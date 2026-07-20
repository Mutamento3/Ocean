import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StoredProject } from "./store.js";
import type { ProjectDocument, ProjectWorkspace } from "./projectWorkspace.js";

const NOTION_VERSION = process.env.NOTION_API_VERSION?.trim() || "2026-03-11";

interface ManagedNotionPage {
  pageId: string;
  url: string;
  lastSyncedAt: string;
}

interface ProjectNotionMapping {
  project: ManagedNotionPage;
  overview?: ManagedNotionPage;
  documents: Record<string, ManagedNotionPage>;
  lastSyncedAt: string;
}

interface NotionMappingData {
  projects: Record<string, ProjectNotionMapping>;
}

interface NotionPageResponse {
  id: string;
  url?: string;
  parent?: { type?: string };
  properties?: Record<string, unknown>;
}

export interface NotionConnectionStatus {
  available: true;
  configured: boolean;
  connected: boolean;
  autoSync: boolean;
  parentPageConfigured: boolean;
  workspaceName?: string;
  parentTitle?: string;
  lastError?: string;
}

export interface NotionProjectSyncResult {
  projectId: string;
  projectPageId: string;
  url: string;
  lastSyncedAt: string;
  documentsSynced: number;
  filesReferenced: number;
}

const EMPTY: NotionMappingData = { projects: {} };
const documentLabels: Record<ProjectDocument["kind"], string> = { brief: "方案", note: "笔记", output: "产出", "meeting-minutes": "会议纪要" };

function plainText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.plain_text === "string") return record.plain_text;
  return Object.values(record).map(plainText).join("");
}

function pageTitle(page: NotionPageResponse) {
  return Object.values(page.properties ?? {}).map(plainText).join("").trim();
}

function richText(content: string) {
  return [{ type: "text", text: { content } }];
}

function paragraph(content: string) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richText(content) } };
}

function heading(content: string) {
  return { object: "block", type: "heading_2", heading_2: { rich_text: richText(content) } };
}

function bullet(content: string) {
  return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(content) } };
}

function splitText(content: string, limit = 1_800) {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return ["（暂无内容）"];
  const chunks: string[] = [];
  for (const section of normalized.split(/\n{2,}/)) {
    const value = section.trim();
    if (!value) continue;
    for (let offset = 0; offset < value.length; offset += limit) chunks.push(value.slice(offset, offset + limit));
  }
  return chunks.length ? chunks : ["（暂无内容）"];
}

function documentBlocks(document: ProjectDocument) {
  return [
    { object: "block", type: "callout", callout: { icon: { type: "emoji", emoji: "🌊" }, rich_text: richText(`由 Ocean 项目空间镜像 · ${documentLabels[document.kind]} · ${new Date(document.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`) } },
    ...splitText(document.content).map(paragraph),
  ];
}

function overviewBlocks(project: StoredProject, workspace: ProjectWorkspace) {
  const blocks: Array<Record<string, unknown>> = [
    { object: "block", type: "callout", callout: { icon: { type: "emoji", emoji: "🐙" }, rich_text: richText("这是 Ocean 的单向项目镜像。Ocean Server 是当前主数据源；在 Notion 中直接修改的内容暂不会反向写回 Ocean。") } },
    heading("项目状态"),
    paragraph(project.status === "done" ? "已完成" : "进行中"),
    heading("项目说明"),
    ...splitText(workspace.brief, 1_800).map(paragraph),
    heading("文档"),
  ];
  if (workspace.documents.length) blocks.push(...workspace.documents.map((item) => bullet(`${documentLabels[item.kind]} · ${item.title}`)));
  else blocks.push(paragraph("（暂无文档）"));
  blocks.push(heading("文件"));
  if (workspace.files.length) blocks.push(...workspace.files.map((item) => bullet(`${item.name} · ${Math.max(1, Math.round(item.size / 1024))} KB`)));
  else blocks.push(paragraph("（暂无文件）"));
  return blocks;
}

export class NotionSyncService {
  private readonly token = process.env.NOTION_ACCESS_TOKEN?.trim() || "";
  private readonly parentPageId = process.env.OCEAN_NOTION_PARENT_PAGE_ID?.trim() || "";
  private readonly baseUrl = (process.env.NOTION_BASE_URL?.trim() || "https://api.notion.com").replace(/\/$/, "");
  private readonly mappingPath: string;
  private mappings: NotionMappingData = structuredClone(EMPTY);
  private readonly queues = new Map<string, Promise<NotionProjectSyncResult>>();

  readonly autoSync = process.env.OCEAN_NOTION_AUTO_SYNC === "enabled";

  constructor(dataPath?: string) {
    this.mappingPath = process.env.OCEAN_NOTION_MAPPING_PATH?.trim() || (dataPath ? `${dataPath}.notion.json` : join(process.cwd(), "server", "data", "notion-sync.json"));
  }

  get configured() { return Boolean(this.token && this.parentPageId); }

  async initialize() {
    try {
      const saved = JSON.parse(await readFile(this.mappingPath, "utf8")) as Partial<NotionMappingData>;
      this.mappings = { projects: saved.projects ?? {} };
    } catch {
      await this.flush();
    }
  }

  private async flush() {
    await mkdir(dirname(this.mappingPath), { recursive: true });
    await writeFile(this.mappingPath, JSON.stringify(this.mappings, null, 2), "utf8");
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.configured) throw new Error("notion_unconfigured");
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try { detail = String((JSON.parse(text) as { message?: string }).message ?? text); } catch { /* keep response text */ }
      throw new Error(`notion_${response.status}:${detail.slice(0, 240)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async status(probe = true): Promise<NotionConnectionStatus> {
    const base = { available: true as const, configured: this.configured, connected: false, autoSync: this.autoSync, parentPageConfigured: Boolean(this.parentPageId) };
    if (!this.configured || !probe) return base;
    try {
      const [parent, me] = await Promise.all([
        this.api<NotionPageResponse>(`/v1/pages/${encodeURIComponent(this.parentPageId)}`),
        this.api<{ bot?: { owner?: { workspace?: boolean } }; name?: string; owner?: { workspace?: { name?: string } } }>("/v1/users/me"),
      ]);
      return { ...base, connected: true, parentTitle: pageTitle(parent) || "Ocean", workspaceName: me.owner?.workspace?.name || me.name || undefined };
    } catch (error) {
      return { ...base, lastError: error instanceof Error ? error.message : "notion_connection_failed" };
    }
  }

  projectStatus(projectId: string) {
    const mapping = this.mappings.projects[projectId];
    return {
      configured: this.configured,
      autoSync: this.autoSync,
      synced: Boolean(mapping),
      url: mapping?.project.url,
      lastSyncedAt: mapping?.lastSyncedAt,
      documentsSynced: mapping ? Object.keys(mapping.documents).length : 0,
    };
  }

  private async createPage(parentPageId: string, title: string, emoji: string) {
    return this.api<NotionPageResponse>("/v1/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { type: "page_id", page_id: parentPageId },
        icon: { type: "emoji", emoji },
        properties: { title: { type: "title", title: richText(title) } },
      }),
    });
  }

  private async updateTitle(pageId: string, title: string) {
    return this.api<NotionPageResponse>(`/v1/pages/${encodeURIComponent(pageId)}`, {
      method: "PATCH",
      body: JSON.stringify({ properties: { title: { type: "title", title: richText(title) } } }),
    });
  }

  private async replaceContent(pageId: string, blocks: Array<Record<string, unknown>>) {
    await this.api(`/v1/pages/${encodeURIComponent(pageId)}`, { method: "PATCH", body: JSON.stringify({ erase_content: true }) });
    for (let offset = 0; offset < blocks.length; offset += 100) {
      await this.api(`/v1/blocks/${encodeURIComponent(pageId)}/children`, { method: "PATCH", body: JSON.stringify({ children: blocks.slice(offset, offset + 100) }) });
    }
  }

  private async managedPage(existing: ManagedNotionPage | undefined, parentPageId: string, title: string, emoji: string) {
    const now = new Date().toISOString();
    if (existing) {
      const page = await this.updateTitle(existing.pageId, title);
      return { pageId: page.id || existing.pageId, url: page.url || existing.url, lastSyncedAt: now } satisfies ManagedNotionPage;
    }
    const page = await this.createPage(parentPageId, title, emoji);
    return { pageId: page.id, url: page.url || `https://www.notion.so/${page.id.replace(/-/g, "")}`, lastSyncedAt: now } satisfies ManagedNotionPage;
  }

  syncProject(project: StoredProject, workspace: ProjectWorkspace) {
    const previous = this.queues.get(project.id) ?? Promise.resolve(undefined as never);
    const queued = previous.catch(() => undefined).then(async () => {
      if (!this.configured) throw new Error("notion_unconfigured");
      const current = this.mappings.projects[project.id];
      const projectPage = await this.managedPage(current?.project, this.parentPageId, project.name, project.status === "done" ? "✅" : "🌊");
      const overview = await this.managedPage(current?.overview, projectPage.pageId, "项目说明", "🧭");
      await this.replaceContent(overview.pageId, overviewBlocks(project, workspace));

      const documents = { ...(current?.documents ?? {}) };
      for (const document of workspace.documents) {
        const title = `${documentLabels[document.kind]} · ${document.title}`;
        const page = await this.managedPage(documents[document.id], projectPage.pageId, title, document.kind === "meeting-minutes" ? "🗣️" : "📄");
        await this.replaceContent(page.pageId, documentBlocks(document));
        documents[document.id] = page;
      }

      const lastSyncedAt = new Date().toISOString();
      this.mappings.projects[project.id] = { project: projectPage, overview, documents, lastSyncedAt };
      await this.flush();
      return { projectId: project.id, projectPageId: projectPage.pageId, url: projectPage.url, lastSyncedAt, documentsSynced: workspace.documents.length, filesReferenced: workspace.files.length } satisfies NotionProjectSyncResult;
    });
    this.queues.set(project.id, queued);
    void queued.finally(() => { if (this.queues.get(project.id) === queued) this.queues.delete(project.id); });
    return queued;
  }
}
