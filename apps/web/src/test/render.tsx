import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface RenderResult {
  container: HTMLDivElement;
  rerender: (ui: ReactElement) => Promise<void>;
  unmount: () => Promise<void>;
}

export async function render(ui: ReactElement): Promise<RenderResult> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(ui);
  });

  return {
    container,
    rerender: async (nextUi) => {
      await act(async () => {
        root.render(nextUi);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  };
}

export async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export function getButtonByText(container: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }

  return button;
}

export function getButtonsByText(container: ParentNode, text: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button")).filter(
    (candidate): candidate is HTMLButtonElement =>
      candidate instanceof HTMLButtonElement && candidate.textContent?.trim() === text
  );
}
