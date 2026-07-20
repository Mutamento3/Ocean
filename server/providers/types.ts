export type OceanChatRole = "user" | "assistant";

export interface OceanChatMessage {
  role: OceanChatRole;
  content: string;
}

export interface OceanChatAttachment {
  kind: "image" | "text" | "connector";
  name: string;
  mimeType: string;
  size: number;
  data: string;
}

export interface OceanChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OceanToolExecutionResult {
  ok: boolean;
  content: unknown;
}

export interface ProviderChatRequest {
  input: string;
  providerId?: string;
  modelId?: string;
  messages?: OceanChatMessage[];
  attachments?: OceanChatAttachment[];
  settings?: Record<string, string>;
  tools?: OceanChatTool[];
  toolChoice?: "auto" | { type: "function"; function: { name: string } };
  executeTool?: (name: string, argumentsValue: Record<string, unknown>) => Promise<OceanToolExecutionResult>;
  context?: {
    mode?: string;
    nightTalk?: boolean;
    elapsedSinceLastTurn?: string;
    continuitySummary?: string;
    continuityHandoff?: string;
    memoryContext?: string;
    memoryRecall?: {
      status: "hit" | "miss" | "skipped" | "disabled" | "unavailable";
      count: number;
      directCount: number;
      relatedCount: number;
    };
    physicalSessionId?: string;
    modeInstruction?: string;
  };
}

export type GatewayStreamEvent =
  | { type: "reasoning"; value: { title: string; content: string } }
  | { type: "segment"; value: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens?: number; providerId: string; modelId: string; cost?: number; currency?: string; costEstimated?: boolean; pricingSource?: "provider" | "built-in" | "gateway-config"; memoryRecall?: { status: "hit" | "miss" | "skipped" | "disabled" | "unavailable"; count: number; directCount: number; relatedCount: number } }
  | { type: "error"; message: string; code?: string; retryable?: boolean; providerId?: string; modelId?: string }
  | { type: "done" };

export interface ProviderModelDefinition {
  id: string;
  name: string;
  profiles: Array<{ id: string; label: string }>;
  settings: Array<{
    id: string;
    label: string;
    defaultValue: string;
    options: Array<{ id: string; label: string }>;
  }>;
  capabilities: string[];
}

export type ProviderKind = "mock" | "openai-responses" | "anthropic-messages" | "openai-compatible";

export interface ProviderDefinition {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKey?: string;
  defaultModel: string;
  models: ProviderModelDefinition[];
  capabilities: string[];
  headers?: Record<string, string>;
}

export interface ProviderAdapter {
  stream(request: ProviderChatRequest, modelId: string): AsyncIterable<GatewayStreamEvent>;
  testConnection(): Promise<{ ok: true; detail: string }>;
}
