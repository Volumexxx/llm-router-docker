import { type ReactNode, useEffect } from "react";

interface DrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  size?: "default" | "wide" | "xl";
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({
  open,
  title,
  subtitle,
  size = "default",
  onClose,
  children
}: DrawerProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="overlay-shell" role="presentation">
      <div className="overlay-backdrop" onClick={onClose} />
      <aside
        className={`drawer-panel drawer-panel-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <header className="overlay-header">
          <div className="stack compact-stack">
            <p className="eyebrow">Detail Workspace</p>
            <h3 id="drawer-title">{title}</h3>
            {subtitle ? <p className="muted overlay-description">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            关闭
          </button>
        </header>

        <div className="overlay-body">{children}</div>
      </aside>
    </div>
  );
}
