type MiniSwitchProps = {
  selected: boolean;
  onChange: () => void;
  enabledLabel: string;
  disabledLabel: string;
  className?: string;
};

export function MiniSwitch({ selected, onChange, enabledLabel, disabledLabel, className = "" }: MiniSwitchProps) {
  return (
    <button
      aria-label={selected ? disabledLabel : enabledLabel}
      aria-pressed={selected}
      className={`mini-switch ${selected ? "selected" : ""} ${className}`.trim()}
      onClick={onChange}
      type="button"
    >
      <span aria-hidden="true" className="mini-switch-thumb" />
    </button>
  );
}
