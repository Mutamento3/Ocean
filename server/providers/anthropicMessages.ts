import type { GatewayStreamEvent, ProviderAdapter, ProviderChatRequest, ProviderDefinition } from "./types.js";
import { anthropicMessages, ParagraphSegmenter, sseJson, withoutTrailingSlash } from "./streaming.js";

export class AnthropicMessagesAdapter implements ProviderAdapter {
  constructor(private readonly provider: ProviderDefinition, private readonly systemPrompt: string) {}

  private headers() {
    return { "Content-Type": "application/json", "x-api-key": String(this.provider.apiKey), "anthropic-version": "2023-06-01" };
  }

  async testConnection() {
    const response = await fetch(`${withoutTrailingSlash(this.provider.baseUrl)}/v1/models`, { headers: this.headers() });
    if (!response.ok) throw new Error(`Anthropic connection failed (${response.status})`);
    return { ok: true as const, detail: "Anthropic models endpoint is reachable" };
  }

  async *stream(request: ProviderChatRequest, modelId: string): AsyncIterable<GatewayStreamEvent> {
    const assembled = anthropicMessages(request, this.systemPrompt);
    const messages = assembled.filter((message) => message.role !== "system");
    const system = assembled.filter((message) => message.role === "system").map((message, index) => index === 0
      ? { type: "text", text: message.content, cache_control: { type: "ephemeral", ttl: "1h" } }
      : { type: "text", text: message.content });
    const response = await fetch(`${withoutTrailingSlash(this.provider.baseUrl)}/v1/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: modelId,
        system,
        messages,
        max_tokens: 4096,
        stream: true,
      }),
    });
    const segmenter = new ParagraphSegmenter();
    let reasoningSeen = false;
    let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 };
    for await (const event of sseJson(response)) {
      if (event.type === "message_start" && event.message?.usage) {
        usage.inputTokens = Number(event.message.usage.input_tokens ?? 0);
        usage.cachedTokens = Number(event.message.usage.cache_read_input_tokens ?? 0);
        usage.cacheWriteTokens = Number(event.message.usage.cache_creation_input_tokens ?? 0);
      }
      if (event.type === "content_block_delta") {
        if (event.delta?.type === "thinking_delta") reasoningSeen = true;
        if (event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
          for (const value of segmenter.push(event.delta.text)) yield { type: "segment", value };
        }
      }
      if (event.type === "message_delta" && event.usage) usage.outputTokens = Number(event.usage.output_tokens ?? usage.outputTokens);
      if (event.type === "error") throw new Error(event.error?.message ?? "Anthropic response failed");
    }
    for (const value of segmenter.flush()) yield { type: "segment", value };
    if (reasoningSeen) yield {
      type: "reasoning",
      value: {
        title: "本轮进行了思考",
        content: "Claude 返回了扩展思考标记，但没有提供可直接展示的思考摘要。这里仅显示状态，不展示未经整理的内部推理原文。",
      },
    };
    yield { type: "usage", ...usage, providerId: this.provider.id, modelId };
    yield { type: "done" };
  }
}
