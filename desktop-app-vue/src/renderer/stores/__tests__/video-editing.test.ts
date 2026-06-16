/**
 * videoEditing store 测试 — src/renderer/stores/videoEditing.ts
 *
 * Pipeline orchestration store; actions go through window.electronAPI.videoEditing
 * (mocked). Getters are pure.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useVideoEditingStore } from "@/stores/videoEditing";

let api: any;
beforeEach(() => {
  setActivePinia(createPinia());
  api = {
    edit: vi.fn(),
    deconstruct: vi.fn(),
    plan: vi.fn(),
    assemble: vi.fn(),
    render: vi.fn(),
    cancel: vi.fn().mockResolvedValue({ ok: true }),
    assetsList: vi.fn(),
    onEvent: vi.fn(() => () => {}),
  };
  (window as any).electronAPI = { videoEditing: api };
});

describe("videoEditing — getters", () => {
  it("isRunning is false for idle/done/error and true otherwise", () => {
    const s = useVideoEditingStore();
    expect(s.isRunning).toBe(false); // idle
    s.phase = "plan";
    expect(s.isRunning).toBe(true);
    s.phase = "done";
    expect(s.isRunning).toBe(false);
    s.phase = "error";
    expect(s.isRunning).toBe(false);
  });

  it("totalShots sums shots across sections (0 when no plan)", () => {
    const s = useVideoEditingStore();
    expect(s.totalShots).toBe(0);
    s.shotPlan = { sections: [{ shots: [1, 2] }, { shots: [3] }] } as any;
    expect(s.totalShots).toBe(3);
  });

  it("eventLog returns the last 100 events", () => {
    const s = useVideoEditingStore();
    s.events = Array.from({ length: 120 }, (_, i) => ({ type: "x", i }) as any);
    expect(s.eventLog).toHaveLength(100);
    expect((s.eventLog[0] as any).i).toBe(20);
  });
});

describe("videoEditing — reset", () => {
  it("restores idle defaults", () => {
    const s = useVideoEditingStore();
    s.phase = "render";
    s.progress = 50;
    s.assetDir = "/x";
    s.error = "e";
    s.reset();
    expect(s.phase).toBe("idle");
    expect(s.progress).toBe(0);
    expect(s.assetDir).toBe("");
    expect(s.error).toBe("");
  });
});

describe("videoEditing — runFullPipeline", () => {
  it("errors when the api is unavailable", async () => {
    (window as any).electronAPI = {};
    const s = useVideoEditingStore();
    await s.runFullPipeline({ requestId: "r1" } as any);
    expect(s.phase).toBe("error");
    expect(s.error).toMatch(/not available/);
  });

  it("fills state and finishes on success", async () => {
    api.edit.mockResolvedValue({
      ok: true,
      assetDir: "/assets",
      shotPlan: { sections: [] },
      shotPoints: [{ t: 1 }],
      outputPath: "/out.mp4",
    });
    const s = useVideoEditingStore();
    await s.runFullPipeline({ requestId: "r1" } as any);
    expect(api.edit).toHaveBeenCalled();
    expect(s.assetDir).toBe("/assets");
    expect(s.outputPath).toBe("/out.mp4");
    expect(s.phase).toBe("done");
  });

  it("sets error phase when the result is not ok", async () => {
    api.edit.mockResolvedValue({ ok: false, error: "boom" });
    const s = useVideoEditingStore();
    await s.runFullPipeline({} as any);
    expect(s.error).toBe("boom");
    expect(s.phase).toBe("error");
  });

  it("captures a thrown error", async () => {
    api.edit.mockRejectedValue(new Error("crash"));
    const s = useVideoEditingStore();
    await s.runFullPipeline({} as any);
    expect(s.error).toBe("crash");
    expect(s.phase).toBe("error");
  });
});

describe("videoEditing — event subscription", () => {
  it("applies phase.start / phase.progress / phase.end(render) events", () => {
    let cb: (ev: any) => void = () => {};
    api.onEvent.mockImplementation((fn: any) => {
      cb = fn;
      return () => {};
    });
    const s = useVideoEditingStore();
    s.subscribeEvents();

    cb({ type: "phase.start", phase: "plan" });
    expect(s.phase).toBe("plan");
    expect(s.progress).toBe(0);

    cb({ type: "phase.progress", pct: 42, message: "working" });
    expect(s.progress).toBe(42);
    expect(s.progressMessage).toBe("working");

    cb({ type: "phase.end", phase: "render" });
    expect(s.phase).toBe("done");

    expect(s.events.length).toBe(3);
  });
});

describe("videoEditing — staged actions", () => {
  it("runDeconstruct sets assetDir on success, error otherwise", async () => {
    api.deconstruct.mockResolvedValue({ ok: true, assetDir: "/d" });
    const s = useVideoEditingStore();
    await s.runDeconstruct({} as any);
    expect(s.assetDir).toBe("/d");
    api.deconstruct.mockResolvedValue({ ok: false, error: "no" });
    await s.runDeconstruct({} as any);
    expect(s.error).toBe("no");
  });

  it("runRender sets outputPath + done on success", async () => {
    api.render.mockResolvedValue({ ok: true, outputPath: "/r.mp4" });
    const s = useVideoEditingStore();
    await s.runRender({} as any);
    expect(s.outputPath).toBe("/r.mp4");
    expect(s.phase).toBe("done");
  });

  it("cancel calls the api and returns to idle", async () => {
    const s = useVideoEditingStore();
    s.activeRequestId = "req1";
    s.phase = "render";
    await s.cancel();
    expect(api.cancel).toHaveBeenCalledWith("req1");
    expect(s.phase).toBe("idle");
  });

  it("loadAssets stores the returned list", async () => {
    api.assetsList.mockResolvedValue({ ok: true, assets: [{ id: "a" }] });
    const s = useVideoEditingStore();
    await s.loadAssets();
    expect(s.assets).toEqual([{ id: "a" }]);
  });
});
