import { once } from "node:events";
import { createServer } from "node:http";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotionSyncService } from "./notionSync.js";
import type { ProjectWorkspace } from "./projectWorkspace.js";
import type { StoredProject } from "./store.js";

const createdPages: Array<{ id: string; parentId: string; title: string }> = [];
let replacedPages = 0;
let appendedBatches = 0;

const fixture = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, any> : {};
  response.setHeader("Content-Type", "application/json");

  if (request.method === "GET" && request.url === "/v1/pages/notion-parent") return response.end(JSON.stringify({ id: "notion-parent", url: "https://notion.test/parent", properties: { title: { title: [{ plain_text: "Ocean Projects" }] } } }));
  if (request.method === "GET" && request.url === "/v1/users/me") return response.end(JSON.stringify({ id: "notion-bot", name: "Ocean", owner: { workspace: { name: "Example Workspace" } } }));
  if (request.method === "POST" && request.url === "/v1/pages") {
    const id = `notion-page-${createdPages.length + 1}`;
    const title = String(payload.properties?.title?.title?.[0]?.text?.content ?? "");
    createdPages.push({ id, parentId: String(payload.parent?.page_id ?? ""), title });
    response.statusCode = 200;
    return response.end(JSON.stringify({ id, url: `https://notion.test/${id}`, properties: payload.properties }));
  }
  if (request.method === "PATCH" && request.url?.startsWith("/v1/pages/")) {
    if (payload.erase_content === true) replacedPages += 1;
    const id = request.url.slice("/v1/pages/".length);
    return response.end(JSON.stringify({ id, url: `https://notion.test/${id}`, properties: payload.properties ?? {} }));
  }
  if (request.method === "PATCH" && request.url?.startsWith("/v1/blocks/") && request.url.endsWith("/children")) {
    appendedBatches += 1;
    return response.end(JSON.stringify({ results: payload.children ?? [] }));
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ message: "fixture route missing" }));
});

fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const address = fixture.address();
if (!address || typeof address === "string") throw new Error("Notion fixture did not bind a port");

process.env.NOTION_ACCESS_TOKEN = "notion-smoke-secret";
process.env.OCEAN_NOTION_PARENT_PAGE_ID = "notion-parent";
process.env.NOTION_BASE_URL = `http://127.0.0.1:${address.port}`;
process.env.OCEAN_NOTION_AUTO_SYNC = "disabled";

const dataPath = join(tmpdir(), `ocean-notion-smoke-${process.pid}.json`);
const service = new NotionSyncService(dataPath);
await service.initialize();

const project: StoredProject = { id: "notion-smoke", name: "Ocean Notion", status: "todo", createdAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z" };
const workspace: ProjectWorkspace = {
  projectId: project.id,
  brief: "验证 Ocean 项目镜像。",
  documents: [{ id: "doc-1", title: "同步说明", kind: "note", content: "第一段。\n\n第二段。", createdAt: project.createdAt, updatedAt: project.updatedAt }],
  files: [{ id: "file-1", name: "ocean.txt", mimeType: "text/plain", size: 128, kind: "text", createdAt: project.createdAt }],
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};

const status = await service.status(true);
const first = await service.syncProject(project, workspace);
const second = await service.syncProject({ ...project, status: "done", updatedAt: new Date().toISOString() }, { ...workspace, brief: "已更新。" });
const projectStatus = service.projectStatus(project.id);

if (!status.connected || status.parentTitle !== "Ocean Projects" || status.workspaceName !== "Example Workspace") throw new Error(`Notion connection probe failed: ${JSON.stringify(status)}`);
if (first.documentsSynced !== 1 || first.filesReferenced !== 1 || first.url !== second.url) throw new Error("Notion project sync result is incomplete");
if (createdPages.length !== 3 || createdPages[0]?.parentId !== "notion-parent" || !createdPages.some((page) => page.title === "项目说明")) throw new Error(`Notion page ownership tree is invalid: ${JSON.stringify(createdPages)}`);
if (replacedPages < 4 || appendedBatches < 4) throw new Error("Managed Notion child pages were not refreshed");
if (!projectStatus.synced || projectStatus.documentsSynced !== 1 || projectStatus.url !== first.url) throw new Error("Notion mapping did not persist in the service");

console.log(JSON.stringify({ status, first, projectStatus, createdPages: createdPages.length, replacedPages, appendedBatches }, null, 2));
fixture.close();
await unlink(`${dataPath}.notion.json`).catch(() => undefined);
