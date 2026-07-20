import type { ChatAdapter } from "./contracts";
import type { ChatContext, ChatStreamEvent } from "../domain/ocean";

const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export class MockChatAdapter implements ChatAdapter {
  async *streamReply(input: string, context: ChatContext): AsyncIterable<ChatStreamEvent> {
    await delay(320);
    yield {
      type: "reasoning",
      value: {
        title: "可展示的思考摘要",
        content: `我注意到你说的是“${input.slice(0, 18)}”。我先判断这是需要陪伴、讨论，还是一个具体任务，再决定回应的节奏。`,
      },
    };

    const prefix = context.nightTalk ? "灯已经暗下来了，我会说得慢一点。" : "我在。";
    const segments = [
      `${prefix}这是一段由 mock 适配器产生的回复，但它和未来真实 API 使用同一套流式事件结构。`,
      "长回复会按语义段落逐个形成气泡；在会话历史里，它们仍属于同一轮回复。这样既保留聊天的呼吸，也不会破坏记忆、重试和引用。",
    ];

    for (const segment of segments) {
      await delay(520);
      yield { type: "segment", value: segment };
    }

    yield { type: "usage", inputTokens: 1280, outputTokens: 126, cachedTokens: 960 };
    yield { type: "done" };
  }
}

export const mockChatAdapter = new MockChatAdapter();
