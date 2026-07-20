import { useState } from "react";
import { usePersistentState } from "../hooks/usePersistentState";
import type { MessageTurn } from "../domain/ocean";
import { syncOrQueue } from "../sync/gatewaySync";

export function ScopedConversation({ scope, label, firstPrompt }: { scope: string; label: string; firstPrompt: string }) {
  const [messages, setMessages] = usePersistentState<MessageTurn[]>(`ocean:chat:${scope}`, []);
  const [input, setInput] = useState("");
  const send = () => {
    const value = input.trim(); if (!value) return;
    const first = messages.length === 0;
    const nextMessages: MessageTurn[] = [...messages, { id: crypto.randomUUID(), role: "user", createdAt: "刚刚", segments: [value] }, { id: crypto.randomUUID(), role: "assistant", createdAt: "刚刚", segments: [first ? `${firstPrompt}（一次性模式上下文）` : `我继续留在「${label}」这个独立会话里。`] }];
    setMessages(nextMessages);
    void syncOrQueue("conversation", { id: scope, scope, messages: nextMessages });
    setInput("");
  };
  const visibleMessages = messages.slice(-4);
  return <section className="scoped-conversation" aria-label={`${label}独立会话`}><div className="scope-label"><span>{label}</span><small>{scope}</small></div><div className="scope-messages">{messages.length === 0 ? <p>这个会话还没有内容。</p> : visibleMessages.map((turn, index) => <div className={`scope-message ${turn.role} ${index > 0 && visibleMessages[index - 1].role === turn.role ? "same-speaker" : ""}`} key={turn.id}>{turn.segments.join("\n")}</div>)}</div><div className="scope-composer"><input aria-label={`${label}输入`} placeholder="继续这件事…" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }}/><button onClick={send}>➤</button></div></section>;
}
