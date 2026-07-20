import type { ContinuitySnapshot, MemoryCandidate, MessageTurn } from "../domain/ocean";
import { gatewayClient, hasPendingSync } from "./gatewaySync";

interface RemoteConversation {
  id: string;
  scope: string;
  messages: MessageTurn[];
  updatedAt: string;
}

interface RemoteHome {
  countdowns?: unknown;
  todos?: unknown;
  notes?: unknown;
  relationship?: unknown;
}

interface RemoteContinuity extends ContinuitySnapshot {
  updatedAt: string;
}

const LEGACY_MOCK_IDS = new Set(["a1", "u1", "a2", "mock-a", "mock-b", "mock-c", "meeting-bird", "meeting-fish", "meeting-octopus"]);

function conversationKey(scope: string) {
  if (scope === "living-main") return "ocean:chat:living-main";
  if (scope === "poetry:shared") return "ocean:poetry:shared:v1";
  if (scope.startsWith("reading:")) return `ocean:chat:reading:${scope.slice("reading:".length)}`;
  if (scope.startsWith("project:")) return `ocean:project:${scope.slice("project:".length)}:messages`;
  if (scope.startsWith("meeting:")) return `ocean:meeting:${scope.slice("meeting:".length)}:messages:v2`;
  return `ocean:chat:${scope}`;
}

function continuityKey(scope: string) {
  if (scope === "living-main") return "ocean:continuity:living-main";
  if (scope.startsWith("reading:")) return `ocean:continuity:reading:${scope.slice("reading:".length)}`;
  if (scope.startsWith("project:")) return `ocean:continuity:project:${scope.slice("project:".length)}`;
  return null;
}

function parseLocal<T>(key: string): T | null {
  try { const value = window.localStorage.getItem(key); return value === null ? null : JSON.parse(value) as T; }
  catch { return null; }
}

function withoutLegacyMocks<T extends { id?: unknown }>(messages: T[]) {
  return messages.filter((message) => typeof message.id !== "string" || !LEGACY_MOCK_IDS.has(message.id));
}

function hasLocalConversation(key: string) {
  const value = parseLocal<Array<{ id?: unknown }>>(key);
  return Array.isArray(value) && withoutLegacyMocks(value).length > 0;
}

function hasLocalContinuity(key: string) {
  const value = parseLocal<ContinuitySnapshot>(key);
  if (!value) return false;
  return value.source !== "local-fallback" || value.generation > 1 || Boolean(value.summary || value.handoff || value.recentTurnIds?.length);
}

function publish(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("ocean:persist", { detail: { key, value } }));
}

export async function restoreFromGateway() {
  const [conversations, continuities, home, remoteCandidates] = await Promise.all([
    gatewayClient.listConversations<RemoteConversation>(),
    gatewayClient.listContinuities<RemoteContinuity>(),
    gatewayClient.getHome<RemoteHome>(),
    gatewayClient.listMemoryCandidates<MemoryCandidate>(),
  ]);

  let restoredConversations = 0;
  let restoredContinuities = 0;
  let preservedLocalConversations = 0;
  const latestByScope = new Map<string, RemoteConversation>();
  conversations.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).forEach((conversation) => {
    if (!latestByScope.has(conversation.scope)) latestByScope.set(conversation.scope, conversation);
  });
  const continuityByScope = new Map(continuities.map((continuity) => [continuity.logicalConversationId, continuity]));
  for (const conversation of latestByScope.values()) {
    if (hasPendingSync("conversation", conversation.scope)) continue;
    const key = conversationKey(conversation.scope);
    const continuity = continuityByScope.get(conversation.scope);
    const targetContinuityKey = continuityKey(conversation.scope);
    if (hasLocalConversation(key)) {
      preservedLocalConversations += 1;
      if (continuity && targetContinuityKey && !hasLocalContinuity(targetContinuityKey)) {
        publish(targetContinuityKey, continuity);
        restoredContinuities += 1;
      }
      continue;
    }
    const restorableMessages = withoutLegacyMocks(Array.isArray(conversation.messages) ? conversation.messages : []);
    if (!restorableMessages.length) continue;
    publish(key, restorableMessages);
    restoredConversations += 1;
    if (continuity && targetContinuityKey && !hasLocalContinuity(targetContinuityKey)) {
      publish(targetContinuityKey, continuity);
      restoredContinuities += 1;
    }
  }

  let restoredHome = false;
  if (home && !hasPendingSync("home")) {
    const homeEntries = [
      ["ocean:home:countdowns", home.countdowns],
      ["ocean:home:todos", home.todos],
      ["ocean:home:notes", home.notes],
      ["ocean:home:relationship", home.relationship],
    ] as const;
    for (const [key, value] of homeEntries) {
      if (value !== undefined && window.localStorage.getItem(key) === null) {
        publish(key, value);
        restoredHome = true;
      }
    }
  }

  const localCandidates = JSON.parse(window.localStorage.getItem("ocean:memory-candidates") ?? "[]") as MemoryCandidate[];
  const mergedCandidates = [...remoteCandidates, ...localCandidates].filter((candidate, index, all) => all.findIndex((item) => item.id === candidate.id) === index);
  publish("ocean:memory-candidates", mergedCandidates);

  return { conversations: restoredConversations, continuities: restoredContinuities, preservedLocalConversations, home: restoredHome, candidates: remoteCandidates.length };
}
