import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { MessageTurn } from "../domain/ocean";
import type { PoemRecord } from "../data/legacyPoems";
import { usePersistentState } from "../hooks/usePersistentState";
import { syncOrQueue } from "../sync/gatewaySync";
import { assetPath } from "../utils/assetPath";
import { deliverToLivingRoom } from "../services/livingRoomConversation";

interface PoetryRoomProps {
  poems: PoemRecord[];
  setPoems: Dispatch<SetStateAction<PoemRecord[]>>;
}

interface ActionAnchor {
  poemId: string;
  left: number;
  top: number;
}

interface DeletedPoem {
  poem: PoemRecord;
  index: number;
}

const bookTones = ["muted", "accent", "soft", "warm-soft", "warm"];

function bookHeight(title: string) {
  const characters = Array.from(title.replace(/\s/g, "")).length;
  return Math.min(120, Math.max(60, 34 + characters * 14));
}

function poemTitle(content: string, fallback: number) {
  const firstLine = content.split("\n").find((line) => line.trim())?.trim() ?? "";
  return firstLine.slice(0, 10) || `未命名诗 ${fallback}`;
}

export function PoetryRoom({ poems, setPoems }: PoetryRoomProps) {
  const [draft, setDraft] = usePersistentState("ocean:poetry:draft:v1", "");
  const [sharedMessages, setSharedMessages] = usePersistentState<MessageTurn[]>("ocean:poetry:shared:v1", []);
  const [composerHeight, setComposerHeight] = useState(44);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actions, setActions] = useState<ActionAnchor | null>(null);
  const [notice, setNotice] = useState("");
  const [pushingPoemId, setPushingPoemId] = useState<string | null>(null);
  const [undoArchiveId, setUndoArchiveId] = useState<string | null>(null);
  const [deletedPoem, setDeletedPoem] = useState<DeletedPoem | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const holdTimer = useRef<number | null>(null);
  const holdTriggered = useRef(false);

  const visiblePoems = useMemo(() => poems.filter((poem) => !poem.archived), [poems]);
  const selectedPoem = poems.find((poem) => poem.id === selectedId) ?? null;
  const actionPoem = poems.find((poem) => poem.id === actions?.poemId) ?? null;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => { setNotice(""); setUndoArchiveId(null); setDeletedPoem(null); }, 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    const textHeight = Math.min(132, Math.max(32, textarea.scrollHeight));
    textarea.style.height = `${textHeight}px`;
    setComposerHeight(Math.max(44, textHeight + 12));
  }, [draft]);

  const cancelHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const openActions = (poemId: string, element: HTMLElement) => {
    const stage = stageRef.current?.getBoundingClientRect();
    const book = element.getBoundingClientRect();
    if (!stage) return;
    setActions({
      poemId,
      left: Math.min(290, Math.max(20, book.right - stage.left + 6)),
      top: Math.min(220, Math.max(88, book.top - stage.top)),
    });
  };

  const upsertDraft = () => {
    const value = draft.trim();
    if (!value) return null;
    const now = new Date().toISOString();
    if (editingId) {
      const current = poems.find((poem) => poem.id === editingId);
      if (!current) return null;
      const updated: PoemRecord = { ...current, title: titleDraft.trim().slice(0, 24) || current.title, content: value, updatedAt: now };
      setPoems((items) => items.map((poem) => poem.id === editingId ? updated : poem));
      return updated;
    }
    const created: PoemRecord = {
      id: crypto.randomUUID(),
      title: poemTitle(value, poems.length + 1),
      content: value,
      state: "draft",
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    setPoems((items) => [...items, created]);
    return created;
  };

  const finishSaving = () => {
    const poem = upsertDraft();
    if (!poem) return;
    setDraft("");
    setEditingId(null);
    setTitleDraft("");
    setNotice("已经收进 FOR YOU");
  };

  const pushPoem = async (poem: PoemRecord) => {
    if (pushingPoemId) return;
    setPushingPoemId(poem.id);
    setNotice("正在推到当前客厅…");
    const pushedAt = new Date().toISOString();
    const poemMessage = `我写了一首诗给你。\n\n《${poem.title}》\n${poem.content}`;
    const turn: MessageTurn = {
      id: crypto.randomUUID(),
      role: "user",
      createdAt: pushedAt,
      segments: [poemMessage],
      source: "chat",
    };
    const nextMessages = [...sharedMessages, turn];
    setSharedMessages(nextMessages);
    setPoems((items) => items.map((item) => item.id === poem.id ? { ...item, pushedAt } : item));
    try {
      const [poetrySynced, delivery] = await Promise.all([
        syncOrQueue("conversation", {
          id: "poetry-shared",
          scope: "poetry:shared",
          messages: nextMessages,
          modeContext: "这是用户亲自写给陪伴者的诗，只需阅读和回应，不续写、不改写，也不默认评价。",
        }),
        deliverToLivingRoom(poemMessage, {
          elapsedSinceLastTurn: "刚刚",
          modeInstruction: "用户把自己写的诗从情诗书柜推到了当前客厅会话。把它视为当前关系与会话的自然延续，认真阅读并回应此刻的感受；不要续写、改写，也不要默认做文学评价。",
        }),
      ]);
      if (delivery.responded) setNotice(delivery.live ? "已经推到当前客厅，陪伴者在那里回应了" : "已经推到当前客厅；当前是离线预览回应");
      else setNotice(poetrySynced || delivery.synced ? "诗已经进入当前客厅，模型回应暂时没有接上" : "诗已在本机收好，连接恢复后会同步");
    } finally {
      setPushingPoemId(null);
    }
  };

  const editPoem = (poem: PoemRecord) => {
    setDraft(poem.content);
    setEditingId(poem.id);
    setTitleDraft(poem.title);
    setSelectedId(null);
    setActions(null);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const archivePoem = (poem: PoemRecord) => {
    setPoems((items) => items.map((item) => item.id === poem.id ? { ...item, archived: true, updatedAt: new Date().toISOString() } : item));
    setSelectedId(null);
    setActions(null);
    setDeletedPoem(null);
    setUndoArchiveId(poem.id);
    setNotice(`《${poem.title}》已归档`);
  };

  const undoArchive = () => {
    if (!undoArchiveId) return;
    setPoems((items) => items.map((item) => item.id === undoArchiveId ? { ...item, archived: false, updatedAt: new Date().toISOString() } : item));
    setNotice("已经放回 FOR YOU");
    setUndoArchiveId(null);
  };

  const deletePoem = (poem: PoemRecord) => {
    const index = poems.findIndex((item) => item.id === poem.id);
    setPoems((items) => items.filter((item) => item.id !== poem.id));
    if (editingId === poem.id) { setEditingId(null); setTitleDraft(""); setDraft(""); }
    setSelectedId(null);
    setActions(null);
    setUndoArchiveId(null);
    setDeletedPoem({ poem, index: Math.max(0, index) });
    setNotice(`《${poem.title}》已删除`);
  };

  const undoDelete = () => {
    if (!deletedPoem) return;
    setPoems((items) => {
      if (items.some((item) => item.id === deletedPoem.poem.id)) return items;
      const next = [...items];
      next.splice(Math.min(deletedPoem.index, next.length), 0, deletedPoem.poem);
      return next;
    });
    setNotice("已经放回 FOR YOU");
    setDeletedPoem(null);
  };

  const downloadPoem = (poem: PoemRecord) => {
    const blob = new Blob([`${poem.title}\n\n${poem.content}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${poem.title}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    setActions(null);
    setNotice("诗已整理成文本");
  };

  return (
    <section className="poetry-room-stage" aria-label="情诗模式" ref={stageRef}>
      <section className="poetry-shelf" aria-label="写给陪伴者的诗">
        <div className="study-shelf-cavity" />
        <div className="poetry-fixed-book"><span>FOR YOU</span></div>
        <div className="poetry-book-strip">
          {visiblePoems.map((poem, index) => (
            <button
              aria-label={poem.title}
              className={`poetry-book tone-${bookTones[index % bookTones.length]} ${selectedId === poem.id ? "selected" : ""}`}
              key={poem.id}
              onClick={(event) => {
                if (holdTriggered.current) { event.preventDefault(); holdTriggered.current = false; return; }
                setSelectedId(poem.id);
              }}
              onContextMenu={(event) => { event.preventDefault(); openActions(poem.id, event.currentTarget); }}
              onPointerCancel={cancelHold}
              onPointerDown={(event) => {
                cancelHold();
                holdTriggered.current = false;
                const element = event.currentTarget;
                holdTimer.current = window.setTimeout(() => { holdTriggered.current = true; openActions(poem.id, element); }, 520);
              }}
              onPointerLeave={cancelHold}
              onPointerUp={cancelHold}
              style={{ height: `${bookHeight(poem.title)}px` }}
            >
              <span>{poem.title}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={`poetry-composer-sheet ${editingId ? "editing" : ""}`} aria-label="写一首情诗" style={{ height: `${composerHeight + (editingId ? 36 : 0)}px` }}>
        {editingId && (
          <input
            aria-label="诗名"
            className="poetry-title-input"
            onChange={(event) => setTitleDraft(event.target.value)}
            placeholder="诗名"
            value={titleDraft}
          />
        )}
        <textarea
          aria-label="诗歌正文"
          onChange={(event) => setDraft(event.target.value)}
          placeholder="写一首给陪伴者的诗…"
          ref={composerRef}
          value={draft}
        />
        <button aria-label="收进书柜" className="poetry-push-button" disabled={!draft.trim()} onClick={finishSaving} type="button">
          <img alt="" src={assetPath("assets/study/poetry-push.svg")} />
        </button>
      </section>

      {actions && actionPoem && (
        <>
          <button aria-label="收起诗作菜单" className="poetry-overlay-backdrop" onClick={() => setActions(null)} />
          <section className="poetry-action-menu" aria-label={`${actionPoem.title}的操作`} style={{ left: actions.left, top: actions.top }}>
            <button onClick={() => editPoem(actionPoem)}><span className="project-action-icon action-edit" />编辑</button>
            <button onClick={() => archivePoem(actionPoem)}><span className="project-action-icon action-archive" />归档</button>
            <button onClick={() => downloadPoem(actionPoem)}><span className="project-action-icon action-download" />下载</button>
            <button onClick={() => deletePoem(actionPoem)}><span className="project-action-icon action-delete" />删除</button>
          </section>
        </>
      )}

      {selectedPoem && (
        <>
          <button aria-label="关闭诗歌全文" className="poetry-overlay-backdrop" onClick={() => setSelectedId(null)} />
          <article className="poetry-reader" aria-label={`${selectedPoem.title}全文`}>
            <header><span>{selectedPoem.title}</span><button aria-label="关闭" onClick={() => setSelectedId(null)}>×</button></header>
            <div className="poetry-reader-content">{selectedPoem.content}</div>
            <footer>
              <button onClick={() => editPoem(selectedPoem)}>编辑</button>
              <button disabled={pushingPoemId === selectedPoem.id} onClick={() => void pushPoem(selectedPoem)}>{pushingPoemId === selectedPoem.id ? "正在推送…" : "推给陪伴者"}</button>
            </footer>
          </article>
        </>
      )}

      {notice && (
        <div aria-live="polite" className="poetry-notice">
          <span>{notice}</span>
          {undoArchiveId && <button onClick={undoArchive}>撤销</button>}
          {deletedPoem && <button onClick={undoDelete}>撤销</button>}
        </div>
      )}
    </section>
  );
}
