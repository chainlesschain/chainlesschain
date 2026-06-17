/**
 * editor-pool 测试 — src/renderer/utils/editor-pool.ts
 *
 * EditorPool (injectable editorFactory) + createEditorPoolManager. Uses a fake
 * factory and a 'custom' editor type so reuse works (isCompatible keys on type)
 * while the monaco/milkdown clean/destroy branches stay inert. logger mocked.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { EditorPool, createEditorPoolManager } from "@/utils/editor-pool";

let factory: ReturnType<typeof vi.fn>;
beforeEach(() => {
  let n = 0;
  factory = vi.fn(async (id: string) => ({ id, n: n++ }));
});

const opts = { type: "custom" as any };

describe("editor-pool — EditorPool acquire/release/reuse", () => {
  it("creates on miss, pools on release, reuses on next acquire", async () => {
    const pool = new EditorPool({ editorFactory: factory, editorType: "custom" });
    const e1 = await pool.acquire("c1", opts);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(pool.getStats()).toMatchObject({
      created: 1,
      misses: 1,
      activeCount: 1,
    });
    expect(pool.release("c1")).toBe(true);
    expect(pool.getStats().poolSize).toBe(1);

    const e2 = await pool.acquire("c2", opts);
    expect(factory).toHaveBeenCalledTimes(1); // reused, no new create
    expect(e2).toBe(e1);
    expect(pool.getStats()).toMatchObject({ reused: 1, hits: 1, hitRate: 50 });
  });

  it("release of an unknown container returns false", () => {
    const pool = new EditorPool({ editorFactory: factory, editorType: "custom" });
    expect(pool.release("nope")).toBe(false);
  });

  it("throws when acquiring without a factory", async () => {
    const pool = new EditorPool({ editorType: "custom" });
    await expect(pool.acquire("c1", opts)).rejects.toThrow(/factory not provided/);
  });
});

describe("editor-pool — EditorPool maintenance", () => {
  it("discards releases beyond maxPoolSize", async () => {
    const pool = new EditorPool({
      editorFactory: factory,
      editorType: "custom",
      maxPoolSize: 1,
    });
    await pool.acquire("a", opts);
    await pool.acquire("b", opts);
    expect(pool.release("a")).toBe(true); // pooled (size 1)
    expect(pool.release("b")).toBe(true); // pool full → destroyed
    expect(pool.getStats().poolSize).toBe(1);
    expect(pool.getStats().destroyed).toBe(1);
  });

  it("prune removes aged pooled editors; clear empties everything", async () => {
    const pool = new EditorPool({ editorFactory: factory, editorType: "custom" });
    await pool.acquire("a", opts);
    pool.release("a");
    pool.prune(-1); // every pooled entry counts as aged
    expect(pool.getStats().poolSize).toBe(0);

    await pool.acquire("b", opts);
    pool.clear();
    expect(pool.getStats()).toMatchObject({ poolSize: 0, activeCount: 0 });
  });
});

describe("editor-pool — createEditorPoolManager", () => {
  it("routes acquire by type, memoizes pools, aggregates stats, clears all", async () => {
    const mgr = createEditorPoolManager({ editorFactory: factory });
    await mgr.acquire("c1", opts);
    expect(factory).toHaveBeenCalled();
    expect(mgr.getPool("custom" as any)).toBe(mgr.getPool("custom" as any));
    expect(mgr.getAllStats().custom).toMatchObject({ created: 1 });
    expect(mgr.release("c1", "custom" as any)).toBe(true);
    mgr.clearAll();
    expect(mgr.getAllStats()).toEqual({});
  });
});
