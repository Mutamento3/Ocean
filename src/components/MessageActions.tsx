import { useState } from "react";

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function CopyIcon() {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><rect height="12" rx="2.5" stroke="currentColor" strokeWidth="1.5" width="12" x="8" y="8"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5"/></svg>;
}

function RetryIcon() {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M19 8V4m0 0h-4m4 0-3.1 3.1A7 7 0 1 0 19 13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"/></svg>;
}

export function MessageActions({
  align = "left",
  copyText,
  retryLabel = "重新生成",
  onRetry,
}: {
  align?: "left" | "right";
  copyText: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyToClipboard(copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_200);
  };
  return (
    <div className={`ocean-message-actions align-${align}`}>
      <button aria-label={copied ? "已复制" : "复制消息"} onClick={() => void copy()} title={copied ? "已复制" : "复制"} type="button">
        <CopyIcon />
      </button>
      {onRetry && <button aria-label={retryLabel} onClick={onRetry} title={retryLabel} type="button"><RetryIcon /></button>}
    </div>
  );
}
