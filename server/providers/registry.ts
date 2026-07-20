import { AnthropicMessagesAdapter } from "./anthropicMessages.js";
import { MockProviderAdapter } from "./mock.js";
import { OpenAICompatibleAdapter } from "./openaiCompatible.js";
import { OpenAIResponsesAdapter } from "./openaiResponses.js";
import type { ProviderAdapter, ProviderChatRequest, ProviderDefinition, ProviderModelDefinition } from "./types.js";
import { withoutTrailingSlash } from "./streaming.js";

const fallbackSystemPrompt = "You are the companion speaking inside Ocean. Preserve continuity, be honest about unavailable tools, and answer naturally.";

function configuredSystemPrompt() {
  const encoded = process.env.OCEAN_SYSTEM_PROMPT_B64?.trim();
  if (encoded) {
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
      if (decoded) return decoded;
    } catch (error) {
      console.warn("Ocean ignored invalid OCEAN_SYSTEM_PROMPT_B64:", error instanceof Error ? error.message : error);
    }
  }
  return process.env.OCEAN_SYSTEM_PROMPT?.trim() || fallbackSystemPrompt;
}

const systemPrompt = configuredSystemPrompt();

const defaultProfile = [{ id: "default", label: "Default" }];
const reasoning = (options: string[], defaultValue: string) => [{
  id: "reasoning",
  label: "推理强度",
  defaultValue,
  options: options.map((value) => ({ id: value, label: ({ none: "无", low: "低", medium: "中", high: "高", xhigh: "超高", max: "Max" } as Record<string, string>)[value] ?? value })),
}];
const thinkingToggle = [{
  id: "thinking",
  label: "思考模式",
  defaultValue: "enabled",
  options: [
    { id: "enabled", label: "开启" },
    { id: "disabled", label: "关闭" },
  ],
}];

function model(id: string, name: string, capabilities: string[], settings: ProviderModelDefinition["settings"] = []): ProviderModelDefinition {
  return { id, name, profiles: defaultProfile, settings, capabilities };
}

function configuredModel(envName: string, fallback = "") {
  return process.env[envName]?.trim() || fallback;
}

function configuredModels(envName: string, fallback: string[]) {
  const configured = process.env[envName]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return [...new Set(configured.length ? configured : fallback)];
}

function buildOpenRouterModel(modelId: string) {
  const sharedCapabilities = ["stream", "routing", "reasoning", "prompt-cache", "tools", "usage"];
  if (modelId === "openrouter/auto" || modelId === "openrouter/auto-beta") return model(modelId, "OpenRouter Auto", sharedCapabilities);
  if (modelId === "openrouter/free") return model(modelId, "OpenRouter Free", ["stream", "routing", "usage"]);
  if (modelId === "anthropic/claude-sonnet-4.6") return model(modelId, "Sonnet 4.6", sharedCapabilities, reasoning(["low", "medium", "high", "max"], "high"));
  if (modelId === "anthropic/claude-opus-4.6") return model(modelId, "Opus 4.6", sharedCapabilities, reasoning(["low", "medium", "high", "max"], "high"));
  if (modelId === "openai/gpt-5.6-sol") return model(modelId, "GPT 5.6 Sol", sharedCapabilities, reasoning(["none", "low", "medium", "high", "xhigh", "max"], "medium"));
  return model(modelId, modelId.split("/").at(-1) ?? modelId, sharedCapabilities);
}

function customCompatibleProviders(): ProviderDefinition[] {
  const raw = process.env.OCEAN_OPENAI_COMPAT_PROVIDERS_JSON;
  if (!raw) return [];
  try {
    const entries = JSON.parse(raw) as Array<Record<string, unknown>>;
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry) => {
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      const name = typeof entry.name === "string" ? entry.name.trim() : id;
      const baseUrl = typeof entry.baseUrl === "string" ? entry.baseUrl.trim() : "";
      const apiKeyEnv = typeof entry.apiKeyEnv === "string" ? entry.apiKeyEnv.trim() : "";
      const modelIds = Array.isArray(entry.models) ? entry.models.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()) : [];
      if (!id || !baseUrl || !apiKeyEnv || modelIds.length === 0 || ["mock", "deepseek", "openai", "anthropic", "openrouter", "kimi", "qwen"].includes(id)) return [];
      return [{
        id,
        name,
        kind: "openai-compatible" as const,
        baseUrl: withoutTrailingSlash(baseUrl),
        apiKeyEnv,
        apiKey: process.env[apiKeyEnv]?.trim(),
        defaultModel: typeof entry.defaultModel === "string" && entry.defaultModel.trim() ? entry.defaultModel.trim() : modelIds[0],
        models: modelIds.map((modelId) => model(modelId, modelId, ["stream", "usage", "openai-compatible"])),
        capabilities: ["stream", "usage", "openai-compatible"],
      }];
    });
  } catch (error) {
    console.warn("Ocean ignored invalid OCEAN_OPENAI_COMPAT_PROVIDERS_JSON:", error instanceof Error ? error.message : error);
    return [];
  }
}

function definitions(): ProviderDefinition[] {
  const openRouterModel = configuredModel("OPENROUTER_MODEL", "openrouter/auto");
  const openRouterModels = configuredModels("OPENROUTER_MODELS", [
    openRouterModel,
    "openrouter/free",
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4.6",
    "openai/gpt-5.6-sol",
  ]);
  if (!openRouterModels.includes(openRouterModel)) openRouterModels.unshift(openRouterModel);
  return [
    {
      id: "mock",
      name: "Ocean Mock",
      kind: "mock",
      baseUrl: "",
      defaultModel: "mock-ocean-1",
      models: [model("mock-ocean-1", "Ocean Mock", ["stream", "reasoning-summary", "usage"])],
      capabilities: ["stream", "reasoning-summary", "usage"],
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      kind: "openai-compatible",
      baseUrl: withoutTrailingSlash(process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"),
      apiKeyEnv: "DEEPSEEK_API_KEY",
      apiKey: process.env.DEEPSEEK_API_KEY?.trim(),
      defaultModel: configuredModel("DEEPSEEK_MODEL", "deepseek-v4-flash"),
      models: [
        model("deepseek-v4-flash", "DeepSeek V4 Flash", ["stream", "reasoning", "prompt-cache", "usage"], reasoning(["low", "medium", "high"], "medium")),
        model("deepseek-v4-pro", "DeepSeek V4 Pro", ["stream", "reasoning", "prompt-cache", "usage"], reasoning(["low", "medium", "high"], "high")),
      ],
      capabilities: ["stream", "reasoning", "prompt-cache", "usage", "openai-compatible"],
    },
    {
      id: "kimi",
      name: "Kimi",
      kind: "openai-compatible",
      baseUrl: withoutTrailingSlash(process.env.MOONSHOT_BASE_URL ?? "https://api.moonshot.cn/v1"),
      apiKeyEnv: "MOONSHOT_API_KEY",
      apiKey: process.env.MOONSHOT_API_KEY?.trim(),
      defaultModel: configuredModel("MOONSHOT_MODEL", "kimi-k3"),
      models: [
        model("kimi-k3", "Kimi K3", ["stream", "reasoning", "prompt-cache", "tools", "usage"], reasoning(["max"], "max")),
        model("kimi-k2.7-code-highspeed", "Kimi K2.7 Code Highspeed", ["stream", "reasoning", "tools", "usage"]),
        model("kimi-k2.6", "Kimi K2.6", ["stream", "reasoning", "prompt-cache", "tools", "usage"]),
      ],
      capabilities: ["openai-compatible", "stream", "reasoning", "prompt-cache", "tools", "usage"],
    },
    {
      id: "qwen",
      name: "通义千问",
      kind: "openai-compatible",
      baseUrl: withoutTrailingSlash(process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1"),
      apiKeyEnv: "DASHSCOPE_API_KEY",
      apiKey: process.env.DASHSCOPE_API_KEY?.trim(),
      defaultModel: configuredModel("DASHSCOPE_MODEL", "qwen3.7-plus"),
      models: [
        model("qwen3.7-plus", "Qwen 3.7 Plus", ["stream", "reasoning", "prompt-cache", "tools", "usage"], thinkingToggle),
        model("qwen3.7-max", "Qwen 3.7 Max", ["stream", "reasoning", "prompt-cache", "tools", "usage"], thinkingToggle),
        model("qwen3.6-flash", "Qwen 3.6 Flash", ["stream", "reasoning", "prompt-cache", "tools", "usage"], thinkingToggle),
      ],
      capabilities: ["openai-compatible", "stream", "reasoning", "prompt-cache", "tools", "usage"],
    },
    {
      id: "openai",
      name: "OpenAI",
      kind: "openai-responses",
      baseUrl: withoutTrailingSlash(process.env.OPENAI_BASE_URL ?? "https://api.openai.com"),
      apiKeyEnv: "OPENAI_API_KEY",
      apiKey: process.env.OPENAI_API_KEY?.trim(),
      defaultModel: configuredModel("OPENAI_MODEL", "gpt-5.6-sol"),
      models: [
        model("gpt-5.6-sol", "GPT 5.6 Sol", ["stream", "reasoning-summary", "prompt-cache", "tools", "usage"], reasoning(["none", "low", "medium", "high", "xhigh", "max"], "medium")),
        model("gpt-5.6-terra", "GPT 5.6 Terra", ["stream", "reasoning-summary", "prompt-cache", "tools", "usage"], reasoning(["none", "low", "medium", "high", "xhigh", "max"], "medium")),
        model("gpt-5.6-luna", "GPT 5.6 Luna", ["stream", "reasoning-summary", "prompt-cache", "tools", "usage"], reasoning(["none", "low", "medium", "high", "xhigh", "max"], "low")),
      ],
      capabilities: ["responses-api", "stream", "reasoning-summary", "prompt-cache", "tools", "usage"],
    },
    {
      id: "anthropic",
      name: "Anthropic Claude",
      kind: "anthropic-messages",
      baseUrl: withoutTrailingSlash(process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"),
      apiKeyEnv: "ANTHROPIC_API_KEY",
      apiKey: process.env.ANTHROPIC_API_KEY?.trim(),
      defaultModel: configuredModel("ANTHROPIC_MODEL", "claude-opus-4-8"),
      models: [model("claude-opus-4-8", "Claude Opus 4.8", ["stream", "prompt-cache", "tools", "usage"])],
      capabilities: ["messages-api", "stream", "prompt-cache", "tools", "usage"],
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      kind: "openai-compatible",
      baseUrl: withoutTrailingSlash(process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"),
      apiKeyEnv: "OPENROUTER_API_KEY",
      apiKey: process.env.OPENROUTER_API_KEY?.trim(),
      defaultModel: openRouterModel,
      models: openRouterModels.map((modelId) => buildOpenRouterModel(modelId)),
      capabilities: ["openai-compatible", "stream", "routing", "fallbacks", "reasoning", "prompt-cache", "tools", "usage"],
      headers: {
        ...(process.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL } : {}),
        "X-Title": process.env.OPENROUTER_APP_NAME ?? "Ocean",
      },
    },
    ...customCompatibleProviders(),
  ];
}

export class ProviderRegistry {
  private readonly providers = definitions();

  listPublic() {
    return this.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      configured: provider.kind === "mock" || Boolean(provider.apiKey),
      defaultModel: provider.defaultModel || null,
      capabilities: provider.capabilities,
      models: provider.models,
    }));
  }

  listModels(includeUnconfigured = false) {
    const available = this.providers
      .filter((provider) => includeUnconfigured || provider.kind === "mock" || Boolean(provider.apiKey))
      .flatMap((provider) => provider.models.map((entry) => ({
        ...entry,
        id: `${provider.id}:${entry.id}`,
        provider: provider.name,
        providerId: provider.id,
        upstreamModelId: entry.id,
      })));
    const allowed = configuredModels("OCEAN_CHAT_MODELS", []);
    if (!allowed.length) return available;
    const filtered = available.filter((entry) => allowed.includes(entry.id));
    return filtered.length ? filtered : available.filter((entry) => entry.providerId === "mock");
  }

  get(id: string) { return this.providers.find((provider) => provider.id === id); }

  async openRouterBalance() {
    const provider = this.get("openrouter");
    if (!provider?.apiKey) throw new Error("OpenRouter is not configured on Ocean Gateway");
    const response = await fetch(`${provider.baseUrl}/credits`, {
      headers: { Authorization: `Bearer ${provider.apiKey}`, ...(provider.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`OpenRouter credits request failed with ${response.status}`);
    const payload = await response.json() as { data?: { total_credits?: number; total_usage?: number } };
    const totalCredits = Number(payload.data?.total_credits);
    const totalUsage = Number(payload.data?.total_usage);
    if (!Number.isFinite(totalCredits) || !Number.isFinite(totalUsage)) throw new Error("OpenRouter credits response is incomplete");
    return {
      providerId: "openrouter" as const,
      currency: "USD" as const,
      totalCredits,
      totalUsage,
      remaining: Math.max(0, totalCredits - totalUsage),
      fetchedAt: new Date().toISOString(),
    };
  }

  resolve(request: ProviderChatRequest) {
    const composite = request.modelId?.includes(":") ? request.modelId.split(":", 2) : null;
    const requestedProviderId = request.providerId || composite?.[0];
    const preferred = requestedProviderId || process.env.OCEAN_DEFAULT_PROVIDER?.trim();
    let provider = preferred ? this.get(preferred) : undefined;
    if (!provider || (provider.kind !== "mock" && !provider.apiKey)) {
      if (requestedProviderId) throw new Error(`Provider '${requestedProviderId}' is not configured on Ocean Gateway`);
      provider = this.get("mock");
    }
    if (!provider) throw new Error("Ocean mock provider is missing");
    const rawModelId = composite?.[1] || request.modelId || provider.defaultModel;
    const modelId = rawModelId || provider.models[0]?.id;
    if (!modelId) throw new Error(`Provider '${provider.id}' has no configured model`);
    const allowed = configuredModels("OCEAN_CHAT_MODELS", []);
    const compositeId = `${provider.id}:${modelId}`;
    if (allowed.length && provider.kind !== "mock" && !allowed.includes(compositeId)) throw new Error(`Model '${compositeId}' is not enabled for Ocean chat`);
    return { provider, modelId };
  }

  adapter(provider: ProviderDefinition): ProviderAdapter {
    if (provider.kind !== "mock" && !provider.apiKey) throw new Error(`${provider.name} requires ${provider.apiKeyEnv}`);
    if (provider.kind === "mock") return new MockProviderAdapter();
    if (provider.kind === "openai-responses") return new OpenAIResponsesAdapter(provider, systemPrompt);
    if (provider.kind === "anthropic-messages") return new AnthropicMessagesAdapter(provider, systemPrompt);
    return new OpenAICompatibleAdapter(provider, systemPrompt);
  }

  async test(id: string) {
    const provider = this.get(id);
    if (!provider) throw new Error(`Unknown provider '${id}'`);
    if (provider.kind !== "mock" && !provider.apiKey) throw new Error(`${provider.name} is not configured; set ${provider.apiKeyEnv} on the Gateway`);
    return this.adapter(provider).testConnection();
  }
}
