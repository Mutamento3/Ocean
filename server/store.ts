import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FreeTimeConfig, FreeTimePromptPreview } from "./freeTime.js";
import type { NotificationPreferences } from "./notifications.js";
import type { PushSubscription } from "web-push";

export interface StoredConversation { id: string; scope: string; messages: unknown[]; updatedAt: string }
export interface StoredProject {
  id: string;
  name: string;
  description?: string;
  status: "todo" | "done";
  createdAt: string;
  updatedAt: string;
}
export interface StoredContinuity {
  logicalConversationId: string;
  physicalSessionId: string;
  generation: number;
  summary: string;
  handoff: string;
  recentTurnIds: string[];
  forgedAt?: string;
  source: "local-fallback" | "gateway-deterministic" | "gateway-staging" | "provider";
  lastForgeMessageId?: string;
  storage?: Record<string, unknown>;
  updatedAt: string;
}
export interface StoredCandidate { id: string; content: string; source: string; status: "candidate" | "saved" | "dismissed"; createdAt: string; externalId?: string; error?: string }
export interface StoredFreeTimeRun extends FreeTimePromptPreview {
  id: string;
  status: "queued" | "dispatched" | "completed" | "skipped";
  reason?: string;
  createdAt: string;
  completedAt?: string;
  summary?: string;
  valence?: number;
  arousal?: number;
  action?: string;
  usage?: { providerId: string; modelId: string; inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens?: number; cost?: number; currency?: string };
}
export interface StoredPushSubscription {
  subscription: PushSubscription;
  preferences: NotificationPreferences;
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
}
export interface StoredPaperNote {
  id: string;
  slot: "morning" | "noon" | "evening" | "night";
  time: string;
  text: string;
  visibleAt: string;
  notifiedAt?: string;
}
export interface StoredPaperNotePackage {
  date: string;
  sourceDate: string;
  sourceImpressionId: string;
  contextVersion?: number;
  portraitSource?: "memory-3-profile";
  providerId: string;
  modelId: string;
  generatedAt: string;
  notes: StoredPaperNote[];
}
interface RuntimeData { projects: StoredProject[]; conversations: StoredConversation[]; continuities: StoredContinuity[]; candidates: StoredCandidate[]; home?: unknown; freeTime?: FreeTimeConfig; freeTimeRuns: StoredFreeTimeRun[]; freeTimeLastUserActivityAt?: string; pushSubscriptions: StoredPushSubscription[]; paperNotePackages: StoredPaperNotePackage[]; paperNoteLastAttemptAt?: string }

const defaultDataPath = () => join(process.cwd(), "server", "data", "runtime.json");
const EMPTY: RuntimeData = { projects: [], conversations: [], continuities: [], candidates: [], freeTimeRuns: [], pushSubscriptions: [], paperNotePackages: [] };

export class JsonStore {
  private data: RuntimeData = structuredClone(EMPTY);
  constructor(private readonly dataPath = defaultDataPath()) {}
  async initialize() {
    try { const saved = JSON.parse(await readFile(this.dataPath, "utf8")) as Partial<RuntimeData>; this.data = { projects: saved.projects ?? [], conversations: saved.conversations ?? [], continuities: saved.continuities ?? [], candidates: saved.candidates ?? [], home: saved.home, freeTime: saved.freeTime, freeTimeRuns: saved.freeTimeRuns ?? [], freeTimeLastUserActivityAt: saved.freeTimeLastUserActivityAt, pushSubscriptions: saved.pushSubscriptions ?? [], paperNotePackages: saved.paperNotePackages ?? [], paperNoteLastAttemptAt: saved.paperNoteLastAttemptAt }; }
    catch { await mkdir(dirname(this.dataPath), { recursive: true }); await this.flush(); }
  }
  private async flush() { await writeFile(this.dataPath, JSON.stringify(this.data, null, 2), "utf8"); }
  listProjects() { return [...this.data.projects].sort((left, right) => left.createdAt.localeCompare(right.createdAt)); }
  getProject(id: string) { return this.data.projects.find((project) => project.id === id); }
  async createProject(input: { name: string; description?: string; id?: string }) {
    const name = input.name.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) throw new Error("project_name_required");
    const duplicate = this.data.projects.find((project) => project.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
    if (duplicate) return duplicate;
    const now = new Date().toISOString();
    const item: StoredProject = {
      id: input.id?.trim() || crypto.randomUUID(),
      name,
      description: input.description?.trim().slice(0, 500) || undefined,
      status: "todo",
      createdAt: now,
      updatedAt: now,
    };
    this.data.projects.push(item);
    await this.flush();
    return item;
  }
  async updateProject(id: string, update: { name?: string; description?: string; status?: "todo" | "done" }) {
    const index = this.data.projects.findIndex((project) => project.id === id);
    if (index < 0) return undefined;
    const name = update.name === undefined ? this.data.projects[index].name : update.name.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) throw new Error("project_name_required");
    const duplicate = this.data.projects.find((project, projectIndex) => projectIndex !== index && project.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
    if (duplicate) throw new Error("project_name_conflict");
    this.data.projects[index] = {
      ...this.data.projects[index],
      name,
      ...(update.description === undefined ? {} : { description: update.description.trim().slice(0, 500) || undefined }),
      ...(update.status ? { status: update.status } : {}),
      updatedAt: new Date().toISOString(),
    };
    await this.flush();
    return this.data.projects[index];
  }
  async deleteProject(id: string) {
    const before = this.data.projects.length;
    this.data.projects = this.data.projects.filter((project) => project.id !== id);
    if (this.data.projects.length !== before) await this.flush();
    return { removed: before - this.data.projects.length };
  }
  async saveConversation(input: Omit<StoredConversation, "id" | "updatedAt"> & { id?: string }) {
    const id = input.id ?? crypto.randomUUID();
    const item = { id, scope: input.scope, messages: input.messages, updatedAt: new Date().toISOString() };
    this.data.conversations = [...this.data.conversations.filter((entry) => entry.id !== id), item];
    await this.flush(); return item;
  }
  listConversations(scope?: string) {
    return scope ? this.data.conversations.filter((entry) => entry.scope === scope) : this.data.conversations;
  }
  getContinuity(logicalConversationId: string) { return this.data.continuities.find((entry) => entry.logicalConversationId === logicalConversationId); }
  listContinuities() { return this.data.continuities; }
  async saveContinuity(input: Omit<StoredContinuity, "updatedAt">) {
    const item: StoredContinuity = { ...input, updatedAt: new Date().toISOString() };
    this.data.continuities = [...this.data.continuities.filter((entry) => entry.logicalConversationId !== item.logicalConversationId), item];
    await this.flush();
    return item;
  }
  listCandidates() { return this.data.candidates; }
  getCandidate(id: string) { return this.data.candidates.find((candidate) => candidate.id === id); }
  async addCandidate(input: Pick<StoredCandidate, "content" | "source"> & { id?: string }) {
    if (input.id) {
      const existing = this.data.candidates.find((candidate) => candidate.id === input.id);
      if (existing) return existing;
    }
    const item: StoredCandidate = { content: input.content, source: input.source, id: input.id ?? crypto.randomUUID(), status: "candidate", createdAt: new Date().toISOString() };
    this.data.candidates.push(item); await this.flush(); return item;
  }
  async updateCandidate(id: string, update: Partial<Pick<StoredCandidate, "status" | "externalId" | "error">>) {
    const index = this.data.candidates.findIndex((candidate) => candidate.id === id);
    if (index < 0) return undefined;
    this.data.candidates[index] = { ...this.data.candidates[index], ...update };
    await this.flush();
    return this.data.candidates[index];
  }
  getHome() { return this.data.home ?? null; }
  async saveHome(home: unknown) { this.data.home = home; await this.flush(); return home; }
  getFreeTime() { return this.data.freeTime; }
  async saveFreeTime(config: FreeTimeConfig) { this.data.freeTime = config; await this.flush(); return config; }
  listFreeTimeRuns() { return [...this.data.freeTimeRuns].reverse(); }
  getFreeTimeLastUserActivityAt() { return this.data.freeTimeLastUserActivityAt; }
  async markFreeTimeUserActivity(at = new Date().toISOString()) { this.data.freeTimeLastUserActivityAt = at; await this.flush(); return at; }
  async saveFreeTimeRun(input: Omit<StoredFreeTimeRun, "id" | "createdAt">) {
    const run: StoredFreeTimeRun = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    this.data.freeTimeRuns.push(run);
    await this.flush();
    return run;
  }
  async saveFreeTimeOutcome(id: string, outcome: Pick<StoredFreeTimeRun, "summary" | "valence" | "arousal" | "completedAt">) {
    const index = this.data.freeTimeRuns.findIndex((run) => run.id === id);
    if (index < 0) return undefined;
    this.data.freeTimeRuns[index] = { ...this.data.freeTimeRuns[index], ...outcome, status: "completed" };
    await this.flush();
    return this.data.freeTimeRuns[index];
  }
  listPushSubscriptions() { return this.data.pushSubscriptions; }
  async savePushSubscription(input: Pick<StoredPushSubscription, "subscription" | "preferences" | "userAgent">) {
    const existing = this.data.pushSubscriptions.find((entry) => entry.subscription.endpoint === input.subscription.endpoint);
    const now = new Date().toISOString();
    const item: StoredPushSubscription = { ...input, createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.data.pushSubscriptions = [...this.data.pushSubscriptions.filter((entry) => entry.subscription.endpoint !== input.subscription.endpoint), item];
    await this.flush();
    return item;
  }
  async removePushSubscription(endpoint: string) {
    const before = this.data.pushSubscriptions.length;
    this.data.pushSubscriptions = this.data.pushSubscriptions.filter((entry) => entry.subscription.endpoint !== endpoint);
    if (this.data.pushSubscriptions.length !== before) await this.flush();
    return { removed: before - this.data.pushSubscriptions.length };
  }
  listPaperNotePackages() { return [...this.data.paperNotePackages].sort((left, right) => right.date.localeCompare(left.date)); }
  getPaperNotePackage(date: string) { return this.data.paperNotePackages.find((entry) => entry.date === date); }
  getPaperNoteLastAttemptAt() { return this.data.paperNoteLastAttemptAt; }
  async markPaperNoteAttempt(at = new Date().toISOString()) { this.data.paperNoteLastAttemptAt = at; await this.flush(); return at; }
  async savePaperNotePackage(input: StoredPaperNotePackage) {
    this.data.paperNotePackages = [...this.data.paperNotePackages.filter((entry) => entry.date !== input.date), input].slice(-45);
    await this.flush();
    return input;
  }
  async markPaperNoteNotified(date: string, noteId: string, notifiedAt = new Date().toISOString()) {
    const packageIndex = this.data.paperNotePackages.findIndex((entry) => entry.date === date);
    if (packageIndex < 0) return undefined;
    const noteIndex = this.data.paperNotePackages[packageIndex].notes.findIndex((entry) => entry.id === noteId);
    if (noteIndex < 0) return undefined;
    this.data.paperNotePackages[packageIndex].notes[noteIndex].notifiedAt = notifiedAt;
    await this.flush();
    return this.data.paperNotePackages[packageIndex].notes[noteIndex];
  }
}
