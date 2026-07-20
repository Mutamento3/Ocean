import type { MemoryAdapter } from "./contracts";
import type { MemoryCandidate } from "../domain/ocean";
import { syncOrQueue } from "../sync/gatewaySync";

const KEY = "ocean:memory-candidates";

export class StagedMemoryAdapter implements MemoryAdapter {
  async createHandoff(sessionId: string) {
    return `Mock handoff for ${sessionId}: 保留当前项目、未完成话题和最近关系天气。`;
  }

  async saveCandidate(content: string, source: string) {
    const current = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as MemoryCandidate[];
    const candidate: MemoryCandidate = { id: crypto.randomUUID(), content, source, status: "candidate", createdAt: new Date().toISOString() };
    current.push(candidate);
    window.localStorage.setItem(KEY, JSON.stringify(current));
    await syncOrQueue("candidate", candidate);
  }
}

export const stagedMemoryAdapter = new StagedMemoryAdapter();
