import type { GatewayStreamEvent, ProviderAdapter, ProviderChatRequest, ProviderDefinition } from "./types.js";
import { openAIResponsesInput, ParagraphSegmenter, sseJson, withoutTrailingSlash } from "./streaming.js";

export class OpenAIResponsesAdapter implements ProviderAdapter {
  constructor(private readonly provider: ProviderDefinition, private readonly systemPrompt: string) {}

  private headers() {
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.provider.apiKey}` };
  }

  async testConnection() {
    const response = await fetch(`${withoutTrailingSlash(this.provider.baseUrl)}/v1/models`, { headers: this.headers() });
    if (!response.ok) throw new Error(`OpenAI connection failed (${response.status})`);
    return { ok: true as const, detail: "OpenAI models endpoint is reachable" };
  }

  async *stream(request: ProviderChatRequest, modelId: string): AsyncIterable<GatewayStreamEvent> {
    const messages = openAIResponsesInput(request, this.systemPrompt);
    const reasoningEffort = request.settings?.reasoning || "medium";
    const response = await fetch(`${withoutTrailingSlash(this.provider.baseUrl)}/v1/responses`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: modelId,
        input: messages.map((message) => ({ role: message.role, content: message.content })),
        reasoning: { effort: reasoningEffort, summary: "auto" },
        stream: true,
      }),
    });
    const segmenter = new ParagraphSegmenter();
    let reasoningSummary = "";
    let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    for await (const event of sseJson(response)) {
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        for (const value of segmenter.push(event.delta)) yield { type: "segment", value };
      }
      if (event.type === "response.reasoning_summary_text.delta" && typeof event.delta === "string") reasoningSummary += event.delta;
      if (event.type === "response.completed" && event.response?.usage) {
        usage = {
          inputTokens: Number(event.response.usage.input_tokens ?? 0),
          outputTokens: Number(event.response.usage.output_tokens ?? 0),
          cachedTokens: Number(event.response.usage.input_tokens_details?.cached_tokens ?? 0),
        };
      }
      if (event.type === "response.failed") throw new Error(event.response?.error?.message ?? "OpenAI response failed");
    }
    for (const value of segmenter.flush()) yield { type: "segment", value };
    if (reasoningSummary.trim()) yield { type: "reasoning", value: { title: "思考摘要", content: reasoningSummary.trim() } };
    yield { type: "usage", ...usage, providerId: this.provider.id, modelId };
    yield { type: "done" };
  }
}
