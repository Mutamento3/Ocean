import type { GatewayStreamEvent, ProviderAdapter, ProviderChatRequest } from "./types.js";

export class MockProviderAdapter implements ProviderAdapter {
  async testConnection() { return { ok: true as const, detail: "Ocean mock provider is available" }; }

  async *stream(request: ProviderChatRequest, modelId: string): AsyncIterable<GatewayStreamEvent> {
    yield { type: "reasoning", value: { title: "可展示的思考摘要", content: "网关已按统一事件协议接收本轮请求。" } };
    yield { type: "segment", value: `Ocean Gateway 收到了「${request.input.slice(0, 24)}」。` };
    yield { type: "segment", value: "目前没有配置真实模型密钥，因此安全地回退到服务端 Mock；接入后这里会保持相同的事件结构。" };
    yield { type: "usage", inputTokens: 420, outputTokens: 52, cachedTokens: 300, providerId: "mock", modelId };
    yield { type: "done" };
  }
}

