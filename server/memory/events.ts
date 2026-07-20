import { createHash } from "node:crypto";
import type { JsonStore, StoredCandidate } from "../store.js";

export const MEMORY_EVENT_TYPES = ["session-forge", "project-completed", "reading-completed", "meeting-completed"] as const;
export type MemoryEventType = typeof MEMORY_EVENT_TYPES[number];

export interface MemoryEventInput {
  eventId: string;
  type: MemoryEventType;
  title?: string;
  summary?: string;
  scope?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

function compact(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function eventType(value: unknown): MemoryEventType | null {
  return typeof value === "string" && (MEMORY_EVENT_TYPES as readonly string[]).includes(value) ? value as MemoryEventType : null;
}

function safeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 12)) {
    if (["string", "number", "boolean"].includes(typeof entry)) result[compact(key, 40)] = typeof entry === "string" ? compact(entry, 240) : entry as number | boolean;
  }
  return result;
}

export function normalizeMemoryEvent(value: unknown): MemoryEventInput {
  if (!value || typeof value !== "object") throw new Error("memory_event_invalid");
  const input = value as Record<string, unknown>;
  const type = eventType(input.type);
  const eventId = compact(input.eventId, 180);
  if (!type) throw new Error("memory_event_type_invalid");
  if (!eventId) throw new Error("memory_event_id_required");
  const occurredAt = compact(input.occurredAt, 40);
  return {
    type,
    eventId,
    title: compact(input.title, 180) || undefined,
    summary: compact(input.summary, 2400) || undefined,
    scope: compact(input.scope, 180) || undefined,
    occurredAt: occurredAt && !Number.isNaN(Date.parse(occurredAt)) ? new Date(occurredAt).toISOString() : undefined,
    metadata: safeMetadata(input.metadata),
  };
}

function candidateId(event: MemoryEventInput) {
  const digest = createHash("sha256").update(`${event.type}\0${event.eventId}`).digest("hex").slice(0, 24);
  return `event:${event.type}:${digest}`;
}

function eventLabel(type: MemoryEventType) {
  return ({
    "session-forge": "会话连续性换窗",
    "project-completed": "项目完成或归档",
    "reading-completed": "完成一本共读",
    "meeting-completed": "会议结束",
  } as const)[type];
}

function candidateContent(event: MemoryEventInput) {
  const metadata = Object.keys(event.metadata ?? {}).length ? `\n事件信息：${JSON.stringify(event.metadata)}` : "";
  return [
    `记忆候选：${eventLabel(event.type)}`,
    event.title ? `标题：${event.title}` : "",
    event.summary ? `摘要：${event.summary}` : "",
    event.scope ? `范围：${event.scope}` : "",
    `发生时间：${event.occurredAt ?? new Date().toISOString()}`,
  ].filter(Boolean).join("\n") + metadata;
}

export async function recordMemoryEvent(store: JsonStore, raw: unknown): Promise<StoredCandidate> {
  const event = normalizeMemoryEvent(raw);
  return store.addCandidate({ id: candidateId(event), source: `event:${event.type}`, content: candidateContent(event) });
}
