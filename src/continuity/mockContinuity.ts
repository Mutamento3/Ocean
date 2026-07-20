import type { ContinuitySnapshot, MessageTurn } from "../domain/ocean";
import { gatewayClient, gatewayIsConnected } from "../sync/gatewaySync";

export function initialContinuity(logicalConversationId: string): ContinuitySnapshot {
  return {
  logicalConversationId,
  physicalSessionId: `${logicalConversationId}:local-generation-1`,
  generation: 1,
  summary: "",
  handoff: "",
  recentTurnIds: [],
  source: "local-fallback",
  };
}

export const INITIAL_CONTINUITY = initialContinuity("living-main");

function estimateNormalizedUnits(text: string) {
  let units = 0;
  for (const char of text) units += /[\u3400-\u9fff\uf900-\ufaff]/.test(char) ? 1 : /\s/.test(char) ? .05 : .25;
  return Math.ceil(units);
}

function retainedMessages(messages: MessageTurn[], previous: ContinuitySnapshot) {
  if (!previous.summary || previous.recentTurnIds.length === 0) return messages;
  const first = messages.findIndex((message) => message.id === previous.recentTurnIds[0]);
  return first >= 0 ? messages.slice(first) : messages.slice(-40);
}

export function messagesForPhysicalSession(messages: MessageTurn[], continuity: ContinuitySnapshot) {
  return retainedMessages(messages, continuity);
}

function localStorageStatus(messages: MessageTurn[], previous: ContinuitySnapshot) {
  const safeThresholdUnits = 10_000;
  const usedUnits = retainedMessages(messages, previous).reduce((sum, message) => sum + 4 + estimateNormalizedUnits(message.segments.join("\n\n")), estimateNormalizedUnits(previous.summary) + estimateNormalizedUnits(previous.handoff));
  const remainingUnits = Math.max(0, safeThresholdUnits - usedUnits);
  return { usedUnits, thresholdUnits: 12_000, reserveUnits: 2_000, safeThresholdUnits, remainingUnits, percentRemaining: Math.round((remainingUnits / safeThresholdUnits) * 100), shouldForge: usedUnits >= safeThresholdUnits, unit: "normalized-token-estimate" as const };
}

function forgeContinuityLocally(messages: MessageTurn[], previous: ContinuitySnapshot): ContinuitySnapshot {
  const storage = localStorageStatus(messages, previous);
  if (!storage.shouldForge) return { ...previous, forged: false, storage };
  const recent = messages.slice(-40);
  const older = messages.slice(0, Math.max(0, messages.length - recent.length));
  const userTopics = recent.filter((turn) => turn.role === "user").flatMap((turn) => turn.segments).slice(-4);
  return {
    logicalConversationId: previous.logicalConversationId,
    physicalSessionId: `mock-session-${previous.generation + 1}`,
    generation: previous.generation + 1,
    summary: `${previous.summary ? `此前连续性：${previous.summary.slice(0, 600)}\n` : ""}最近用户提到：${userTopics.join("；") || older.flatMap((turn) => turn.segments).slice(-4).join("；") || "继续共同生活与项目"}。`,
    handoff: "保持自然承接；不要宣布换窗；时间间隔作为事实附在动态上下文末尾。",
    recentTurnIds: recent.map((turn) => turn.id),
    forgedAt: new Date().toISOString(),
    source: "local-fallback",
    forged: true,
    storage: localStorageStatus(recent, { ...previous, summary: "", handoff: "", recentTurnIds: [] }),
  };
}

export async function forgeContinuity(messages: MessageTurn[], previous: ContinuitySnapshot): Promise<ContinuitySnapshot> {
  if (gatewayIsConnected()) {
    try {
      return await gatewayClient.createHandoff({
        logicalConversationId: previous.logicalConversationId,
        generation: previous.generation,
        messages,
        previous,
      });
    } catch {
      // Offline-first continuity must still work when the Gateway is temporarily unavailable.
    }
  }
  return forgeContinuityLocally(messages, previous);
}
