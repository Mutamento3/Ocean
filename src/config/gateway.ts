const GATEWAY_URL_KEY = "ocean:gateway-url";

function stripWrappingQuotes(value: string) {
  let result = value.trim();
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["“", "”"],
    ["‘", "’"],
  ];

  for (const [opening, closing] of quotePairs) {
    if (result.startsWith(opening) && result.endsWith(closing) && result.length >= opening.length + closing.length) {
      result = result.slice(opening.length, -closing.length).trim();
      break;
    }
  }
  return result;
}

function normalizeGatewayUrl(value: string) {
  const trimmed = stripWrappingQuotes(value);
  if (!trimmed) return "";
  if (trimmed === "/") return "";

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed.replace(/\/$/, "");
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function isLoopbackUrl(value: string, origin: string) {
  try {
    const parsed = new URL(value, origin);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  } catch {
    return false;
  }
}

export function getGatewayBaseUrl() {
  const localPage = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  try {
    const saved = window.localStorage.getItem(GATEWAY_URL_KEY);
    if (saved) {
      const normalized = normalizeGatewayUrl(saved);
      if (normalized) {
        const savedIsLoopback = isLoopbackUrl(normalized, window.location.origin);
        if (!localPage && savedIsLoopback) window.localStorage.removeItem(GATEWAY_URL_KEY);
        else {
          if (normalized !== saved) window.localStorage.setItem(GATEWAY_URL_KEY, normalized);
          return normalized;
        }
      }
      window.localStorage.removeItem(GATEWAY_URL_KEY);
    }
  } catch { /* Storage can be unavailable in privacy modes. */ }
  const configured = normalizeGatewayUrl(import.meta.env.VITE_OCEAN_GATEWAY_URL ?? "");
  if (configured && (localPage || !isLoopbackUrl(configured, window.location.origin))) return configured;
  if (localPage) return "http://127.0.0.1:8787";

  // A phone opening Vite's LAN preview must talk to the Gateway on the same
  // computer, not to the phone's own localhost. Production deployments keep
  // using the same-origin /api reverse proxy.
  if (window.location.port === "4173") {
    return `${window.location.protocol}//${window.location.hostname}:8787`;
  }
  return window.location.pathname.startsWith("/ocean") ? "/ocean-api" : "/api";
}

export function setGatewayBaseUrl(value: string) {
  const normalized = normalizeGatewayUrl(value);
  window.localStorage.setItem(GATEWAY_URL_KEY, normalized);
  window.dispatchEvent(new CustomEvent("ocean:gateway-url-changed", { detail: normalized }));
  return normalized;
}
