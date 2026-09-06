import { useEffect, type ReactNode } from "react";

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[500] grid place-items-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`w-full ${width} max-h-[88vh] overflow-y-auto rounded-2xl bg-panel border border-line shadow-panel`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between bg-panel-2 border-b border-line px-5 py-3">
          <h2 className="u-display text-lg text-ink">{title}</h2>
          <button
            className="h-8 w-8 grid place-items-center rounded-md text-muted hover:text-ink hover:bg-panel-3 transition"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 text-sm text-ink"
    >
      <span
        className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-accent" : "bg-panel-3 border border-line"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-header transition ${checked ? "left-[22px]" : "left-0.5"}`}
        />
      </span>
      {label}
    </button>
  );
}
