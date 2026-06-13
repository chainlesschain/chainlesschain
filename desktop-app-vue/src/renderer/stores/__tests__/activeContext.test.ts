/**
 * activeContext store — the "currently visible document" that views publish so
 * the AI chat's "file" mode tracks what's on screen now (not the last-opened
 * file). Pure state logic; no IPC.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useActiveContextStore } from "../activeContext";

describe("activeContext store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts with no document", () => {
    const store = useActiveContextStore();
    expect(store.document).toBeNull();
    expect(store.hasDocument).toBe(false);
  });

  it("sets and clears the active document", () => {
    const store = useActiveContextStore();
    store.setActiveDocument({
      source: "project-file",
      name: "app.ts",
      path: "src/app.ts",
      content: "export const x = 1;",
    });
    expect(store.document?.name).toBe("app.ts");
    expect(store.document?.source).toBe("project-file");
    expect(store.hasDocument).toBe(true);

    store.clearActiveDocument();
    expect(store.document).toBeNull();
    expect(store.hasDocument).toBe(false);
  });

  it("hasDocument is false when content is empty or whitespace", () => {
    const store = useActiveContextStore();
    store.setActiveDocument({ source: "x", name: "empty.ts", content: "" });
    expect(store.hasDocument).toBe(false);
    store.setActiveDocument({ source: "x", name: "ws.ts", content: "   \n " });
    expect(store.hasDocument).toBe(false);
    store.setActiveDocument({ source: "x", name: "noContent.ts" });
    expect(store.hasDocument).toBe(false);
  });

  it("setActiveDocument(null) clears", () => {
    const store = useActiveContextStore();
    store.setActiveDocument({ source: "x", name: "a", content: "z" });
    store.setActiveDocument(null);
    expect(store.document).toBeNull();
  });
});
