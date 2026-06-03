/**
 * useDesignStore — Pinia store unit tests
 *
 * Focused on the rich pure-logic surface (no IPC):
 *  - Initial state shape
 *  - Getters: hasSelection / canUndo / canRedo / singleSelection
 *  - History: addToHistory (push + clear redo + 50-cap) / undo / redo / clearHistory
 *  - Selection + tool/color setters
 *  - setZoom (clamp 10–400) / toggleGrid
 *  - Clipboard: copySelection / pasteFromClipboard (+20 offset)
 *  - reset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// design.ts only imports electronAPI from ../utils/ipc — stub it (no IPC exercised here).
vi.mock("../utils/ipc", () => ({ electronAPI: { invoke: vi.fn() } }));

import { useDesignStore } from "../design";
import type { DesignObject, HistoryAction } from "../design";

function makeObject(overrides: Partial<DesignObject> = {}): DesignObject {
  return { id: "obj-1", type: "rect", left: 10, top: 20, ...overrides };
}

function makeAction(overrides: Partial<HistoryAction> = {}): HistoryAction {
  return { type: "move", timestamp: 1700000000000, data: {}, ...overrides };
}

describe("useDesignStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("has empty selection, default tool, empty history and default canvas settings", () => {
      const store = useDesignStore();
      expect(store.currentProject).toBeNull();
      expect(store.selectedObjects).toEqual([]);
      expect(store.activeTool).toBe("select");
      expect(store.clipboard).toEqual([]);
      expect(store.history).toEqual({ undoStack: [], redoStack: [] });
      expect(store.zoom).toBe(100);
      expect(store.showGrid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("hasSelection reflects selection length", () => {
      const store = useDesignStore();
      expect(store.hasSelection).toBe(false);
      store.setSelectedObjects([makeObject()]);
      expect(store.hasSelection).toBe(true);
    });

    it("singleSelection is the object only when exactly one is selected", () => {
      const store = useDesignStore();
      expect(store.singleSelection).toBeNull();
      store.setSelectedObjects([makeObject({ id: "a" })]);
      expect(store.singleSelection?.id).toBe("a");
      store.setSelectedObjects([
        makeObject({ id: "a" }),
        makeObject({ id: "b" }),
      ]);
      expect(store.singleSelection).toBeNull();
    });

    it("canUndo / canRedo reflect the respective stacks", () => {
      const store = useDesignStore();
      expect(store.canUndo).toBe(false);
      expect(store.canRedo).toBe(false);
      store.addToHistory(makeAction());
      expect(store.canUndo).toBe(true);
      store.undo();
      expect(store.canUndo).toBe(false);
      expect(store.canRedo).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  describe("history (undo / redo)", () => {
    it("addToHistory pushes to undoStack and clears redoStack", () => {
      const store = useDesignStore();
      // seed a redo entry, then a new action must clear it
      store.addToHistory(makeAction({ type: "a" }));
      store.undo(); // moves to redoStack
      expect(store.history.redoStack).toHaveLength(1);
      store.addToHistory(makeAction({ type: "b" }));
      expect(store.history.undoStack.map((x) => x.type)).toEqual(["b"]);
      expect(store.history.redoStack).toEqual([]);
    });

    it("caps the undo stack at 50, dropping the oldest", () => {
      const store = useDesignStore();
      for (let i = 0; i < 51; i++) {
        store.addToHistory(makeAction({ type: `a${i}` }));
      }
      expect(store.history.undoStack).toHaveLength(50);
      expect(store.history.undoStack[0].type).toBe("a1"); // a0 shifted out
      expect(store.history.undoStack[49].type).toBe("a50");
    });

    it("undo pops undo→redo and returns the action; null when empty", () => {
      const store = useDesignStore();
      expect(store.undo()).toBeNull();
      store.addToHistory(makeAction({ type: "x" }));
      const action = store.undo();
      expect(action?.type).toBe("x");
      expect(store.history.undoStack).toEqual([]);
      expect(store.history.redoStack.map((a) => a.type)).toEqual(["x"]);
    });

    it("redo pops redo→undo and returns the action; null when empty", () => {
      const store = useDesignStore();
      expect(store.redo()).toBeNull();
      store.addToHistory(makeAction({ type: "x" }));
      store.undo();
      const action = store.redo();
      expect(action?.type).toBe("x");
      expect(store.history.undoStack.map((a) => a.type)).toEqual(["x"]);
      expect(store.history.redoStack).toEqual([]);
    });

    it("clearHistory empties both stacks", () => {
      const store = useDesignStore();
      store.addToHistory(makeAction());
      store.undo();
      store.clearHistory();
      expect(store.history).toEqual({ undoStack: [], redoStack: [] });
    });
  });

  // -------------------------------------------------------------------------
  // Selection + setters
  // -------------------------------------------------------------------------

  describe("selection + tool / color setters", () => {
    it("setActiveTool / setSelectedObjects update state", () => {
      const store = useDesignStore();
      store.setActiveTool("circle");
      expect(store.activeTool).toBe("circle");
      const objs = [makeObject()];
      store.setSelectedObjects(objs);
      expect(store.selectedObjects).toEqual(objs);
    });

    it("color + stroke-width setters update design state", () => {
      const store = useDesignStore();
      store.setFillColor("#ff0000");
      store.setStrokeColor("#00ff00");
      store.setStrokeWidth(4);
      expect(store.currentFillColor).toBe("#ff0000");
      expect(store.currentStrokeColor).toBe("#00ff00");
      expect(store.currentStrokeWidth).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // Zoom / grid
  // -------------------------------------------------------------------------

  describe("setZoom + toggleGrid", () => {
    it("setZoom clamps to [10, 400]", () => {
      const store = useDesignStore();
      store.setZoom(150);
      expect(store.zoom).toBe(150);
      store.setZoom(5);
      expect(store.zoom).toBe(10);
      store.setZoom(500);
      expect(store.zoom).toBe(400);
    });

    it("toggleGrid flips showGrid", () => {
      const store = useDesignStore();
      const initial = store.showGrid;
      store.toggleGrid();
      expect(store.showGrid).toBe(!initial);
    });
  });

  // -------------------------------------------------------------------------
  // Clipboard
  // -------------------------------------------------------------------------

  describe("clipboard", () => {
    it("copySelection snapshots the current selection", () => {
      const store = useDesignStore();
      store.setSelectedObjects([
        makeObject({ id: "a" }),
        makeObject({ id: "b" }),
      ]);
      store.copySelection();
      expect(store.clipboard.map((o) => o.id)).toEqual(["a", "b"]);
    });

    it("pasteFromClipboard returns copies offset by +20 without mutating originals", () => {
      const store = useDesignStore();
      store.setSelectedObjects([makeObject({ id: "a", left: 10, top: 20 })]);
      store.copySelection();
      const pasted = store.pasteFromClipboard();
      expect(pasted[0]).toMatchObject({ id: "a", left: 30, top: 40 });
      // originals untouched
      expect(store.clipboard[0]).toMatchObject({ left: 10, top: 20 });
    });

    it("pasteFromClipboard treats missing left/top as 0", () => {
      const store = useDesignStore();
      store.setSelectedObjects([
        makeObject({ id: "a", left: undefined, top: undefined }),
      ]);
      store.copySelection();
      const pasted = store.pasteFromClipboard();
      expect(pasted[0]).toMatchObject({ left: 20, top: 20 });
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset", () => {
    it("restores selection, tool, clipboard and history to defaults", () => {
      const store = useDesignStore();
      store.setSelectedObjects([makeObject()]);
      store.setActiveTool("text");
      store.copySelection();
      store.addToHistory(makeAction());
      store.reset();
      expect(store.selectedObjects).toEqual([]);
      expect(store.activeTool).toBe("select");
      expect(store.clipboard).toEqual([]);
      expect(store.history).toEqual({ undoStack: [], redoStack: [] });
      expect(store.currentProject).toBeNull();
    });
  });
});
