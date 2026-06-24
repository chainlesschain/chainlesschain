/**
 * progress-emitter 测试 —— ProgressEmitter 的任务追踪器：步进/百分比计算、
 * 阶段流转(complete/error/cancel)、"progress" 事件与 taskId 作用域事件、
 * 节流(throttleInterval)、IPC 转发(mainWindow.webContents.send)、终态后的延迟清理。
 *
 * 分层：smoke + unit（百分比/阶段/事件）+ integration（节流、IPC 转发、清理）。
 *
 * 全程 fake timers：既控制终态后的 setTimeout 清理，也驱动节流窗口；
 * 默认 throttleInterval:0 关闭节流（专门的节流用例单独用 100）。
 */

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const ProgressEmitter = require("../progress-emitter.js");

const STAGE = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

const make = (config = {}) =>
  new ProgressEmitter({ throttleInterval: 0, ...config });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("progress-emitter — smoke", () => {
  it("creates a tracker exposing the progress API", () => {
    const pe = make();
    const t = pe.createTracker("task-1", { title: "X", totalSteps: 100 });
    for (const m of ["step", "setPercent", "setStage", "complete", "error"]) {
      expect(typeof t[m]).toBe("function");
    }
    expect(pe.tasks.get("task-1").stage).toBe(STAGE.PENDING);
  });
});

describe("progress-emitter — step / setPercent math", () => {
  it("step advances currentStep and computes a rounded percent", () => {
    const pe = make();
    const t = pe.createTracker("t", { totalSteps: 4 });
    t.step("a", 1);
    expect(pe.tasks.get("t")).toMatchObject({ currentStep: 1, percent: 25 });
    t.step("b", 2);
    expect(pe.tasks.get("t")).toMatchObject({ currentStep: 3, percent: 75 });
  });

  it("step caps at totalSteps (never over 100%)", () => {
    const pe = make();
    const t = pe.createTracker("t", { totalSteps: 2 });
    t.step("", 99);
    expect(pe.tasks.get("t")).toMatchObject({ currentStep: 2, percent: 100 });
  });

  it("setPercent clamps to 0..100", () => {
    const pe = make();
    const t = pe.createTracker("t", { totalSteps: 100 });
    t.setPercent(150);
    expect(pe.tasks.get("t").percent).toBe(100);
    t.setPercent(-5);
    expect(pe.tasks.get("t").percent).toBe(0);
  });
});

describe("progress-emitter — events + terminal stages", () => {
  it('emits "progress" and "progress:<id>" with the event payload', () => {
    const pe = make();
    const global = [];
    const scoped = [];
    pe.on("progress", (e) => global.push(e));
    pe.on("progress:t", (e) => scoped.push(e));
    const t = pe.createTracker("t", { totalSteps: 10 });
    t.step("halfway", 5);
    const last = global[global.length - 1];
    expect(last.taskId).toBe("t");
    expect(last.percent).toBe(50);
    expect(last.message).toBe("halfway");
    expect(scoped[scoped.length - 1].percent).toBe(50);
  });

  it("complete sets stage=completed, percent=100 and emits", () => {
    const pe = make();
    const events = [];
    pe.on("progress", (e) => events.push(e));
    const t = pe.createTracker("t", { totalSteps: 10 });
    t.complete({ message: "ok" });
    expect(pe.tasks.get("t")).toMatchObject({
      stage: STAGE.COMPLETED,
      percent: 100,
    });
    expect(events[events.length - 1].stage).toBe(STAGE.COMPLETED);
  });

  it("error sets stage=failed and captures the message", () => {
    const pe = make();
    const t = pe.createTracker("t");
    t.error(new Error("boom"));
    expect(pe.tasks.get("t")).toMatchObject({
      stage: STAGE.FAILED,
      error: "boom",
    });
  });

  it("cancel sets stage=cancelled; the task is cleaned up after the delay", () => {
    const pe = make();
    const t = pe.createTracker("t");
    t.cancel("user");
    expect(pe.tasks.get("t").stage).toBe(STAGE.CANCELLED);
    vi.advanceTimersByTime(5000); // delayed removeTask
    expect(pe.tasks.has("t")).toBe(false);
  });
});

describe("progress-emitter — throttling", () => {
  it("throttles rapid non-terminal emits but always emits terminal stages", () => {
    const pe = make({ throttleInterval: 100 });
    const events = [];
    pe.on("progress", (e) => events.push(e));
    const t = pe.createTracker("t", { totalSteps: 100 }); // PENDING emit at t0
    const afterCreate = events.length;

    t.step("a", 10); // same instant → throttled (no new event)
    expect(events.length).toBe(afterCreate);
    expect(pe.tasks.get("t").percent).toBe(10); // state still updated

    vi.advanceTimersByTime(100); // window passed
    t.step("b", 10);
    expect(events.length).toBe(afterCreate + 1); // now emits

    // a terminal stage bypasses the throttle even back-to-back.
    t.complete();
    expect(events[events.length - 1].stage).toBe(STAGE.COMPLETED);
  });
});

describe("progress-emitter — IPC forwarding (integration)", () => {
  it("forwards progress to the main window's webContents when set", () => {
    const pe = make();
    const sent = [];
    pe.setMainWindow({
      webContents: { send: (ch, data) => sent.push([ch, data]) },
    });
    const t = pe.createTracker("t", { totalSteps: 10 });
    t.step("go", 5);
    const channels = sent.map(([ch]) => ch);
    expect(channels).toContain("task-progress");
    expect(channels).toContain("task-progress:t");
    const payload = sent.find(([ch]) => ch === "task-progress")[1];
    expect(payload.taskId).toBe("t");
  });

  it("survives a throwing webContents.send (best-effort, no crash)", () => {
    const pe = make();
    pe.setMainWindow({
      webContents: {
        send: () => {
          throw new Error("renderer gone");
        },
      },
    });
    const t = pe.createTracker("t", { totalSteps: 10 });
    expect(() => t.step("go", 5)).not.toThrow();
  });
});
