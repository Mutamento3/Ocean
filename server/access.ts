import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const COOKIE_NAME = "ocean_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

type FailureWindow = { count: number; resetAt: number };

function configuredPassword() {
  const encoded = process.env.OCEAN_ACCESS_PASSWORD_B64?.trim();
  if (encoded) {
    try { return Buffer.from(encoded, "base64").toString("utf8"); }
    catch { return ""; }
  }
  return process.env.OCEAN_ACCESS_PASSWORD ?? "";
}

function equalSecret(left: string, right: string) {
  const leftDigest = createHmac("sha256", "ocean-access-compare").update(left).digest();
  const rightDigest = createHmac("sha256", "ocean-access-compare").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function cookies(request: IncomingMessage) {
  return Object.fromEntries((request.headers.cookie ?? "").split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return [part.trim(), ""];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([key]) => key));
}

function requestAddress(request: IncomingMessage) {
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
}

function cookieScope(request: IncomingMessage) {
  const rawPrefix = request.headers["x-forwarded-prefix"];
  const prefix = (Array.isArray(rawPrefix) ? rawPrefix[0] : rawPrefix)?.trim();
  const path = prefix?.startsWith("/") ? prefix.replace(/\/$/, "") || "/" : "/";
  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const secure = proto === "https" || Boolean((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted);
  return { path, secure };
}

function sessionCookie(request: IncomingMessage, value: string, maxAge: number) {
  const scope = cookieScope(request);
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=${scope.path}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${scope.secure ? "; Secure" : ""}`;
}

export class OceanAccessController {
  private readonly password = configuredPassword();
  private readonly failures = new Map<string, FailureWindow>();

  get required() { return Boolean(this.password); }

  private signature(expiresAt: number) {
    return createHmac("sha256", this.password).update(`ocean-session-v1:${expiresAt}`).digest("base64url");
  }

  private token(expiresAt: number) {
    return `${expiresAt}.${this.signature(expiresAt)}`;
  }

  isAuthenticated(request: IncomingMessage) {
    if (!this.required) return true;
    const value = cookies(request)[COOKIE_NAME];
    if (!value) return false;
    const [rawExpiresAt, signature] = value.split(".");
    const expiresAt = Number(rawExpiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || !signature) return false;
    return equalSecret(signature, this.signature(expiresAt));
  }

  login(request: IncomingMessage, password: string) {
    if (!this.required) return { ok: true as const, cookie: undefined, expiresAt: undefined };
    const address = requestAddress(request);
    const now = Date.now();
    const window = this.failures.get(address);
    if (window && window.resetAt > now && window.count >= MAX_FAILURES) {
      return { ok: false as const, status: 429 as const, retryAfterSeconds: Math.ceil((window.resetAt - now) / 1000) };
    }
    if (!equalSecret(password, this.password)) {
      const next = !window || window.resetAt <= now
        ? { count: 1, resetAt: now + FAILURE_WINDOW_MS }
        : { ...window, count: window.count + 1 };
      this.failures.set(address, next);
      return { ok: false as const, status: 401 as const };
    }
    this.failures.delete(address);
    const expiresAt = now + SESSION_SECONDS * 1000;
    return {
      ok: true as const,
      expiresAt: new Date(expiresAt).toISOString(),
      cookie: sessionCookie(request, this.token(expiresAt), SESSION_SECONDS),
    };
  }

  logoutCookie(request: IncomingMessage) {
    return sessionCookie(request, "", 0);
  }
}
