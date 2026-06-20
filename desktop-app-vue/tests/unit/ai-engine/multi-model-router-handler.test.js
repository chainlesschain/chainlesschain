import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * multi-model-router skill handler — 覆盖此前无测试的纯路由逻辑（经 execute）：
 * 复杂度评分 → 模型选择分档（haiku / sonnet / opus）、成本估算格式、--config 矩阵。
 */

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let handler;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod =
    await import("../../../src/main/ai-engine/cowork/skills/builtin/multi-model-router/handler.js");
  handler = mod.default || mod;
});

const route = (task) => handler.execute({ input: "--route " + task }, {});

describe("multi-model-router routing tiers", () => {
  it("routes a trivial typo/one-file edit to the cheap model (haiku)", async () => {
    const r = await route("fix a typo in one file");
    expect(r.success).toBe(true);
    expect(r.result.complexity).toBe(1); // baseline 5 +1(fix) -4(low) -1(short)
    expect(r.result.recommendedModel).toBe("claude-haiku");
  });

  it("routes a normal feature task to the mid model (sonnet)", async () => {
    const r = await route(
      "please implement a new feature endpoint module for the service today",
    );
    expect(r.success).toBe(true);
    expect(r.result.complexity).toBe(7); // baseline 5 +2(medium)
    expect(r.result.recommendedModel).toBe("claude-sonnet");
  });

  it("routes a heavy security/architecture task to the top model (opus)", async () => {
    const r = await route(
      "architect and migrate the entire security infrastructure across all systems with api design and audit",
    );
    expect(r.success).toBe(true);
    expect(r.result.complexity).toBe(10); // clamped
    expect(r.result.recommendedModel).toBe("claude-opus");
  });

  it("emits a well-formed cost estimate", async () => {
    const r = await route("fix a typo in one file");
    expect(r.message).toMatch(/Estimated cost: \$\d+\.\d{4}/);
  });
});

describe("multi-model-router --config", () => {
  it("returns the model capability matrix", async () => {
    const r = await handler.execute({ input: "--config" }, {});
    expect(r.success).toBe(true);
    expect(r.result.models).toHaveProperty("claude-opus");
    expect(r.result.models).toHaveProperty("claude-haiku");
  });

  it("fails with usage when input is empty", async () => {
    const r = await handler.execute({ input: "" }, {});
    expect(r.success).toBe(false);
  });
});
