import type { ChatContext, ChatStreamEvent } from "../domain/ocean";
import type { FreeTimeConfig, FreeTimePromptPreview, FreeTimeRun } from "../domain/freeTime";

export interface ChatAdapter {
  streamReply(input: string, context: ChatContext): AsyncIterable<ChatStreamEvent>;
}

export interface MemoryAdapter {
  createHandoff(sessionId: string): Promise<string>;
  saveCandidate(content: string, source: string): Promise<void>;
}

export interface SchedulerAdapter {
  pause(): Promise<void>;
  resume(): Promise<void>;
  getStatus(): Promise<"running" | "paused" | "unavailable">;
  getConfig(): Promise<FreeTimeConfig>;
  updateConfig(config: FreeTimeConfig): Promise<FreeTimeConfig>;
  previewPrompt(config?: FreeTimeConfig): Promise<FreeTimePromptPreview>;
  triggerNow(): Promise<FreeTimeRun>;
  listRuns(): Promise<FreeTimeRun[]>;
}
