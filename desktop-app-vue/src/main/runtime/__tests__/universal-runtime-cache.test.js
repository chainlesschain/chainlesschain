import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { UniversalRuntime } = require("../universal-runtime.js");

describe("UniversalRuntime bounded bookkeeping maps", () => {
  let rt;

  beforeEach(() => {
    rt = new UniversalRuntime();
  });

  it("_capMapSet caps the map at 200 and evicts the oldest entries", () => {
    const m = new Map();
    for (let i = 0; i < 250; i++) rt._capMapSet(m, `k${i}`, i);
    expect(m.size).toBe(200);
    expect(m.has("k0")).toBe(false); // first 50 evicted
    expect(m.has("k49")).toBe(false);
    expect(m.has("k50")).toBe(true);
    expect(m.has("k249")).toBe(true); // newest kept
  });

  it("_capMapSet updating an existing key does not evict another entry", () => {
    const m = new Map();
    rt._capMapSet(m, "a", 1);
    rt._capMapSet(m, "b", 2);
    rt._capMapSet(m, "a", 3); // update, not a new key
    expect(m.size).toBe(2);
    expect(m.get("a")).toBe(3);
    expect(m.has("b")).toBe(true);
  });

  it("profile() records its result via the bounded setter", async () => {
    rt.db = { prepare: () => ({ run: () => {} }) }; // mock db so the insert succeeds
    const result = await rt.profile("memory", 0);
    expect(result.type).toBe("memory");
    expect(rt._profileData.has(result.id)).toBe(true);
  });
});
