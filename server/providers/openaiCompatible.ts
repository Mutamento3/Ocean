import type { GatewayStreamEvent, ProviderAdapter, ProviderChatRequest, ProviderDefinition } from "./types.js";
import { openAIChatMessages, ParagraphSegmenter, providerResponseError, sseJson, withoutTrailingSlash } from "./streaming.js";
import { estimateUsageCost } from "./pricing.js";

function publicReasoningSummaries(details: unknown[]) {
  return details.flatMap((detail) => {
    if (!detail || typeof detail !== "object") return [];
    const item = detail as Record<string, unknown>;
    if (item.type !== "reasoning.summary") return [];
    if (typeof item.summary === "string" && item.summary.trim()) return [item.summary.trim()];
    if (Array.isArray(item.summary)) {
      return item.summary
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        .map((value) => value.trim());
    }
    return [];
  });
}

function mergeReasoningFragment(previous: unknown, incoming: unknown) {
  if (incoming === null || incoming === undefined) return previous;
  if (typeof incoming !== "string") return incoming;
  if (!incoming) return previous ?? "";
  if (typeof previous !== "string" || !previous) return incoming;
  if (incoming === previous || previous.endsWith(incoming)) return previous;
  if (incoming.startsWith(previous)) return incoming;
  return `${previous}${incoming}`;
}

function reasoningDetailKey(detail: Record<string, unknown>) {
  const type = typeof detail.type === "string" ? detail.type : "reasoning";
  if (typeof detail.id === "string" && detail.id) return `${type}:id:${detail.id}`;
  if (typeof detail.index === "number") return `${type}:index:${detail.index}`;
  return "";
}

export function mergeReasoningDetails(target: unknown[], incoming: unknown[]) {
  for (const value of incoming) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      target.push(value);
      continue;
    }
    const detail = value as Record<string, unknown>;
    const key = reasoningDetailKey(detail);
    const existingIndex = key
      ? target.findIndex((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate)
        && reasoningDetailKey(candidate as Record<string, unknown>) === key)
      : -1;
    if (existingIndex < 0) {
      target.push({ ...detail });
      continue;
    }
    const previous = target[existingIndex] as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...previous, ...detail };
    for (const field of ["text", "data", "signature", "summary"] as const) {
      if (field in previous || field in detail) merged[field] = mergeReasoningFragment(previous[field], detail[field]);
    }
    target[existingIndex] = merged;
  }
  return target;
}

function toolActivitySummary(name: string, result: { ok: boolean; content: unknown }) {
  if (!result.ok) {
    return name === "ocean_memory_hold"
      ? "本轮尝试写入深海某处，但写入没有成功。"
      : "本轮调用了工具，但工具没有成功完成。";
  }
  if (name === "ocean_memory_hold") {
    const content = result.content && typeof result.content === "object" ? result.content as Record<string, unknown> : {};
    const bucketId = typeof content.bucketId === "string" && content.bucketId ? content.bucketId : "未返回编号";
    const title = typeof content.title === "string" && content.title ? `「${content.title}」` : "该条记忆";
    return `本轮已调用深海某处完成记忆写入：${title}，记忆桶编号为 ${bucketId}。`;
  }
  if (name === "ocean_memory_breath") return "本轮调用深海某处检索了相关长期记忆。";
  return `本轮调用了 ${name}。`;
}

function withExplicitCacheBreakpoint(messages: ReturnType<typeof openAIChatMessages>) {
  if (messages.length < 2) return messages;
  const breakpointIndex = Math.max(0, messages.length - 2);
  const target = messages[breakpointIndex];
  if (!target) return messages;
  const content = target.content;
  if (typeof content === "string") {
    messages[breakpointIndex] = {
      ...target,
      content: [{ type: "text", text: content, cache_control: { type: "ephemeral" } }],
    };
    return messages;
  }
  if (Array.isArray(content) && content.length) {
    const blocks = [...content];
    const last = blocks.at(-1);
    if (last && typeof last === "object") blocks[blocks.length - 1] = { ...last, cache_control: { type: "ephemeral" } };
    messages[breakpointIndex] = { ...target, content: blocks };
  }
  return messages;
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  constructor(private readonly provider: ProviderDefinition, private readonly systemPrompt: string) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.provider.apiKey}`,
      ...this.provider.headers,
    };
  }

  async testConnection() {
    const response = await fetch(`${withoutTrailingSlash(this.provider.baseUrl)}/models`, { headers: this.headers() });
    if (!response.ok) throw await providerResponseError(response);
    return { ok: true as const, detail: `${this.provider.name} models endpoint is reachable` };
  }

  async *stream(request: ProviderChatRequest, modelId: string): AsyncIterable<GatewayStreamEvent> {
    const isOpenRouter = this.provider.id === "openrouter";
    const explicitAnthropicCache = isOpenRouter
      && modelId.startsWith("anthropic/")
      && process.env.OCEAN_OPENROUTER_PROMPT_CACHE !== "disabled";
    const modelDefinition = this.provider.models.find((model) => model.id === modelId);
    const canUseTools = isOpenRouter || Boolean(modelDefinition?.capabilities.includes("tools")) || this.provider.capabilities.includes("tools");
    const forcedToolName = request.toolChoice && typeof request.toolChoice === "object"
      ? request.toolChoice.function.name
      : "";
    const messages: any[] = openAIChatMessages(request, this.systemPrompt);
    if (explicitAnthropicCache) withExplicitCacheBreakpoint(messages);
    const segmenter = new ParagraphSegmenter();
    let reasoningSeen = false;
    const visibleReasoningSummaries: string[] = [];
    const toolActivity: string[] = [];
    let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, cost: undefined as number | undefined, currency: undefined as string | undefined };

    for (let round = 0; round < 3; round += 1) {
      // Keep the same breakpoint through tool continuations. Moving or
      // dropping it on round two forces OpenRouter to bill the full prefix
      // again just when a memory tool call is most expensive.
      const requestMessages = messages;
      const response = await fetch(`${withoutTrailingSlash(this.provider.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: modelId,
          messages: requestMessages,
          stream: true,
          stream_options: { include_usage: true },
          ...(canUseTools && request.tools?.length && request.executeTool ? { tools: request.tools, tool_choice: round === 0 ? request.toolChoice ?? "auto" : "auto", parallel_tool_calls: false } : {}),
          ...(isOpenRouter && request.context?.physicalSessionId ? { session_id: request.context.physicalSessionId.slice(0, 256) } : {}),
          ...(isOpenRouter && request.settings?.reasoning ? { reasoning: { effort: request.settings.reasoning, exclude: false } } : {}),
          ...(!isOpenRouter && request.settings?.reasoning ? { reasoning_effort: request.settings.reasoning } : {}),
          ...(this.provider.id === "deepseek" && request.settings?.thinking ? { thinking: { type: request.settings.thinking } } : {}),
          ...(this.provider.id === "qwen" && request.settings?.thinking ? { enable_thinking: request.settings.thinking === "enabled" } : {}),
        }),
      });
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
      let assistantContent = "";
      let assistantReasoning = "";
      const assistantReasoningDetails: unknown[] = [];

      for await (const event of sseJson(response)) {
        const delta = event.choices?.[0]?.delta;
        const reasoning = typeof delta?.reasoning === "string"
          ? delta.reasoning
          : typeof delta?.reasoning_content === "string"
            ? delta.reasoning_content
            : "";
        if (reasoning) {
          reasoningSeen = true;
          assistantReasoning += reasoning;
        }
        if (Array.isArray(delta?.reasoning_details) && delta.reasoning_details.length) {
          reasoningSeen = true;
          mergeReasoningDetails(assistantReasoningDetails, delta.reasoning_details);
        }
        if (typeof delta?.content === "string") {
          assistantContent += delta.content;
          // A forced write is a transaction, not a conversational claim. Hold
          // provider prose until the real tool result has been verified.
          if (!forcedToolName) {
            for (const value of segmenter.push(delta.content)) yield { type: "segment", value };
          }
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const fragment of delta.tool_calls) {
            const index = Number(fragment.index ?? 0);
            const current = toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
            if (typeof fragment.id === "string") current.id += fragment.id;
            if (typeof fragment.function?.name === "string") current.name += fragment.function.name;
            if (typeof fragment.function?.arguments === "string") current.arguments += fragment.function.arguments;
            toolCalls.set(index, current);
          }
        }
        if (event.usage) {
          const inputTokens = Number(event.usage.prompt_tokens ?? event.usage.input_tokens ?? 0);
          const outputTokens = Number(event.usage.completion_tokens ?? event.usage.output_tokens ?? 0);
          const cachedTokens = Number(event.usage.prompt_tokens_details?.cached_tokens ?? event.usage.input_tokens_details?.cached_tokens ?? event.usage.prompt_cache_hit_tokens ?? event.usage.cache_read_input_tokens ?? event.usage.cached_tokens ?? 0);
          const cacheWriteTokens = Number(event.usage.prompt_tokens_details?.cache_write_tokens ?? event.usage.input_tokens_details?.cache_write_tokens ?? event.usage.cache_creation_input_tokens ?? 0);
          const eventCost = typeof event.usage.cost === "number" ? event.usage.cost : undefined;
          usage = {
            inputTokens: usage.inputTokens + inputTokens,
            outputTokens: usage.outputTokens + outputTokens,
            cachedTokens: usage.cachedTokens + cachedTokens,
            cacheWriteTokens: usage.cacheWriteTokens + cacheWriteTokens,
            cost: eventCost === undefined ? usage.cost : (usage.cost ?? 0) + eventCost,
            currency: eventCost === undefined ? usage.currency : (typeof event.usage.currency === "string" ? event.usage.currency.toUpperCase() : "USD"),
          };
        }
      }

      visibleReasoningSummaries.push(...publicReasoningSummaries(assistantReasoningDetails));

      if (!toolCalls.size || !request.executeTool) {
        if (forcedToolName) {
          throw new Error(`${this.provider.name} did not call the required ${forcedToolName} tool`);
        }
        break;
      }
      if (round === 2) throw new Error("Ocean stopped a model tool loop after three rounds");
      const normalizedCalls = [...toolCalls.entries()].sort(([left], [right]) => left - right).map(([, call], index) => ({
        id: call.id || `ocean-tool-${round}-${index}`,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments || "{}" },
      }));
      if (!forcedToolName) {
        messages.push({
          role: "assistant",
          content: assistantContent || null,
          tool_calls: normalizedCalls,
          // OpenRouter requires signed reasoning_details to be passed back
          // byte-for-byte in their original sequence. Do not also send the
          // lossy plaintext aggregate when structured details are available.
          ...(assistantReasoningDetails.length
            ? { reasoning_details: assistantReasoningDetails }
            : assistantReasoning
              ? { reasoning: assistantReasoning }
              : {}),
        });
      }
      let forcedToolResult: { ok: boolean; content: unknown } | null = null;
      for (const call of normalizedCalls) {
        let argumentsValue: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(call.function.arguments);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) argumentsValue = parsed as Record<string, unknown>;
        } catch {
          argumentsValue = { _invalid_json: call.function.arguments };
        }
        const result = await request.executeTool(call.function.name, argumentsValue);
        toolActivity.push(toolActivitySummary(call.function.name, result));
        if (forcedToolName && call.function.name === forcedToolName) forcedToolResult = result;
        if (!forcedToolName) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify(result),
          });
        }
      }
      if (forcedToolName) {
        if (!forcedToolResult) throw new Error(`${this.provider.name} returned a different tool instead of ${forcedToolName}`);
        for (const value of segmenter.push(toolActivitySummary(forcedToolName, forcedToolResult))) {
          yield { type: "segment", value };
        }
        break;
      }
    }

    for (const value of segmenter.flush()) yield { type: "segment", value };
    if (reasoningSeen) yield {
      type: "reasoning",
      value: {
        title: "本轮思考摘要",
        content: visibleReasoningSummaries.length
          ? [...new Set(visibleReasoningSummaries)].join("\n\n")
          : toolActivity.length
            ? toolActivity.join("\n\n")
            : `${this.provider.name} 完成了推理，但上游本轮只返回了原始或加密推理块，没有提供可公开的思考摘要。`,
      },
    };
    const estimated = usage.cost === undefined ? estimateUsageCost(this.provider, modelId, usage) : { costEstimated: false as const, pricingSource: "provider" as const };
    yield { type: "usage", ...usage, ...estimated, providerId: this.provider.id, modelId };
    yield { type: "done" };
  }
}
