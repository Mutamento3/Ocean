import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export type OceanSheetDetent = "compact" | "medium" | "tall";

interface OceanBottomSheetProps {
  children: ReactNode;
  className?: string;
  contentLength?: number;
  detent?: OceanSheetDetent | "auto";
  label: string;
  onClose: () => void;
  open: boolean;
}

function resolveDetent(detent: OceanBottomSheetProps["detent"], contentLength: number): OceanSheetDetent {
  if (detent && detent !== "auto") return detent;
  if (contentLength <= 180) return "compact";
  if (contentLength <= 700) return "medium";
  return "tall";
}

export function OceanBottomSheet({
  children,
  className = "",
  contentLength = 0,
  detent = "auto",
  label,
  onClose,
  open,
}: OceanBottomSheetProps) {
  if (!open) return null;
  const shell = document.querySelector(".ocean-shell");
  if (!shell) return null;

  const resolvedDetent = resolveDetent(detent, contentLength);

  return createPortal(
    <div className="ocean-sheet-layer" onClick={onClose} role="presentation">
      <section
        aria-label={label}
        aria-modal="true"
        className={`ocean-bottom-sheet detent-${resolvedDetent} ${className}`.trim()}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button aria-label={`收起${label}`} className="ocean-sheet-handle" onClick={onClose} />
        <div className="ocean-sheet-content">{children}</div>
      </section>
    </div>,
    shell,
  );
}
