import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * color-picker skill handler — 覆盖此前无测试的纯色彩数学（经 execute 间接调用）：
 * HEX/RGB/HSL 转换与往返、3 位 HEX 展开、无效输入、WCAG 对比度（黑白=21、同色=1）。
 */

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let handler;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod =
    await import("../../../src/main/ai-engine/cowork/skills/builtin/color-picker/handler.js");
  handler = mod.default || mod;
});

const run = (input) => handler.execute({ input }, {});

describe("color-picker --convert", () => {
  it("converts a 6-digit hex to rgb + hsl", async () => {
    const r = await run("--convert #ff0000");
    expect(r.success).toBe(true);
    expect(r.result.hex).toBe("#ff0000");
    expect(r.result.rgb).toBe("rgb(255, 0, 0)");
    expect(r.result.hsl).toBe("hsl(0, 100%, 50%)");
  });

  it("expands a 3-digit hex", async () => {
    const r = await run("--convert #fff");
    expect(r.success).toBe(true);
    expect(r.result.hex).toBe("#ffffff");
    expect(r.result.rgb).toBe("rgb(255, 255, 255)");
  });

  it("round-trips an rgb() input back to hex", async () => {
    const r = await run("--convert rgb(0, 128, 0)");
    expect(r.success).toBe(true);
    expect(r.result.hex).toBe("#008000");
  });

  it("rejects an invalid color", async () => {
    const r = await run("--convert notacolor");
    expect(r.success).toBe(false);
  });
});

describe("color-picker --contrast (WCAG)", () => {
  it("black vs white is the maximum 21:1 and passes AAA", async () => {
    const r = await run("--contrast #000000 #ffffff");
    expect(r.success).toBe(true);
    expect(r.result.ratio).toBe(21);
    expect(r.result.wcag.aaa.normal).toBe(true);
  });

  it("identical colors give 1:1 and fail every WCAG tier", async () => {
    const r = await run("--contrast #777777 #777777");
    expect(r.success).toBe(true);
    expect(r.result.ratio).toBe(1);
    expect(r.result.wcag.aa.large).toBe(false);
    expect(r.result.wcag.aaa.normal).toBe(false);
  });
});
