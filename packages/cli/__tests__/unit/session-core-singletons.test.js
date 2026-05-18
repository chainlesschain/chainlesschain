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

  it("SessionManager parks sessions to disk and restores them across reloads", async () => {
    const mod1 = await import("../../src/lib/session-core-singletons.js");
    const mgr1 = mod1.getSessionManager();
    const h = mgr1.create({ agentId: "cli-agent", sessionId: "sess_cli_park" });
    expect(mgr1.markIdle(h.sessionId)).toBe(true);
    const parked = await mgr1.park(h.sessionId);
    expect(parked).toBe(true);

    const parkedFile = path.join(tmpHome, "parked-sessions.json");
    expect(fs.existsSync(parkedFile)).toBe(true);
    const disk = JSON.parse(fs.readFileSync(parkedFile, "utf8"));
    expect(disk.sess_cli_park).toBeTruthy();
    expect(disk.sess_cli_park.status).toBe("parked");

    mod1.resetSessionCoreSingletonsForTests();
    vi.resetModules();
    const mod2 = await import("../../src/lib/session-core-singletons.js");
    const mgr2 = mod2.getSessionManager();
    const resumed = await mgr2.resume("sess_cli_park");
    expect(resumed).toBe(true);
    expect(mgr2.has("sess_cli_park")).toBe(true);
  });

  it("SessionManager close removes parked entry from disk", async () => {
    const mod = await import("../../src/lib/session-core-singletons.js");
    const mgr = mod.getSessionManager();
    mgr.create({ agentId: "a", sessionId: "sess_close_1" });
    mgr.markIdle("sess_close_1");
    await mgr.park("sess_close_1");
    await mgr.resume("sess_close_1");
    const closed = await mgr.close("sess_close_1");
    expect(closed).toBe(true);
    const parkedFile = path.join(tmpHome, "parked-sessions.json");
    if (fs.existsSync(parkedFile)) {
      const disk = JSON.parse(fs.readFileSync(parkedFile, "utf8"));
      expect(disk.sess_close_1).toBeUndefined();
    }
  });

  it("agent-repl flow: handle by sessionId, idle→park→reload→unpark", async () => {
    // Simulates what agent-repl.js does on startup (create handle keyed by
    // JSONL sessionId) and on rl.close() (markIdle + park).
    const replSessionId = "sess_repl_flow_1";
    const mod1 = await import("../../src/lib/session-core-singletons.js");
    const mgr1 = mod1.getSessionManager();
    mgr1.create({
      agentId: "cli-agent",
      sessionId: replSessionId,
      metadata: { provider: "ollama", model: "qwen2:7b" },
    });
    expect(mgr1.markIdle(replSessionId)).toBe(true);
    expect(await mgr1.park(replSessionId)).toBe(true);

    // New process — unpark resumes from disk
    mod1.resetSessionCoreSingletonsForTests();
    vi.resetModules();
    const mod2 = await import("../../src/lib/session-core-singletons.js");
    const mgr2 = mod2.getSessionManager();
    const resumed = await mgr2.resume(replSessionId);
    expect(resumed).toBe(true);
    const h = mgr2.get(replSessionId);
    expect(h.status).toBe("running");
    expect(h.metadata?.provider).toBe("ollama");
  });

  it("--no-park-on-exit resolves policy.parkOnExit=false", async () => {
    const { resolveAgentPolicy } =
      await import("../../src/runtime/policies/agent-policy.js");
    const defaults = resolveAgentPolicy({ overrides: {} });
    expect(defaults.parkOnExit).toBe(true);
    const opted = resolveAgentPolicy({ overrides: { parkOnExit: false } });
    expect(opted.parkOnExit).toBe(false);
  });

  it("createStreamRouter returns a working StreamRouter", async () => {
    const mod = await import("../../src/lib/session-core-singletons.js");
    const router = mod.createStreamRouter();
    expect(typeof router.stream).toBe("function");
    async function* src() {
      yield "hello";
      yield " world";
    }
    const out = await router.collect(src());
    expect(out.text).toBe("hello world");
  });
});
