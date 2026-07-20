import { MemoryMcpClient } from "./mcp.js";

export interface MemoryBucketSummary {
  id: string;
  title: string;
  domain: string;
  valence: number;
  arousal: number;
  importance: number;
  score: number;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  kind: "memory" | "feel" | "whisper";
}

export interface DailyImpressionSummary {
  id: string;
  date: string;
  title: string;
  valence: number;
  arousal: number;
  intensity: number;
}

export interface MemorySearchHit {
  id: string;
  title: string;
  snippet: string;
  kind: "direct" | "related";
  created?: string;
}

export interface MemoryEvidenceEntry {
  id: string;
  title: string;
  snippet: string;
  sourceType: string;
}

export interface MemoryEvidenceChain {
  bucketId: string;
  summary: string;
  direct: MemoryEvidenceEntry[];
  derived: MemoryEvidenceEntry[];
  context: MemoryEvidenceEntry[];
  warnings: string[];
}

export interface MemoryPortraitItem {
  text: string;
  emotions: string[];
  trigger?: string;
  action?: string;
  avoid?: string;
}

export interface MemoryPortraitGroup {
  title: string;
  items: MemoryPortraitItem[];
}

export interface MemoryPortraitSection {
  id: "user" | "self" | "bond" | "continuity";
  title: string;
  groups: MemoryPortraitGroup[];
}

export interface MemoryPortrait {
  sections: MemoryPortraitSection[];
  source: "memory-3-profile";
}

export interface MemoryHoldOptions {
  tags?: string[];
  importance?: number;
  title?: string;
  verificationText?: string;
}

export interface MemoryHoldResult {
  result: string;
  bucketId?: string;
  verified: boolean;
  verification: "content-match" | "content-mismatch" | "missing-bucket-id" | "bucket-unreadable";
  bucket?: MemoryBucketSummary;
}

function numberAfter(line: string, pattern: RegExp, fallback = 0) {
  const value = Number(line.match(pattern)?.[1]);
  return Number.isFinite(value) ? value : fallback;
}

function normalizedMemoryText(value: string) {
  return value.toLocaleLowerCase("zh-CN").replace(/[^\p{L}\p{N}]+/gu, "");
}

function memoryBigrams(value: string) {
  const normalized = normalizedMemoryText(value);
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) grams.add(normalized.slice(index, index + 2));
  return grams;
}

export function memoryContentMatches(proposed: string, stored: string) {
  const expected = normalizedMemoryText(proposed);
  const actual = normalizedMemoryText(stored);
  if (!expected || !actual) return false;
  if (actual.includes(expected) || expected.includes(actual)) return true;
  const expectedGrams = memoryBigrams(expected);
  const actualGrams = memoryBigrams(actual);
  if (!expectedGrams.size || !actualGrams.size) return false;
  let shared = 0;
  expectedGrams.forEach((gram) => { if (actualGrams.has(gram)) shared += 1; });
  return shared / Math.min(expectedGrams.size, actualGrams.size) >= 0.42;
}

function bucketIdFromHoldResult(result: string) {
  const trimmed = result.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const candidate = parsed.bucket_id ?? parsed.bucketId ?? parsed.id;
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    } catch { /* Fall back to the text formats returned by older Memory builds. */ }
  }
  return result.match(/bucket[_ ]?id\s*[:：=]\s*([a-zA-Z0-9_-]+)/i)?.[1]
    ?? result.match(/\[bucket_id:([^\]]+)\]/i)?.[1];
}

export function extractBucketContent(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return raw;
  try {
    const parsed = JSON.parse(trimmed) as { content?: unknown };
    return typeof parsed.content === "string" ? parsed.content : raw;
  } catch {
    return raw;
  }
}

export function parseBreathResults(text: string): MemorySearchHit[] {
  const lines = text.split(/\r?\n/);
  const results: MemorySearchHit[] = [];
  let section: "direct" | "related" = "direct";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.includes("联想浮现")) { section = "related"; continue; }
    if (line.includes("直接命中记忆")) { section = "direct"; continue; }
    const id = line.match(/\[bucket_id:([^\]]+)\]/)?.[1];
    if (!id) continue;
    const created = line.match(/\[created:([^\]]+)\]/)?.[1];
    if (section === "related" || line.startsWith("-")) {
      const summary = line.match(/摘要[:：]\s*(.*?)(?:\s*\/\s*[^（(]+)?(?:[（(].*)?$/)?.[1]?.trim() || id;
      results.push({ id, title: summary, snippet: summary, kind: "related", created });
      continue;
    }
    const afterTokens = line.replace(/\[[^\]]+\]\s*/g, "").trim();
    const title = afterTokens.replace(/^(?:body|feel|whisper|fact)\s+/i, "").replace(/\s+(?:bucket_[a-z_]+|###\s*[a-z_]+)$/i, "").trim() || id;
    const snippet = lines.slice(index + 1).find((candidate) => candidate.trim() && !candidate.trim().startsWith("==="))?.trim() || title;
    results.push({ id, title, snippet, kind: "direct", created });
  }
  return [...new Map(results.map((result) => [result.id, result])).values()];
}

export function parseEvidenceChain(bucketId: string, text: string): MemoryEvidenceChain {
  const chain: MemoryEvidenceChain = { bucketId, summary: "", direct: [], derived: [], context: [], warnings: [] };
  const lines = text.split(/\r?\n/);
  let section: "summary" | "direct" | "derived" | "context" | "warnings" = "summary";
  const summary: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("=== Evidence Chain:")) continue;
    if (/^直接证据[:：]$/.test(line)) { section = "direct"; continue; }
    if (/^推导证据[:：]$/.test(line)) { section = "derived"; continue; }
    if (/^上下文证据[:：]$/.test(line)) { section = "context"; continue; }
    if (/^提醒[:：]$/.test(line)) { section = "warnings"; continue; }
    if (section === "warnings") { chain.warnings.push(line.replace(/^[-•]\s*/, "")); continue; }
    const match = line.match(/^[-•]\s*\[([^\]]+)\]\s*\[bucket_id:([^\]]+)\]\s*(.*)$/);
    if (match && section !== "summary") {
      const rest = match[3].trim();
      const splitAt = rest.search(/[:：]/);
      const entry: MemoryEvidenceEntry = {
        sourceType: match[1],
        id: match[2],
        title: splitAt >= 0 ? rest.slice(0, splitAt).trim() : rest,
        snippet: splitAt >= 0 ? rest.slice(splitAt + 1).trim() : "",
      };
      chain[section].push(entry);
      continue;
    }
    if (section === "summary") summary.push(line);
  }
  chain.summary = summary.join("\n");
  return chain;
}

export function parsePortrait(text: string): MemoryPortrait {
  const ids: Record<string, MemoryPortraitSection["id"]> = {
    "User Profile": "user",
    "Self Profile": "self",
    Bond: "bond",
    "Continuity Profile": "continuity",
  };
  const sections: MemoryPortraitSection[] = [];
  let section: MemoryPortraitSection | undefined;
  let group: MemoryPortraitGroup | undefined;
  let item: MemoryPortraitItem | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sectionTitle = line.match(/^===\s*(.*?)\s*===$/)?.[1];
    if (sectionTitle && ids[sectionTitle]) {
      section = { id: ids[sectionTitle], title: sectionTitle, groups: [] };
      sections.push(section);
      group = undefined;
      item = undefined;
      continue;
    }
    if (!section) continue;
    if (!line.startsWith("-") && /[:：]$/.test(line) && !/^(情感|触发|应做|避免)[:：]/.test(line)) {
      group = { title: line.replace(/[:：]$/, ""), items: [] };
      section.groups.push(group);
      item = undefined;
      continue;
    }
    if (line.startsWith("- ") && group) {
      item = { text: line.slice(2).trim(), emotions: [] };
      group.items.push(item);
      continue;
    }
    if (!item) continue;
    const metadata = line.match(/^(情感|触发|应做|避免)[:：]\s*(.*)$/);
    if (!metadata) continue;
    const value = metadata[2].trim();
    if (metadata[1] === "情感") item.emotions = value.split(/[，,]/).map((entry) => entry.trim()).filter(Boolean);
    if (metadata[1] === "触发") item.trigger = value;
    if (metadata[1] === "应做") item.action = value;
    if (metadata[1] === "避免") item.avoid = value;
  }
  return { sections, source: "memory-3-profile" };
}

export function parsePulse(text: string): MemoryBucketSummary[] {
  return text.split(/\r?\n/).flatMap((line) => {
    if (!line.includes("bucket_id:")) return [];
    const id = line.match(/bucket_id:(\S+)/)?.[1];
    if (!id) return [];
    const title = line.match(/\[([^\]]+)\]/)?.[1] ?? id;
    const domain = line.match(/主题:(.*?)\s+情感:/)?.[1]?.trim() || "未分类";
    const tags = (line.match(/标签:(.*)$/)?.[1] ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const kind = tags.includes("whisper") ? "whisper" : tags.includes("daily_impression") || line.trimStart().startsWith("🫧") ? "feel" : "memory";
    return [{
      id,
      title,
      domain,
      valence: numberAfter(line, /情感:V(-?\d+(?:\.\d+)?)/, .5),
      arousal: numberAfter(line, /\/A(-?\d+(?:\.\d+)?)/, .3),
      importance: numberAfter(line, /重要:(\d+)/, 5),
      score: numberAfter(line, /权重:(\d+(?:\.\d+)?)/, 0),
      tags,
      pinned: line.trimStart().startsWith("📌"),
      archived: line.includes("[已解决]") || line.trimStart().startsWith("📦"),
      kind,
    } satisfies MemoryBucketSummary];
  });
}

export function dailyImpressions(buckets: MemoryBucketSummary[]): DailyImpressionSummary[] {
  return buckets.flatMap((bucket) => {
    if (!bucket.tags.includes("daily_impression")) return [];
    const date = bucket.title.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? bucket.id.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!date) return [];
    const distance = Math.sqrt((bucket.valence - .5) ** 2 + (bucket.arousal - .3) ** 2);
    return [{ ...bucket, date, intensity: Math.max(1, Math.min(3, Math.ceil(distance * 6))) }];
  });
}

export class MemoryAdapter {
  private readonly client: MemoryMcpClient;

  constructor(url: string, authorization = "") {
    this.client = new MemoryMcpClient(url, authorization);
  }

  async health() {
    const tools = await this.client.listTools();
    return { status: "ok" as const, provider: "ombre-brain-mcp" as const, ...this.client.serverInfo, tools: tools.map((tool) => tool.name) };
  }

  async listBuckets(includeArchive = false) {
    return parsePulse(await this.client.callTool("pulse", { include_archive: includeArchive }));
  }

  async readBucket(bucketId: string) {
    const raw = await this.client.callTool("read_bucket", { bucket_id: bucketId });
    return { id: bucketId, content: extractBucketContent(raw) };
  }

  async search(query: string, maxResults = 20) {
    const content = await this.client.callTool("breath", { query, max_results: maxResults, include_related: true, surface: "ocean" });
    return { query, content, results: parseBreathResults(content) };
  }

  async contextForChat(query: string, maxResults = 4, maxCharacters = 3200) {
    const result = await this.search(query, maxResults);
    const selected = result.results.slice(0, Math.min(3, maxResults));
    if (!selected.length) return { text: "", count: 0, directCount: 0, relatedCount: 0 };
    const details = await Promise.allSettled(selected.slice(0, 2).map((hit) => this.readBucket(hit.id)));
    let remaining = Math.max(500, maxCharacters);
    const blocks: string[] = [];
    selected.forEach((hit, index) => {
      const detail = details[index];
      const full = detail?.status === "fulfilled" ? detail.value.content.trim() : "";
      const body = (full || hit.snippet || hit.title).slice(0, remaining);
      if (!body) return;
      const block = `[${hit.kind === "direct" ? "direct" : "related"} memory · ${hit.id}] ${hit.title}\n${body}`;
      blocks.push(block);
      remaining -= block.length;
    });
    return {
      text: blocks.join("\n\n").slice(0, maxCharacters),
      count: blocks.length,
      directCount: selected.filter((hit) => hit.kind === "direct").length,
      relatedCount: selected.filter((hit) => hit.kind !== "direct").length,
    };
  }

  async evidence(bucketId: string) {
    const content = await this.client.callTool("breath", { query: bucketId, mode: "evidence", max_results: 20, include_related: true, surface: "ocean" });
    return parseEvidenceChain(bucketId, content);
  }

  async portrait() {
    const content = await this.client.callTool("breath", { mode: "profile", max_results: 20, include_core: true, surface: "ocean" });
    return parsePortrait(content);
  }

  async breath(args: Record<string, unknown>) {
    return { content: await this.client.callTool("breath", { ...args, surface: "ocean" }) };
  }

  async hold(content: string, source: string, options: MemoryHoldOptions = {}): Promise<MemoryHoldResult> {
    const tags = [...new Set(["ocean", source, ...(options.tags ?? [])].map((tag) => tag.trim()).filter(Boolean))].slice(0, 16);
    const importance = Math.max(1, Math.min(10, Math.round(options.importance ?? 5)));
    // Memory 3.0 returns a display title after `new`/`merge`, while a related
    // read-only memory may also be appended as `[bucket_id:...]`.  Treating
    // that related id as the write result makes a successful write look like
    // a failed one.  Diff the bucket inventory around the write and prefer the
    // genuinely new Ocean-tagged bucket; only fall back to legacy ids when no
    // new bucket can be observed.
    const before = await this.listBuckets(true);
    const beforeIds = new Set(before.map((entry) => entry.id));
    const result = await this.client.callTool("hold", {
      content,
      tags: tags.join(","),
      importance,
      ...(options.title?.trim() ? { title: options.title.trim() } : {}),
    });
    const after = await this.listBuckets(true);
    const created = after.filter((entry) => !beforeIds.has(entry.id));
    const expectedTitle = options.title?.trim();
    const preferredCreated = created.find((entry) => expectedTitle && entry.title === expectedTitle)
      ?? created.find((entry) => entry.tags.includes("ocean") && entry.tags.includes(source))
      ?? created.find((entry) => entry.tags.includes("ocean"))
      ?? created.at(-1);
    const bucketId = preferredCreated?.id ?? bucketIdFromHoldResult(result);
    if (!bucketId) return { result, verified: false, verification: "missing-bucket-id" };
    try {
      const detail = await this.readBucket(bucketId);
      const bucket = after.find((entry) => entry.id === bucketId) ?? preferredCreated;
      const verified = memoryContentMatches(options.verificationText ?? content, detail.content);
      return {
        result,
        bucketId,
        verified,
        verification: verified ? "content-match" : "content-mismatch",
        bucket,
      };
    } catch {
      return { result, bucketId, verified: false, verification: "bucket-unreadable" };
    }
  }
}

export function createMemoryAdapterFromEnv() {
  const url = process.env.OCEAN_MEMORY_MCP_URL?.trim();
  if (!url) return null;
  return new MemoryAdapter(url, process.env.OCEAN_MEMORY_AUTH_TOKEN?.trim() ?? "");
}
