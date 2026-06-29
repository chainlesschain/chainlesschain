import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useVideoEditingStore } from "../videoEditing";

const onEvent = vi.fn();
const edit = vi.fn();
const cancel = vi.fn();
const assetsList = vi.fn();
const unsubscribe = vi.fn();

function setApi(present = true) {
  (
    window as unknown as { electronAPI: { videoEditing?: unknown } }
  ).electronAPI = present
    ? { videoEditing: { onEvent, edit, cancel, assetsList } }
    : ({} as { videoEditing?: unknown });
}

beforeEach(() => {
  setActivePinia(createPinia());
  onEvent.mockReset();
  edit.mockReset();
  cancel.mockReset();
  assetsList.mockReset();
  unsubscribe.mockReset();
  onEvent.mockReturnValue(unsubscribe);
  setApi(true);
});

describe("useVideoEditingStore", () => {
  it("initial state + getters", () => {
    const store = useVideoEditingStore();
    expect(store.phase).toBe("idle");
    expect(store.isRunning).toBe(false);
    expect(store.totalShots).toBe(0);
    expect(store.eventLog).toEqual([]);
  });

  it("isRunning true for in-flight phase", () => {
    const store = useVideoEditingStore();
    store.phase = "assemble";
    expect(store.isRunning).toBe(true);
  });

  it("subscribeEvents registers callback + handles phase events", () => {
    const store = useVideoEditingStore();
    store.subscribeEvents();
    expect(onEvent).toHaveBeenCalledTimes(1);
    const cb = onEvent.mock.calls[0][0] as (
      ev: Record<string, unknown>,
    ) => void;

    cb({ type: "phase.start", phase: "plan", ts: 1 });
    expect(store.phase).toBe("plan");

    cb({ type: "phase.progress", pct: 42, message: "working", ts: 2 });
    expect(store.progress).toBe(42);
    expect(store.progressMessage).toBe("working");

    cb({ type: "phase.end", phase: "render", ts: 3 });
    expect(store.phase).toBe("done");
    expect(store.events).toHaveLength(3);
  });

  it("unsubscribeEvents calls + clears the unsubscribe fn", () => {
    const store = useVideoEditingStore();
    store.subscribeEvents();
    store.unsubscribeEvents();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("runFullPipeline success sets shotPlan/outputPath/phase=done", async () => {
    edit.mockResolvedValueOnce({
      ok: true,
      assetDir: "/cache/x",
      shotPlan: {
        sections: [
          { section_idx: 0, shots: [{ shot_idx: 0 }, { shot_idx: 1 }] },
        ],
      },
      shotPoints: [],
      outputPath: "./out.mp4",
    });
    const store = useVideoEditingStore();
    await store.runFullPipeline({ videoPath: "/raw.mp4" });
    expect(onEvent).toHaveBeenCalled(); // subscribed
    expect(edit).toHaveBeenCalled();
    expect(store.phase).toBe("done");
    expect(store.outputPath).toBe("./out.mp4");
    expect(store.totalShots).toBe(2);
  });

  it("runFullPipeline failure sets error + phase=error", async () => {
    edit.mockResolvedValueOnce({ ok: false, error: "ffmpeg failed" });
    const store = useVideoEditingStore();
    await store.runFullPipeline({ videoPath: "/raw.mp4" });
    expect(store.phase).toBe("error");
    expect(store.error).toBe("ffmpeg failed");
  });

  it("runFullPipeline throw sets error + phase=error", async () => {
    edit.mockRejectedValueOnce(new Error("boom"));
    const store = useVideoEditingStore();
    await store.runFullPipeline({ videoPath: "/raw.mp4" });
    expect(store.phase).toBe("error");
    expect(store.error).toBe("boom");
  });

  it("runFullPipeline without api errors gracefully", async () => {
    setApi(false);
    const store = useVideoEditingStore();
    await store.runFullPipeline({ videoPath: "/raw.mp4" });
    expect(store.phase).toBe("error");
    expect(store.error).toContain("not available");
  });

  it("cancel calls api.cancel with active request + resets to idle", async () => {
    cancel.mockResolvedValueOnce(undefined);
    const store = useVideoEditingStore();
    store.activeRequestId = "ve_1";
    store.phase = "assemble";
    await store.cancel();
    expect(cancel).toHaveBeenCalledWith("ve_1");
    expect(store.phase).toBe("idle");
  });

  it("loadAssets populates assets", async () => {
    assetsList.mockResolvedValueOnce({
      ok: true,
      assets: [{ hash: "h1", videoPath: "/a.mp4" }],
    });
    const store = useVideoEditingStore();
    await store.loadAssets();
    expect(store.assets).toHaveLength(1);
  });

  it("eventLog returns last 100 events", () => {
    const store = useVideoEditingStore();
    store.events = Array.from({ length: 150 }, (_, i) => ({
      type: "x",
      ts: i,
    }));
    expect(store.eventLog).toHaveLength(100);
    expect(store.eventLog[0].ts).toBe(50);
  });

  it("reset clears pipeline state", () => {
    const store = useVideoEditingStore();
    store.phase = "done";
    store.outputPath = "./out.mp4";
    store.shotPlan = { sections: [] };
    store.reset();
    expect(store.phase).toBe("idle");
    expect(store.outputPath).toBe("");
    expect(store.shotPlan).toBeNull();
  });
});
