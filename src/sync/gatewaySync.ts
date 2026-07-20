import { OceanGatewayClient } from "../api/OceanGatewayClient";

export type SyncKind = "conversation" | "candidate" | "memory-event" | "home";
export interface SyncOperation { id: string; kind: SyncKind; payload: unknown; createdAt: string }
const OUTBOX_KEY = "ocean:sync-outbox";
export const gatewayClient = new OceanGatewayClient();

export function gatewayIsConnected() {
  try { return (JSON.parse(localStorage.getItem("ocean:connections") ?? "{}") as { gateway?: string }).gateway === "connected"; }
  catch { return false; }
}

function readOutbox() { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]") as SyncOperation[]; } catch { return []; } }
function writeOutbox(items: SyncOperation[]) { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items)); }

function operationScope(operation: SyncOperation) {
  if (!operation.payload || typeof operation.payload !== "object") return undefined;
  const scope = (operation.payload as { scope?: unknown }).scope;
  return typeof scope === "string" ? scope : undefined;
}

export function hasPendingSync(kind: SyncKind, scope?: string) {
  return readOutbox().some((operation) => operation.kind === kind && (scope === undefined || operationScope(operation) === scope));
}

async function execute(operation: SyncOperation) {
  if (operation.kind === "conversation") return gatewayClient.saveConversation(operation.payload);
  if (operation.kind === "candidate") return gatewayClient.addMemoryCandidate(operation.payload);
  if (operation.kind === "memory-event") return gatewayClient.recordMemoryEvent(operation.payload);
  return gatewayClient.saveHome(operation.payload);
}

export async function syncOrQueue(kind: SyncKind, payload: unknown) {
  const operation: SyncOperation = { id: crypto.randomUUID(), kind, payload, createdAt: new Date().toISOString() };
  if (gatewayIsConnected()) {
    try { await execute(operation); return true; } catch { /* queue below */ }
  }
  const outbox = readOutbox();
  const deduped = kind === "home" || kind === "conversation" ? outbox.filter((item) => item.kind !== kind || (item.payload as any)?.scope !== (payload as any)?.scope) : outbox;
  writeOutbox([...deduped, operation]); return false;
}

export async function flushOutbox(force = false) {
  if (!force && !gatewayIsConnected()) return { sent: 0, remaining: readOutbox().length };
  const pending = readOutbox(); const remaining: SyncOperation[] = []; let sent = 0;
  for (const operation of pending) { try { await execute(operation); sent += 1; } catch { remaining.push(operation); } }
  writeOutbox(remaining); return { sent, remaining: remaining.length };
}
