import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { usePersistentState } from "../hooks/usePersistentState";
import type { DailyImpressionSummary, MemoryBucketSummary, MemoryCandidate, MemoryEvidenceChain, MemoryPortrait, MemorySearchHit } from "../domain/ocean";
import { OceanGatewayClient } from "../api/OceanGatewayClient";
import { OceanBottomSheet } from "./OceanBottomSheet";
import { assetPath } from "../utils/assetPath";

type PalaceTab = "memories" | "daily" | "portrait" | "config" | "console";
type ConsoleTab = "recall" | "breath" | "candidates" | "import";
type ConfigFieldType = "text" | "status" | "select" | "number";
type EditableProfileId = "user" | "self";

interface ConfigField {
  id: string;
  label: string;
  value: string;
  type?: ConfigFieldType;
  help?: string;
  options?: string[];
}

interface ConfigSection {
  id: string;
  title: string;
  description: string;
  fields: ConfigField[];
}

interface MemoryItem {
  id: string;
  title: string;
  domain: string;
  state: "流水" | "未解决" | "已消化" | "已归档";
  score: number;
  pinned?: boolean;
  anchor?: boolean;
  evidenceTagged?: boolean;
  evidence: number;
  snippet: string;
  live?: boolean;
}

function MemoryDetailSheet({ item, onClose }: { item: MemoryItem; onClose: () => void }) {
  const [view, setView] = useState<"detail" | "evidence">("detail");
  const [liveEvidence, setLiveEvidence] = useState<MemoryEvidenceChain | null>(null);
  const [evidenceState, setEvidenceState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const directEvidence = Math.max(1, Math.round(item.evidence * .4));
  const derivedEvidence = Math.max(1, Math.round(item.evidence * .25));
  const contextEvidence = Math.max(0, item.evidence - directEvidence - derivedEvidence);
  const mockEvidenceGroups = [
    { kind: "直接证据", count: directEvidence, entries: [{ id: "mock-direct", title: "原始记录", snippet: `与“${item.title}”直接相关的原始对话、批注或用户确认。`, sourceType: "mock" }] },
    { kind: "推导证据", count: derivedEvidence, entries: [{ id: "mock-derived", title: "一致性归纳", snippet: "由多条一致记录归纳出的关系与长期偏好，不替代原始证据。", sourceType: "mock" }] },
    { kind: "上下文证据", count: contextEvidence, entries: [{ id: "mock-context", title: "当时背景", snippet: "帮助理解时间、项目阶段与当时情绪效价的背景记录。", sourceType: "mock" }] },
  ];
  const evidenceGroups = liveEvidence ? [
    { kind: "直接证据", count: liveEvidence.direct.length, entries: liveEvidence.direct },
    { kind: "推导证据", count: liveEvidence.derived.length, entries: liveEvidence.derived },
    { kind: "上下文证据", count: liveEvidence.context.length, entries: liveEvidence.context },
  ] : mockEvidenceGroups;
  const contentLength = view === "detail"
    ? item.title.length + item.snippet.length
    : evidenceGroups.reduce((total, group) => total + group.kind.length + group.entries.reduce((sum, entry) => sum + entry.title.length + entry.snippet.length, 0), 0) + 220;
  const showEvidence = () => {
    setView("evidence");
    if (!item.live || evidenceState === "loading" || evidenceState === "ready") return;
    setEvidenceState("loading");
    void new OceanGatewayClient().memoryEvidence(item.id).then((chain) => {
      setLiveEvidence(chain);
      setEvidenceState("ready");
    }).catch(() => setEvidenceState("error"));
  };

  return (
    <OceanBottomSheet
      className={`memory-detail-card ${view === "evidence" ? "showing-evidence" : ""}`}
      contentLength={contentLength}
      label={view === "detail" ? `${item.title}详情` : `${item.title}证据链`}
      onClose={onClose}
      open
    >
      {view === "detail" ? <>
        <span className="memory-detail-meta">{item.domain} · {item.state}</span>
        <h2>{item.title}</h2>
        <p>{item.snippet}</p>
        <footer><span>相关度 {item.score.toFixed(2)}</span><button onClick={showEvidence}>查看证据链{item.live ? "" : ` ${item.evidence}`}</button></footer>
      </> : <section className="memory-evidence-view">
        <button className="memory-evidence-back" onClick={() => setView("detail")}><span aria-hidden="true">‹</span>记忆详情</button>
        <header><span>可解释召回</span><h2>证据链</h2><p>{liveEvidence?.summary || "这条记忆为什么被保留，以及结论从哪里来。"}</p></header>
        {evidenceState === "loading" && <p className="memory-evidence-status">正在读取真实证据链…</p>}
        {evidenceState === "error" && <p className="memory-evidence-status error">证据链暂时不可用，记忆正文仍可正常阅读。</p>}
        {evidenceState !== "loading" && <div className="memory-evidence-list">
          {evidenceGroups.map((group) => <article key={group.kind}><div><strong>{group.kind}</strong><b>{group.count}</b></div>{group.entries.length ? group.entries.map((entry) => <section className="memory-evidence-entry" key={`${group.kind}-${entry.id}`}><h3>{entry.title}</h3>{entry.snippet && <p>{entry.snippet}</p>}<small>{entry.sourceType} · {entry.id}</small></section>) : <p>目前没有这一类证据。</p>}</article>)}
        </div>}
        {liveEvidence?.warnings.length ? <div className="memory-evidence-warning">{liveEvidence.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
        <div className="memory-evidence-edge"><span>关系边</span><strong>{item.domain} → {item.title} → {item.state}</strong></div>
      </section>}
    </OceanBottomSheet>
  );
}

const tabs: { id: PalaceTab; icon: string; label: string }[] = [
  { id: "memories", icon: assetPath("assets/palace/bucket.svg"), label: "记忆" },
  { id: "daily", icon: assetPath("assets/palace/daily.svg"), label: "日印象" },
  { id: "portrait", icon: assetPath("assets/palace/portrait.svg"), label: "肖像" },
  { id: "config", icon: assetPath("assets/palace/config.svg"), label: "配置" },
  { id: "console", icon: assetPath("assets/palace/console.svg"), label: "控制台" },
];

const primaryMemoryFilters = [
  { label: "全部" },
  { label: "置顶", icon: assetPath("assets/palace/top.svg") },
  { label: "锚点", icon: assetPath("assets/palace/anchor.svg") },
  { label: "证据", icon: assetPath("assets/palace/evidence.svg") },
];

const memoryTagRows: Array<Array<{ label: string; icon?: string }>> = [
  primaryMemoryFilters,
  ["感受", "项目", "技术", "关系", "约定"].map((label) => ({ label })),
  ["流水", "未解决", "已消化", "已归档"].map((label) => ({ label })),
];

const memories: MemoryItem[] = [];

const configSections: ConfigSection[] = [
  { id: "model", title: "模型 / API", description: "记忆整理、反思与画像使用的基础模型", fields: [
    { id: "model-name", label: "Model", value: "deepseek-chat" },
    { id: "model-base", label: "Base URL", value: "https://api.deepseek.com/v1" },
    { id: "model-key", label: "API Key", value: "已配置（服务器）", type: "status", help: "密钥只由服务端保存，PWA 不读取明文" },
    { id: "max-tokens", label: "Max Tokens", value: "1024", type: "number" },
    { id: "temperature", label: "Temperature", value: "0.1", type: "number" },
  ] },
  { id: "embedding", title: "向量化 Embedding", description: "千问 / DashScope 语义检索", fields: [
    { id: "embedding-enabled", label: "启用", value: "开启", type: "select", options: ["开启", "关闭"] },
    { id: "embedding-model", label: "Model", value: "text-embedding-v4" },
    { id: "embedding-base", label: "Base URL", value: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    { id: "embedding-key", label: "API Key", value: "已配置（服务器）", type: "status" },
  ] },
  { id: "reranker", title: "重排序 Reranker", description: "对召回候选进行二次相关性排序", fields: [
    { id: "rerank-enabled", label: "启用", value: "开启", type: "select", options: ["开启", "关闭"] },
    { id: "rerank-model", label: "Model", value: "gte-rerank-v2" },
    { id: "rerank-timeout", label: "Timeout", value: "12", type: "number" },
    { id: "rerank-candidates", label: "候选上限", value: "20", type: "number" },
    { id: "rerank-score", label: "最低得分", value: "0.65", type: "number" },
  ] },
  { id: "persona", title: "Persona State", description: "画像提示与智能体自我状态整理", fields: [
    { id: "persona-enabled", label: "启用", value: "开启", type: "select", options: ["开启", "关闭"] },
    { id: "persona-provider", label: "提供方", value: "同主模型", type: "select", options: ["同主模型", "独立模型"] },
    { id: "persona-candidates", label: "候选更新", value: "仅提醒", type: "select", options: ["仅提醒", "关闭"] },
  ] },
  { id: "reflection", title: "记忆与日印象", description: "生活日边界、日印象、关系天气与 aftercare", fields: [
    { id: "daily-enabled", label: "日印象", value: "开启", type: "select", options: ["开启", "关闭"] },
    { id: "daily-hour", label: "每日整理时间", value: "04:00" },
    { id: "sleep-boundary", label: "睡眠边界", value: "02:00" },
    { id: "daily-quality", label: "Daily Quality", value: "开启", type: "select", options: ["开启", "关闭"] },
    { id: "affect-anchor", label: "Affect Anchor", value: "开启", type: "select", options: ["开启", "关闭"] },
  ] },
  { id: "portrait", title: "每日画像 Portrait", description: "生成候选但不自动覆盖正式画像", fields: [
    { id: "portrait-enabled", label: "候选生成", value: "开启", type: "select", options: ["开启", "关闭"] },
    { id: "portrait-overwrite", label: "自动覆盖", value: "关闭", type: "status", help: "Memory 3.0 固定为只读确认流" },
    { id: "portrait-max", label: "每日最多候选", value: "18", type: "number" },
    { id: "portrait-length", label: "候选文本上限", value: "160", type: "number" },
  ] },
  { id: "fallback", title: "自由入口", description: "没有匹配固定域时写入的默认桶", fields: [{ id: "fallback-bucket", label: "默认 Bucket", value: "fallback" }] },
  { id: "other", title: "其他参数", description: "分页与前端读取数量", fields: [{ id: "page-size", label: "分页数量", value: "75", type: "number" }] },
];

const recallSections: ConfigSection[] = [
  { id: "recent", title: "Recent Context", description: "最近记忆与 Persona 注入节奏", fields: [
    { id: "recent-enabled", label: "最近记忆", value: "开启", type: "select", options: ["开启", "关闭"] },
    { id: "persona-prompt", label: "Persona 提示", value: "开启", type: "select", options: ["开启", "关闭"] },
    { id: "persona-rounds", label: "Persona 轮数", value: "15", type: "number" },
    { id: "cooldown-hours", label: "冷却时间", value: "6", type: "number" },
    { id: "cooldown-rounds", label: "冷却轮数", value: "5", type: "number" },
    { id: "reentry-hours", label: "再进入", value: "24", type: "number" },
  ] },
  { id: "budget", title: "召回预算", description: "控制直命中、扩散与细节二次取回", fields: [
    { id: "recent-budget", label: "最近预算", value: "300", type: "number" },
    { id: "direct-budget", label: "直命中预算", value: "400", type: "number" },
    { id: "diffuse-budget", label: "扩散预算", value: "220", type: "number" },
    { id: "detail-retry", label: "细节二次取回", value: "关闭", type: "select", options: ["关闭", "开启"] },
    { id: "detail-count", label: "细节条数", value: "3", type: "number" },
    { id: "detail-budget", label: "细节预算", value: "1200", type: "number" },
  ] },
  { id: "graph", title: "图扩散", description: "边关系保留在后端，不恢复装饰性网络图", fields: [
    { id: "recall-mode", label: "召回模式", value: "graph", type: "select", options: ["graph", "direct"] },
    { id: "diffusion", label: "图扩散", value: "开启", type: "select", options: ["开启", "关闭"] },
    { id: "diffusion-count", label: "扩散条数", value: "4", type: "number" },
    { id: "minimum-activation", label: "最小激活", value: "0.18", type: "number" },
    { id: "chain-depth", label: "链路深度", value: "6", type: "number" },
    { id: "chain-confidence", label: "链路置信", value: "0.72", type: "number" },
  ] },
];

const initialCandidates: MemoryCandidate[] = [];

const initialProfileBasics: Record<EditableProfileId, string[]> = {
  user: [],
  self: [],
};

const profileBlocks: Array<{ id: string; title: string; editableBasics?: EditableProfileId; groups: string[] }> = [
  { id: "user", title: "User Profile", editableBasics: "user", groups: ["性格与认知模式", "沟通偏好"] },
  { id: "self", title: "Self Profile", editableBasics: "self", groups: ["回应风格", "能力边界", "长期关系锚点"] },
  { id: "bond", title: "Bond", groups: ["关系起源", "重要约定"] },
  { id: "continuity", title: "Continuity Profile", groups: ["当前项目", "未完成事项", "承接线索"] },
];

function Field({ field, value, onChange }: { field: ConfigField; value: string; onChange: (value: string) => void }) {
  if (field.type === "status") return <div className="palace-field status"><span>{field.label}</span><strong>{value}</strong>{field.help && <small>{field.help}</small>}</div>;
  if (field.type === "select") return <label className="palace-field"><span>{field.label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{(field.options ?? [value]).map((option) => <option key={option}>{option}</option>)}</select>{field.help && <small>{field.help}</small>}</label>;
  return <label className="palace-field"><span>{field.label}</span><input inputMode={field.type === "number" ? "decimal" : "text"} value={value} onChange={(event) => onChange(event.target.value)} />{field.help && <small>{field.help}</small>}</label>;
}

function ConfigAccordion({ sections, values, onChange }: { sections: ConfigSection[]; values: Record<string, string>; onChange: (id: string, value: string) => void }) {
  return <div className="palace-accordion">{sections.map((section, index) => <details className="palace-config-section" key={section.id} open={index === 0}><summary><span><strong>{section.title}</strong><small>{section.description}</small></span><i /></summary><div className="palace-config-fields">{section.fields.map((field) => <Field field={field} key={field.id} value={values[field.id] ?? field.value} onChange={(value) => onChange(field.id, value)} />)}</div></details>)}</div>;
}

function bucketToItem(bucket: MemoryBucketSummary): MemoryItem {
  return {
    id: bucket.id,
    title: bucket.title,
    domain: bucket.domain.split(",")[0] || "未分类",
    state: bucket.archived ? "已归档" : bucket.tags.includes("resolved") ? "已消化" : "流水",
    score: Math.max(0, Math.min(1, bucket.importance / 10)),
    pinned: bucket.pinned,
    anchor: bucket.tags.some((tag) => tag === "anchor" || tag === "affect_anchor"),
    evidenceTagged: bucket.tags.some((tag) => tag.startsWith("profile_") || tag === "evidence"),
    evidence: 0,
    snippet: bucket.tags.length ? `标签：${bucket.tags.slice(0, 8).join("、")}` : "从 Memory 3.0 读取的记忆桶。",
    live: true,
  };
}

function MemoryBuckets({ search, searchResults, searchState }: { search: string; searchResults: MemorySearchHit[] | null; searchState: "idle" | "loading" | "ready" | "error" }) {
  const [activeTag, setActiveTag] = useState("全部");
  const [selected, setSelected] = useState<MemoryItem | null>(null);
  const [items, setItems] = useState<MemoryItem[]>(memories);
  const [source, setSource] = useState<"unconfigured" | "memory">("unconfigured");

  useEffect(() => {
    const controller = new AbortController();
    void new OceanGatewayClient().listMemoryBuckets(false, controller.signal).then((buckets) => {
      setItems(buckets.filter((bucket) => bucket.kind !== "whisper").map(bucketToItem));
      setSource("memory");
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const locallyVisible = items.filter((item) => {
    const query = search.trim().toLocaleLowerCase();
    if (query && !`${item.title} ${item.domain} ${item.snippet}`.toLocaleLowerCase().includes(query)) return false;
    if (activeTag === "全部") return true;
    if (activeTag === "置顶") return item.pinned;
    if (activeTag === "锚点") return item.anchor;
    if (activeTag === "证据") return item.evidenceTagged;
    return item.domain === activeTag || item.state === activeTag;
  });
  const semanticVisible = searchResults?.map((hit) => {
    const existing = items.find((item) => item.id === hit.id);
    return existing ? { ...existing, title: existing.title || hit.title, snippet: hit.snippet || existing.snippet } : {
      id: hit.id,
      title: hit.title,
      domain: hit.kind === "direct" ? "直接命中" : "联想浮现",
      state: "流水" as const,
      score: hit.kind === "direct" ? 1 : .72,
      evidence: 0,
      snippet: hit.snippet,
      live: true,
    };
  });
  const visible = search.trim() && searchState === "ready" ? semanticVisible ?? [] : locallyVisible;
  return <section className="palace-memory-view">
    <div className="palace-tag-cloud">{memoryTagRows.map((row, rowIndex) => <div className={`palace-filter-row tag-row-${rowIndex + 1}`} key={rowIndex}>{row.map(({ label, icon }) => <button className={activeTag === label ? "selected" : ""} key={label} onClick={() => setActiveTag(label)}>{icon && <i aria-hidden="true" className="palace-tag-icon" style={{ WebkitMaskImage: `url(${icon})`, maskImage: `url(${icon})` }} />}<span>{label}</span></button>)}</div>)}</div>
    <div className="palace-memory-list">{visible.map((item) => {
      const icon = item.pinned ? assetPath("assets/palace/top.svg") : item.anchor ? assetPath("assets/palace/anchor.svg") : item.evidenceTagged ? assetPath("assets/palace/evidence.svg") : null;
      return <button aria-label={`${item.title}，${item.domain}，${item.state}，相关度 ${item.score.toFixed(2)}`} className={`palace-memory-row ${icon ? "has-icon" : ""}`} key={item.id} onClick={() => { setSelected(item); if (source === "memory") void new OceanGatewayClient().readMemoryBucket(item.id).then((detail) => setSelected((current) => current?.id === item.id ? { ...current, snippet: detail.content } : current)).catch(() => undefined); }}>{icon && <img alt="" className="memory-mark" src={icon} />}<strong>{item.title}</strong><b>{item.score.toFixed(2)}</b></button>;
    })}</div>
    {searchState === "loading" && <p className="palace-search-note">正在 Memory 3.0 中检索…</p>}
    {searchState === "error" && <p className="palace-search-note">语义检索暂时不可用，当前显示标题与标签的本地匹配。</p>}
    {visible.length === 0 && searchState !== "loading" && <p className="palace-empty">这个筛选下暂时没有记忆。</p>}
    <p className="palace-data-source">{search.trim() && searchState === "ready" ? `Memory 3.0 语义检索 · ${visible.length} 条` : source === "memory" ? "Memory 3.0 实时读取" : "等待 Memory 3.0 连接"}</p>
    {selected && <MemoryDetailSheet item={selected} onClose={() => setSelected(null)} />}
  </section>;
}

function DailyImpressions() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const [selectedDay, setSelectedDay] = useState(Math.min(now.getDate(), days));
  const [live, setLive] = useState<DailyImpressionSummary[]>([]);
  const [liveDetail, setLiveDetail] = useState("");
  const calendarCells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: days }, (_, index) => index + 1),
  ];
  useEffect(() => {
    const controller = new AbortController();
    const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(days).padStart(2, "0")}`;
    void new OceanGatewayClient().listDailyImpressions(from, to, controller.signal).then(setLive).catch(() => undefined);
    return () => controller.abort();
  }, [days, month, year]);
  const selectedLive = live.find((item) => Number(item.date.slice(-2)) === selectedDay);
  useEffect(() => {
    setLiveDetail("");
    if (!selectedLive) return;
    void new OceanGatewayClient().readMemoryBucket(selectedLive.id).then((detail) => setLiveDetail(detail.content)).catch(() => undefined);
  }, [selectedLive?.id]);
  const intensity = (day: number) => live.find((item) => Number(item.date.slice(-2)) === day)?.intensity ?? 0;
  const calendarRows = Math.ceil(calendarCells.length / 7);
  const impression = "连接 Memory 3.0 后，这里会显示所选日期的日印象。";
  return <section className="palace-daily-view">
    <article className={`palace-calendar-card rows-${calendarRows}`}>
      <header><span className="palace-calendar-track" /><strong>{new Intl.DateTimeFormat("en", { month: "short" }).format(now)}</strong><span>{Math.round(now.getDate() / days * 100)}%</span></header>
      <div className="palace-weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="palace-calendar-grid">{calendarCells.map((day, index) => day === null ? <span key={`blank-${index}`} /> : <button aria-label={`${month + 1}月${day}日，情感浓度${intensity(day)}${day > now.getDate() ? "，尚无日印象" : ""}`} className={`intensity-${intensity(day)} ${day === selectedDay ? "selected" : ""} ${day > now.getDate() ? "future" : ""}`} disabled={day > now.getDate()} key={day} onClick={() => setSelectedDay(day)}><span>{day}</span></button>)}</div>
    </article>
    <article className="palace-impression-card"><h2>{year}.{month + 1}.{selectedDay}</h2><h3>日印象</h3><p>{selectedLive ? liveDetail || "正在从 Memory 3.0 读取…" : live.length ? "这一天没有日印象。" : impression}</p><h3>关系天气</h3><p>{selectedLive ? "以记忆桶正文中的 relationship_weather 为准。" : "尚无记录。"}</p><h3>数值</h3><p className="impression-values">V {selectedLive?.valence.toFixed(2) ?? "—"}&nbsp; A {selectedLive?.arousal.toFixed(2) ?? "—"}{selectedLive && <><br />Memory 3.0 · {selectedLive.id}</>}</p></article>
  </section>;
}

function PortraitView({ onSearch }: { onSearch: (query: string) => void }) {
  const [candidates, setCandidates] = usePersistentState<MemoryCandidate[]>("ocean:portrait-candidates:v2", initialCandidates);
  const [profileBasics, setProfileBasics] = usePersistentState<Record<EditableProfileId, string[]>>("ocean:portrait-basics:v2", { user: [], self: [] });
  const [showCandidates, setShowCandidates] = useState(false);
  const [portrait, setPortrait] = useState<MemoryPortrait | null>(null);
  const [portraitState, setPortraitState] = useState<"loading" | "memory" | "mock">("loading");
  const [evidence, setEvidence] = useState<{ label: string; query: string; state: "loading" | "ready" | "error"; hits: MemorySearchHit[] } | null>(null);
  const [editingBasics, setEditingBasics] = useState<EditableProfileId | null>(null);
  const [basicsDraft, setBasicsDraft] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void new OceanGatewayClient().memoryPortrait(controller.signal).then((value) => { setPortrait(value); setPortraitState("memory"); }).catch(() => setPortraitState("mock"));
    return () => controller.abort();
  }, []);
  const updateCandidate = (id: string, status: MemoryCandidate["status"]) => setCandidates((current) => current.map((candidate) => candidate.id === id ? { ...candidate, status } : candidate));
  const sectionFor = (id: string) => portrait?.sections.find((section) => section.id === id);
  const groupFor = (id: string, title: string) => sectionFor(id)?.groups.find((group) => group.title === title);
  const displayedBasics = (id: EditableProfileId) => profileBasics[id].length ? profileBasics[id] : groupFor(id, "基础身份")?.items.map((item) => item.text) ?? initialProfileBasics[id];
  const beginBasicsEdit = (id: EditableProfileId) => { setEditingBasics(id); setBasicsDraft(displayedBasics(id).join("\n")); };
  const saveBasics = (id: EditableProfileId) => {
    const lines = basicsDraft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 0) setProfileBasics((current) => ({ ...current, [id]: lines }));
    setEditingBasics(null);
  };
  const openEvidence = (profileId: string, profileTitle: string, groupTitle: string) => {
    const group = groupFor(profileId, groupTitle);
    const query = [profileTitle, groupTitle, ...(group?.items.slice(0, 2).map((item) => item.text) ?? [])].join(" ").slice(0, 240);
    setEvidence({ label: `${profileTitle} / ${groupTitle}`, query, state: "loading", hits: [] });
    void new OceanGatewayClient().searchMemory(query, 8).then((result) => setEvidence((current) => current?.query === query ? { ...current, state: "ready", hits: result.results } : current)).catch(() => setEvidence((current) => current?.query === query ? { ...current, state: "error" } : current));
  };
  const pending = candidates.filter((candidate) => candidate.status === "candidate");
  return <section className="palace-portrait-view">
    <button aria-expanded={showCandidates} className={`portrait-candidate-toggle ${showCandidates ? "expanded" : ""}`} onClick={() => setShowCandidates((value) => !value)}><span>画像更新候选</span><b>{pending.length}</b><i aria-hidden="true" /></button>
    {showCandidates && <div className="portrait-candidates">{pending.length ? pending.map((candidate) => <article key={candidate.id}><small>{candidate.source}</small><p>{candidate.content}</p><div><button onClick={() => updateCandidate(candidate.id, "saved")}>接纳</button><button onClick={() => updateCandidate(candidate.id, "dismissed")}>忽略</button></div></article>) : <p>暂时没有新的画像候选。</p>}</div>}
    {profileBlocks.map((profile) => <section className={`portrait-profile profile-${profile.id}`} key={profile.id}><h2>{profile.title}</h2>{profile.editableBasics && <details className="portrait-basics"><summary><span>基础身份</span><i aria-hidden="true" /></summary><div className="portrait-basics-content">{editingBasics === profile.editableBasics ? <><textarea aria-label={`${profile.title} 基础身份`} onChange={(event) => setBasicsDraft(event.target.value)} value={basicsDraft} /><div className="portrait-basics-actions"><button type="button" onClick={() => saveBasics(profile.editableBasics!)}>保存</button><button type="button" onClick={() => setEditingBasics(null)}>取消</button></div></> : <>{displayedBasics(profile.editableBasics).map((line) => <p key={line}>{line}</p>)}<button className="portrait-basics-edit" type="button" onClick={() => beginBasicsEdit(profile.editableBasics!)}>编辑基础身份</button></>}</div></details>}<div className="portrait-groups">{profile.groups.map((groupTitle) => { const group = groupFor(profile.id, groupTitle); return <details className="portrait-group" key={groupTitle}><summary><span>{groupTitle}</span><i aria-hidden="true" /></summary><div className="portrait-group-content">{group?.items.length ? group.items.map((item, index) => <article className="portrait-fact" key={`${groupTitle}-${index}`}><p>{item.text}</p>{item.emotions.length ? <small>{item.emotions.join(" · ")}</small> : null}{item.trigger && <p className="portrait-fact-rule"><b>触发</b>{item.trigger}</p>}{item.action && <p className="portrait-fact-rule"><b>应做</b>{item.action}</p>}{item.avoid && <p className="portrait-fact-rule"><b>避免</b>{item.avoid}</p>}</article>) : <p>这里展示由证据桶支持的只读画像内容。用户可通过对话提出修正，不在前端直接改写正式画像。</p>}<button type="button" onClick={() => openEvidence(profile.id, profile.title, groupTitle)}>查看支持记录</button></div></details>; })}</div></section>)}
    <p className="palace-data-source">{portraitState === "memory" ? "Memory 3.0 实时画像" : portraitState === "loading" ? "正在读取 Memory 3.0 画像…" : "演示画像 · 等待 Memory 连接"}</p>
    {evidence && <OceanBottomSheet className="portrait-evidence-sheet" contentLength={evidence.hits.reduce((total, hit) => total + hit.title.length + hit.snippet.length, 120)} label={`${evidence.label}支持记录`} onClose={() => setEvidence(null)} open><span className="memory-detail-meta">Memory 3.0 语义支持</span><h2>{evidence.label}</h2><p className="portrait-evidence-description">这里列出支持这一组画像的相关记忆；进入单条记忆后可继续查看严格 Evidence Chain。</p>{evidence.state === "loading" && <p className="memory-evidence-status">正在检索支持记录…</p>}{evidence.state === "error" && <p className="memory-evidence-status error">支持记录暂时不可用。</p>}{evidence.state === "ready" && <div className="portrait-evidence-results">{evidence.hits.length ? evidence.hits.map((hit) => <button key={hit.id} onClick={() => { setEvidence(null); onSearch(hit.title); }}><strong>{hit.title}</strong><span>{hit.snippet}</span><small>{hit.kind === "direct" ? "直接命中" : "联想浮现"} · {hit.id}</small></button>) : <p>暂时没有检索到支持记录。</p>}</div>}</OceanBottomSheet>}
  </section>;
}

function MemoryConfiguration() {
  const defaults = Object.fromEntries(configSections.flatMap((section) => section.fields.map((field) => [field.id, field.value])));
  const [values, setValues] = usePersistentState<Record<string, string>>("ocean:memory-config-draft:v2", defaults);
  const [notice, setNotice] = useState("");
  const [selectedAction, setSelectedAction] = useState<"runtime" | "config" | "keys" | null>(null);
  const change = (id: string, value: string) => setValues((current) => ({ ...current, [id]: value }));
  const apply = (action: "runtime" | "config" | "keys", message: string) => { setSelectedAction(action); setNotice(message); window.setTimeout(() => setNotice(""), 2200); };
  return <section className="palace-config-view"><div className="palace-section-intro"><span>Memory 3.0</span><strong>配置</strong><small>前端保存草稿；写入服务器前仍需后端确认。</small></div><ConfigAccordion sections={configSections} values={values} onChange={change} /><section className="palace-system-status"><header><h3>系统信息</h3><span>待连接</span></header><p>Transport <b>streamable-http</b></p><p>Backend <b>Ocean Memory 3.0</b></p><p>Portrait API <b>已设计</b></p><p>Embedding / Rerank <b>服务端配置</b></p></section><div className="palace-config-actions"><button aria-pressed={selectedAction === "runtime"} onClick={() => apply("runtime", "已保存运行时草稿")}>应用（仅运行时）</button><button aria-pressed={selectedAction === "config"} onClick={() => apply("config", "等待 Gateway 写入 config.yaml")}>写入 config.yaml</button><button aria-pressed={selectedAction === "keys"} onClick={() => apply("keys", "密钥需要在服务器端更新")}>管理服务端密钥</button></div>{notice && <div className="palace-toast">{notice}</div>}</section>;
}

function BreathConsole() {
  const [mode, setMode] = useState<"continuity" | "profile" | "evidence">("continuity");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState("");
  const runPreview = () => {
    const output = mode === "continuity" ? "当前项目、Open Loops、近期事件、关系天气与 continuity cues。" : mode === "profile" ? "User / Self / Bond / Continuity 四块画像摘要。" : query.trim() ? `读取 ${query.trim()} 的直接、推导与上下文证据。` : "Evidence 模式需要输入 bucket_id 或画像条目。";
    setPreview(output);
  };
  return <section className="breath-console"><div className="console-intro"><h3>Breath 模拟</h3><p>预览智能体在新窗口或指定场景中会读取什么；只读，不修改记忆。</p></div><div className="breath-modes">{(["continuity", "profile", "evidence"] as const).map((item) => <button className={mode === item ? "selected" : ""} key={item} onClick={() => setMode(item)}>{item}</button>)}</div><label className="breath-query"><span>{mode === "evidence" ? "Bucket ID" : "缩窄查询（可选）"}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === "evidence" ? "例如 9ceb599a5848" : "例如 Ocean、关系或当前项目"} /></label><button className="breath-preview-button" onClick={runPreview}>生成读取预览</button>{preview && <article className="breath-preview"><header><span>{mode}</span><small>只读预览</small></header><p>{preview}</p><small>正式执行将由 Gateway 调用 Memory 3.0 MCP。</small></article>}</section>;
}

function RecallConsole() {
  const defaults = Object.fromEntries(recallSections.flatMap((section) => section.fields.map((field) => [field.id, field.value])));
  const [values, setValues] = usePersistentState<Record<string, string>>("ocean:memory-recall-draft:v2", defaults);
  const [selectedAction, setSelectedAction] = useState<"runtime" | "config" | null>(null);
  return <section className="recall-console"><div className="console-intro"><h3>记忆浮现</h3><p>控制 Recent Context、Persona、直命中与图扩散的召回行为。</p></div><ConfigAccordion sections={recallSections} values={values} onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))} /><div className="palace-config-actions"><button aria-pressed={selectedAction === "runtime"} onClick={() => setSelectedAction("runtime")}>应用运行时草稿</button><button aria-pressed={selectedAction === "config"} onClick={() => setSelectedAction("config")}>写入 config.yaml</button></div></section>;
}

function ImportConsole() {
  const [fileName, setFileName] = useState("");
  const [preserveOriginal, setPreserveOriginal] = useState(false);
  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => setFileName(event.target.files?.[0]?.name ?? "");
  const dropFile = (event: DragEvent<HTMLLabelElement>) => { event.preventDefault(); setFileName(event.dataTransfer.files?.[0]?.name ?? ""); };
  return <section className="import-console"><div className="console-intro"><h3>历史对话导入</h3><p>支持 Claude JSON、ChatGPT 导出、DeepSeek、Markdown 与纯文本。</p></div><label className="palace-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={dropFile}><input type="file" onChange={chooseFile} accept=".json,.md,.txt" /><span className="folder-shape" /><strong>{fileName || "拖拽文件到此处"}</strong><small>{fileName ? "已选择，等待后端解析" : "或点击选择"}</small></label><label className="palace-preserve"><input checked={preserveOriginal} onChange={(event) => setPreserveOriginal(event.target.checked)} type="checkbox" /><span>保留原文模式</span><small>特殊情境、暗号与仪式性内容不摘要</small></label><div className="palace-imported-heading"><h3>已导入记忆</h3><button>刷新</button></div><p className="palace-empty">尚未导入记忆。连接 Memory 3.0 后，这里会显示真实导入结果。</p><section className="palace-frequency"><h3>高频模式检测</h3><button>检测高频模式</button></section></section>;
}

function CandidateConsole() {
  const [items, setItems] = useState<MemoryCandidate[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
  const load = useCallback(() => {
    setState("loading");
    void new OceanGatewayClient().listMemoryCandidates<MemoryCandidate>().then((result) => {
      setItems(result.slice().reverse());
      setState("ready");
    }).catch(() => setState("error"));
  }, []);
  useEffect(load, [load]);
  const update = async (candidate: MemoryCandidate, action: "accept" | "dismiss") => {
    setNotice("");
    try {
      const updated = await new OceanGatewayClient().updateMemoryCandidate<MemoryCandidate>(candidate.id, action);
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice(action === "accept" ? "已写入 Memory 3.0" : "已忽略这条候选");
    } catch {
      setNotice(action === "accept" ? "尚未写入，请检查 Memory 3.0 连接" : "操作失败，请稍后再试");
    }
  };
  const pending = items.filter((item) => item.status === "candidate");
  return <section className="candidate-console"><div className="console-intro"><h3>记忆候选</h3><p>只审阅明确边界产生的候选；接纳后才写入长期记忆。</p></div><button className="candidate-refresh" onClick={load}>刷新</button>{state === "loading" ? <p className="candidate-empty">正在读取候选…</p> : state === "error" ? <p className="candidate-empty">暂时无法读取 Gateway 候选。</p> : pending.length === 0 ? <p className="candidate-empty">现在没有待审阅的候选。</p> : <div className="candidate-list">{pending.map((candidate) => <article key={candidate.id}><header><strong>{candidate.source.replace(/^event:/, "")}</strong><small>{new Date(candidate.createdAt).toLocaleString("zh-CN")}</small></header><p>{candidate.content}</p>{candidate.error && <small className="candidate-error">{candidate.error}</small>}<footer><button onClick={() => void update(candidate, "dismiss")}>忽略</button><button onClick={() => void update(candidate, "accept")}>接纳</button></footer></article>)}</div>}{notice && <div className="palace-toast">{notice}</div>}</section>;
}

function MemoryConsole() {
  const [tab, setTab] = useState<ConsoleTab>("recall");
  return <section className="palace-console-view"><nav className="palace-console-tabs"><button className={tab === "recall" ? "selected" : ""} onClick={() => setTab("recall")}>记忆浮现</button><button className={tab === "breath" ? "selected" : ""} onClick={() => setTab("breath")}>Breath</button><button className={tab === "candidates" ? "selected" : ""} onClick={() => setTab("candidates")}>候选</button><button className={tab === "import" ? "selected" : ""} onClick={() => setTab("import")}>历史导入</button></nav>{tab === "recall" ? <RecallConsole /> : tab === "breath" ? <BreathConsole /> : tab === "candidates" ? <CandidateConsole /> : <ImportConsole />}</section>;
}

export function PalaceRoom() {
  const [tab, setTab] = useState<PalaceTab>("memories");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<MemorySearchHit[] | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const executeSearch = useCallback((value: string) => {
    const query = value.trim();
    setSearch(query);
    setTab("memories");
    if (!query) { setSearchResults(null); setSearchState("idle"); return; }
    setSearchState("loading");
    void new OceanGatewayClient().searchMemory(query, 20).then((result) => {
      setSearchResults(result.results);
      setSearchState("ready");
    }).catch(() => {
      setSearchResults(null);
      setSearchState("error");
    });
  }, []);
  const runSearch = (event: FormEvent) => { event.preventDefault(); executeSearch(searchDraft); };
  const searchFromPortrait = useCallback((query: string) => { setSearchDraft(query); executeSearch(query); }, [executeSearch]);
  const changeSearch = (value: string) => {
    setSearchDraft(value);
    if (!value.trim()) { setSearch(""); setSearchResults(null); setSearchState("idle"); }
  };
  const content = useMemo(() => ({ memories: <MemoryBuckets search={search} searchResults={searchResults} searchState={searchState} />, daily: <DailyImpressions />, portrait: <PortraitView onSearch={searchFromPortrait} />, config: <MemoryConfiguration />, console: <MemoryConsole /> })[tab], [search, searchFromPortrait, searchResults, searchState, tab]);
  return <section className="palace-room palace-fidelity" aria-label="宫殿：Ocean Memory 3.0">
    <form className="memory-search" onSubmit={runSearch}><button aria-label="执行记忆搜索" type="submit"><img alt="" src={assetPath("assets/palace/search.svg")} /></button><input aria-label="搜索记忆" enterKeyHint="search" placeholder="搜索 Ocean Memory" value={searchDraft} onChange={(event) => changeSearch(event.target.value)} /></form>
    <nav className="palace-tabs" aria-label="记忆库区域">{tabs.map((item) => <button aria-label={item.label} className={tab === item.id ? "selected" : ""} key={item.id} onClick={() => setTab(item.id)}><i aria-hidden="true" className="palace-tab-icon" style={{ WebkitMaskImage: `url(${item.icon})`, maskImage: `url(${item.icon})` }} />{tab === item.id && <span>{item.label}</span>}</button>)}</nav>
    <div className="palace-content">{content}</div>
  </section>;
}
