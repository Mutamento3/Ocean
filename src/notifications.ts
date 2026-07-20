import { OceanGatewayClient } from "./api/OceanGatewayClient";

export interface NotificationPreferences {
  paperNotes: boolean;
  freeTime: boolean;
  showPreview: boolean;
  quietStart: string;
  quietEnd: string;
}

export type OceanNotificationStatus = "unsupported" | "needs-install" | "available" | "denied" | "subscribed";

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
}

function applicationServerKey(value: string) {
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function supportStatus(): OceanNotificationStatus {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (/iP(?:hone|ad|od)/.test(navigator.userAgent) && !isStandalone()) return "needs-install";
  if (Notification.permission === "denied") return "denied";
  return "available";
}

export async function getOceanNotificationStatus(): Promise<OceanNotificationStatus> {
  const support = supportStatus();
  if (support !== "available") return support;
  const registration = await navigator.serviceWorker.ready;
  return await registration.pushManager.getSubscription() ? "subscribed" : "available";
}

export async function enableOceanNotifications(preferences: NotificationPreferences) {
  const support = supportStatus();
  if (support !== "available") return support;
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "available";
  const registration = await navigator.serviceWorker.ready;
  const client = new OceanGatewayClient();
  const { publicKey } = await client.notificationPublicKey();
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) });
  await client.subscribeNotifications(subscription.toJSON(), preferences);
  return "subscribed" as const;
}

export async function syncOceanNotificationPreferences(preferences: NotificationPreferences) {
  if (supportStatus() !== "available" || Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  await new OceanGatewayClient().subscribeNotifications(subscription.toJSON(), preferences);
  return true;
}

export async function disableOceanNotifications() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await new OceanGatewayClient().unsubscribeNotifications(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}

export async function testOceanNotification() {
  return new OceanGatewayClient().testNotification();
}
