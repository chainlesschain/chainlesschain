import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * humanizer skill handler — 覆盖此前无测试的纯文本逻辑（经 execute）：
 * humanize（缩写转换 + 变更计数）、analyze（自然度评分）、adjust-tone（音调校验）、
 * 未知 action 处理。
 */

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let handler;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod =
    await import("../../../src/main/ai-engine/cowork/skills/builtin/humanizer/handler.js");
  handler = mod.default || mod;
});

const run = (input) => handler.execute({ input }, {});

describe("humanizer humanize", () => {
  it("applies contractions and reports changes", async () => {
    const r = await run("humanize It is great. We are ready. Do not wait.");
    expect(r.success).toBe(true);
    const out = r.result.humanized.toLowerCase();
    expect(out).toContain("it's");
    expect(out).toContain("we're");
    expect(out).toContain("don't");
    expect(r.result.changeCount).toBeGreaterThanOrEqual(1);
    expect(r.result.changes.some((c) => c.type === "contracted")).toBe(true);
  });

  it("errors when no text is given", async () => {
    const r = await run("humanize");
    expect(r.success).toBe(false);
  });
});

describe("humanizer analyze", () => {
  it("returns a naturalness score and counts", async () => {
    const r = await run("analyze The system is good. It works well.");
    expect(r.success).toBe(true);
    expect(r.result.naturalness).toBeGreaterThanOrEqual(0);
    expect(r.result.naturalness).toBeLessThanOrEqual(100);
    expect(r.result.aiScore).toBe(100 - r.result.naturalness);
    expect(r.result.wordCount).toBeGreaterThan(0);
  });
});

describe("humanizer adjust-tone", () => {
  it("casual tone applies informal substitutions", async () => {
    const r = await run("adjust-tone casual It is fine. Do not stop.");
    expect(r.success).toBe(true);
    expect(JSON.stringify(r.result).toLowerCase()).toContain("don't");
  });

  it("rejects an invalid tone", async () => {
    const r = await run("adjust-tone robotic some text here");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Invalid tone/i);
  });
});

describe("humanizer unknown action", () => {
  it("reports an unknown action", async () => {
    const r = await run("frobnicate hello world");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown action/i);
  });
});
