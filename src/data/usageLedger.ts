import type { ChatStreamEvent } from "../domain/ocean";

type UsageEvent = Extract<ChatStreamEvent, { type: "usage" }>;

export interface UsageLedger {
  day: string;
  latest: UsageEvent | null;
  dailyInputTokens: number;
  dailyOutputTokens: number;
  dailyCachedTokens: number;
  dailyCost: number;
  dailyCosts: Record<string, number>;
  estimatedCurrencies: string[];
  currency?: string;
}

const KEY = "ocean:usage-ledger";
const today = () => new Date().toISOString().slice(0, 10);
const empty = (): UsageLedger => ({ day: today(), latest: null, dailyInputTokens: 0, dailyOutputTokens: 0, dailyCachedTokens: 0, dailyCost: 0, dailyCosts: {}, estimatedCurrencies: [] });

export function readUsageLedger(): UsageLedger {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as UsageLedger | null;
    if (saved?.day !== today()) return empty();
    const dailyCosts = saved.dailyCosts ?? (saved.currency && saved.dailyCost > 0 ? { [saved.currency]: saved.dailyCost } : {});
    return { ...empty(), ...saved, dailyCosts, estimatedCurrencies: saved.estimatedCurrencies ?? [] };
  } catch { return empty(); }
}

export function recordUsage(event: UsageEvent) {
  const current = readUsageLedger();
  const currency = event.currency?.toUpperCase() ?? current.currency;
  const dailyCosts = { ...current.dailyCosts };
  if (event.cost !== undefined && currency) dailyCosts[currency] = (dailyCosts[currency] ?? 0) + event.cost;
  const estimatedCurrencies = event.costEstimated && currency
    ? Array.from(new Set([...current.estimatedCurrencies, currency]))
    : current.estimatedCurrencies;
  const next: UsageLedger = {
    day: today(),
    latest: event,
    dailyInputTokens: current.dailyInputTokens + event.inputTokens,
    dailyOutputTokens: current.dailyOutputTokens + event.outputTokens,
    dailyCachedTokens: current.dailyCachedTokens + event.cachedTokens,
    dailyCost: currency ? (dailyCosts[currency] ?? 0) : current.dailyCost,
    dailyCosts,
    estimatedCurrencies,
    currency,
  };
  window.localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("ocean:usage-updated", { detail: next }));
  return next;
}
