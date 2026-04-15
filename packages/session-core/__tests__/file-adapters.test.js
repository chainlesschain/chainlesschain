import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createMemoryFileAdapter,
  createBetaFlagsFileAdapter,
  createApprovalGateFileAdapter,
  hydrateMemoryStore,
} from "../lib/file-adapters.js";
import { MemoryStore, SCOPE } from "../lib/memory-store.js";
import { BetaFlags } from "../lib/beta-flags.js";
import { ApprovalGate, POLICY } from "../lib/approval-gate.js";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-adapters-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createMemoryFileAdapter", () => {
  it("persists add / remove across instances", async () => {
    const file = path.join(tmpDir, "mem.json");
    const adapter1 = createMemoryFileAdapter(file);
    const store1 = new MemoryStore({ adapter: adapter1 });
    const m = store1.add({ scope: SCOPE.GLOBAL, content: "hello" });
    await new Promise((r) => setImmediate(r));

    // new store instance — hydrate from file
    const adapter2 = createMemoryFileAdapter(file);
    const store2 = new MemoryStore({ adapter: adapter2 });
    hydrateMemoryStore(store2, adapter2);
    expect(store2.size()).toBe(1);
    expect(store2.get(m.id).content).toBe("hello");

    store2.remove(m.id);
    await new Promise((r) => setImmediate(r));

    const adapter3 = createMemoryFileAdapter(file);
    const store3 = new MemoryStore({ adapter: adapter3 });
    hydrateMemoryStore(store3, adapter3);
    expect(store3.size()).toBe(0);
  });

  it("tolerates missing file on load", () => {
    const adapter = createMemoryFileAdapter(path.join(tmpDir, "does-not-exist.json"));
    expect(adapter.load()).toEqual([]);
  });

  it("creates parent directories on save", async () => {
    const deep = path.join(tmpDir, "nested", "dir", "mem.json");
    const adapter = createMemoryFileAdapter(deep);
    const store = new MemoryStore({ adapter });
    store.add({ scope: SCOPE.GLOBAL, content: "x" });
    await new Promise((r) => setImmediate(r));
    expect(fs.existsSync(deep)).toBe(true);
  });
});

describe("createBetaFlagsFileAdapter", () => {
  it("persists enable/disable", async () => {
    const file = path.join(tmpDir, "beta.json");
    const adapter = createBetaFlagsFileAdapter(file);
    const b1 = new BetaFlags({ store: adapter });
    b1.enable("x-2026-01-01");
    await new Promise((r) => setImmediate(r));

    const adapter2 = createBetaFlagsFileAdapter(file);
    const b2 = new BetaFlags({ store: adapter2 });
    await b2.load();
    expect(b2.isEnabled("x-2026-01-01")).toBe(true);

    b2.disable("x-2026-01-01");
    await new Promise((r) => setImmediate(r));

    const adapter3 = createBetaFlagsFileAdapter(file);
    const b3 = new BetaFlags({ store: adapter3 });
    await b3.load();
    expect(b3.isEnabled("x-2026-01-01")).toBe(false);
  });

  it("load() returns empty when file missing", async () => {
    const adapter = createBetaFlagsFileAdapter(path.join(tmpDir, "nope.json"));
    expect(await adapter.load()).toEqual([]);
  });
});

describe("createApprovalGateFileAdapter", () => {
  it("persists per-session policy across instances", async () => {
    const file = path.join(tmpDir, "approval.json");
    const adapter1 = createApprovalGateFileAdapter(file);
    const g1 = new ApprovalGate({ store: adapter1 });
    g1.setSessionPolicy("s1", POLICY.TRUSTED);
    g1.setSessionPolicy("s2", POLICY.AUTOPILOT);
    await new Promise((r) => setImmediate(r));

    const adapter2 = createApprovalGateFileAdapter(file);
    const g2 = new ApprovalGate({ store: adapter2 });
    await g2.load();
    expect(g2.getSessionPolicy("s1")).toBe(POLICY.TRUSTED);
    expect(g2.getSessionPolicy("s2")).toBe(POLICY.AUTOPILOT);
    expect(g2.getSessionPolicy("unknown")).toBe(POLICY.STRICT);

    g2.clearSessionPolicy("s1");
    await new Promise((r) => setImmediate(r));

    const adapter3 = createApprovalGateFileAdapter(file);
    const g3 = new ApprovalGate({ store: adapter3 });
    await g3.load();
    expect(g3.getSessionPolicy("s1")).toBe(POLICY.STRICT);
    expect(g3.getSessionPolicy("s2")).toBe(POLICY.AUTOPILOT);
  });

  it("load() returns empty object when file missing", async () => {
    const adapter = createApprovalGateFileAdapter(path.join(tmpDir, "nope.json"));
    expect(await adapter.load()).toEqual({});
  });

  it("ignores corrupted JSON", async () => {
    const file = path.join(tmpDir, "approval.json");
    fs.writeFileSync(file, "{not json", "utf-8");
    const adapter = createApprovalGateFileAdapter(file);
    expect(await adapter.load()).toEqual({});
  });
});
