export interface MemoryToolInfo {
  name: string;
  description?: string;
}

interface JsonRpcEnvelope<T> {
  jsonrpc: "2.0";
  id?: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: { result?: string };
  isError?: boolean;
}

interface InitializeResult {
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
}

function parseResponse<T>(text: string): JsonRpcEnvelope<T> {
  const payloads = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  const raw = payloads.at(-1) ?? text.trim();
  if (!raw) return { jsonrpc: "2.0", result: undefined };
  return JSON.parse(raw) as JsonRpcEnvelope<T>;
}

export class MemoryMcpClient {
  private sessionId = "";
  private nextId = 1;
  private initialization?: Promise<void>;
  private info = { name: "Memory MCP", version: "unknown" };

  constructor(
    private readonly url: string,
    private readonly authorization = "",
    private readonly label = "Memory MCP",
  ) {}

  private headers(session = false) {
    return {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(this.authorization ? { Authorization: this.authorization.startsWith("Bearer ") ? this.authorization : `Bearer ${this.authorization}` } : {}),
      ...(session && this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
    };
  }

  private async post<T>(method: string, params: unknown, session = true): Promise<T> {
    const id = this.nextId++;
    const response = await fetch(this.url, {
      method: "POST",
      headers: this.headers(session),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!response.ok) throw new Error(`${this.label} ${response.status}: ${await response.text()}`);
    if (!this.sessionId) this.sessionId = response.headers.get("mcp-session-id") ?? "";
    const envelope = parseResponse<T>(await response.text());
    if (envelope.error) throw new Error(`${this.label} ${envelope.error.code}: ${envelope.error.message}`);
    if (envelope.result === undefined) throw new Error(`${this.label} returned no result for ${method}`);
    return envelope.result;
  }

  private async notify(method: string, params: unknown) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    });
    if (!response.ok) throw new Error(`${this.label} notification ${response.status}`);
  }

  private async initialize() {
    const result = await this.post<InitializeResult>("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "Ocean Gateway", version: "0.1.0" },
    }, false);
    this.info = {
      name: result.serverInfo?.name || this.info.name,
      version: result.serverInfo?.version || this.info.version,
    };
    await this.notify("notifications/initialized", {});
  }

  private async ready() {
    if (!this.initialization) {
      this.initialization = this.initialize().catch((error) => {
        this.initialization = undefined;
        this.sessionId = "";
        throw error;
      });
    }
    await this.initialization;
  }

  async listTools() {
    await this.ready();
    const result = await this.post<{ tools: MemoryToolInfo[] }>("tools/list", {});
    return result.tools;
  }

  get serverInfo() {
    return { ...this.info };
  }

  async callTool(name: string, args: Record<string, unknown> = {}) {
    await this.ready();
    let result: ToolCallResult;
    try {
      result = await this.post<ToolCallResult>("tools/call", { name, arguments: args });
    } catch (error) {
      if (!String(error).includes("404") && !String(error).includes("410") && !String(error).includes("session")) throw error;
      this.sessionId = "";
      this.initialization = undefined;
      await this.ready();
      result = await this.post<ToolCallResult>("tools/call", { name, arguments: args });
    }
    if (result.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text ?? `Memory tool ${name} failed`);
    return result.structuredContent?.result
      ?? result.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n")
      ?? "";
  }
}
