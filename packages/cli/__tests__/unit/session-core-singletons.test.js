import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome;

beforeEach(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-singletons-"));
  vi.resetModules();
  vi.doMock("../../src/lib/paths.js", () => ({
    getHomeDir: () => tmpHome,
    getBinDir: () => path.join(tmpHome, "bin"),
    getConfigPath: () => path.join(tmpHome, "config.json"),
    getStatePath: () => path.join(tmpHome, "state"),
    getPidFilePath: () => path.join(tmpHome, "state", "app.pid"),
    getServicesDir: () => path.join(tmpHome, "services"),
  }));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.doUnmock("../../src/lib/paths.js");
});

describe("session-core-singletons", () => {
  it("MemoryStore persists across reloads via file adapter", async () => {
    const mod1 = await import("../../src/lib/session-core-singletons.js");
    const store1 = mod1.getMemoryStore();
    const m = store1.add({ scope: "global", content: "hello cli" });
    await new Promise((r) => setImmediate(r));

    // reset modules so new singleton rehydrates from disk
    mod1.resetSessionCoreSingletonsForTests();
    vi.resetModules();
    const mod2 = await import("../../src/lib/session-core-singletons.js");
    const store2 = mod2.getMemoryStore();
    expect(store2.size()).toBe(1);
    expect(store2.get(m.id).content).toBe("hello cli");
  });

  it("BetaFlags persist across reloads", async () => {
    const mod1 = await import("../../src/lib/session-core-singletons.js");
    const flags1 = await mod1.getBetaFlags();
    flags1.enable("cli-integration-2026-04-15");
    await new Promise((r) => setImmediate(r));

    mod1.resetSessionCoreSingletonsForTests();
    vi.resetModules();
    const mod2 = await import("../../src/lib/session-core-singletons.js");
    const flags2 = await mod2.getBetaFlags();
    expect(flags2.isEnabled("cli-integration-2026-04-15")).toBe(true);
  });

  it("ApprovalGate session policy sticks for the process lifetime", async () => {
    const mod = await import("../../src/lib/session-core-singletons.js");
    const gate = await mod.getApprovalGate();
    gate.setSessionPolicy("sess_1", "trusted");
    expect(gate.getSessionPolicy("sess_1")).toBe("trusted");
    expect(gate.getSessionPolicy("sess_2")).toBe("strict");
  });

  it("ApprovalGate per-session policy persists across reloads", async () => {
    const mod1 = await import("../../src/lib/session-core-singletons.js");
    const gate1 = await mod1.getApprovalGate();
    gate1.setSessionPolicy("sess_persist", "autopilot");
    await new Promise((r) => setImmediate(r));

    mod1.resetSessionCoreSingletonsForTests();
    vi.resetModules();
    const mod2 = await import("../../src/lib/session-core-singletons.js");
    const gate2 = await mod2.getApprovalGate();
    expect(gate2.getSessionPolicy("sess_persist")).toBe("autopilot");
    expect(gate2.getSessionPolicy("sess_other")).toBe("strict");
  });

  it("singleton is stable within a process", async () => {
    const mod = await import("../../src/lib/session-core-singletons.js");
    const a = mod.getMemoryStore();
    const b = mod.getMemoryStore();
    expect(a).toBe(b);
  });
});
