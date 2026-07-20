import type { ProviderDefinition } from "./types.js";

export interface UsageForPricing {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

interface PricingTier {
  upToInputTokens?: number;
  input: number;
  cachedInput?: number;
  output: number;
}

interface ModelPricing {
  currency: string;
  tiers: PricingTier[];
}

const qwenTier = (input: number, output: number, upToInputTokens?: number): PricingTier => ({
  input,
  cachedInput: input * 0.2,
  output,
  upToInputTokens,
});

// List prices per one million tokens. Provider-reported cost always wins; these
// rates are only a transparent fallback and can be replaced from Gateway env.
const BUILT_IN_PRICING: Record<string, ModelPricing> = {
  "deepseek:deepseek-v4-flash": { currency: "USD", tiers: [{ input: 0.14, cachedInput: 0.0028, output: 0.28 }] },
  "deepseek:deepseek-v4-pro": { currency: "USD", tiers: [{ input: 0.435, cachedInput: 0.003625, output: 0.87 }] },
  "kimi:kimi-k3": { currency: "USD", tiers: [{ input: 3, cachedInput: 0.3, output: 15 }] },
  "qwen:qwen3.7-plus": { currency: "CNY", tiers: [qwenTier(2, 8, 256_000), qwenTier(6, 24)] },
  "qwen:qwen3.7-max": { currency: "CNY", tiers: [qwenTier(12, 36)] },
  "qwen:qwen3.6-flash": { currency: "CNY", tiers: [qwenTier(1.2, 7.2, 256_000), qwenTier(4.8, 28.8)] },
};

function isFiniteRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function pricingOverrides(): Record<string, ModelPricing> {
  const raw = process.env.OCEAN_MODEL_PRICING_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => {
      if (!value || typeof value !== "object") return [];
      const entry = value as Record<string, unknown>;
      const currency = typeof entry.currency === "string" && entry.currency.trim() ? entry.currency.trim().toUpperCase() : "USD";
      const tiersInput = Array.isArray(entry.tiers) ? entry.tiers : [entry];
      const tiers = tiersInput.flatMap((tierValue) => {
        if (!tierValue || typeof tierValue !== "object") return [];
        const tier = tierValue as Record<string, unknown>;
        if (!isFiniteRate(tier.input) || !isFiniteRate(tier.output)) return [];
        return [{
          input: tier.input,
          output: tier.output,
          ...(isFiniteRate(tier.cachedInput) ? { cachedInput: tier.cachedInput } : {}),
          ...(isFiniteRate(tier.upToInputTokens) ? { upToInputTokens: tier.upToInputTokens } : {}),
        } satisfies PricingTier];
      });
      return tiers.length ? [[key, { currency, tiers } satisfies ModelPricing] as const] : [];
    }));
  } catch {
    return {};
  }
}

export function estimateUsageCost(provider: ProviderDefinition, modelId: string, usage: UsageForPricing) {
  const overrides = pricingOverrides();
  const exactOverride = overrides[`${provider.id}:${modelId}`];
  const wildcardOverride = overrides[`${provider.id}:*`];
  const pricing = exactOverride ?? wildcardOverride ?? BUILT_IN_PRICING[`${provider.id}:${modelId}`];
  if (!pricing) return {};
  const tier = pricing.tiers.find((candidate) => candidate.upToInputTokens === undefined || usage.inputTokens <= candidate.upToInputTokens)
    ?? pricing.tiers.at(-1);
  if (!tier) return {};
  const cachedTokens = Math.min(Math.max(0, usage.cachedTokens), Math.max(0, usage.inputTokens));
  const uncachedTokens = Math.max(0, usage.inputTokens - cachedTokens);
  const cachedRate = tier.cachedInput ?? tier.input;
  const cost = (uncachedTokens * tier.input + cachedTokens * cachedRate + Math.max(0, usage.outputTokens) * tier.output) / 1_000_000;
  return {
    cost,
    currency: pricing.currency,
    costEstimated: true as const,
    pricingSource: exactOverride || wildcardOverride ? "gateway-config" as const : "built-in" as const,
  };
}
