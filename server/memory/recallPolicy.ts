export type ChatMemoryRecallMode = "full" | "light" | "skip";

export interface ChatMemoryRecallPlan {
  mode: ChatMemoryRecallMode;
  maxResults: number;
  maxCharacters: number;
  reason: "explicit-memory-question" | "conversation-bootstrap" | "explicit-save" | "ordinary-follow-up";
}

const SAVE_OR_REMINDER_LANGUAGE = [
  /(?:请|帮我)?(?:记住|保存|存下|存进|写进|放进)(?:这|到|一|我)/,
  /(?:存入|保存到)(?:记忆|深海某处|记忆宫殿)/,
  /(?:记一下|记一条)/,
  /记得(?:要|去|帮|提醒|叫|喝|吃|睡|拿|买|做|发|交|带)/,
];

const EXPLICIT_RECALL_LANGUAGE = [
  /(?:还|是否|会不会)?记得/,
  /记不记得/,
  /(?:我们?|你|我)(?:以前|之前|曾经|过去|当时|上次|那次|第一次)/,
  /(?:以前|之前|过去|当时|上次|那次|第一次)(?:我们?|你|我)/,
  /(?:回忆|往事|经历|约定|传统|记忆宫殿|深海某处|日印象|关系天气|画像|肖像)/,
  /我(?:到底)?是谁/,
  /你(?:到底)?是谁/,
  /我们(?:是|算|属于)什么关系/,
  /我的?(?:生日|喜好|偏好|习惯|身份|经历)(?:是|在|有什么|有哪些|是什么)/,
  /我(?:最)?(?:喜欢|讨厌|害怕|在意).*(?:什么|谁|哪)/,
];

/**
 * Keeps dynamic long-term memory out of ordinary follow-up turns so the
 * provider's stable prefix and recent conversation can be reused. Explicit
 * memory questions still receive the full configured budget. The first turn
 * gets a small bootstrap only; explicit save/reminder language is handled by
 * the write path and deliberately does not cause an unrelated recall.
 */
export function planChatMemoryRecall(
  query: string,
  hasConversationHistory: boolean,
  configuredMaxResults = 4,
  configuredMaxCharacters = 3200,
): ChatMemoryRecallPlan {
  const normalized = query.replace(/\s+/g, "").trim();
  const fullResults = Math.max(1, Math.min(12, configuredMaxResults));
  const fullCharacters = Math.max(500, Math.min(12_000, configuredMaxCharacters));

  if (SAVE_OR_REMINDER_LANGUAGE.some((pattern) => pattern.test(normalized))) {
    return { mode: "skip", maxResults: 0, maxCharacters: 0, reason: "explicit-save" };
  }
  if (EXPLICIT_RECALL_LANGUAGE.some((pattern) => pattern.test(normalized))) {
    return { mode: "full", maxResults: fullResults, maxCharacters: fullCharacters, reason: "explicit-memory-question" };
  }
  if (!hasConversationHistory) {
    return {
      mode: "light",
      maxResults: Math.min(2, fullResults),
      maxCharacters: Math.min(1200, fullCharacters),
      reason: "conversation-bootstrap",
    };
  }
  return { mode: "skip", maxResults: 0, maxCharacters: 0, reason: "ordinary-follow-up" };
}
