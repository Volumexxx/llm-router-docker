import { type ReactNode, useEffect } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ open, title, description, onClose, children }: ModalProps) {
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
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className="overlay-header">
          <div className="stack compact-stack">
            <p className="eyebrow">Trend View</p>
            <h3 id="modal-title">{title}</h3>
            {description ? <p className="muted overlay-description">{description}</p> : null}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            关闭
          </button>
        </header>

        <div className="overlay-body">{children}</div>
      </section>
    </div>
  );
}
