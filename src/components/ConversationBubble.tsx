import type { HTMLAttributes, ReactNode } from "react";

export function ConversationBubble({
  children,
  className = "",
  leading,
  trailing,
  ...props
}: {
  children: ReactNode;
  className?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  return (
    <div {...props} className={`ocean-conversation-bubble ${className}`.trim()}>
      {leading}
      <span className="ocean-conversation-bubble-copy">{children}</span>
      {trailing}
    </div>
  );
}
