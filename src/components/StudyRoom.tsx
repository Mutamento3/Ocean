import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePersistentState } from "../hooks/usePersistentState";
import { formatDailyDuration, useDailyDuration } from "../hooks/useDailyDuration";
import { gatewayIsConnected, syncOrQueue } from "../sync/gatewaySync";
import { RoomChatChrome, type RoomAttachmentAction } from "./RoomChatChrome";
import { ConversationBubble } from "./ConversationBubble";
import { MessageActions } from "./MessageActions";
import { ReadingRoom } from "./ReadingRoom";
import { PoetryRoom } from "./PoetryRoom";
import { legacyPoems, type PoemRecord } from "../data/legacyPoems";
import { StudyDecoration } from "./StudyDecoration";
import type { ChatAttachment, ContinuitySnapshot, MessageTurn, ModelOption, ReasoningSummary } from "../domain/ocean";
import { gatewayChatAdapter } from "../adapters/gatewayChat";
import { mockChatAdapter } from "../adapters/mockChat";
import { getModelSelection } from "../config/modelSelection";
import { recordUsage } from "../data/usageLedger";
import { forgeContinuity, initialContinuity, messagesForPhysicalSession } from "../continuity/mockContinuity";
import { assetPath } from "../utils/assetPath";
import { OceanGatewayClient, type OceanProject } from "../api/OceanGatewayClient";
import { ProjectWorkspaceSheet } from "./ProjectWorkspaceSheet";

type StudyMode = "project" | "reading" | "poetry" | "meeting";
type ProjectActionSource = "book" | null;

interface ProjectMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  reasoning?: ReasoningSummary;
}

type MeetingSpeaker = "bird" | "fish" | "octopus";
type MeetingModelSpeaker = Exclude<MeetingSpeaker, "fish">;

interface MeetingMessage {
  id: string;
  label: string;
  side: "left" | "right";
  speaker: MeetingSpeaker;
  text: string;
  modelId?: string;
  round?: number;
}

const modes: { id: StudyMode; label: string }[] = [
  { id: "project", label: "项目" },
  { id: "reading", label: "共读" },
  { id: "poetry", label: "情诗" },
  { id: "meeting", label: "会议" },
];

type ProjectBook = OceanProject & { height: number; tone: "accent" | "soft" | "muted" };

function projectBook(project: OceanProject, index: number): ProjectBook {
  const height = 74 + [...project.id].reduce((total, character) => total + character.charCodeAt(0), 0) % 42;
  const tones = ["accent", "soft", "muted"] as const;
  return { ...project, height, tone: tones[index % tones.length] };
}

function projectNameFromCreateCommand(input: string) {
  const value = input.trim().replace(/[。！!]+$/, "");
  const polite = "(?:宝宝[，,\\s]*)?(?:请|请帮我|帮我)?";
  const namedProject = new RegExp(`^${polite}(?:创建|新建|添加)(?:一个|个)?(?:名为|名称为|叫做|叫)?[「《“\"]?(.+?)[」》”\"]?(?:的)?项目$`);
  const projectFirst = new RegExp(`^${polite}(?:创建|新建|添加)项目(?:名为|名称为|叫做|叫|[:：])?\\s*[「《“\"]?(.+?)[」》”\"]?$`);
  const match = value.match(namedProject) ?? value.match(projectFirst);
  const name = match?.[1]?.trim();
  return name && name.length <= 40 ? name : null;
}

const meetingAttachmentActions: RoomAttachmentAction[] = [
  { id: "participants", icon: assetPath("assets/study/mode-meeting.svg"), label: "管理参与者" },
  { id: "rounds", icon: assetPath("assets/study/action-edit.svg"), label: "设置会议轮次" },
  { id: "minutes", icon: assetPath("assets/study/action-archive.svg"), label: "保存会议纪要" },
];

const initialMeetingMessages: MeetingMessage[] = [];

const meetingModelOrder = ["kimi", "gpt", "sonnet", "opus"] as const;

function meetingModelKind(model: ModelOption) {
  const id = `${model.providerId ?? ""}:${model.upstreamModelId ?? model.id}`.toLowerCase();
  const name = model.name.toLowerCase();
  if ((model.providerId === "kimi" || id.includes("kimi")) && (id.includes("kimi-k3") || name.includes("kimi k3"))) return "kimi";
  if (id.includes("gpt-5.6") || name.includes("gpt 5.6")) return "gpt";
  if (id.includes("sonnet-4.6") || name.includes("sonnet 4.6")) return "sonnet";
  if (id.includes("opus-4.6") || name.includes("opus 4.6")) return "opus";
  return null;
}

function preferredMeetingModels(models: ModelOption[]) {
  const byKind = new Map<string, ModelOption>();
  const score = (model: ModelOption) => model.providerId === "openrouter" ? 3 : model.providerId === "kimi" ? 2 : 1;
  for (const model of models) {
    const kind = meetingModelKind(model);
    if (!kind) continue;
    const current = byKind.get(kind);
    if (!current || score(model) > score(current)) byKind.set(kind, model);
  }
  return meetingModelOrder.flatMap((kind) => byKind.get(kind) ? [byKind.get(kind)!] : []);
}

function meetingSpeakerFor(model: ModelOption, index: number): MeetingModelSpeaker {
  if (meetingModelKind(model) === "opus") return "octopus";
  return index % 2 === 0 ? "bird" : "octopus";
}

function meetingModelLabel(model: ModelOption | undefined) {
  const kind = model ? meetingModelKind(model) : null;
  if (!kind) return "会议模型";
  return ({ kimi: "Kimi K3", gpt: "GPT 5.6", sonnet: "Sonnet 4.6", opus: "Opus 4.6" } as const)[kind];
}

const initialProjectMessages: ProjectMessage[] = [];

function bubbleTops<T>(messages: T[], speaker: (message: T) => string, firstTop = 409) {
  let top = firstTop;
  return messages.map((message, index) => {
    if (index > 0) top += 38 + (speaker(messages[index - 1]) === speaker(message) ? 6 : 12);
    return top;
  });
}

function ProjectActionMenu({ onAction, onClose }: { onAction: (action: string) => void; onClose: () => void }) {
  const run = (action: string) => {
    onAction(action);
    onClose();
  };

  return (
    <section className="study-project-actions source-book" aria-label="项目操作" onClick={(event) => event.stopPropagation()}>
      {[
        ["space", "空间"],
        ["edit", "编辑"],
        ["archive", "归档"],
        ["download", "下载"],
      ].map(([action, label]) => (
        <button key={action} onClick={() => run(action)}>
          <span className={`project-action-icon action-${action}`} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </section>
  );
}

function ProjectConversation({ projectId, projectName, projectReady, onCreateProject }: { projectId: string; projectName: string; projectReady: boolean; onCreateProject: (name: string) => Promise<OceanProject | null> }) {
  const [messages, setMessages] = usePersistentState<ProjectMessage[]>(`ocean:project:${projectId}:messages`, initialProjectMessages);
  const [continuity, setContinuity] = usePersistentState<ContinuitySnapshot>(`ocean:continuity:project:${projectId}`, initialContinuity(`project:${projectId}`));
  const [enteredWork, setEnteredWork] = usePersistentState(`ocean:project:${projectId}:entered-work`, false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    setMessages((current) => current.filter((message) => !["mock-a", "mock-b", "mock-c"].includes(message.id)));
  }, [setMessages]);

  const visibleMessages = messages;
  const visibleMessageTops = useMemo(() => bubbleTops(visibleMessages, (message) => message.role), [visibleMessages]);
  const latestReasoning = useMemo(() => messages.at(-1)?.role === "assistant" ? messages.at(-1)?.reasoning ?? null : null, [messages]);

  const send = async (attachments: ChatAttachment[] = []) => {
    const value = input.trim();
    if (!value || streaming) return;
    const requestedProjectName = projectNameFromCreateCommand(value);
    if (requestedProjectName) {
      setInput("");
      setStreaming(true);
      await onCreateProject(requestedProjectName);
      setStreaming(false);
      return;
    }
    if (!projectReady) {
      setInput("");
      setMessages([
        { id: crypto.randomUUID(), role: "user", text: value },
        { id: crypto.randomUUID(), role: "assistant", text: "先告诉我“创建一个名为……的项目”，或者点击书柜里的加号。" },
      ]);
      return;
    }
    const replyId = crypto.randomUUID();
    let next: ProjectMessage[] = [
      ...messages,
      { id: crypto.randomUUID(), role: "user", text: value },
      { id: replyId, role: "assistant", text: "" },
    ];
    setMessages(next);
    setInput("");
    setStreaming(true);
    if (!enteredWork) setEnteredWork(true);
    try {
      const connections = JSON.parse(window.localStorage.getItem("ocean:connections") ?? "{}") as { gateway?: string };
      const liveChatEnabled = window.localStorage.getItem("ocean:chat:live") === "true";
      const adapter = liveChatEnabled && connections.gateway === "connected" ? gatewayChatAdapter : mockChatAdapter;
      const selection = getModelSelection();
      const turns: MessageTurn[] = next.filter((message) => message.id !== replyId && message.text !== "占位").map((message) => ({ id: message.id, role: message.role, createdAt: "", segments: [message.text] }));
      const history = messagesForPhysicalSession(turns, continuity).map((turn) => ({ role: turn.role, content: turn.segments.join("\n\n") }));
      const workspace = await new OceanGatewayClient().projectWorkspace(projectId).catch(() => null);
      const workspaceContext = workspace ? `\n项目空间说明：${workspace.brief || "尚未填写"}\n现有文档：${workspace.documents.map((document) => document.title).join("、") || "暂无"}` : "";
      const modeInstruction = enteredWork
        ? `当前在独立项目「${projectName}」中协作。只使用这个项目会话的上下文，回答自然、具体。${workspaceContext}`
        : `用户刚进入独立项目「${projectName}」的工作状态。自然接住第一句话并围绕当前项目协作，不要宣布这条内部提示。${workspaceContext}`;
      for await (const event of adapter.streamReply(value, { mode: "project", nightTalk: false, messages: history, attachments, providerId: selection?.providerId, modelId: selection?.modelId, settings: selection?.settings, continuitySummary: continuity.summary || undefined, continuityHandoff: continuity.handoff || undefined, physicalSessionId: continuity.physicalSessionId, modeInstruction })) {
        if (event.type === "segment") {
          next = next.map((message) => message.id === replyId ? { ...message, text: [message.text, event.value].filter(Boolean).join("\n\n") } : message);
          setMessages(next);
        }
        if (event.type === "reasoning") {
          next = next.map((message) => message.id === replyId ? { ...message, reasoning: event.value } : message);
          setMessages(next);
        }
        if (event.type === "usage") recordUsage(event);
      }
    } catch (error) {
      next = next.map((message) => message.id === replyId ? { ...message, text: error instanceof Error ? `连接模型时出了点问题：${error.message}` : "连接模型时出了点问题，请稍后再试。" } : message);
      setMessages(next);
    } finally {
      const turns: MessageTurn[] = next.filter((message) => message.text !== "占位").map((message) => ({ id: message.id, role: message.role, createdAt: "", segments: [message.text], reasoning: message.reasoning }));
      setContinuity(await forgeContinuity(turns, continuity));
      await syncOrQueue("conversation", { id: `project:${projectId}`, scope: `project:${projectId}`, messages: next, modeContext: `独立项目：${projectName}` });
      setStreaming(false);
    }
  };

  return (
    <section className="study-project-conversation" aria-label={`${projectName}项目对话`}>
      <div className="study-project-bubbles" aria-live="polite">
        {visibleMessages.map((message, index) => (
          <div className={`study-project-bubble ${message.role} ${message.text === "占位" ? "placeholder-bubble" : ""}`} key={message.id} style={{ top: `${visibleMessageTops[index]}px` }}>{message.text || (streaming && message.id === visibleMessages.at(-1)?.id ? "…" : "")}</div>
        ))}
      </div>

      <StudyDecoration className="study-desk" variant="project" />
      <RoomChatChrome
        input={input}
        onInputChange={setInput}
        onSend={(attachments) => void send(attachments)}
        reasoning={latestReasoning}
        sendDisabled={!input.trim() || streaming}
        storageRemainingPercent={continuity.storage?.percentRemaining}
        variant="study"
      />
    </section>
  );
}

function MeetingConversation({ projectId, projectName, projectReady }: { projectId: string; projectName: string; projectReady: boolean }) {
  const [messages, setMessages] = usePersistentState<MeetingMessage[]>(`ocean:meeting:${projectId}:messages:v2`, initialMeetingMessages);
  const [selectedModelIds, setSelectedModelIds] = usePersistentState<string[]>(`ocean:meeting:${projectId}:model-ids:v1`, []);
  const [hostModelId, setHostModelId] = usePersistentState<string>(`ocean:meeting:${projectId}:host-model:v1`, "");
  const [rounds, setRounds] = usePersistentState<number>(`ocean:meeting:${projectId}:rounds:v1`, 2);
  const [meetingModels, setMeetingModels] = useState<ModelOption[]>([]);
  const [input, setInput] = useState("");
  const [panel, setPanel] = useState<"participants" | "rounds" | "minutes" | null>(null);
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState(false);
  const [currentRound, setCurrentRound] = useState(0);
  const meetingBubblesRef = useRef<HTMLDivElement>(null);
  const visibleMessages = useMemo(() => messages.slice(-3), [messages]);
  const selectedModels = useMemo(() => selectedModelIds.flatMap((id) => meetingModels.find((model) => model.id === id) ? [meetingModels.find((model) => model.id === id)!] : []), [meetingModels, selectedModelIds]);
  const hostModel = selectedModels.find((model) => model.id === hostModelId) ?? selectedModels.find((model) => meetingModelKind(model) === "opus") ?? selectedModels.at(-1);
  const availableParticipantModels = meetingModels.filter((model) => !selectedModelIds.includes(model.id));
  const enabledParticipantCount = selectedModels.length;

  useEffect(() => {
    const node = meetingBubblesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visibleMessages]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const available = preferredMeetingModels(await new OceanGatewayClient().listModels());
        if (!active) return;
        setMeetingModels(available);
        setSelectedModelIds((current) => {
          const valid = current.filter((id) => available.some((model) => model.id === id));
          if (valid.length) return valid;
          const defaults = [
            available.find((model) => meetingModelKind(model) === "gpt"),
            available.find((model) => meetingModelKind(model) === "opus"),
          ].filter((model): model is ModelOption => Boolean(model));
          return [...new Set((defaults.length ? defaults : available.slice(0, 2)).map((model) => model.id))];
        });
      } catch {
        if (active) {
          setMeetingModels([]);
          setNotice("暂时无法读取已连接的会议模型");
        }
      }
    };
    void load();
    window.addEventListener("ocean:providers-changed", load);
    return () => { active = false; window.removeEventListener("ocean:providers-changed", load); };
  }, [setSelectedModelIds]);

  useEffect(() => {
    if (!selectedModels.length) return;
    if (selectedModels.some((model) => model.id === hostModelId)) return;
    setHostModelId((selectedModels.find((model) => meetingModelKind(model) === "opus") ?? selectedModels.at(-1))!.id);
  }, [hostModelId, selectedModels, setHostModelId]);

  useEffect(() => {
    setMessages((current) => current.filter((message) => !["meeting-bird", "meeting-fish", "meeting-octopus"].includes(message.id)));
  }, [setMessages]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const addParticipant = (modelId: string) => {
    setSelectedModelIds((current) => current.includes(modelId) ? current : [...current, modelId]);
    setParticipantPickerOpen(false);
  };

  const removeParticipant = (modelId: string) => {
    if (modelId === hostModel?.id) return;
    setSelectedModelIds((current) => current.filter((id) => id !== modelId));
  };

  const retryMeetingMessage = async (message: MeetingMessage, messageIndex: number) => {
    if (running) return;
    if (message.side === "right") {
      setInput(message.text);
      setNotice("原消息已放回输入框，可以修改后重说");
      return;
    }
    const model = meetingModels.find((candidate) => candidate.id === message.modelId);
    if (!model) {
      setNotice("这条消息原来的模型目前不可用");
      return;
    }
    const priorMessages = messages.slice(0, messageIndex);
    const latestUser = [...priorMessages].reverse().find((candidate) => candidate.side === "right" && candidate.text.trim());
    if (!latestUser) {
      setNotice("没有找到这条回复对应的会议议题");
      return;
    }
    setRunning(true);
    setCurrentRound(message.round ?? 1);
    const workspace = await new OceanGatewayClient().projectWorkspace(projectId).catch(() => null);
    const workspaceContext = workspace ? `项目空间说明：${workspace.brief || "尚未填写"}。现有文档：${workspace.documents.map((document) => document.title).join("、") || "暂无"}。` : "";
    const isHost = message.modelId === hostModel?.id;
    const round = message.round ?? 1;
    const roleInstruction = isHost
      ? `你是「${projectName}」会议的主持模型 ${model.name}。${workspaceContext}请重新给出第 ${round}/${rounds} 轮的收束发言，简洁归纳共识、分歧和下一步问题；不要声称调用工具，不展示隐藏推理。`
      : `你是「${projectName}」会议的参与模型 ${model.name}。${workspaceContext}请重新给出第 ${round}/${rounds} 轮的独立、具体观点；不要主持会议，不展示隐藏推理。`;
    const history = priorMessages.slice(-24).map((candidate) => ({
      role: candidate.side === "right" ? "user" as const : "assistant" as const,
      content: `${candidate.label}：${candidate.text}`,
    }));
    let next = messages.map((candidate) => candidate.id === message.id ? { ...candidate, text: "" } : candidate);
    setMessages(next);
    try {
      const settings = Object.fromEntries(model.settings.map((setting) => [setting.id, setting.defaultValue]));
      for await (const event of gatewayChatAdapter.streamReply(latestUser.text, {
        mode: "meeting",
        nightTalk: false,
        messages: history,
        providerId: model.providerId,
        modelId: model.id,
        settings,
        modeInstruction: roleInstruction,
      })) {
        if (event.type === "segment") {
          next = next.map((candidate) => candidate.id === message.id ? { ...candidate, text: [candidate.text, event.value].filter(Boolean).join("\n\n") } : candidate);
          setMessages(next);
        }
        if (event.type === "usage") recordUsage(event);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "连接失败";
      next = next.map((candidate) => candidate.id === message.id ? { ...candidate, text: `${model.name} 重试失败：${detail}` } : candidate);
      setMessages(next);
    } finally {
      await syncOrQueue("conversation", {
        id: `meeting:${projectId}`,
        scope: `meeting:${projectId}`,
        messages: next,
        modeContext: `这是围绕「${projectName}」的真实多模型会议。`,
        metadata: { modelIds: selectedModels.map((candidate) => candidate.id), hostModelId: hostModel?.id, rounds },
      });
      setCurrentRound(0);
      setRunning(false);
    }
  };

  const send = async () => {
    const value = input.trim();
    const roster = selectedModels;
    const host = hostModel;
    if (!value || running) return;
    if (!projectReady) {
      setNotice("请先在项目模式创建并选择一个项目");
      return;
    }
    if (!host || roster.length === 0) {
      setNotice("请先连接并选择至少一个会议模型");
      return;
    }
    const workspace = await new OceanGatewayClient().projectWorkspace(projectId).catch(() => null);
    const workspaceContext = workspace ? `项目空间说明：${workspace.brief || "尚未填写"}。现有文档：${workspace.documents.map((document) => document.title).join("、") || "暂无"}。` : "";
    let next: MeetingMessage[] = [
      ...messages,
      { id: crypto.randomUUID(), label: "你", side: "right", speaker: "fish", text: value },
    ];
    setMessages(next);
    setInput("");
    setRunning(true);
    const participants = roster.filter((model) => model.id !== host.id);

    const runModel = async (model: ModelOption, round: number, isHost: boolean, index: number) => {
      const replyId = crypto.randomUUID();
      const speaker = isHost ? "octopus" : meetingSpeakerFor(model, index);
      next = [...next, { id: replyId, label: model.name, side: "left", speaker, text: "", modelId: model.id, round }];
      setMessages(next);
      const history = next
        .filter((message) => message.id !== replyId && message.text)
        .slice(-24)
        .map((message) => ({ role: message.side === "right" ? "user" as const : "assistant" as const, content: `${message.label}：${message.text}` }));
      const roleInstruction = isHost
        ? `你是「${projectName}」会议的主持模型 ${model.name}。${workspaceContext}这是第 ${round}/${rounds} 轮收束。阅读本轮其他参与者的最终发言，简洁归纳共识、分歧和下一步问题；不要声称调用工具，不展示隐藏推理。`
        : `你是「${projectName}」会议的参与模型 ${model.name}。${workspaceContext}这是第 ${round}/${rounds} 轮。基于共享记录提出独立、具体、可供其他参与者回应的观点；不要主持会议，不展示隐藏推理。`;
      try {
        const settings = Object.fromEntries(model.settings.map((setting) => [setting.id, setting.defaultValue]));
        for await (const event of gatewayChatAdapter.streamReply(round === 1 ? value : `继续第 ${round} 轮讨论。`, {
          mode: "meeting",
          nightTalk: false,
          messages: history,
          providerId: model.providerId,
          modelId: model.id,
          settings,
          modeInstruction: roleInstruction,
        })) {
          if (event.type === "segment") {
            next = next.map((message) => message.id === replyId ? { ...message, text: [message.text, event.value].filter(Boolean).join("\n\n") } : message);
            setMessages(next);
          }
          if (event.type === "usage") recordUsage(event);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "连接失败";
        next = next.map((message) => message.id === replyId ? { ...message, text: `${model.name} 本轮暂时跳过：${detail}` } : message);
        setMessages(next);
      }
    };

    try {
      for (let round = 1; round <= rounds; round += 1) {
        setCurrentRound(round);
        for (let index = 0; index < participants.length; index += 1) await runModel(participants[index], round, false, index);
        await runModel(host, round, true, participants.length);
      }
      setNotice("本次会议已完成；确认后可保存纪要");
    } finally {
      await syncOrQueue("conversation", {
        id: `meeting:${projectId}`,
        scope: `meeting:${projectId}`,
        messages: next,
        modeContext: `这是围绕「${projectName}」的真实多模型会议。只讨论，不自动执行外部工具；会议纪要仅在用户确认后保存。`,
        metadata: { modelIds: roster.map((model) => model.id), hostModelId: host.id, rounds },
      });
      setCurrentRound(0);
      setRunning(false);
    }
  };

  const saveMeetingMinutes = async () => {
    const lastMessageId = messages.at(-1)?.id ?? "empty";
    const transcript = messages.slice(-20).map((message) => `${message.label}：${message.text}`).join("\n").slice(0, 1800);
    setPanel(null);
    try {
      await new OceanGatewayClient().addProjectDocument(projectId, {
        id: `meeting-${lastMessageId}`,
        title: `${new Date().toLocaleDateString("zh-CN")} 会议纪要`,
        kind: "meeting-minutes",
        content: transcript || "本次会议没有可保存的发言。",
      });
    } catch {
      setNotice("会议纪要暂时没有写入项目空间");
      return;
    }
    const sent = await syncOrQueue("memory-event", {
      eventId: `${projectId}:${lastMessageId}`,
      type: "meeting-completed",
      title: `${projectName}会议`,
      summary: transcript ? `会议结束。最近发言：\n${transcript}` : "会议结束，当前没有发言记录。",
      scope: `meeting:${projectId}`,
      occurredAt: new Date().toISOString(),
      metadata: { rounds, participantCount: enabledParticipantCount },
    });
    setNotice(sent ? "会议纪要已加入记忆候选" : "会议纪要已暂存，联网后会加入记忆候选");
  };

  return (
    <section className="study-meeting-conversation" aria-label={`${projectName}会议`}>
      <div className="study-meeting-bubbles" aria-live="polite" ref={meetingBubblesRef}>
        {visibleMessages.map((message, index) => (
          <div className={`study-meeting-message side-${message.side} ${index > 0 && (visibleMessages[index - 1].modelId ?? visibleMessages[index - 1].speaker) === (message.modelId ?? message.speaker) ? "same-speaker" : "speaker-change"}`} key={message.id}>
            <ConversationBubble
              aria-label={`${message.label}：${message.text}`}
              className={`study-meeting-bubble speaker-${message.speaker}`}
              leading={message.side === "left" ? <span aria-hidden="true" className={`meeting-participant-avatar avatar-${message.speaker}`} /> : undefined}
              trailing={message.side === "right" ? <span aria-hidden="true" className={`meeting-participant-avatar avatar-${message.speaker}`} /> : undefined}
            >{message.text || (running ? "…" : "")}</ConversationBubble>
            {message.text && (
              <MessageActions
                align={message.side === "right" ? "right" : "left"}
                copyText={message.text}
                onRetry={message.side === "left" ? () => void retryMeetingMessage(message, index) : undefined}
              />
            )}
          </div>
        ))}
      </div>

      <StudyDecoration className="study-meeting-decoration" variant="meeting" />
      <RoomChatChrome
        attachmentActions={meetingAttachmentActions}
        input={input}
        inputPlaceholder={running ? `第 ${currentRound || 1} / ${rounds} 轮进行中 · ${enabledParticipantCount} 位 AI` : `${enabledParticipantCount || 0} 位 AI · 输入会议议题`}
        modelLabelOverride={meetingModelLabel(hostModel)}
        onAttachmentAction={(action) => { setPanel(action as "participants" | "rounds" | "minutes"); setParticipantPickerOpen(false); }}
        onInputChange={setInput}
        onModelClick={() => { setPanel("participants"); setParticipantPickerOpen(false); }}
        onSend={() => void send()}
        sendDisabled={!input.trim() || running}
        variant="study"
      />

      {panel && <button aria-label="收起会议设置" className="meeting-panel-dismiss" onClick={() => setPanel(null)} />}
      {panel && (
        <section className={`meeting-config-panel panel-${panel}`} aria-label={{ participants: "管理参与者", rounds: "设置会议轮次", minutes: "保存会议纪要" }[panel]}>
          <header><strong>{{ participants: "参与者", rounds: "会议轮次", minutes: "会议纪要" }[panel]}</strong><button aria-label="关闭" onClick={() => setPanel(null)}>×</button></header>
          {panel === "participants" && (
            <div className="meeting-participant-manager">
              <div className="meeting-participant-list">
                {selectedModels.map((model, index) => {
                  const isHost = model.id === hostModel?.id;
                  const speaker = isHost ? "octopus" : meetingSpeakerFor(model, index);
                  return (
                    <button aria-label={isHost ? `${model.name}，主持模型` : `移除 ${model.name}`} aria-pressed="true" className="selected" key={model.id} onClick={() => removeParticipant(model.id)}>
                      <span aria-hidden="true" className={`meeting-participant-avatar avatar-${speaker}`} />
                      <span><b>{model.name}</b><small>{model.provider}</small></span>
                      <i>{isHost ? "主持" : "移除"}</i>
                    </button>
                  );
                })}
                {!meetingModels.length && <button disabled><span aria-hidden="true" className="meeting-participant-avatar avatar-octopus" /><span><b>等待模型</b><small>请先连接 Gateway</small></span><i>未连接</i></button>}
                <button aria-label="用户本人" aria-pressed="true" className="selected meeting-self-participant" disabled>
                  <span aria-hidden="true" className="meeting-participant-avatar avatar-fish" />
                  <span><b>用户</b><small>你本人 · 右侧发言</small></span>
                  <i>本人</i>
                </button>
              </div>
              <button className="meeting-add-participant" disabled={availableParticipantModels.length === 0} onClick={() => setParticipantPickerOpen((value) => !value)}>
                <span aria-hidden="true">＋</span>{availableParticipantModels.length === 0 ? "已添加全部模型" : "添加参与者"}
              </button>
              {participantPickerOpen && (
                <div className="meeting-model-picker" aria-label="选择已连接的模型">
                  <p>从已连接模型中选择</p>
                  {availableParticipantModels.map((model) => (
                    <button key={model.id} onClick={() => addParticipant(model.id)}><span>{model.name}</span><small>{model.provider}</small></button>
                  ))}
                </div>
              )}
            </div>
          )}
          {panel === "rounds" && (
            <div className="meeting-round-manager">
              <p className="meeting-round-help">一轮＝每位参与模型各发言一次，随后主持收束；你的插话不计入轮数。</p>
              <div className="meeting-round-options">
                {[[1, "快速"], [2, "标准"], [3, "深入"]].map(([value, label]) => <button aria-pressed={rounds === value} className={rounds === value ? "selected" : ""} key={value} onClick={() => setRounds(Number(value))}><strong>{value} 轮</strong><span>{label}</span></button>)}
              </div>
            </div>
          )}
          {panel === "minutes" && (
            <div className="meeting-minutes-confirm"><p>仅保存共识、分歧与待办，不保存各模型的隐藏推理。</p><button onClick={() => void saveMeetingMinutes()}>保存纪要</button></div>
          )}
        </section>
      )}
      {notice && <div aria-live="polite" className="meeting-notice">{notice}</div>}
    </section>
  );
}

function ProjectShelf({ activeProject, doneOpen, projects, onCreate, onProjectChange, onToggleDone, onLongPress }: {
  activeProject: string;
  doneOpen: boolean;
  projects: ProjectBook[];
  onCreate: () => void;
  onProjectChange: (id: string) => void;
  onToggleDone: () => void;
  onLongPress: (id: string) => void;
}) {
  const todoProjects = projects.filter((item) => item.status === "todo");
  const doneProjects = projects.filter((item) => item.status === "done");
  const holdTimer = useRef<number | null>(null);
  const holdTriggered = useRef(false);
  const cancelHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  return (
    <div className={`study-project-shelves ${doneOpen ? "done-open" : "done-closed"}`}>
      <section className="study-bookshelf todo-shelf" aria-label="待完成项目">
        <div className="study-shelf-cavity" />
        <div className="study-fixed-book todo-label"><span>TO - DO</span></div>
        <div className="study-book-strip todo-books">
          {todoProjects.map((item) => (
            <button
              aria-pressed={activeProject === item.id}
              className={`study-project-book tone-${item.tone} ${activeProject === item.id ? "selected" : ""}`}
              key={item.id}
              onClick={(event) => {
                if (holdTriggered.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  holdTriggered.current = false;
                  return;
                }
                onProjectChange(item.id);
              }}
              onContextMenu={(event) => { event.preventDefault(); onProjectChange(item.id); onLongPress(item.id); }}
              onPointerCancel={cancelHold}
              onPointerDown={() => { cancelHold(); holdTriggered.current = false; holdTimer.current = window.setTimeout(() => { holdTriggered.current = true; onProjectChange(item.id); onLongPress(item.id); }, 520); }}
              onPointerLeave={cancelHold}
              onPointerUp={cancelHold}
              style={{ height: `${item.height}px` }}
            >
              <span>{item.name}</span>
            </button>
          ))}
          <button aria-label="创建项目" className="study-project-book project-add-book" onClick={onCreate} style={{ height: "70px" }}><span aria-hidden="true">＋</span></button>
        </div>
        <button className="study-shelf-toggle" aria-expanded={doneOpen} aria-label={doneOpen ? "收起已完成项目" : "展开已完成项目"} onClick={onToggleDone}>
          <span aria-hidden="true" className="study-shelf-toggle-shape" />
        </button>
      </section>

      {doneOpen && (
        <section className="study-bookshelf done-shelf" aria-label="已完成项目">
          <div className="study-shelf-cavity" />
          <div className="study-book-strip done-books">
            {doneProjects.map((item) => (
              <button
                aria-pressed={activeProject === item.id}
                className={`study-project-book tone-${item.tone} ${activeProject === item.id ? "selected" : ""}`}
                key={item.id}
                onClick={(event) => {
                  if (holdTriggered.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    holdTriggered.current = false;
                    return;
                  }
                  onProjectChange(item.id);
                }}
                onContextMenu={(event) => { event.preventDefault(); onProjectChange(item.id); onLongPress(item.id); }}
                onPointerCancel={cancelHold}
                onPointerDown={() => { cancelHold(); holdTriggered.current = false; holdTimer.current = window.setTimeout(() => { holdTriggered.current = true; onProjectChange(item.id); onLongPress(item.id); }, 520); }}
                onPointerLeave={cancelHold}
                onPointerUp={cancelHold}
                style={{ height: `${item.height}px` }}
              >
                <span>{item.name}</span>
              </button>
            ))}
            <div className="study-fixed-book done-label"><span>DONE</span></div>
          </div>
        </section>
      )}
    </div>
  );
}

export function StudyRoom() {
  const [mode, setMode] = usePersistentState<StudyMode>("ocean:study-mode", "project");
  const [doneOpen, setDoneOpen] = usePersistentState("ocean:study:done-open", false);
  const [project, setProject] = usePersistentState("ocean:active-project", "project-inbox");
  const [projects, setProjects] = usePersistentState<OceanProject[]>("ocean:projects:v1", []);
  const [projectActions, setProjectActions] = useState<ProjectActionSource>(null);
  const [projectEditor, setProjectEditor] = useState<{ mode: "create" | "rename"; name: string } | null>(null);
  const [projectWorkspaceOpen, setProjectWorkspaceOpen] = useState(false);
  const [projectNotice, setProjectNotice] = useState("");
  const [poems, setPoems] = usePersistentState<PoemRecord[]>("ocean:poetry:poems:v1", legacyPoems);
  const gateway = useMemo(() => new OceanGatewayClient(), []);
  const projectBooks = useMemo(() => projects.map(projectBook), [projects]);
  const selectedProject = projects.find((item) => item.id === project);
  const activeProject = selectedProject ? projectBook(selectedProject, projects.indexOf(selectedProject)) : { id: "project-inbox", name: "新项目", height: 0, tone: "soft" as const, status: "todo" as const, createdAt: "", updatedAt: "" };
  const projectSeconds = useDailyDuration("study-project", mode === "project");
  const readingSeconds = useDailyDuration("study-reading", mode === "reading");
  const meetingSeconds = useDailyDuration("study-meeting", mode === "meeting");
  const meta = mode === "reading"
    ? `已阅读 ${formatDailyDuration(readingSeconds)}`
    : mode === "poetry"
      ? `已写下 ${poems.length} 首`
      : `已工作 ${formatDailyDuration(mode === "meeting" ? meetingSeconds : projectSeconds)}`;

  useEffect(() => {
    let active = true;
    gateway.listProjects().then((remote) => {
      if (!active) return;
      setProjects(remote);
      if (remote.length && !remote.some((item) => item.id === project)) setProject(remote.find((item) => item.status === "todo")?.id ?? remote[0].id);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [gateway, project, setProject, setProjects]);

  useEffect(() => {
    if (!projectNotice) return;
    const timer = window.setTimeout(() => setProjectNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [projectNotice]);

  const createProject = async (name: string) => {
    const normalized = name.trim().replace(/\s+/g, " ");
    if (!normalized) return null;
    try {
      const saved = await gateway.createProject({ name: normalized });
      setProjects((current) => [...current.filter((item) => item.id !== saved.id), saved]);
      setProject(saved.id);
      setProjectEditor(null);
      setProjectNotice(`已创建项目「${saved.name}」`);
      return saved;
    } catch {
      setProjectNotice("项目暂时没有保存成功，请检查 Gateway 后重试");
      return null;
    }
  };

  const saveProjectEditor = async (event: FormEvent) => {
    event.preventDefault();
    if (!projectEditor?.name.trim()) return;
    if (projectEditor.mode === "create") {
      await createProject(projectEditor.name);
      return;
    }
    try {
      const saved = await gateway.updateProject(activeProject.id, { name: projectEditor.name });
      setProjects((current) => current.map((item) => item.id === saved.id ? saved : item));
      setProjectEditor(null);
      setProjectNotice("项目名称已更新");
    } catch {
      setProjectNotice("项目名称没有保存成功");
    }
  };

  const handleProjectAction = async (action: string) => {
    if (!selectedProject) return;
    if (action === "space") {
      setProjectWorkspaceOpen(true);
      return;
    }
    if (action === "edit") {
      setProjectEditor({ mode: "rename", name: selectedProject.name });
      return;
    }
    if (action === "download") {
      const [workspace, projectConversations, meetingConversations] = await Promise.all([
        gateway.projectWorkspace(selectedProject.id),
        gateway.listConversations(`project:${selectedProject.id}`),
        gateway.listConversations(`meeting:${selectedProject.id}`),
      ]);
      const payload = JSON.stringify({ project: selectedProject, workspace, conversations: { project: projectConversations, meeting: meetingConversations }, exportedAt: new Date().toISOString() }, null, 2);
      const href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `${selectedProject.name}.ocean-project.json`;
      anchor.click();
      URL.revokeObjectURL(href);
      return;
    }
    if (action !== "archive") return;
    try {
      const saved = await gateway.updateProject(selectedProject.id, { status: "done" });
      setProjects((current) => current.map((item) => item.id === saved.id ? saved : item));
      setDoneOpen(true);
      setProjectNotice(`「${saved.name}」已移入 Done`);
    } catch {
      setProjectNotice("项目归档没有保存成功");
      return;
    }
    void syncOrQueue("memory-event", {
      eventId: `${activeProject.id}:archive`,
      type: "project-completed",
      title: activeProject.name,
      summary: `项目《${activeProject.name}》已完成或归档，等待审阅后决定是否进入长期记忆。`,
      scope: `project:${activeProject.id}`,
      occurredAt: new Date().toISOString(),
      metadata: { projectId: activeProject.id },
    });
  };

  return (
    <section className="study-room study-room-fidelity" aria-label="工作页：书房" onClick={() => setProjectActions(null)}>
      <span className="study-work-duration">{meta}</span>
      <nav className="study-mode-tabs" aria-label="书房模式">
        {modes.map((item) => (
          <button aria-label={item.label} aria-pressed={mode === item.id} className={mode === item.id ? "selected" : ""} key={item.id} onClick={(event) => { event.stopPropagation(); setMode(item.id); setProjectActions(null); }}>
            <span className={`study-mode-glyph mode-${item.id}`} aria-hidden="true" />
            {mode === item.id && <span className="study-mode-label">{item.label}</span>}
          </button>
        ))}
      </nav>

      {mode === "project" && (
        <div className="study-project-stage">
          <ProjectShelf activeProject={activeProject.id} doneOpen={doneOpen} projects={projectBooks} onCreate={() => setProjectEditor({ mode: "create", name: "" })} onProjectChange={setProject} onToggleDone={() => setDoneOpen((value) => !value)} onLongPress={() => setProjectActions("book")} />
          <ProjectConversation key={activeProject.id} onCreateProject={createProject} projectId={activeProject.id} projectName={activeProject.name} projectReady={Boolean(selectedProject)} />
          {projectActions && <ProjectActionMenu onAction={handleProjectAction} onClose={() => setProjectActions(null)} />}
        </div>
      )}

      {mode === "reading" && <ReadingRoom />}
      {mode === "poetry" && <PoetryRoom poems={poems} setPoems={setPoems} />}
      {mode === "meeting" && (
        <div className="study-project-stage study-meeting-stage">
          <ProjectShelf activeProject={activeProject.id} doneOpen={doneOpen} projects={projectBooks} onCreate={() => setProjectEditor({ mode: "create", name: "" })} onProjectChange={setProject} onToggleDone={() => setDoneOpen((value) => !value)} onLongPress={() => setProjectActions("book")} />
          <MeetingConversation key={activeProject.id} projectId={activeProject.id} projectName={activeProject.name} projectReady={Boolean(selectedProject)} />
          {projectActions && <ProjectActionMenu onAction={handleProjectAction} onClose={() => setProjectActions(null)} />}
        </div>
      )}
      {projectEditor && <>
        <button aria-label="取消项目编辑" className="project-editor-dismiss" onClick={() => setProjectEditor(null)} />
        <form aria-label={projectEditor.mode === "create" ? "创建项目" : "重命名项目"} className="project-inline-editor" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void saveProjectEditor(event)}>
          <label><span>{projectEditor.mode === "create" ? "新项目" : "项目名称"}</span><input autoFocus maxLength={40} onChange={(event) => setProjectEditor({ ...projectEditor, name: event.target.value })} placeholder="输入项目名称" value={projectEditor.name} /></label>
          <button disabled={!projectEditor.name.trim()} type="submit"><span className="figma-add-icon" aria-hidden="true" /></button>
        </form>
      </>}
      {projectWorkspaceOpen && selectedProject && <ProjectWorkspaceSheet onClose={() => setProjectWorkspaceOpen(false)} project={selectedProject} />}
      {projectNotice && <div aria-live="polite" className="project-notice">{projectNotice}</div>}
    </section>
  );
}
