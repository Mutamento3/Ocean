import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

export type ProjectDocumentKind = "brief" | "note" | "output" | "meeting-minutes";

export interface ProjectDocument {
  id: string;
  title: string;
  kind: ProjectDocumentKind;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text" | "file";
  createdAt: string;
}

export interface ProjectWorkspace {
  projectId: string;
  brief: string;
  documents: ProjectDocument[];
  files: ProjectFile[];
  createdAt: string;
  updatedAt: string;
}

const cleanProjectId = (value: string) => {
  const id = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error("project_id_invalid");
  return id;
};

const cleanTitle = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, 80);
const cleanContent = (value: string) => value.replace(/\r\n/g, "\n").slice(0, 80_000);
const kinds = new Set<ProjectDocumentKind>(["brief", "note", "output", "meeting-minutes"]);

export class ProjectWorkspaceStore {
  private readonly root: string;

  constructor(dataPath?: string) {
    this.root = process.env.OCEAN_PROJECTS_PATH?.trim() || (dataPath ? `${dataPath}.projects` : join(process.cwd(), "server", "data", "projects"));
  }

  private directory(projectId: string) { return join(this.root, cleanProjectId(projectId)); }
  private manifestPath(projectId: string) { return join(this.directory(projectId), "workspace.json"); }

  private empty(projectId: string): ProjectWorkspace {
    const now = new Date().toISOString();
    return { projectId: cleanProjectId(projectId), brief: "", documents: [], files: [], createdAt: now, updatedAt: now };
  }

  private async read(projectId: string) {
    const id = cleanProjectId(projectId);
    try {
      const saved = JSON.parse(await readFile(this.manifestPath(id), "utf8")) as Partial<ProjectWorkspace>;
      return {
        ...this.empty(id),
        ...saved,
        projectId: id,
        brief: typeof saved.brief === "string" ? saved.brief : "",
        documents: Array.isArray(saved.documents) ? saved.documents : [],
        files: Array.isArray(saved.files) ? saved.files : [],
      } satisfies ProjectWorkspace;
    } catch {
      return this.empty(id);
    }
  }

  private async save(workspace: ProjectWorkspace) {
    const path = this.manifestPath(workspace.projectId);
    await mkdir(dirname(path), { recursive: true });
    const next = { ...workspace, updatedAt: new Date().toISOString() };
    await writeFile(path, JSON.stringify(next, null, 2), "utf8");
    return next;
  }

  get(projectId: string) { return this.read(projectId); }

  async updateBrief(projectId: string, brief: string) {
    const workspace = await this.read(projectId);
    return this.save({ ...workspace, brief: cleanContent(brief).slice(0, 4_000) });
  }

  async addDocument(projectId: string, input: { title: string; content?: string; kind?: string; id?: string }) {
    const workspace = await this.read(projectId);
    const title = cleanTitle(input.title);
    if (!title) throw new Error("project_document_title_required");
    const kind = kinds.has(input.kind as ProjectDocumentKind) ? input.kind as ProjectDocumentKind : "note";
    const now = new Date().toISOString();
    const existing = input.id ? workspace.documents.find((item) => item.id === input.id) : undefined;
    if (existing) return existing;
    const item: ProjectDocument = { id: input.id?.trim() || crypto.randomUUID(), title, kind, content: cleanContent(input.content ?? ""), createdAt: now, updatedAt: now };
    await this.save({ ...workspace, documents: [...workspace.documents, item] });
    return item;
  }

  async updateDocument(projectId: string, documentId: string, input: { title?: string; content?: string; kind?: string }) {
    const workspace = await this.read(projectId);
    const index = workspace.documents.findIndex((item) => item.id === documentId);
    if (index < 0) return undefined;
    const current = workspace.documents[index];
    const title = input.title === undefined ? current.title : cleanTitle(input.title);
    if (!title) throw new Error("project_document_title_required");
    const kind = input.kind === undefined ? current.kind : kinds.has(input.kind as ProjectDocumentKind) ? input.kind as ProjectDocumentKind : current.kind;
    const next: ProjectDocument = { ...current, title, kind, content: input.content === undefined ? current.content : cleanContent(input.content), updatedAt: new Date().toISOString() };
    const documents = [...workspace.documents];
    documents[index] = next;
    await this.save({ ...workspace, documents });
    return next;
  }

  async deleteDocument(projectId: string, documentId: string) {
    const workspace = await this.read(projectId);
    const documents = workspace.documents.filter((item) => item.id !== documentId);
    await this.save({ ...workspace, documents });
    return { removed: workspace.documents.length - documents.length };
  }

  async addFile(projectId: string, input: { name: string; mimeType?: string; size?: number; data: string }) {
    const workspace = await this.read(projectId);
    const name = input.name.trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, 120);
    if (!name) throw new Error("project_file_name_required");
    const encoded = input.data.includes(",") && input.data.startsWith("data:") ? input.data.slice(input.data.indexOf(",") + 1) : input.data;
    const buffer = Buffer.from(encoded, "base64");
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw new Error("project_file_size_invalid");
    const id = crypto.randomUUID();
    const suffix = extname(name).slice(0, 12);
    const directory = join(this.directory(projectId), "files");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${id}${suffix}`), buffer);
    const mimeType = input.mimeType?.slice(0, 100) || "application/octet-stream";
    const item: ProjectFile = { id, name, mimeType, size: buffer.length, kind: mimeType.startsWith("image/") ? "image" : mimeType.startsWith("text/") ? "text" : "file", createdAt: new Date().toISOString() };
    await this.save({ ...workspace, files: [...workspace.files, item] });
    return item;
  }

  async remove(projectId: string) {
    await rm(this.directory(projectId), { recursive: true, force: true });
  }
}
