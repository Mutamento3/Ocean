import { gatewayChatAdapter } from "../adapters/gatewayChat";
import { mockChatAdapter } from "../adapters/mockChat";
import { getModelSelection } from "../config/modelSelection";
import { forgeContinuity, INITIAL_CONTINUITY, messagesForPhysicalSession } from "../continuity/mockContinuity";
import { recordUsage } from "../data/usageLedger";
import type { ChatAttachment, ContinuitySnapshot, MessageTurn } from "../domain/ocean";
import { syncOrQueue } from "../sync/gatewaySync";

const LIVING_MESSAGES_KEY = "ocean:chat:living-main";
const LIVING_CONTINUITY_KEY = "ocean:continuity:living-main";

function readState<T>(key: string, fallback: T) {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
}

function persistState<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("ocean:persist", { detail: { key, value } }));
}

export interface LivingRoomDeliveryOptions {
  attachments?: ChatAttachment[];
  continuity?: ContinuitySnapshot;
  elapsedSinceLastTurn?: string;
  messages?: MessageTurn[];
  modeInstruction?: string;
  nightTalk?: boolean;
  onContinuity?: (continuity: ContinuitySnapshot) => void;
  onMessages?: (messages: MessageTurn[]) => void;
}

export interface LivingRoomDeliveryResult {
  continuity: ContinuitySnapshot;
  error?: string;
  live: boolean;
  messages: MessageTurn[];
  responded: boolean;
  synced: boolean;
}

export async function deliverToLivingRoom(input: string, options: LivingRoomDeliveryOptions = {}): Promise<LivingRoomDeliveryResult> {
  const value = input.trim();
  if (!value) throw new Error("不能发送空消息");
  const currentMessages = options.messages ?? readState<MessageTurn[]>(LIVING_MESSAGES_KEY, []);
  const currentContinuity = options.continuity ?? readState<ContinuitySnapshot>(LIVING_CONTINUITY_KEY, INITIAL_CONTINUITY);
  const createdAt = new Date().toISOString();
  const userTurn: MessageTurn = { id: crypto.randomUUID(), role: "user", createdAt, segments: [value], source: "chat" };
  const replyId = crypto.randomUUID();
  const reply: MessageTurn = { id: replyId, role: "assistant", createdAt, segments: [], source: "chat" };
  let nextMessages = [...currentMessages, userTurn, reply];
  const publishMessages = () => {
    persistState(LIVING_MESSAGES_KEY, nextMessages);
    options.onMessages?.(nextMessages);
  };
  publishMessages();

  const connections = readState<{ gateway?: string }>("ocean:connections", {});
  const live = window.localStorage.getItem("ocean:chat:live") === "true" && connections.gateway === "connected";
  const adapter = live ? gatewayChatAdapter : mockChatAdapter;
  const selection = getModelSelection();
  const history = messagesForPhysicalSession([...currentMessages, userTurn], currentContinuity)
    .map((turn) => ({ role: turn.role, content: turn.segments.join("\n\n") }));
  let error: string | undefined;

  try {
    for await (const event of adapter.streamReply(value, {
      mode: "living-room",
      nightTalk: options.nightTalk ?? false,
      elapsedSinceLastTurn: options.elapsedSinceLastTurn ?? "刚刚",
      messages: history,
      attachments: options.attachments ?? [],
      providerId: selection?.providerId,
      modelId: selection?.modelId,
      settings: selection?.settings,
      continuitySummary: currentContinuity.summary || undefined,
      continuityHandoff: currentContinuity.handoff || undefined,
      physicalSessionId: currentContinuity.physicalSessionId,
      modeInstruction: options.modeInstruction,
    })) {
      if (event.type === "segment") {
        nextMessages = nextMessages.map((turn) => turn.id === replyId ? { ...turn, segments: [...turn.segments, event.value] } : turn);
        publishMessages();
      }
      if (event.type === "reasoning") {
        nextMessages = nextMessages.map((turn) => turn.id === replyId ? { ...turn, reasoning: event.value } : turn);
        publishMessages();
      }
      if (event.type === "usage") recordUsage(event);
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "连接模型时出了点问题";
    nextMessages = nextMessages.map((turn) => turn.id === replyId ? { ...turn, segments: [`连接模型时出了点问题：${error}`] } : turn);
    publishMessages();
  }

  const evaluated = await forgeContinuity(nextMessages, currentContinuity);
  persistState(LIVING_CONTINUITY_KEY, evaluated);
  options.onContinuity?.(evaluated);
  const synced = await syncOrQueue("conversation", { id: "living-main", scope: "living-main", messages: nextMessages });
  return {
    continuity: evaluated,
    error,
    live,
    messages: nextMessages,
    responded: nextMessages.find((turn) => turn.id === replyId)?.segments.length !== 0 && !error,
    synced,
  };
}
