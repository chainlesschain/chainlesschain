import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * cron-scheduler skill handler — 覆盖此前无测试的自然语言→cron 解析（经 execute）：
 * every N minutes/hours、every day at Xam/pm（含 12am/12pm 边界）、every weekday、
 * 缺命令/未知 action 的错误处理。使用 fake timers 避免 setInterval 泄漏。
 */

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let handler;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  const mod =
    await import("../../../src/main/ai-engine/cowork/skills/builtin/cron-scheduler/handler.js");
  handler = mod.default || mod;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const add = (schedule, command = "echo hi") =>
  handler.execute({ input: `add "${schedule}" "${command}"` }, {});

describe("cron-scheduler natural-language → cron", () => {
  it("every N minutes", async () => {
    const r = await add("every 5 minutes");
    expect(r.success).toBe(true);
    expect(r.cron).toBe("*/5 * * * *");
    expect(r.type).toBe("recurring");
  });

  it("every N hours", async () => {
    const r = await add("every 2 hours");
    expect(r.cron).toBe("0 */2 * * *");
  });

  it("every day at 9am / 6pm", async () => {
    expect((await add("every day at 9am")).cron).toBe("0 9 * * *");
    expect((await add("every day at 6pm")).cron).toBe("0 18 * * *");
  });

  it("handles 12am → 0 and 12pm → 12 correctly", async () => {
    expect((await add("every day at 12am")).cron).toBe("0 0 * * *");
    expect((await add("every day at 12pm")).cron).toBe("0 12 * * *");
  });

  it("every weekday at 8am → Mon-Fri", async () => {
    expect((await add("every weekday at 8am")).cron).toBe("0 8 * * 1-5");
  });

  it("passes through an explicit cron expression", async () => {
    const r = await add("*/15 * * * *");
    expect(r.cron).toBe("*/15 * * * *");
  });
});

describe("cron-scheduler errors", () => {
  it("requires a command", async () => {
    // schedule only, no command token → "No command provided."
    const r = await handler.execute({ input: "add hourly" }, {});
    expect(r.success).toBe(false);
  });

  it("errors when removing a non-existent job", async () => {
    const r = await handler.execute({ input: "remove no_such_job_id" }, {});
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });
});
