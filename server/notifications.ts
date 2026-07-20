import webpush, { type PushSubscription } from "web-push";
import type { JsonStore, StoredPaperNote, StoredPushSubscription } from "./store.js";

export interface OceanPushPayload {
  title: string;
  body: string;
  tag: string;
  url?: string;
  room?: "living" | "home" | "study" | "leisure" | "palace";
}

export interface NotificationPreferences {
  paperNotes: boolean;
  freeTime: boolean;
  showPreview: boolean;
  quietStart: string;
  quietEnd: string;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  paperNotes: true,
  freeTime: true,
  showPreview: false,
  quietStart: "02:00",
  quietEnd: "08:00",
};

function minuteInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function parseClock(value: string, fallback: number) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : fallback;
}

function isQuietNow(preferences: NotificationPreferences, now = new Date(), timeZone = "Asia/Shanghai") {
  const start = parseClock(preferences.quietStart, 120);
  const end = parseClock(preferences.quietEnd, 480);
  if (start === end) return false;
  const minute = minuteInTimeZone(now, timeZone);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const clock = (key: string, fallback: string) => typeof input[key] === "string" && /^\d{2}:\d{2}$/.test(input[key] as string) ? input[key] as string : fallback;
  return {
    paperNotes: input.paperNotes !== false,
    freeTime: input.freeTime !== false,
    showPreview: input.showPreview === true,
    quietStart: clock("quietStart", DEFAULT_NOTIFICATION_PREFERENCES.quietStart),
    quietEnd: clock("quietEnd", DEFAULT_NOTIFICATION_PREFERENCES.quietEnd),
  };
}

export class OceanNotificationService {
  readonly configured: boolean;
  readonly publicKey: string;
  private readonly timeZone: string;

  constructor(private readonly store: JsonStore) {
    const publicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim() ?? "";
    const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim() ?? "";
    const subject = process.env.WEB_PUSH_SUBJECT?.trim() || "mailto:admin@example.invalid";
    this.publicKey = publicKey;
    this.configured = Boolean(publicKey && privateKey);
    this.timeZone = process.env.NOTIFICATION_TIME_ZONE?.trim() || "Asia/Shanghai";
    if (this.configured) webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  async subscribe(subscription: PushSubscription, preferences: NotificationPreferences, userAgent?: string) {
    if (!this.configured) throw new Error("web_push_unconfigured");
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) throw new Error("invalid_push_subscription");
    return this.store.savePushSubscription({ subscription, preferences, userAgent });
  }

  async unsubscribe(endpoint: string) {
    return this.store.removePushSubscription(endpoint);
  }

  async send(payload: OceanPushPayload, options: { kind: "test" | "free-time" | "paper-note"; force?: boolean } = { kind: "test" }) {
    if (!this.configured) return { sent: 0, removed: 0, skipped: this.store.listPushSubscriptions().length };
    let sent = 0;
    let removed = 0;
    let skipped = 0;
    for (const entry of this.store.listPushSubscriptions()) {
      const preferences = normalizeNotificationPreferences(entry.preferences);
      const enabled = options.kind === "free-time" ? preferences.freeTime : options.kind === "paper-note" ? preferences.paperNotes : true;
      if (!options.force && (!enabled || isQuietNow(preferences, new Date(), this.timeZone))) { skipped += 1; continue; }
      const safePayload = preferences.showPreview || options.kind === "test"
        ? payload
        : { ...payload, body: options.kind === "free-time" ? "陪伴者刚刚回来过。" : "Ocean 有一条新消息。" };
      try {
        await webpush.sendNotification(entry.subscription, JSON.stringify(safePayload), { TTL: 60 * 60, urgency: options.kind === "test" ? "high" : "normal" });
        sent += 1;
      } catch (error) {
        const statusCode = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode?: number }).statusCode) : 0;
        if (statusCode === 404 || statusCode === 410) {
          await this.store.removePushSubscription(entry.subscription.endpoint);
          removed += 1;
        } else {
          console.error("Ocean push send failed", { statusCode, endpoint: entry.subscription.endpoint.slice(0, 48) });
        }
      }
    }
    return { sent, removed, skipped };
  }

  async notifyFreeTime(run: { summary?: string; action?: string }) {
    const detail = run.summary?.trim() || (run.action ? `陪伴者完成了一次${run.action}。` : "陪伴者刚刚回来过。");
    return this.send({ title: "Ocean · 自由时间", body: detail, tag: "ocean-free-time", url: "?room=living", room: "living" }, { kind: "free-time" });
  }
  async notifyPaperNote(note: Pick<StoredPaperNote, "id" | "time" | "text">) {
    return this.send({ title: `Ocean · ${note.time}纸条`, body: note.text, tag: `ocean-paper-note-${note.id}`, url: "?room=home", room: "home" }, { kind: "paper-note" });
  }
}

export type { StoredPushSubscription };
