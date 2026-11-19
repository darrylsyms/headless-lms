// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { useDrag } from "react-dnd";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { EditorDndProvider } from "./editor-dnd-provider";

function DragSource() {
  useDrag(() => ({ type: "test-block", item: {} }));
  return <div>Block</div>;
}

beforeAll(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => { document.body.innerHTML = ""; });

it("shares one backend across simultaneous editors and remounts", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<StrictMode><EditorDndProvider><DragSource /></EditorDndProvider><EditorDndProvider><DragSource /></EditorDndProvider></StrictMode>); });
  expect(container.textContent).toBe("BlockBlock");
  await act(async () => { root.render(<EditorDndProvider><DragSource /></EditorDndProvider>); });
  expect(container.textContent).toBe("Block");
  await act(async () => { root.unmount(); });
  expect(Reflect.get(window, Symbol.for("__REACT_DND_CONTEXT_INSTANCE__"))).toBeTruthy();
});
