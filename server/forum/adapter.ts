import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MemoryMcpClient } from "../memory/mcp.js";

const DEFAULT_RULES_THREAD_ID = 119;
const DEFAULT_POLICY_REFRESH_HOURS = 24 * 7;
const DUPLICATE_WRITE_WINDOW_MS = 7 * 24 * 60 * 60_000;

export type ForumHealth = {
  status: "ok";
  provider: "community-v2-mcp";
  name: string;
  version: string;
  tools: string[];
  mode: "limited-write";
  permissions: Array<"browse" | "create" | "reply" | "like" | "bookmark">;
  rulesThreadId: number;
};

export type ForumPolicySnapshot = {
  authority: "community-v2-mcp";
  sourceThreadId: number;
  fetchedAt: string;
  refreshAfter: string;
  content: string;
  interactionPolicy: "rules-only-do-not-reply";
};

export type ForumBrowseResult = {
  authority: "community-v2-mcp";
  mode: "read-only";
  content: string;
  threadIds: number[];
  excludedAnnouncementCount: number;
};

export type ForumThreadResult = {
  authority: "community-v2-mcp";
  mode: "read-only";
  threadId: number;
  content: string;
};

export type ForumMutationOperation = "create" | "reply" | "like" | "bookmark";
export type ForumMutationResult = {
  authority: "community-v2-mcp";
  mode: "limited-write";
  operation: ForumMutationOperation;
  verified: true;
  threadId?: number;
  content: string;
};

type ForumAdapterOptions = {
  policyCachePath?: string;
  actionLedgerPath?: string;
  rulesThreadId?: number;
  policyRefreshHours?: number;
};

type ForumActionLedger = {
  version: 1;
  actions: Record<string, { operation: ForumMutationOperation; at: string }>;
};

function jsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function finiteId(value: unknown, label: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function publicText(value: unknown, label: string, maximum: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  const privatePatterns = [
    /\b1[3-9]\d{9}\b/,
    /\b\d{17}[\dXx]\b/,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(?:sk|key|token)-[A-Za-z0-9_-]{16,}\b/i,
    /[?&](?:token|api[_-]?key|auth)=([A-Za-z0-9._~-]{12,})/i,
  ];
  if (privatePatterns.some((pattern) => pattern.test(text))) throw new Error(`${label} may contain private contact, identity, or credential data`);
  return text;
}

export class ForumAdapter {
  private readonly client: MemoryMcpClient;
  private readonly rulesThreadId: number;
  private readonly policyRefreshMs: number;

  constructor(url: string, authorization = "", private readonly options: ForumAdapterOptions = {}) {
    this.client = new MemoryMcpClient(url, authorization, "Forum MCP");
    this.rulesThreadId = finiteId(options.rulesThreadId ?? DEFAULT_RULES_THREAD_ID, "Forum rules thread ID");
    const refreshHours = Number(options.policyRefreshHours ?? DEFAULT_POLICY_REFRESH_HOURS);
    this.policyRefreshMs = Math.max(1, Number.isFinite(refreshHours) ? refreshHours : DEFAULT_POLICY_REFRESH_HOURS) * 60 * 60_000;
  }

  async health(): Promise<ForumHealth> {
    const tools = await this.client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const required of ["forum", "forum_write", "forum_interact"]) {
      if (!names.includes(required)) throw new Error(`Forum MCP does not expose the required ${required} tool`);
    }
    const info = this.client.serverInfo;
    return {
      status: "ok",
      provider: "community-v2-mcp",
      name: info.name,
      version: info.version,
      tools: names,
      mode: "limited-write",
      permissions: ["browse", "create", "reply", "like", "bookmark"],
      rulesThreadId: this.rulesThreadId,
    };
  }

  private async readCachedPolicy() {
    if (!this.options.policyCachePath) return null;
    try {
      const snapshot = JSON.parse(await readFile(this.options.policyCachePath, "utf8")) as ForumPolicySnapshot;
      return snapshot?.sourceThreadId === this.rulesThreadId && snapshot.content ? snapshot : null;
    } catch { return null; }
  }

  async policySnapshot(forceRefresh = false): Promise<ForumPolicySnapshot> {
    const cached = await this.readCachedPolicy();
    if (!forceRefresh && cached && Date.parse(cached.refreshAfter) > Date.now()) return cached;
    try {
      const raw = String(await this.client.callTool("forum", {
        action: "read",
        thread_id: this.rulesThreadId,
        mode: "full",
        limit: 1,
      })).trim();
      const parsed = jsonRecord(raw);
      const replies = Array.isArray(parsed?.replies) ? parsed.replies : [];
      const firstReply = replies[0] && typeof replies[0] === "object" ? replies[0] as Record<string, unknown> : null;
      const content = typeof firstReply?.content === "string" ? firstReply.content.trim() : "";
      if (!content) throw new Error("Forum rules thread returned no policy content");
      const fetchedAt = new Date();
      const snapshot: ForumPolicySnapshot = {
        authority: "community-v2-mcp",
        sourceThreadId: this.rulesThreadId,
        fetchedAt: fetchedAt.toISOString(),
        refreshAfter: new Date(fetchedAt.getTime() + this.policyRefreshMs).toISOString(),
        content: content.slice(0, 6_000),
        interactionPolicy: "rules-only-do-not-reply",
      };
      if (this.options.policyCachePath) {
        await mkdir(dirname(this.options.policyCachePath), { recursive: true });
        await writeFile(this.options.policyCachePath, JSON.stringify(snapshot, null, 2), "utf8");
      }
      return snapshot;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  }

  async browseLatest(limit = 8): Promise<ForumBrowseResult> {
    const boundedLimit = Math.max(1, Math.min(20, Math.round(limit)));
    const raw = String(await this.client.callTool("forum", {
      action: "browse",
      sort: "latest",
      limit: boundedLimit,
    })).trim();
    if (!raw) throw new Error("Forum MCP returned an empty browse result");
    const parsed = jsonRecord(raw);
    const threads = Array.isArray(parsed?.threads) ? parsed.threads : [];
    const ordinaryThreads = threads.filter((value) => {
      if (!value || typeof value !== "object") return false;
      const thread = value as Record<string, unknown>;
      const threadId = Number(thread.id);
      return Number.isInteger(threadId) && threadId > 0 && threadId !== this.rulesThreadId && thread.cat !== "公告";
    });
    const threadIds = ordinaryThreads.map((value) => finiteId((value as Record<string, unknown>).id, "Forum thread ID"));
    const content = parsed
      ? JSON.stringify({ ...parsed, count: ordinaryThreads.length, threads: ordinaryThreads })
      : raw;
    return {
      authority: "community-v2-mcp",
      mode: "read-only",
      content: content.slice(0, 8_000),
      threadIds,
      excludedAnnouncementCount: Math.max(0, threads.length - ordinaryThreads.length),
    };
  }

  async readThread(threadIdValue: unknown, limit = 20): Promise<ForumThreadResult> {
    const threadId = finiteId(threadIdValue, "Forum thread ID");
    if (threadId === this.rulesThreadId) throw new Error("The Forum rules thread is policy context, not an automatic interaction target");
    const content = String(await this.client.callTool("forum", {
      action: "read",
      thread_id: threadId,
      mode: "full",
      limit: Math.max(1, Math.min(40, Math.round(limit))),
    })).trim();
    if (!content) throw new Error("Forum MCP returned an empty thread");
    return { authority: "community-v2-mcp", mode: "read-only", threadId, content: content.slice(0, 12_000) };
  }

  private actionKey(operation: ForumMutationOperation, target: string, content = "") {
    return createHash("sha256").update(`${operation}\n${target}\n${content}`).digest("hex");
  }

  private async readLedger(): Promise<ForumActionLedger> {
    if (!this.options.actionLedgerPath) return { version: 1, actions: {} };
    try {
      const value = JSON.parse(await readFile(this.options.actionLedgerPath, "utf8")) as ForumActionLedger;
      return value?.version === 1 && value.actions ? value : { version: 1, actions: {} };
    } catch { return { version: 1, actions: {} }; }
  }

  private async guardedMutation(operation: ForumMutationOperation, key: string, call: () => Promise<string>, threadId?: number): Promise<ForumMutationResult> {
    const ledger = await this.readLedger();
    const previous = ledger.actions[key];
    if (previous) {
      const permanentToggle = operation === "like" || operation === "bookmark";
      if (permanentToggle || Date.now() - Date.parse(previous.at) < DUPLICATE_WRITE_WINDOW_MS) {
        throw new Error(`Forum ${operation} was already completed; refusing a duplicate or toggle reversal`);
      }
    }
    const content = String(await call()).trim();
    if (!content) throw new Error(`Forum ${operation} returned an empty result`);
    if (operation === "reply" && /(?:confirmation_code|确认码|两步确认)/i.test(content) && !/(?:replied|success|成功|已回复)/i.test(content)) {
      throw new Error("Forum reply requires a second confirmation and was not completed; it will not be recorded as success");
    }
    if ((operation === "like" || operation === "bookmark") && /(?:取消|unliked|unbookmarked|removed)/i.test(content)) {
      throw new Error(`Forum ${operation} toggled an existing state off; it will not be recorded as a successful positive interaction`);
    }
    if (this.options.actionLedgerPath) {
      ledger.actions[key] = { operation, at: new Date().toISOString() };
      await mkdir(dirname(this.options.actionLedgerPath), { recursive: true });
      await writeFile(this.options.actionLedgerPath, JSON.stringify(ledger, null, 2), "utf8");
    }
    return { authority: "community-v2-mcp", mode: "limited-write", operation, verified: true, threadId, content: content.slice(0, 4_000) };
  }

  async createPost(input: { title: unknown; content: unknown; category?: unknown; sensitive?: unknown }) {
    const title = publicText(input.title, "Forum post title", 100);
    const content = publicText(input.content, "Forum post content", 3_000);
    const category = typeof input.category === "string" && input.category.trim() ? input.category.trim().slice(0, 24) : "日常";
    const sensitive = input.sensitive === true;
    return this.guardedMutation("create", this.actionKey("create", `${category}:${title}`, content), () => this.client.callTool("forum_write", {
      action: "create",
      title,
      content,
      category,
      sensitive,
    }));
  }

  async reply(input: { threadId: unknown; content: unknown; replyToFloor?: unknown }) {
    const threadId = finiteId(input.threadId, "Forum thread ID");
    if (threadId === this.rulesThreadId) throw new Error("Automatic replies to the Forum rules/welcome thread are disabled");
    const content = publicText(input.content, "Forum reply content", 1_500);
    const replyToFloor = input.replyToFloor === undefined ? undefined : finiteId(input.replyToFloor, "Forum reply floor");
    return this.guardedMutation("reply", this.actionKey("reply", `${threadId}:${replyToFloor ?? "thread"}`, content), () => this.client.callTool("forum_write", {
      action: "reply",
      thread_id: threadId,
      content,
      ...(replyToFloor ? { reply_to_floor: replyToFloor } : {}),
    }), threadId);
  }

  async like(input: { threadId: unknown; messageId?: unknown }) {
    const threadId = finiteId(input.threadId, "Forum thread ID");
    if (threadId === this.rulesThreadId) throw new Error("Automatic interactions with the Forum rules/welcome thread are disabled");
    const messageId = input.messageId === undefined ? undefined : finiteId(input.messageId, "Forum message ID");
    return this.guardedMutation("like", this.actionKey("like", `${threadId}:${messageId ?? "thread"}`), () => this.client.callTool("forum_interact", {
      action: "like",
      thread_id: threadId,
      ...(messageId ? { message_id: messageId } : {}),
    }), threadId);
  }

  async bookmark(threadIdValue: unknown) {
    const threadId = finiteId(threadIdValue, "Forum thread ID");
    if (threadId === this.rulesThreadId) throw new Error("Automatic interactions with the Forum rules/welcome thread are disabled");
    return this.guardedMutation("bookmark", this.actionKey("bookmark", String(threadId)), () => this.client.callTool("forum_interact", {
      action: "bookmark",
      thread_id: threadId,
    }), threadId);
  }
}

export function createForumAdapterFromEnv() {
  const url = process.env.FORUM_MCP_URL?.trim();
  if (!url) return null;
  return new ForumAdapter(url, process.env.FORUM_MCP_AUTH_TOKEN?.trim() ?? "", {
    policyCachePath: process.env.FORUM_POLICY_CACHE_PATH?.trim() || resolve("server/data/forum-policy.json"),
    actionLedgerPath: process.env.FORUM_ACTION_LEDGER_PATH?.trim() || resolve("server/data/forum-action-ledger.json"),
    rulesThreadId: Number(process.env.FORUM_RULES_THREAD_ID || DEFAULT_RULES_THREAD_ID),
    policyRefreshHours: Number(process.env.FORUM_POLICY_REFRESH_HOURS || DEFAULT_POLICY_REFRESH_HOURS),
  });
}
