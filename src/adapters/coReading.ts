import { getGatewayBaseUrl } from "../config/gateway";

export interface CoReadingBook {
  bookId: string;
  title: string;
  author: string | null;
  chunkCount: number;
  chunksRead: number;
  annotationCount: number;
  lastChunkId: string | null;
  lastReadAt: string | null;
  complete: boolean;
}

export interface CoReadingProgress {
  chunkCount: number;
  chunksRead: number;
  complete: boolean;
  lastChunkId: string | null;
  lastReadAt: string | null;
}

export interface CoReadingChunkMeta {
  id: string;
  title: string;
  order: number;
  prevId: string | null;
  nextId: string | null;
  charCount?: number;
  read?: boolean;
}

export interface CoReadingPage {
  bookId: string;
  title: string;
  author: string | null;
  chunk: CoReadingChunkMeta;
  prevId: string | null;
  nextId: string | null;
  text: string;
  progress?: CoReadingProgress;
  completed?: boolean;
}

export interface CoReadingAnnotation {
  id: string;
  bookId: string;
  chunkId: string;
  quote: string;
  note: string;
  author: string;
  kind?: string;
  status?: string;
  parentId?: string | null;
  quoteOffset?: number | null;
  createdAt?: string;
}

export interface CoReadingImportResult {
  bookId: string;
  title: string;
  author: string | null;
  chunkCount: number;
  firstChunkId: string | null;
  lastChunkId: string | null;
  source?: { type?: string; fileName?: string } | null;
  message?: string;
}

export interface CoReadingAdapter {
  listBooks(signal?: AbortSignal): Promise<CoReadingBook[]>;
  listChunks(bookId: string, signal?: AbortSignal): Promise<CoReadingChunkMeta[]>;
  continueBook(bookId?: string, signal?: AbortSignal): Promise<CoReadingPage>;
  readChunk(bookId: string, chunkId: string, signal?: AbortSignal): Promise<CoReadingPage>;
  markRead(bookId: string, chunkId: string): Promise<CoReadingProgress>;
  listAnnotations(bookId: string, chunkId: string, signal?: AbortSignal): Promise<CoReadingAnnotation[]>;
  addAnnotation(input: { bookId: string; chunkId: string; quote: string; note: string; author?: string }): Promise<CoReadingAnnotation>;
  submitNotes(input: { bookId: string; chunkId?: string; sessionId: string }): Promise<{ count: number; submissionId?: string }>;
  importBook(input: { filename: string; dataBase64: string }): Promise<CoReadingImportResult>;
}

const figmaReadingText = [
  "滚滚长江东逝水，浪花淘尽英雄。是非成败转头空。青山依旧在，几度夕阳红。白发渔樵江渚上，惯看秋月春风。一壶浊酒喜相逢。古今多少事，都付笑谈中。",
  "滚滚长江东逝水，浪花淘尽英雄。是非成败转头空。青山依旧在，几度夕阳红。白发渔樵江渚上，惯看秋月春风。一壶浊酒喜相逢。古今多少事，都付笑谈中。",
  "滚滚长江东逝水，浪花淘尽英雄。是非成败转头空。青山依旧在，几度夕阳红。白发渔樵江渚上，惯看秋月春风。一壶浊酒喜相逢。古今多少事，都付笑谈中。",
  "滚滚长江东逝水，浪花淘尽英雄。是非成败转头空。青山依旧在，几度夕阳红。白发渔樵江渚上，惯看秋月春风。一壶浊酒喜相逢。古今多少事，都付笑谈中。",
  "滚滚长江东逝水，浪花淘尽英雄。是非成败转头空。青山依旧在，几度夕阳红。",
].join("");

const mockBooks: CoReadingBook[] = [
  { bookId: "myth-of-sisyphus", title: "西西弗神话", author: "阿尔贝·加缪", chunkCount: 38, chunksRead: 17, annotationCount: 12, lastChunkId: "ch16", lastReadAt: "2026-07-15T21:30:00.000Z", complete: false },
  { bookId: "sand-and-foam", title: "沙与沫", author: "纪伯伦", chunkCount: 16, chunksRead: 16, annotationCount: 8, lastChunkId: "ch15", lastReadAt: "2026-07-02T20:10:00.000Z", complete: true },
];

const mockPage: CoReadingPage = {
  bookId: "myth-of-sisyphus",
  title: "西西弗神话",
  author: "阿尔贝·加缪",
  chunk: { id: "ch17", title: "唐璜主义", order: 17, prevId: "ch16", nextId: "ch18" },
  prevId: "ch16",
  nextId: "ch18",
  text: figmaReadingText,
  progress: { chunkCount: 38, chunksRead: 17, complete: false, lastChunkId: "ch16", lastReadAt: "2026-07-15T21:30:00.000Z" },
  completed: false,
};

const mockAnnotations: CoReadingAnnotation[] = [
  {
    id: "mock-user-note",
    bookId: "myth-of-sisyphus",
    chunkId: "ch17",
    quote: "青山依旧在，几度夕阳红。",
    note: "这一句让我想到，有些东西并不会因为人的来去而改变。",
    author: "user",
    status: "open",
  },
  {
    id: "mock-assistant-note",
    bookId: "myth-of-sisyphus",
    chunkId: "ch17",
    quote: "古今多少事，都付笑谈中。",
    note: "像是把沉重慢慢放回时间里，最后留下可以一起谈起的部分。",
    author: "claude",
    status: "published",
  },
];

export class MockCoReadingAdapter implements CoReadingAdapter {
  async listBooks(_signal?: AbortSignal) { return mockBooks; }
  async listChunks(_bookId: string, _signal?: AbortSignal) { return [{ ...mockPage.chunk, charCount: mockPage.text.length, read: false }]; }
  async continueBook(bookId?: string, _signal?: AbortSignal) { return { ...mockPage, bookId: bookId || mockPage.bookId }; }
  async readChunk(bookId: string, chunkId: string, _signal?: AbortSignal) { return { ...mockPage, bookId, chunk: { ...mockPage.chunk, id: chunkId } }; }
  async markRead(_bookId: string, chunkId: string) { return { ...mockPage.progress!, chunksRead: mockPage.progress!.chunksRead + 1, lastChunkId: chunkId }; }
  async listAnnotations(bookId: string, chunkId: string, _signal?: AbortSignal) { return mockAnnotations.filter((item) => item.bookId === bookId && item.chunkId === chunkId); }
  async addAnnotation(input: { bookId: string; chunkId: string; quote: string; note: string; author?: string }) {
    return { id: crypto.randomUUID(), ...input, author: input.author ?? "user", status: "open", createdAt: new Date().toISOString() };
  }
  async submitNotes() { return { count: 1, submissionId: crypto.randomUUID() }; }
  async importBook(_input: { filename: string; dataBase64: string }): Promise<CoReadingImportResult> { throw new Error("请先连接共读服务，再导入电子书"); }
}

export class GatewayCoReadingAdapter implements CoReadingAdapter {
  constructor(private readonly baseUrl: string) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!response.ok) throw new Error(`Co-Reading ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  listBooks(signal?: AbortSignal) { return this.json<CoReadingBook[]>("/v1/reading/books", { signal }); }
  listChunks(bookId: string, signal?: AbortSignal) { return this.json<CoReadingChunkMeta[]>(`/v1/reading/books/${encodeURIComponent(bookId)}/chunks`, { signal }); }
  continueBook(bookId?: string, signal?: AbortSignal) { return this.json<CoReadingPage>(`/v1/reading/continue${bookId ? `?bookId=${encodeURIComponent(bookId)}` : ""}`, { signal }); }
  readChunk(bookId: string, chunkId: string, signal?: AbortSignal) { return this.json<CoReadingPage>(`/v1/reading/books/${encodeURIComponent(bookId)}/chunks/${encodeURIComponent(chunkId)}`, { signal }); }
  markRead(bookId: string, chunkId: string) { return this.json<CoReadingProgress>("/v1/reading/mark-read", { method: "POST", body: JSON.stringify({ bookId, chunkId }) }); }
  listAnnotations(bookId: string, chunkId: string, signal?: AbortSignal) { return this.json<CoReadingAnnotation[]>(`/v1/reading/annotations?bookId=${encodeURIComponent(bookId)}&chunkId=${encodeURIComponent(chunkId)}`, { signal }); }
  addAnnotation(input: { bookId: string; chunkId: string; quote: string; note: string; author?: string }) { return this.json<CoReadingAnnotation>("/v1/reading/annotations", { method: "POST", body: JSON.stringify(input) }); }
  submitNotes(input: { bookId: string; chunkId?: string; sessionId: string }) { return this.json<{ count: number; submissionId?: string }>("/v1/reading/submit-notes", { method: "POST", body: JSON.stringify({ ...input, contextMode: "chunk-once-per-session" }) }); }
  importBook(input: { filename: string; dataBase64: string }) { return this.json<CoReadingImportResult>("/v1/reading/import", { method: "POST", body: JSON.stringify(input) }); }
}

export const mockCoReadingAdapter = new MockCoReadingAdapter();

export function getCoReadingAdapter() {
  try {
    const states = JSON.parse(window.localStorage.getItem("ocean:connections") ?? "{}") as { gateway?: string; reading?: string };
    return states.gateway === "connected" && states.reading === "connected" ? new GatewayCoReadingAdapter(getGatewayBaseUrl()) : mockCoReadingAdapter;
  } catch {
    return mockCoReadingAdapter;
  }
}
