import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getCoReadingAdapter,
  mockCoReadingAdapter,
  type CoReadingAdapter,
  type CoReadingAnnotation,
  type CoReadingBook,
  type CoReadingPage,
} from "../adapters/coReading";
import type { ContinuitySnapshot, MessageTurn } from "../domain/ocean";
import { usePersistentState } from "../hooks/usePersistentState";
import { gatewayIsConnected, syncOrQueue } from "../sync/gatewaySync";
import { RoomChatChrome, type RoomAttachmentAction } from "./RoomChatChrome";
import { MiniSwitch } from "./MiniSwitch";
import { StudyDecoration } from "./StudyDecoration";
import { gatewayChatAdapter } from "../adapters/gatewayChat";
import { mockChatAdapter } from "../adapters/mockChat";
import { assetPath } from "../utils/assetPath";
import { getModelSelection } from "../config/modelSelection";
import { recordUsage } from "../data/usageLedger";
import { forgeContinuity, initialContinuity, messagesForPhysicalSession } from "../continuity/mockContinuity";

type ReadingInputMode = "chat" | "question";
type PendingSelection = { quote: string; left: number; top: number };

const readingAttachmentActions: RoomAttachmentAction[] = [
  { id: "bookmark", icon: assetPath("assets/study/reading-bookmark.svg"), label: "书签" },
  { id: "annotation", icon: assetPath("assets/study/reading-annotation.svg"), label: "批注" },
  { id: "question", icon: assetPath("assets/study/reading-question.svg"), label: "提问" },
];

function bookTone(index: number, selected: boolean) {
  if (selected) return "selected";
  return index % 2 === 0 ? "tone-accent" : "tone-soft";
}

const structuralTitles = new Set(["cover", "目录", "版权页", "插页", "封面"]);
const humanAuthors = new Set(["user", "human", "you", "koshi"]);

function isHumanAuthor(author: string) {
  return humanAuthors.has(author.toLocaleLowerCase());
}

function displayReadingText(text: string) {
  return text.replace(/^#{1,6}\s+/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

function compactBookTitle(title: string) {
  return title.length > 10 ? `${title.slice(0, 9)}…` : title;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("没有读到这个文件"));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const separator = value.indexOf(",");
      if (separator < 0) return reject(new Error("电子书内容格式不完整"));
      resolve(value.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

function isSupportedReadingFile(file: File) {
  return /\.(epub|txt|text|md|markdown)$/i.test(file.name);
}

async function openReadablePage(adapter: CoReadingAdapter, bookId: string, signal: AbortSignal) {
  const selected = await adapter.continueBook(bookId, signal);
  const title = selected.chunk.title.trim().toLocaleLowerCase();
  const isStructural = structuralTitles.has(title) || title === selected.title.trim().toLocaleLowerCase();
  if (!isStructural && selected.text.trim().length >= 80) return selected;

  const chunks = await adapter.listChunks(bookId, signal);
  const candidate = chunks.find((chunk) => !chunk.read && (chunk.charCount ?? 0) >= 100 && !structuralTitles.has(chunk.title.trim().toLocaleLowerCase()) && chunk.title.trim() !== selected.title.trim());
  return candidate ? adapter.readChunk(bookId, candidate.id, signal) : selected;
}

function highlightRanges(text: string, annotations: CoReadingAnnotation[]) {
  const grouped = new Map<string, CoReadingAnnotation[]>();
  annotations.forEach((annotation) => {
    const quote = annotation.quote?.trim();
    if (!quote) return;
    grouped.set(quote, [...(grouped.get(quote) ?? []), annotation]);
  });

  const ranges = Array.from(grouped.entries()).flatMap(([quote, notes]) => {
    const storedOffset = notes.find((note) => typeof note.quoteOffset === "number")?.quoteOffset;
    const start = storedOffset !== undefined && storedOffset !== null && text.slice(storedOffset, storedOffset + quote.length) === quote
      ? storedOffset
      : text.indexOf(quote);
    return start < 0 ? [] : [{ start, end: start + quote.length, quote, notes }];
  }).sort((a, b) => a.start - b.start || b.end - a.end);

  return ranges.filter((range, index) => index === 0 || range.start >= ranges[index - 1].end);
}

export function ReadingRoom() {
  const [activeBookId, setActiveBookId] = usePersistentState("ocean:reading:active-book", "myth-of-sisyphus");
  const [books, setBooks] = useState<CoReadingBook[]>([]);
  const [page, setPage] = useState<CoReadingPage | null>(null);
  const [readingLoadError, setReadingLoadError] = useState("");
  const [readingRetry, setReadingRetry] = useState(0);
  const [annotations, setAnnotations] = useState<CoReadingAnnotation[]>([]);
  const [input, setInput] = useState("");
  const [inputMode, setInputMode] = useState<ReadingInputMode>("chat");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState("");
  const [bookMenuOpen, setBookMenuOpen] = useState(false);
  const [importingBooks, setImportingBooks] = useState(false);
  const [turningPage, setTurningPage] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [shareAnnotation, setShareAnnotation] = useState(false);
  const [activeQuote, setActiveQuote] = useState<string | null>(null);
  const [pageCollapsed, setPageCollapsed] = useState(false);
  const pageCardRef = useRef<HTMLElement>(null);
  const pageTextRef = useRef<HTMLParagraphElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const selectionTimerRef = useRef<number | null>(null);
  const [messages, setMessages] = usePersistentState<MessageTurn[]>(`ocean:chat:reading:${activeBookId}`, []);
  const [continuity, setContinuity] = usePersistentState<ContinuitySnapshot>(`ocean:continuity:reading:${activeBookId}`, initialContinuity(`reading:${activeBookId}`));
  const [contextChunkIds, setContextChunkIds] = usePersistentState<string[]>(`ocean:reading:${activeBookId}:context-chunks`, []);
  const [sessionId] = usePersistentState(`ocean:reading:${activeBookId}:session-id`, crypto.randomUUID());

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const adapter = getCoReadingAdapter();
      try {
        const nextBooks = await adapter.listBooks(controller.signal);
        const selectedBookId = nextBooks.some((book) => book.bookId === activeBookId) ? activeBookId : nextBooks[0]?.bookId;
        if (!selectedBookId) {
          if (!controller.signal.aborted) {
            setBooks([]);
            setPage(null);
            setReadingLoadError("");
            setStatus("共读书库还没有书，可以从换书面板导入");
          }
          return;
        }
        const nextPage = await openReadablePage(adapter, selectedBookId, controller.signal);
        if (!controller.signal.aborted) {
          setBooks(nextBooks);
          setPage(nextPage);
          setReadingLoadError("");
          setBookMenuOpen(false);
          pageCardRef.current?.scrollTo({ top: 0 });
          if (selectedBookId !== activeBookId) setActiveBookId(selectedBookId);
        }
      } catch {
        if (adapter !== mockCoReadingAdapter) {
          if (!controller.signal.aborted) {
            setBooks([]);
            setPage(null);
            setReadingLoadError("真实共读服务暂时无法连接，请检查 Gateway 或共读服务");
            setStatus("真实共读服务暂时无法连接，不会使用演示正文替代");
          }
          return;
        }
        const nextBooks = await mockCoReadingAdapter.listBooks(controller.signal);
        const fallbackBookId = nextBooks.some((book) => book.bookId === activeBookId) ? activeBookId : nextBooks[0]?.bookId;
        if (!fallbackBookId) return;
        const nextPage = await mockCoReadingAdapter.continueBook(fallbackBookId, controller.signal);
        if (!controller.signal.aborted) {
          setBooks(nextBooks);
          setPage(nextPage);
          setReadingLoadError("");
          setStatus("共读服务暂未连接，正在使用离线演示书页");
          if (fallbackBookId !== activeBookId) setActiveBookId(fallbackBookId);
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [activeBookId, readingRetry, setActiveBookId]);

  useEffect(() => {
    if (!page) return;
    const controller = new AbortController();
    const loadAnnotations = async () => {
      try {
        const next = await getCoReadingAdapter().listAnnotations(page.bookId, page.chunk.id, controller.signal);
        if (!controller.signal.aborted) setAnnotations(next);
      } catch {
        const next = await mockCoReadingAdapter.listAnnotations(page.bookId, page.chunk.id, controller.signal);
        if (!controller.signal.aborted) setAnnotations(next);
      }
    };
    setPendingSelection(null);
    setActiveQuote(null);
    void loadAnnotations();
    return () => controller.abort();
  }, [page?.bookId, page?.chunk.id]);

  const readingText = useMemo(() => page ? displayReadingText(page.text) : "", [page]);
  const ranges = useMemo(() => highlightRanges(readingText, annotations), [annotations, readingText]);
  const visibleBooks = useMemo(() => books.slice(0, 5), [books]);
  const currentBook = books.find((book) => book.bookId === activeBookId);
  const activeNotes = activeQuote ? annotations.filter((annotation) => annotation.quote === activeQuote) : [];
  const visibleReadingMessages = useMemo(() => messages.slice(-3), [messages]);
  const latestReasoning = useMemo(() => messages.at(-1)?.role === "assistant" ? messages.at(-1)?.reasoning ?? null : null, [messages]);
  const statusIsError = status.includes("暂时没有翻过去") || status.includes("检查共读连接") || status.includes("导入失败") || status.includes("不支持");

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), statusIsError ? 3600 : 2600);
    return () => window.clearTimeout(timer);
  }, [status, statusIsError]);

  useEffect(() => {
    const captureSelection = () => {
      if (selectionTimerRef.current !== null) window.clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = window.setTimeout(() => {
        const selection = window.getSelection();
        const textNode = pageTextRef.current;
        const card = pageCardRef.current;
        if (!selection || selection.isCollapsed || !selection.rangeCount || !textNode || !card) return;
        if (!selection.anchorNode || !selection.focusNode || !textNode.contains(selection.anchorNode) || !textNode.contains(selection.focusNode)) return;
        const quote = selection.toString().trim();
        if (quote.length < 2 || quote.length > 180) return;
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.left - cardRect.left + card.scrollLeft, card.clientWidth - 278));
        const top = Math.max(card.scrollTop + 8, Math.min(rect.bottom - cardRect.top + card.scrollTop + 6, card.scrollTop + card.clientHeight - 158));
        setPendingSelection({ quote, left, top });
        setAnnotationDraft("");
        setShareAnnotation(false);
        setActiveQuote(null);
      }, 140);
    };
    document.addEventListener("selectionchange", captureSelection);
    return () => {
      document.removeEventListener("selectionchange", captureSelection);
      if (selectionTimerRef.current !== null) window.clearTimeout(selectionTimerRef.current);
    };
  }, [page?.chunk.id]);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setPendingSelection(null);
    setAnnotationDraft("");
    setShareAnnotation(false);
  };

  const selectBook = (bookId: string) => {
    setActiveBookId(bookId);
    setStatus("");
    setBookMenuOpen(false);
    setPageCollapsed(false);
  };

  const importBooks = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (!files.length || importingBooks) return;
    const unsupported = files.find((file) => !isSupportedReadingFile(file));
    if (unsupported) {
      setStatus(`不支持 ${unsupported.name}，请选择 EPUB、TXT 或 Markdown`);
      if (importInputRef.current) importInputRef.current.value = "";
      return;
    }

    setImportingBooks(true);
    try {
      const adapter = getCoReadingAdapter();
      let lastImportedBookId = "";
      for (const [index, file] of files.entries()) {
        setStatus(files.length === 1 ? `正在导入《${file.name}》…` : `正在导入第 ${index + 1}/${files.length} 本…`);
        const imported = await adapter.importBook({ filename: file.name, dataBase64: await fileToBase64(file) });
        lastImportedBookId = imported.bookId;
      }
      const nextBooks = await adapter.listBooks();
      setBooks(nextBooks);
      setBookMenuOpen(false);
      if (lastImportedBookId) selectBook(lastImportedBookId);
      setStatus(files.length === 1 ? "电子书已放进共读书架" : `${files.length} 本电子书已放进共读书架`);
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Co-Reading \d+:\s*/, "") : "未知错误";
      setStatus(`导入失败：${message}`);
    } finally {
      setImportingBooks(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const turnPage = async (direction: "previous" | "next") => {
    if (!page || turningPage) return;
    const targetId = direction === "previous" ? page.prevId : page.nextId;
    if (!targetId && direction === "previous") {
      setStatus("");
      return;
    }
    setTurningPage(true);
    try {
      const adapter = getCoReadingAdapter();
      if (direction === "next") {
        const progress = await adapter.markRead(page.bookId, page.chunk.id);
        if (progress.complete) {
          await syncOrQueue("memory-event", {
            eventId: `${page.bookId}:completed`,
            type: "reading-completed",
            title: page.title,
            summary: `完成共读《${page.title}》，已读 ${progress.chunksRead} / ${progress.chunkCount} 个阅读块。`,
            scope: `reading:${page.bookId}`,
            occurredAt: progress.lastReadAt ?? new Date().toISOString(),
            metadata: { bookId: page.bookId, chunkCount: progress.chunkCount },
          });
        }
        if (!targetId) {
          setStatus(progress.complete ? "这本书已经读完了" : "已读到本书最后一块");
          return;
        }
      }
      if (!targetId) return;
      const nextPage = await adapter.readChunk(page.bookId, targetId);
      setPage(nextPage);
      setStatus("");
      pageCardRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setStatus("这一页暂时没有翻过去，请检查共读连接");
    } finally {
      setTurningPage(false);
    }
  };

  const sendToReadingSession = async (value: string, mode: ReadingInputMode | "annotation") => {
    if (!page || !value.trim() || streaming) return false;
    const userTurn: MessageTurn = { id: crypto.randomUUID(), role: "user", createdAt: "刚刚", segments: [value.trim()] };
    const replyId = crypto.randomUUID();
    const reply: MessageTurn = { id: replyId, role: "assistant", createdAt: "刚刚", segments: [] };
    let nextMessages = [...messages, userTurn, reply];
    setMessages(nextMessages);
    setStreaming(true);

    const contextKey = `${continuity.physicalSessionId}:${page.chunk.id}`;
    const includePageContext = mode !== "chat" || !contextChunkIds.includes(contextKey);
    try {
      const liveChatEnabled = window.localStorage.getItem("ocean:chat:live") === "true";
      const adapter = liveChatEnabled && gatewayIsConnected() ? gatewayChatAdapter : mockChatAdapter;
      const selection = getModelSelection();
      const history = messagesForPhysicalSession([...messages, userTurn], continuity).map((turn) => ({ role: turn.role, content: turn.segments.join("\n\n") }));
      const pageContext = includePageContext ? `\n本次可引用的当前书页：\n[${page.chunk.title}]\n${readingText.slice(0, 5000)}` : "";
      const modeInstruction = [
        `这是《${page.title}》的独立共读会话，作者：${page.author ?? "未知"}。当前阅读块是「${page.chunk.title}」。`,
        "只使用这本书的会话历史，不与其他书籍串联；可以结合用户和助手在本书留下的批注自然讨论。",
        mode === "question" ? "用户正在带着当前书页提问，请优先依据书页原文回答，并清楚区分原文与推断。" : "",
        mode === "annotation" ? "用户刚把一条书页批注推送给你，请回应批注本身，不要声称看到了未提供的内容。" : "",
        pageContext,
      ].filter(Boolean).join("\n");
      for await (const event of adapter.streamReply(value.trim(), { mode: "reading", nightTalk: false, messages: history, providerId: selection?.providerId, modelId: selection?.modelId, settings: selection?.settings, continuitySummary: continuity.summary || undefined, continuityHandoff: continuity.handoff || undefined, physicalSessionId: continuity.physicalSessionId, modeInstruction })) {
        if (event.type === "segment") {
          nextMessages = nextMessages.map((turn) => turn.id === replyId ? { ...turn, segments: [...turn.segments, event.value] } : turn);
          setMessages(nextMessages);
        }
        if (event.type === "reasoning") {
          nextMessages = nextMessages.map((turn) => turn.id === replyId ? { ...turn, reasoning: event.value } : turn);
          setMessages(nextMessages);
        }
        if (event.type === "usage") recordUsage(event);
      }
      if (includePageContext) setContextChunkIds((current) => current.includes(contextKey) ? current : [...current, contextKey]);
      return true;
    } catch (error) {
      nextMessages = nextMessages.map((turn) => turn.id === replyId ? { ...turn, segments: [error instanceof Error ? `连接模型时出了点问题：${error.message}` : "连接模型时出了点问题，请稍后再试。"] } : turn);
      setMessages(nextMessages);
      return false;
    } finally {
      setContinuity(await forgeContinuity(nextMessages, continuity));
      await syncOrQueue("conversation", {
        id: `reading:${page.bookId}`,
        scope: `reading:${page.bookId}`,
        messages: nextMessages,
        readingContext: { bookId: page.bookId, chunkId: page.chunk.id, sessionId, contextMode: "chunk-once-per-session" },
      });
      setStreaming(false);
    }
  };

  const saveAnnotation = async () => {
    const note = annotationDraft.trim();
    if (!note || !page || !pendingSelection) return;
    const optimistic: CoReadingAnnotation = {
      id: crypto.randomUUID(),
      bookId: page.bookId,
      chunkId: page.chunk.id,
      quote: pendingSelection.quote,
      note,
      author: "user",
      status: "open",
      createdAt: new Date().toISOString(),
    };
    const adapter = getCoReadingAdapter();
    try {
      const saved = await adapter.addAnnotation({
        bookId: page.bookId,
        chunkId: page.chunk.id,
        quote: pendingSelection.quote,
        note,
        author: "user",
      });
      setAnnotations((current) => [...current, saved]);
      if (shareAnnotation) {
        try {
          await adapter.submitNotes({ bookId: page.bookId, chunkId: page.chunk.id, sessionId });
          const delivered = await sendToReadingSession(`批注「${pendingSelection.quote}」\n${note}`, "annotation");
          setPageCollapsed(true);
          setStatus(delivered ? "批注已经留下，也推给陪伴者了" : "批注已经留下，但模型回复暂时没有接上");
        } catch {
          setStatus("批注已经留下，但暂时没能推给陪伴者");
        }
      } else {
        setStatus("批注已经留在选中的句子旁边");
      }
    } catch {
      setAnnotations((current) => [...current, optimistic]);
      setStatus("批注已先保存在当前书页，连接恢复后可再同步");
    }
    clearSelection();
  };

  const handleAttachment = (action: string) => {
    if (action === "bookmark") {
      setStatus(page ? `书签留在「${page.chunk.title}」` : "书签已经留下");
      return;
    }
    if (action === "annotation") {
      setStatus("请长按或框选书页中的一句，再留下批注");
      return;
    }
    setInputMode("question");
    setStatus("下一条输入会带着当前书页去问陪伴者");
  };

  const send = async () => {
    const value = input.trim();
    if (!value || !page || streaming) return;

    if (inputMode === "question") {
      try {
        await getCoReadingAdapter().submitNotes({ bookId: page.bookId, chunkId: page.chunk.id, sessionId });
      } catch {
        // The conversation still remains useful in Mock/offline mode.
      }
    }

    const mode = inputMode;
    setInput("");
    setInputMode("chat");
    setPageCollapsed(true);
    const delivered = await sendToReadingSession(value, mode);
    setStatus(delivered ? (mode === "question" ? "问题已放进这本书的独立会话" : "已写进这本书的共读会话") : "消息已留在本书会话，模型回复暂时没有接上");
  };

  const renderedText = (() => {
    if (!ranges.length) return readingText;
    const nodes: ReactNode[] = [];
    let cursor = 0;
    ranges.forEach((range) => {
      if (range.start > cursor) nodes.push(readingText.slice(cursor, range.start));
      const hasHuman = range.notes.some((note) => isHumanAuthor(note.author));
      const hasAssistant = range.notes.some((note) => !isHumanAuthor(note.author));
      const tone = hasHuman && hasAssistant ? "mixed" : hasHuman ? "human" : "assistant";
      nodes.push(
        <mark
          className={`reading-highlight ${tone}`}
          key={`${range.start}-${range.quote}`}
          onClick={() => setActiveQuote(range.quote)}
          onFocus={() => setActiveQuote(range.quote)}
          onMouseEnter={() => setActiveQuote(range.quote)}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setActiveQuote(range.quote); }}
          role="button"
          tabIndex={0}
        >
          {readingText.slice(range.start, range.end)}
        </mark>,
      );
      cursor = range.end;
    });
    if (cursor < readingText.length) nodes.push(readingText.slice(cursor));
    return nodes;
  })();

  return (
    <section className={`reading-room-stage ${pageCollapsed ? "reading-collapsed" : ""}`} aria-label="共读模式">
      <section className="reading-bookshelf" aria-label="共读书架">
        <div className="study-shelf-cavity" />
        <div className="reading-shelf-label reading-label"><span>READING</span></div>
        <div className="reading-book-strip">
          {visibleBooks.map((book, index) => (
            <button
              aria-pressed={book.bookId === activeBookId}
              className={`reading-book ${bookTone(index, book.bookId === activeBookId)}`}
              key={book.bookId}
              onClick={() => selectBook(book.bookId)}
              style={{ height: `${index % 2 === 0 ? 120 : 76}px` }}
            >
              <span>{book.title}</span>
            </button>
          ))}
        </div>
        <div className="reading-shelf-label finish-label"><span>FINSH</span></div>
      </section>

      <article className={`reading-page-card ${pageCollapsed ? "collapsed" : ""}`} aria-label={page ? `${page.title} · ${page.chunk.title}` : "正在打开书页"} ref={pageCardRef}>
        <p ref={pageTextRef}>{page ? renderedText : readingLoadError || "正在把书页翻到上次停下的位置……"}</p>
        {readingLoadError && (
          <button className="reading-retry-connection" onClick={() => setReadingRetry((value) => value + 1)} type="button">
            重新连接
          </button>
        )}

        {pendingSelection && (
          <form
            className="reading-inline-note-editor"
            onSubmit={(event) => { event.preventDefault(); void saveAnnotation(); }}
            style={{ left: pendingSelection.left, top: pendingSelection.top }}
          >
            <q>{pendingSelection.quote}</q>
            <textarea aria-label="给选中文字留下批注" autoFocus onChange={(event) => setAnnotationDraft(event.target.value)} placeholder="在这句话旁边写一点…" rows={2} value={annotationDraft} />
            <div className="reading-note-actions">
              <label className="reading-share-toggle">
                <span>同时推给陪伴者</span>
                <MiniSwitch
                  disabledLabel="不推给陪伴者"
                  enabledLabel="同时推给陪伴者"
                  onChange={() => setShareAnnotation((selected) => !selected)}
                  selected={shareAnnotation}
                />
              </label>
              <span><button type="button" onClick={clearSelection}>取消</button><button disabled={!annotationDraft.trim()} type="submit">留下</button></span>
            </div>
          </form>
        )}

        {activeNotes.length > 0 && (
          <aside className="reading-note-thread" aria-label="这句话的批注">
            <button aria-label="关闭批注" className="reading-note-thread-close" onClick={() => setActiveQuote(null)}>×</button>
            <q>{activeQuote}</q>
            {activeNotes.map((note) => (
              <div className={isHumanAuthor(note.author) ? "human" : "assistant"} key={note.id}>
                <span>{isHumanAuthor(note.author) ? "我" : "陪伴者"}</span>
                <p>{note.note}</p>
              </div>
            ))}
          </aside>
        )}
      </article>

      <div aria-hidden="true" className="reading-page-header" />

      <div className="reading-page-toolbar">
        {!statusIsError && <span aria-live="polite">{status}</span>}
        <button
          aria-expanded={!pageCollapsed}
          aria-label={pageCollapsed ? "展开书页" : "收起书页，查看这本书的会话"}
          className={`reading-page-toggle ${pageCollapsed ? "collapsed" : ""}`}
          onClick={() => { clearSelection(); setActiveQuote(null); setBookMenuOpen(false); setPageCollapsed((collapsed) => !collapsed); }}
        >
          <i aria-hidden="true" />
        </button>
      </div>

      {statusIsError && <div aria-live="assertive" className="reading-error-toast">{status}</div>}

      {pageCollapsed && (
        <section className="reading-conversation" aria-label={`${currentBook?.title ?? page?.title ?? "本书"}独立会话`}>
          <div aria-live="polite">
            {visibleReadingMessages.length === 0
              ? <p className="reading-conversation-empty">这本书的会话还没有内容</p>
              : visibleReadingMessages.map((turn, index) => (
                <div className={`reading-conversation-turn ${turn.role} ${index > 0 && visibleReadingMessages[index - 1].role === turn.role ? "same-speaker" : ""}`} key={turn.id}>
                  <p>{turn.segments.length ? turn.segments.join("\n") : (streaming && index === visibleReadingMessages.length - 1 ? "…" : "")}</p>
                </div>
              ))}
          </div>
        </section>
      )}

      <nav className="reading-navigation" aria-label="翻页和换书">
        <button aria-label="上一块" disabled={!page?.prevId || turningPage} onClick={() => void turnPage("previous")}>‹</button>
        <button aria-expanded={bookMenuOpen} className="reading-book-switch" onClick={() => setBookMenuOpen((open) => !open)}>
          <span>{currentBook ? compactBookTitle(currentBook.title) : "选择一本书"}</span><i aria-hidden="true" />
        </button>
        <button aria-label={page?.nextId ? "下一块" : "完成本书"} disabled={!page || turningPage} onClick={() => void turnPage("next")}>›</button>
      </nav>

      {bookMenuOpen && (
        <>
          <button aria-label="收起书单" className="reading-library-backdrop" onClick={() => setBookMenuOpen(false)} />
          <section className="reading-library-popover" aria-label="切换共读书目">
            <strong>换一本书</strong>
            <div className="reading-library-list">
              {books.map((book) => (
                <button aria-pressed={book.bookId === activeBookId} key={book.bookId} onClick={() => selectBook(book.bookId)}>
                  <span>{book.title}</span><small>{book.author ?? "未知作者"}</small>
                </button>
              ))}
              {books.length === 0 && <p className="reading-library-empty">还没有电子书</p>}
            </div>
            <input
              accept=".epub,.txt,.text,.md,.markdown"
              aria-label="选择要导入的电子书"
              hidden
              multiple
              onChange={(event) => void importBooks(event.target.files)}
              ref={importInputRef}
              type="file"
            />
            <button className="reading-import-book" disabled={importingBooks} onClick={() => importInputRef.current?.click()}>
              <i aria-hidden="true" />
              <span><b>{importingBooks ? "正在导入…" : "导入电子书"}</b><small>EPUB · TXT · MD</small></span>
            </button>
          </section>
        </>
      )}

      <StudyDecoration className="study-reading-decoration" variant="reading" />
      <RoomChatChrome
        attachmentActions={readingAttachmentActions}
        input={input}
        inputPlaceholder={`${compactBookTitle(currentBook?.title ?? page?.title ?? "本书")} · 独立会话`}
        onAttachmentAction={handleAttachment}
        onInputChange={setInput}
        onSend={() => void send()}
        reasoning={latestReasoning}
        sendDisabled={!input.trim() || !page || streaming}
        storageRemainingPercent={continuity.storage?.percentRemaining}
        variant="study"
      />
    </section>
  );
}
