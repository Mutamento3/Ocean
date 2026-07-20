import type { MemoryAdapter } from "./memory/adapter.js";
import { dailyImpressions } from "./memory/adapter.js";
import type { OceanNotificationService } from "./notifications.js";
import type { ProviderRegistry } from "./providers/registry.js";
import type { JsonStore, StoredPaperNote, StoredPaperNotePackage } from "./store.js";

const TIME_ZONE = process.env.OCEAN_TIME_ZONE?.trim() || "Asia/Shanghai";
const SLOT_DEFINITIONS = [
  { slot: "morning", time: "08:00", label: "早上" },
  { slot: "noon", time: "12:00", label: "午后" },
  { slot: "evening", time: "18:00", label: "傍晚" },
  { slot: "night", time: "22:00", label: "夜里" },
] as const;

function localParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${read("year")}-${read("month")}-${read("day")}`, time: `${read("hour")}:${read("minute")}` };
}

function previousDate(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function stripFence(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return (fenced ?? value).trim();
}

function parseNotes(value: string, date: string): StoredPaperNote[] {
  const cleaned = stripFence(value);
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("paper_note_json_missing");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Array<Record<string, unknown>>;
  if (!Array.isArray(parsed) || parsed.length !== SLOT_DEFINITIONS.length) throw new Error("paper_note_count_invalid");
  return SLOT_DEFINITIONS.map((definition, index) => {
    const text = typeof parsed[index]?.text === "string" ? parsed[index].text.trim().slice(0, 120) : "";
    if (!text) throw new Error(`paper_note_${definition.slot}_empty`);
    return {
      id: `${date}-${definition.slot}`,
      slot: definition.slot,
      time: definition.label,
      text,
      visibleAt: `${date}T${definition.time}:00`,
    };
  });
}

async function modelNotes(providers: ProviderRegistry, impression: { id: string; date: string; content: string }, portraitContext: string, targetDate: string) {
  const configuredProviders = providers.listPublic().filter((provider) => provider.configured && provider.kind !== "mock");
  const fallbackProvider = configuredProviders.find((provider) => provider.id === "openrouter") ?? configuredProviders[0];
  const providerId = process.env.PAPER_NOTE_PROVIDER_ID?.trim() || process.env.OCEAN_DEFAULT_PROVIDER?.trim() || fallbackProvider?.id;
  const modelId = process.env.PAPER_NOTE_MODEL_ID?.trim();
  if (!providerId) throw new Error("paper_note_provider_unconfigured");
  const request = {
    input: `请根据以下 ${impression.date} 日印象，为 ${targetDate} 写四张短纸条。\n\n${impression.content.slice(0, 6000)}`,
    providerId,
    modelId,
    context: {
      mode: "paper-note",
      modeInstruction: "你正在为长期陪伴界面写次日纸条。只输出 JSON 数组，不要 Markdown，不要解释。数组必须恰好四项，顺序为早上、午后、傍晚、夜里；每项格式为 {\"text\":\"...\"}。每张 12-48 个中文字符，具体、自然、彼此不重复，不杜撰事实，不提及系统、模型或记忆库。",
      // Provider adapters always prepend the private configured Ocean
      // system/profile prompt. Portrait remains dynamic reference context and
      // is never copied into the note package, logs, or PWA response.
      memoryContext: `[Memory 3.0 portrait]\n${portraitContext}`,
    },
  };
  const resolved = providers.resolve(request);
  const adapter = providers.adapter(resolved.provider);
  let output = "";
  for await (const event of adapter.stream(request, resolved.modelId)) {
    if (event.type === "segment") output += event.value;
    if (event.type === "error") throw new Error(event.message);
  }
  return { notes: parseNotes(output, targetDate), providerId: resolved.provider.id, modelId: resolved.modelId };
}

export async function generatePaperNotes(store: JsonStore, providers: ProviderRegistry, memory: MemoryAdapter | null, options: { targetDate?: string; force?: boolean } = {}) {
  const targetDate = options.targetDate || localParts().date;
  const existing = store.getPaperNotePackage(targetDate);
  const upgradingProfileContext = Boolean(existing && existing.contextVersion !== 2);
  if (existing && !options.force && !upgradingProfileContext) return { status: "existing" as const, package: existing };
  if (!memory) return { status: "skipped" as const, reason: "memory_unconfigured" };
  const attempt = store.getPaperNoteLastAttemptAt();
  if (!options.force && !upgradingProfileContext && attempt && Date.now() - Date.parse(attempt) < 6 * 60 * 60 * 1000) return { status: "skipped" as const, reason: "retry_cooldown" };
  await store.markPaperNoteAttempt();
  const sourceDate = previousDate(targetDate);
  const impressions = dailyImpressions(await memory.listBuckets(false));
  const impression = impressions.find((entry) => entry.date === sourceDate);
  if (!impression) return { status: "skipped" as const, reason: "source_impression_missing", sourceDate };
  const [detail, portrait] = await Promise.all([memory.readBucket(impression.id), memory.portrait()]);
  const portraitContext = JSON.stringify(portrait).slice(0, 12_000);
  const generated = await modelNotes(providers, { id: impression.id, date: impression.date, content: detail.content }, portraitContext, targetDate);
  const notePackage: StoredPaperNotePackage = {
    date: targetDate,
    sourceDate,
    sourceImpressionId: impression.id,
    contextVersion: 2,
    portraitSource: portrait.source,
    providerId: generated.providerId,
    modelId: generated.modelId,
    generatedAt: new Date().toISOString(),
    notes: generated.notes,
  };
  await store.savePaperNotePackage(notePackage);
  return { status: "generated" as const, package: notePackage };
}

export function visiblePaperNotes(notePackage: StoredPaperNotePackage | undefined, now = new Date()) {
  if (!notePackage) return [];
  const local = localParts(now);
  if (local.date !== notePackage.date) return [];
  return notePackage.notes.filter((note) => note.visibleAt.slice(11, 16) <= local.time);
}

export async function deliverDuePaperNotes(store: JsonStore, notifications: OceanNotificationService, now = new Date()) {
  const local = localParts(now);
  const notePackage = store.getPaperNotePackage(local.date);
  if (!notePackage) return { delivered: 0 };
  let delivered = 0;
  for (const note of visiblePaperNotes(notePackage, now)) {
    if (note.notifiedAt) continue;
    const result = await notifications.notifyPaperNote(note);
    if (result.sent > 0) {
      await store.markPaperNoteNotified(notePackage.date, note.id);
      delivered += result.sent;
    }
  }
  return { delivered };
}
