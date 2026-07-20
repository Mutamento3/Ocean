import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { OceanGatewayClient, OceanProject, OceanProjectDocument, OceanProjectDocumentKind, OceanProjectWorkspace, type OceanNotionProjectStatus } from "../api/OceanGatewayClient";

const emptyWorkspace = (projectId: string): OceanProjectWorkspace => ({ projectId, brief: "", documents: [], files: [], createdAt: "", updatedAt: "" });
const documentLabels: Record<OceanProjectDocumentKind, string> = { brief: "方案", note: "笔记", output: "产出", "meeting-minutes": "纪要" };

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("file_read_failed"));
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
}

export function ProjectWorkspaceSheet({ project, onClose }: { project: OceanProject; onClose: () => void }) {
  const gateway = useMemo(() => new OceanGatewayClient(), []);
  const [workspace, setWorkspace] = useState<OceanProjectWorkspace>(() => emptyWorkspace(project.id));
  const [tab, setTab] = useState<"documents" | "files">("documents");
  const [editing, setEditing] = useState<OceanProjectDocument | null>(null);
  const [draft, setDraft] = useState({ title: "", content: "", kind: "note" as OceanProjectDocumentKind });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [notion, setNotion] = useState<OceanNotionProjectStatus | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      gateway.projectWorkspace(project.id),
      gateway.projectNotionStatus(project.id).catch(() => null),
    ]).then(([value, notionStatus]) => {
      if (!active) return;
      setWorkspace(value);
      setNotion(notionStatus);
    }).catch(() => setNotice("空间暂时没有同步成功")).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [gateway, project.id]);

  const openDocument = (document: OceanProjectDocument) => {
    setEditing(document);
    setDraft({ title: document.title, content: document.content, kind: document.kind });
  };

  const createDocument = () => {
    setEditing(null);
    setDraft({ title: "", content: "", kind: "note" });
  };

  const saveBrief = async () => {
    setSaving(true);
    try {
      setWorkspace(await gateway.updateProjectWorkspace(project.id, workspace.brief));
      setNotice("项目说明已保存");
    } catch { setNotice("项目说明没有保存成功"); }
    finally { setSaving(false); }
  };

  const saveDocument = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) return;
    setSaving(true);
    try {
      const saved = editing
        ? await gateway.updateProjectDocument(project.id, editing.id, draft)
        : await gateway.addProjectDocument(project.id, draft);
      setWorkspace((current) => ({ ...current, documents: [...current.documents.filter((item) => item.id !== saved.id), saved], updatedAt: saved.updatedAt }));
      setEditing(saved);
      setNotice("文档已保存到项目空间");
    } catch { setNotice("文档没有保存成功"); }
    finally { setSaving(false); }
  };

  const removeDocument = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await gateway.deleteProjectDocument(project.id, editing.id);
      setWorkspace((current) => ({ ...current, documents: current.documents.filter((item) => item.id !== editing.id) }));
      setEditing(null);
      setDraft({ title: "", content: "", kind: "note" });
      setNotice("文档已删除");
    } catch { setNotice("文档没有删除成功"); }
    finally { setSaving(false); }
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 3);
    if (!files.length) return;
    setSaving(true);
    try {
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024) throw new Error("file_too_large");
        const saved = await gateway.addProjectFile(project.id, { name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, data: await readAsDataUrl(file) });
        setWorkspace((current) => ({ ...current, files: [...current.files, saved] }));
      }
      setNotice(files.length === 1 ? "文件已加入项目空间" : `${files.length} 个文件已加入项目空间`);
    } catch { setNotice("文件没有上传成功；单个文件需小于 8 MB"); }
    finally { setSaving(false); event.target.value = ""; }
  };

  const syncNotion = async () => {
    if (!notion?.configured) { setNotice("请先在设置中连接 Notion"); return; }
    setSaving(true);
    setNotice("正在镜像到 Notion…");
    try {
      const result = await gateway.syncProjectToNotion(project.id);
      setNotion({ configured: true, autoSync: notion.autoSync, synced: true, url: result.url, lastSyncedAt: result.lastSyncedAt, documentsSynced: result.documentsSynced });
      setNotice(`已同步 ${result.documentsSynced} 份文档到 Notion`);
    } catch { setNotice("Notion 同步没有完成，请检查设置中的授权"); }
    finally { setSaving(false); }
  };

  return (
    <>
      <button aria-label="关闭项目空间" className="project-workspace-backdrop" onClick={onClose} />
      <section aria-label={`${project.name}项目空间`} className="project-workspace-sheet" onClick={(event) => event.stopPropagation()}>
        <button aria-label="收起项目空间" className="project-workspace-handle" onClick={onClose}><span /></button>
        <header>
          <div><small>PROJECT SPACE</small><h2>{project.name}</h2></div>
          <span>{workspace.documents.length} 文档 · {workspace.files.length} 文件</span>
        </header>

        <div className="project-workspace-tabs" role="tablist">
          <button aria-selected={tab === "documents"} onClick={() => setTab("documents")} role="tab">文档</button>
          <button aria-selected={tab === "files"} onClick={() => setTab("files")} role="tab">文件</button>
        </div>

        <div className="project-workspace-cloud">
          <span>{notion?.synced ? `Notion · ${notion.documentsSynced} 文档` : notion?.configured ? "Notion · 尚未同步" : "Notion · 未连接"}</span>
          {notion?.url && <a href={notion.url} rel="noreferrer" target="_blank">打开</a>}
          <button disabled={!notion?.configured || saving} onClick={() => void syncNotion()}>{notion?.autoSync ? "立即同步" : "同步"}</button>
        </div>

        {loading ? <p className="project-workspace-empty">正在打开空间…</p> : tab === "documents" ? (
          <div className="project-workspace-body">
            <section className="project-brief-card">
              <label><span>项目说明</span><textarea maxLength={4000} onChange={(event) => setWorkspace({ ...workspace, brief: event.target.value })} placeholder="这个项目要完成什么、目前进行到哪里……" value={workspace.brief} /></label>
              <button disabled={saving} onClick={() => void saveBrief()}>保存说明</button>
            </section>

            <div className="project-document-layout">
              <aside aria-label="项目文档列表">
                <button className="project-document-add" onClick={createDocument}>＋ 新文档</button>
                {workspace.documents.map((document) => <button className={editing?.id === document.id ? "selected" : ""} key={document.id} onClick={() => openDocument(document)}><small>{documentLabels[document.kind]}</small><span>{document.title}</span></button>)}
              </aside>
              <form className="project-document-editor" onSubmit={(event) => void saveDocument(event)}>
                <div>
                  <input aria-label="文档标题" maxLength={80} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="文档标题" value={draft.title} />
                  <select aria-label="文档类型" onChange={(event) => setDraft({ ...draft, kind: event.target.value as OceanProjectDocumentKind })} value={draft.kind}>
                    {Object.entries(documentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <textarea aria-label="文档正文" onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="记录方案、资料或阶段产出……" value={draft.content} />
                <footer><button disabled={!draft.title.trim() || saving} type="submit">保存</button>{editing && <button disabled={saving} onClick={() => void removeDocument()} type="button">删除</button>}</footer>
              </form>
            </div>
          </div>
        ) : (
          <div className="project-files-panel">
            <label className="project-file-upload"><input multiple onChange={(event) => void uploadFiles(event)} type="file" /><strong>＋ 添加文件</strong><span>图片与常见文档，单个不超过 8 MB</span></label>
            <div className="project-file-list">
              {workspace.files.map((file) => <article key={file.id}><span aria-hidden="true">{file.kind === "image" ? "▧" : file.kind === "text" ? "▤" : "◇"}</span><div><strong>{file.name}</strong><small>{Math.max(1, Math.round(file.size / 1024))} KB · 已存服务器</small></div></article>)}
              {!workspace.files.length && <p className="project-workspace-empty">还没有文件。聊天里需要长期保留的材料，可以放进这里。</p>}
            </div>
          </div>
        )}
        {notice && <p aria-live="polite" className="project-workspace-notice">{notice}</p>}
      </section>
    </>
  );
}
