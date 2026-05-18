import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let SkillInvoker, getSkillInvoker;

beforeEach(async () => {
  const mod = await import("../../../src/main/marketplace/skill-invoker.js");
  SkillInvoker = mod.SkillInvoker;
  getSkillInvoker = mod.getSkillInvoker;
});

describe("SkillInvoker", () => {
  let invoker;
  beforeEach(() => {
    invoker = new SkillInvoker();
  });

  it("should initialize with defaults", () => {
    expect(invoker.timeout).toBe(30000);
    expect(invoker._invokeHistory).toHaveLength(0);
  });

  it("should throw if endpoint missing", async () => {
    await expect(invoker.invoke({})).rejects.toThrow("Endpoint is required");
  });

  it("should invoke skill", async () => {
    const result = await invoker.invoke({
      endpoint: "http://test",
      skillId: "s1",
    });
    expect(result.status).toBe("completed");
  });

  it("should delegate to org", async () => {
    const result = await invoker.delegateToOrg({
      orgId: "org1",
      skillId: "s1",
    });
    expect(result.status).toBe("completed");
  });

  it("should track history", async () => {
    await invoker.invoke({ endpoint: "http://test", skillId: "s1" });
    expect(invoker.getHistory()).toHaveLength(1);
  });

  it("should close", async () => {
    await invoker.invoke({ endpoint: "http://test", skillId: "s1" });
    await invoker.close();
    expect(invoker._invokeHistory).toHaveLength(0);
  });
});
