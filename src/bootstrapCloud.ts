import { OceanGatewayClient } from "./api/OceanGatewayClient";
import { getModelSelection, setModelSelection } from "./config/modelSelection";
import { restoreFromGateway } from "./sync/gatewayRestore";
import { flushOutbox } from "./sync/gatewaySync";

type ConnectionState = "mock" | "connected" | "staging" | "disconnected";
type Connections = Record<"model" | "gateway" | "memory" | "reading" | "notifications", ConnectionState>;

const DEFAULT_CONNECTIONS: Connections = {
  model: "mock",
  gateway: "mock",
  memory: "mock",
  reading: "mock",
  notifications: "disconnected",
};

let recoveryInstalled = false;
let recoveryPromise: Promise<void> | null = null;

function readConnections() {
  try { return { ...DEFAULT_CONNECTIONS, ...JSON.parse(window.localStorage.getItem("ocean:connections") ?? "{}") } as Connections; }
  catch { return { ...DEFAULT_CONNECTIONS }; }
}

async function recoverGatewayConnection() {
  if (recoveryPromise) return recoveryPromise;
  recoveryPromise = (async () => {
    const client = new OceanGatewayClient();
    try {
      await client.health();
      const connections = readConnections();
      connections.gateway = "connected";
      window.localStorage.setItem("ocean:connections", JSON.stringify(connections));
      await flushOutbox(true);
      await restoreFromGateway();
      window.dispatchEvent(new CustomEvent("ocean:gateway-recovered"));
    } catch {
      const connections = readConnections();
      connections.gateway = "disconnected";
      window.localStorage.setItem("ocean:connections", JSON.stringify(connections));
    }
  })().finally(() => { recoveryPromise = null; });
  return recoveryPromise;
}

function installGatewayRecovery() {
  if (recoveryInstalled) return;
  recoveryInstalled = true;
  window.addEventListener("offline", () => {
    const connections = readConnections();
    connections.gateway = "disconnected";
    window.localStorage.setItem("ocean:connections", JSON.stringify(connections));
  });
  window.addEventListener("online", () => { void recoverGatewayConnection(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) void recoverGatewayConnection();
  });
}

/**
 * A same-origin production build already has a private Gateway assigned by the
 * host. Detect it once so a fresh phone does not have to paste infrastructure
 * URLs or manually switch from Mock before the first real conversation.
 */
export async function bootstrapCloudGateway() {
  const local = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  if (local) return;

  installGatewayRecovery();
  const client = new OceanGatewayClient();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4_000);
  try {
    await client.health(controller.signal);
    const [providersResult, readingResult, memoryResult] = await Promise.allSettled([
      client.listProviders(),
      client.readingHealth(),
      client.memoryHealth(),
    ]);
    const providers = providersResult.status === "fulfilled" ? providersResult.value : [];
    const realProvider = providers.find((provider) => provider.configured && provider.id !== "mock");
    const connections = readConnections();
    connections.gateway = "connected";
    connections.model = realProvider ? "connected" : connections.model;
    connections.reading = readingResult.status === "fulfilled" ? "connected" : connections.reading;
    connections.memory = memoryResult.status === "fulfilled" ? "connected" : connections.memory;
    window.localStorage.setItem("ocean:connections", JSON.stringify(connections));
    window.localStorage.setItem("ocean:onboarded", "true");

    if (realProvider) {
      window.localStorage.setItem("ocean:chat:live", "true");
      if (!getModelSelection() && realProvider.defaultModel) {
        setModelSelection({ providerId: realProvider.id, modelId: `${realProvider.id}:${realProvider.defaultModel}`, settings: {} });
      }
    }

    await restoreFromGateway().catch(() => undefined);
    await flushOutbox(true).catch(() => undefined);
  } catch {
    // A public/open-source build can intentionally have no hosted Gateway.
    // In that case the normal first-run wizard and Mock path remain available.
  } finally {
    window.clearTimeout(timeout);
  }
}
