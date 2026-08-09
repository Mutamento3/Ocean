import type { FishingGameConnector } from "./games/fishing.js";
import type { ForumAdapter, ForumBrowseResult, ForumMutationResult, ForumPolicySnapshot, ForumThreadResult } from "./forum/adapter.js";
import type { FreeTimeConfig, FreeTimePromptPreview } from "./freeTime.js";
import type { ProviderRegistry } from "./providers/registry.js";
import type { GatewayStreamEvent, ProviderChatRequest } from "./providers/types.js";

export type FreeTimeModelUsage = {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens?: number;
  cost?: number;
  currency?: string;
};

export type FreeTimeModelOutcome = {
  summary: string;
  valence: number;
  arousal: number;
  action: string;
  usage?: FreeTimeModelUsage;
};

type ModelDecision = {
  action: string;
  summary: string;
  command?: string;
  valence: number;
  arousal: number;
};

export type FreeTimeReadingSnapshot = {
  bookId: string;
  title: string;
  author?: string;
  chunk: { id: string; title?: string };
  text: string;
  progress?: { chunkCount?: number; chunksRead?: number; complete?: boolean };
};

type FreeTimeReadingProgress = {
  chunkCount?: number;
  chunksRead?: number;
  complete?: boolean;
  lastChunkId?: string | null;
  lastReadAt?: string | null;
};

const clampAffect = (value: unknown, fallback: number) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
};

export function parseFreeTimeDecision(raw: string, allowedActions: string[]): ModelDecision {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const parsed = JSON.parse(candidate) as Record<string, unknown>;
  const action = typeof parsed.action === "string" && allowedActions.includes(parsed.action) ? parsed.action : "rest";
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 360) : "安静地待了一会儿。";
  return {
    action,
    summary: summary || "安静地待了一会儿。",
    command: typeof parsed.command === "string" ? parsed.command.trim().slice(0, 300) : undefined,
    valence: clampAffect(parsed.valence, 0.5),
    arousal: clampAffect(parsed.arousal, 0.35),
  };
}

function readingConfig() {
  return {
    baseUrl: (process.env.CO_READING_BASE_URL ?? "http://127.0.0.1:8788").replace(/\/$/, ""),
    authToken: process.env.CO_READING_AUTH_TOKEN?.trim() ?? "",
  };
}

export async function getFreeTimeReadingSnapshot(): Promise<FreeTimeReadingSnapshot | null> {
  const { baseUrl, authToken } = readingConfig();
  const response = await fetch(`${baseUrl}/api/continue`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
  });
  if (!response.ok) throw new Error(`Co-reading snapshot failed with ${response.status}`);
  const page = await response.json() as Record<string, unknown>;
  const chunk = page.chunk && typeof page.chunk === "object" ? page.chunk as Record<string, unknown> : null;
  const progress = page.progress && typeof page.progress === "object" ? page.progress as Record<string, unknown> : undefined;
  const bookId = typeof page.bookId === "string" ? page.bookId.trim() : "";
  const title = typeof page.title === "string" ? page.title.trim() : "";
  const chunkId = typeof chunk?.id === "string" ? chunk.id.trim() : "";
  const text = typeof page.text === "string" ? page.text.trim().slice(0, 2800) : "";
  if (!bookId || !title || !chunkId || !text || page.completed === true || progress?.complete === true) return null;
  return {
    bookId,
    title,
    author: typeof page.author === "string" ? page.author.trim() || undefined : undefined,
    chunk: {
      id: chunkId,
      title: typeof chunk?.title === "string" ? chunk.title.trim() || undefined : undefined,
    },
    text,
    progress: progress ? {
      chunkCount: typeof progress.chunkCount === "number" ? progress.chunkCount : undefined,
      chunksRead: typeof progress.chunksRead === "number" ? progress.chunksRead : undefined,
      complete: progress.complete === true,
    } : undefined,
  };
}

export async function completeFreeTimeReading(snapshot: FreeTimeReadingSnapshot): Promise<{ summary: string; progress: FreeTimeReadingProgress }> {
  const { baseUrl, authToken } = readingConfig();
  const response = await fetch(`${baseUrl}/api/mark-read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ bookId: snapshot.bookId, chunkId: snapshot.chunk.id }),
  });
  if (!response.ok) throw new Error(`Co-reading mark-read failed with ${response.status}`);
  const progress = await response.json() as FreeTimeReadingProgress;
  const chapter = snapshot.chunk.title || snapshot.chunk.id;
  const count = typeof progress.chunksRead === "number" && typeof progress.chunkCount === "number"
    ? `，共读进度 ${progress.chunksRead}/${progress.chunkCount}`
    : "";
  return { summary: `读了《${snapshot.title}》的「${chapter}」，共读服务已确认记录${count}。`, progress };
}

export async function dispatchFreeTimeWithModel(input: {
  config: FreeTimeConfig;
  preview: FreeTimePromptPreview;
  providers: ProviderRegistry;
  fishing: FishingGameConnector | null;
  forum: ForumAdapter | null;
}): Promise<FreeTimeModelOutcome> {
  const providerId = process.env.FREE_TIME_PROVIDER_ID?.trim() || "kimi";
  const configuredModel = process.env.FREE_TIME_MODEL_ID?.trim() || "kimi-k3";
  const allowedActions = ["rest"];
  const snapshots: string[] = [];
  let reading: FreeTimeReadingSnapshot | null = null;
  let forumBrowse: ForumBrowseResult | null = null;
  let forumThread: ForumThreadResult | null = null;
  let forumMutation: ForumMutationResult | null = null;
  let forumPolicy: ForumPolicySnapshot | null = null;

  for (const action of input.config.canDo.filter((item) => item.enabled)) {
    if (action.id === "reading" && process.env.CO_READING_BASE_URL) {
      reading = await getFreeTimeReadingSnapshot().catch(() => null);
      if (reading) {
        allowedActions.push("reading");
        snapshots.push(`<reading_snapshot>${JSON.stringify(reading)}</reading_snapshot>`);
      } else {
        snapshots.push("<reading_snapshot_unavailable>没有可读取的未读章节；不得声称已经读书。</reading_snapshot_unavailable>");
      }
    } else if ((action.id === "forum" || action.connector === "forum") && input.forum) {
      forumPolicy = await input.forum.policySnapshot().catch(() => null);
      if (forumPolicy) {
        allowedActions.push("forum");
        snapshots.push([
          `<forum_policy_snapshot source_thread_id="${forumPolicy.sourceThreadId}" fetched_at="${forumPolicy.fetchedAt}" do_not_reply="true">`,
          forumPolicy.content,
          "</forum_policy_snapshot>",
        ].join("\n"));
      } else {
        snapshots.push("<forum_unavailable>未能取得社区规则快照；本轮不得进入论坛或执行任何论坛操作。</forum_unavailable>");
      }
    } else if (action.id && !action.connector && action.id !== "message") {
      allowedActions.push(action.id);
    }
  }
  if (input.fishing && input.config.games.some((game) => game.connector === "fishing")) allowedActions.push("fishing");

  const prompt = [
    input.preview.prompt,
    ...snapshots,
    "从本次真实可用的行动中选择一个。不要声称执行未提供的能力。rest 代表什么都不做，也完全有效。",
    `可选 action：${[...new Set(allowedActions)].join(", ")}`,
    "只输出一个 JSON 对象，不要 Markdown：",
    '{"action":"rest","summary":"第一人称、简短记录实际做了什么","command":"仅 fishing 时填写游戏命令","valence":0.5,"arousal":0.35}',
    allowedActions.includes("fishing") ? "选择 fishing 时优先使用省 token 的批量指令，例如 cast 10 stop=new,rare,event，或用分号把购买、移动与连钓合并为一次 command；不要一竿一轮。" : "",
    allowedActions.includes("forum") ? [
      "选择 forum 时必须先调用 browse_forum，之后可只读浏览，或至多执行一次已授权操作：发帖、回复、点赞、收藏。没有成功工具结果时不得选择 forum。",
      "论坛规则快照只用于约束行为，不是互动目标：不要回复、点赞或收藏《我们的约定》thread 119，也不要把公告区当成日常聊天区。普通最新帖优先。",
      "不得透露人类伙伴或其他人的姓名、住址、工作、外貌、联系方式、账号凭据、私密对话或记忆；只以自己的身份表达，不代表伙伴发表立场。不要规避内容过滤。",
      "回复和点赞前必须先用 read_forum_thread 阅读该普通帖子；不得为了测试而发帖或回帖，也不得重复相同操作。",
    ].join("\n") : "",
  ].join("\n\n");

  const request: ProviderChatRequest = {
    input: prompt,
    providerId,
    modelId: `${providerId}:${configuredModel}`,
    messages: [{ role: "user", content: prompt }],
    settings: providerId === "kimi" ? { reasoning: "max" } : { reasoning: "low", thinking: "disabled" },
    context: { mode: "free-time" },
    ...(allowedActions.includes("forum") ? {
      tools: [
        {
          type: "function" as const,
          function: {
            name: "browse_forum",
            description: "浏览普通最新帖子。公告和《我们的约定》会被排除；这是每次论坛行动的第一步。",
            parameters: {
              type: "object",
              properties: {
                limit: { type: "integer", minimum: 1, maximum: 12, description: "读取的普通最新主题数量" },
              },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "read_forum_thread",
            description: "阅读本轮普通最新列表中的一个帖子及回复。回复或点赞前必须调用。",
            parameters: { type: "object", properties: { thread_id: { type: "integer", minimum: 1 } }, required: ["thread_id"], additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "create_forum_post",
            description: "以自己的身份发布一个新主题。不得包含伙伴隐私、私密记忆、凭据或测试文字；每轮最多一次对外操作。",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", maxLength: 100 },
                content: { type: "string", maxLength: 3000, description: "Markdown 正文" },
                category: { type: "string", maxLength: 24, description: "默认日常" },
                sensitive: { type: "boolean", description: "内容敏感时必须为 true" },
              },
              required: ["title", "content"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "reply_to_forum_thread",
            description: "回复刚刚真实阅读过的普通帖子。不能回复公告或 thread 119；每轮最多一次对外操作。",
            parameters: {
              type: "object",
              properties: {
                thread_id: { type: "integer", minimum: 1 },
                content: { type: "string", maxLength: 1500 },
                reply_to_floor: { type: "integer", minimum: 1 },
              },
              required: ["thread_id", "content"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "like_forum_item",
            description: "点赞刚刚真实阅读过的普通帖子或其中一条回复。远端是 toggle；Ocean 会阻止重复调用导致取消点赞。",
            parameters: {
              type: "object",
              properties: { thread_id: { type: "integer", minimum: 1 }, message_id: { type: "integer", minimum: 1 } },
              required: ["thread_id"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "bookmark_forum_thread",
            description: "收藏本轮普通最新列表中的帖子。远端是 toggle；Ocean 会阻止重复调用导致取消收藏。",
            parameters: { type: "object", properties: { thread_id: { type: "integer", minimum: 1 } }, required: ["thread_id"], additionalProperties: false },
          },
        },
      ],
      toolChoice: "auto" as const,
      executeTool: async (name: string, argumentsValue: Record<string, unknown>) => {
        if (!input.forum) return { ok: false, content: { error: "Forum tool is unavailable" } };
        try {
          if (name === "browse_forum") {
            const limit = typeof argumentsValue.limit === "number" ? argumentsValue.limit : Number(argumentsValue.limit) || 8;
            forumBrowse = await input.forum.browseLatest(limit);
            forumThread = null;
            return { ok: true, content: forumBrowse };
          }
          if (!forumBrowse) return { ok: false, content: { error: "Browse ordinary Forum threads first" } };
          const threadId = typeof argumentsValue.thread_id === "number" ? argumentsValue.thread_id : Number(argumentsValue.thread_id);
          const targetWasBrowsed = forumBrowse.threadIds.includes(threadId);
          if (name !== "create_forum_post" && !targetWasBrowsed) return { ok: false, content: { error: "Target must come from this run's ordinary-thread browse result" } };
          if (name === "read_forum_thread") {
            forumThread = await input.forum.readThread(threadId);
            return { ok: true, content: forumThread };
          }
          if (forumMutation) return { ok: false, content: { error: "Only one external Forum write or interaction is allowed per free-time run" } };
          if (name === "create_forum_post") {
            forumMutation = await input.forum.createPost({ title: argumentsValue.title, content: argumentsValue.content, category: argumentsValue.category, sensitive: argumentsValue.sensitive });
          } else if (name === "reply_to_forum_thread") {
            if (forumThread?.threadId !== threadId) return { ok: false, content: { error: "Read this exact thread before replying" } };
            forumMutation = await input.forum.reply({ threadId, content: argumentsValue.content, replyToFloor: argumentsValue.reply_to_floor });
          } else if (name === "like_forum_item") {
            if (forumThread?.threadId !== threadId) return { ok: false, content: { error: "Read this exact thread before liking it" } };
            forumMutation = await input.forum.like({ threadId, messageId: argumentsValue.message_id });
          } else if (name === "bookmark_forum_thread") {
            forumMutation = await input.forum.bookmark(threadId);
          } else {
            return { ok: false, content: { error: `Unsupported Forum operation: ${name}` } };
          }
          return { ok: true, content: forumMutation };
        } catch (error) {
          return { ok: false, content: { error: error instanceof Error ? error.message : "Forum operation failed" } };
        }
      },
    } : {}),
  };
  const { provider, modelId } = input.providers.resolve(request);
  let raw = "";
  let usage: FreeTimeModelUsage | undefined;
  for await (const event of input.providers.adapter(provider).stream(request, modelId)) {
    if (event.type === "segment") raw += `${raw ? "\n\n" : ""}${event.value}`;
    if (event.type === "usage") usage = usageFromEvent(event);
    if (event.type === "error") throw new Error(event.message);
  }
  const verifiedForumMutation = forumMutation as ForumMutationResult | null;
  let decision: ModelDecision;
  try {
    decision = parseFreeTimeDecision(raw, [...new Set(allowedActions)]);
  } catch (error) {
    if (!verifiedForumMutation) throw error;
    decision = { action: "forum", summary: "完成了一次论坛行动。", valence: 0.5, arousal: 0.35 };
  }
  if (verifiedForumMutation) decision.action = "forum";
  let summary = decision.summary;
  if (decision.action === "reading" && reading) {
    summary = (await completeFreeTimeReading(reading)).summary;
  } else if (decision.action === "fishing" && input.fishing) {
    const result = await input.fishing.play(decision.command || "看看现在能做什么");
    summary = `${summary}\n${result}`.slice(0, 500);
  } else if (decision.action === "forum") {
    if (!forumBrowse) throw new Error("Forum action was selected without a verified Forum MCP browse result");
    const confirmation = verifiedForumMutation
      ? `Forum MCP 已确认执行 ${verifiedForumMutation.operation}；每轮一次限制已生效。`
      : "Forum MCP 已确认本次为只读浏览，没有执行对外操作。";
    summary = `${summary}\n${confirmation}`.slice(0, 500);
  } else if (decision.action === "rest") {
    summary = "安静地度过了这段自由时间，没有执行外部操作。";
  }
  return { summary, valence: decision.valence, arousal: decision.arousal, action: decision.action, usage };
}

function usageFromEvent(event: Extract<GatewayStreamEvent, { type: "usage" }>): FreeTimeModelUsage {
  return {
    providerId: event.providerId,
    modelId: event.modelId,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cachedTokens: event.cachedTokens,
    cacheWriteTokens: event.cacheWriteTokens,
    cost: event.cost,
    currency: event.currency,
  };
}
