import { describe, it, expect, beforeEach, vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

// Phase H: Desktop session-core singletons + IPC handlers wiring tests.
// Run without Electron by injecting a temp home dir via the module's _deps.

describe("session-core IPC (Desktop)", () => {
  let tmpHome;
  let singletons;
  let registerSessionCoreIpc;

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-session-ipc-"));
    vi.resetModules();
    singletons = require("../../../src/main/session/session-core-singletons.js");
    singletons._deps.getUserDataDir = () => tmpHome;
    singletons.resetSessionCoreSingletonsForTests();
    ({
      registerSessionCoreIpc,
    } = require("../../../src/main/session/session-core-ipc.js"));
  });

  function buildMockIpc() {
    const handlers = new Map();
    return {
      ipcMain: {
        handle: (channel, fn) => handlers.set(channel, fn),
      },
      invoke: (channel, ...args) => {
        const fn = handlers.get(channel);
        if (!fn) {
          throw new Error(`no handler for ${channel}`);
        }
        return fn({}, ...args);
      },
      handlers,
    };
  }

  it("registers all 24 channels and rejects missing ipcMain", () => {
    expect(() => registerSessionCoreIpc(null)).toThrow(/ipcMain/);
    const { ipcMain, handlers } = buildMockIpc();
    const res = registerSessionCoreIpc(ipcMain);
    expect(res.channels).toHaveLength(24);
    expect(handlers.size).toBe(24);
  });

  it("session:recall-on-start returns scoped memories for new session seed", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    await invoke("memory:store", {
      scope: "agent",
      scopeId: "agent_coder",
      content: "Prefers TypeScript",
      category: "preference",
    });
    await invoke("memory:store", {
      scope: "agent",
      scopeId: "agent_coder",
      content: "Prefers semicolons",
      category: "preference",
    });
    const res = await invoke("session:recall-on-start", {
      agentId: "agent_coder",
      limit: 5,
    });
    expect(res.ok).toBe(true);
    expect(res.data.scope).toBe("agent");
    expect(res.data.scopeId).toBe("agent_coder");
    expect(res.data.memories.length).toBeGreaterThanOrEqual(2);
  });

  it("session:recall-on-start rejects missing agentId", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const res = await invoke("session:recall-on-start", {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/agentId/);
  });

  it("session:close with consolidate=true writes facts before close", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const created = await invoke("session:create", { agentId: "agent_cc" });
    const sid = created.data.sessionId;
    singletons.getSessionManager().markIdle(sid);
    const closed = await invoke("session:close", sid, {
      consolidate: true,
      scope: "agent",
      events: [{ type: "user_message", data: { content: "我喜欢 Rust" } }],
    });
    expect(closed.ok).toBe(true);
    expect(closed.data.closed).toBe(true);
    expect(closed.data.consolidation).toBeTruthy();
    expect(closed.data.consolidation.writtenCount).toBeGreaterThan(0);
  });

  it("agent:stream:start normalizes source and pushes events to sender", async () => {
    const handlers = new Map();
    const sent = [];
    const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
    const fakeEvent = {
      sender: { send: (ch, ...args) => sent.push({ ch, args }) },
    };
    registerSessionCoreIpc(ipcMain);

    const res = await handlers.get("agent:stream:start")(fakeEvent, {
      streamId: "s_1",
      source: { tokens: ["hel", "lo"] },
    });
    expect(res.ok).toBe(true);
    expect(res.data.events[0].type).toBe("start");
    expect(res.data.events.at(-1).type).toBe("end");
    expect(res.data.events.filter((e) => e.type === "token")).toHaveLength(2);

    const streamSends = sent.filter((s) => s.ch === "agent:stream:event");
    expect(streamSends.length).toBe(res.data.eventCount);
    expect(streamSends[0].args[0]).toBe("s_1");
  });

  it("agent:stream:start wraps string source as single message", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const res = await invoke("agent:stream:start", {
      streamId: "s_2",
      source: "hello world",
    });
    expect(res.ok).toBe(true);
    expect(
      res.data.events.some(
        (e) => e.type === "message" && e.content === "hello world",
      ),
    ).toBe(true);
  });

  it("agent:stream:start rejects duplicate streamId", async () => {
    const { ipcMain } = buildMockIpc();
    const handlers = new Map();
    ipcMain.handle = (ch, fn) => handlers.set(ch, fn);
    registerSessionCoreIpc(ipcMain);
    // Start one that won't end until we manually drain it — use a large token array
    const slow = (async function* () {
      yield "a";
      await new Promise((r) => setTimeout(r, 10));
      yield "b";
    })();
    const p = handlers.get("agent:stream:start")(
      {},
      { streamId: "s_dup", source: slow },
    );
    const dup = await handlers.get("agent:stream:start")(
      {},
      { streamId: "s_dup", source: "x" },
    );
    expect(dup.ok).toBe(false);
    expect(dup.error).toMatch(/duplicate/);
    await p;
  });

  it("session:create + session:list + session:show + park/resume/close", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const created = await invoke("session:create", { agentId: "agent_x" });
    expect(created.ok).toBe(true);
    const sid = created.data.sessionId;

    const listed = await invoke("session:list", { agentId: "agent_x" });
    expect(listed.ok).toBe(true);
    expect(listed.data.some((s) => s.sessionId === sid)).toBe(true);

    const shown = await invoke("session:show", sid);
    expect(shown.ok).toBe(true);
    expect(shown.data.sessionId).toBe(sid);
    expect(shown.data.usage).toBeTruthy();

    // park requires status=idle (running → idle → parked)
    singletons.getSessionManager().markIdle(sid);
    const parked = await invoke("session:park", sid);
    expect(parked.ok).toBe(true);
    expect(parked.data.parked).toBe(true);

    const resumed = await invoke("session:resume", sid);
    expect(resumed.ok).toBe(true);
    expect(resumed.data.resumed).toBe(true);

    const closed = await invoke("session:close", sid);
    expect(closed.ok).toBe(true);
    expect(closed.data.closed).toBe(true);

    const after = await invoke("session:show", sid);
    expect(after.ok).toBe(false);
  });

  it("session:create rejects missing agentId", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const res = await invoke("session:create", {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/agentId/);
  });

  it("session:policy:get returns default STRICT for unknown sessions", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const res = await invoke("session:policy:get", "sess_x");
    expect(res.ok).toBe(true);
    expect(res.data.policy).toBe("strict");
  });

  it("session:policy:set persists across singleton re-hydration", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const setRes = await invoke("session:policy:set", "sess_a", "autopilot");
    expect(setRes.ok).toBe(true);
    expect(setRes.data.policy).toBe("autopilot");

    // Wait for async persist (ApprovalGate._persist() is fire-and-forget).
    await new Promise((r) => setTimeout(r, 30));

    // Force a fresh singleton load (simulates Desktop restart).
    singletons.resetSessionCoreSingletonsForTests();
    const mock2 = buildMockIpc();
    registerSessionCoreIpc(mock2.ipcMain);
    const getRes = await mock2.invoke("session:policy:get", "sess_a");
    expect(getRes.data.policy).toBe("autopilot");
  });

  it("session:policy:set rejects invalid policy", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const res = await invoke("session:policy:set", "sess_b", "bogus");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid policy/);
  });

  it("session:policy:clear removes override", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    await invoke("session:policy:set", "sess_c", "trusted");
    const cleared = await invoke("session:policy:clear", "sess_c");
    expect(cleared.ok).toBe(true);
    expect(cleared.data.cleared).toBe(true);
    const after = await invoke("session:policy:get", "sess_c");
    expect(after.data.policy).toBe("strict");
  });

  it("memory:store + memory:recall round-trip via singleton", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const stored = await invoke("memory:store", {
      scope: "global",
      content: "Likes TypeScript",
      category: "preference",
      tags: ["lang"],
    });
    expect(stored.ok).toBe(true);
    expect(stored.data.id).toBeTruthy();

    const recalled = await invoke("memory:recall", {
      query: "typescript",
      scope: "global",
    });
    expect(recalled.ok).toBe(true);
    expect(recalled.data.length).toBeGreaterThan(0);
    expect(recalled.data[0].content).toMatch(/TypeScript/);
  });

  it("memory:store rejects non-object entry", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const res = await invoke("memory:store", null);
    expect(res.ok).toBe(false);
  });

  it("memory:consolidate writes facts from supplied JSONL events", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const events = [
      {
        type: "user_message",
        data: { content: "我喜欢用 TypeScript 写代码" },
      },
      {
        type: "tool_result",
        data: { tool: "read_file", result: { ok: true, summary: "ok" } },
      },
    ];
    const res = await invoke("memory:consolidate", {
      sessionId: "sess_consolidate",
      agentId: "agent_a",
      scope: "agent",
      events,
    });
    expect(res.ok).toBe(true);
    expect(res.data.eventCount).toBe(2);
    expect(res.data.writtenCount).toBeGreaterThan(0);
  });

  it("memory:consolidate rejects missing events", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const res = await invoke("memory:consolidate", { sessionId: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/events/);
  });

  it("beta:enable + beta:list + beta:disable flow", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const flag = "idle-park-2026-05-01";
    const en = await invoke("beta:enable", flag);
    expect(en.ok).toBe(true);
    expect(en.data.enabled).toBe(true);

    const list = await invoke("beta:list");
    expect(list.ok).toBe(true);
    expect(list.data.some((f) => f.flag === flag && f.enabled)).toBe(true);

    const dis = await invoke("beta:disable", flag);
    expect(dis.ok).toBe(true);
    expect(dis.data.enabled).toBe(false);
  });

  it("beta:enable rejects empty flag", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const res = await invoke("beta:enable", "");
    expect(res.ok).toBe(false);
  });

  it("singletons write files under the configured home dir", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    await invoke("session:policy:set", "sess_d", "trusted");
    await invoke("memory:store", {
      scope: "global",
      content: "x",
      category: "note",
    });
    await invoke("beta:enable", "feature-2026-01-01");
    await new Promise((r) => setTimeout(r, 30));

    expect(fs.existsSync(path.join(tmpHome, "approval-policies.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(tmpHome, "memory-store.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, "beta-flags.json"))).toBe(true);
  });

  it("session:usage returns aggregate session-hour metrics", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    await invoke("session:create", { agentId: "usage-agent" });
    const res = await invoke("session:usage");
    expect(res.ok).toBe(true);
    expect(res.data.total.sessionCount).toBeGreaterThanOrEqual(1);
    expect(res.data.byAgent.length).toBeGreaterThanOrEqual(1);
    expect(res.data.byAgent[0].agentId).toBe("usage-agent");
  });

  it("session:subscribe forwards lifecycle events to webContents.send", async () => {
    const handlers = new Map();
    const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
    registerSessionCoreIpc(ipcMain);

    const sent = [];
    const fakeEvent = {
      sender: {
        send: (ch, ...args) => sent.push({ ch, args }),
        once: () => {},
      },
    };

    const res = await handlers.get("session:subscribe")(fakeEvent, {
      events: ["created", "idle"],
    });
    expect(res.ok).toBe(true);
    expect(res.data.subscribed).toBe(true);
    expect(res.data.events).toEqual(["created", "idle"]);

    const mgr = singletons.getSessionManager();
    const h = mgr.create({ agentId: "sub-test" });
    await new Promise((r) => setImmediate(r));

    const createdEvents = sent.filter(
      (s) => s.ch === "session:event" && s.args[0]?.type === "session.created",
    );
    expect(createdEvents.length).toBeGreaterThan(0);
    expect(createdEvents[0].args[0].session.agentId).toBe("sub-test");
  });

  it("session:subscribe defaults to all lifecycle events when filter omitted", async () => {
    const handlers = new Map();
    const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
    registerSessionCoreIpc(ipcMain);

    const fakeEvent = {
      sender: { send: () => {}, once: () => {} },
    };

    const res = await handlers.get("session:subscribe")(fakeEvent, {});
    expect(res.ok).toBe(true);
    expect(res.data.events).toHaveLength(7);
    expect(res.data.events).toEqual(
      expect.arrayContaining([
        "created",
        "adopted",
        "touched",
        "idle",
        "parked",
        "resumed",
        "closed",
      ]),
    );
  });

  // ── bundle IPC (Deep Agents Deploy — Desktop parity) ─────────────
  function createTestBundle(dir, manifest, extras = {}) {
    fs.mkdirSync(dir, { recursive: true });
    if (manifest) {
      fs.writeFileSync(
        path.join(dir, "chainless-agent.json"),
        JSON.stringify(manifest),
        "utf-8",
      );
    }
    if (extras.agentsMd) {
      fs.writeFileSync(path.join(dir, "AGENTS.md"), extras.agentsMd, "utf-8");
    }
    if (extras.userMd) {
      fs.writeFileSync(path.join(dir, "USER.md"), extras.userMd, "utf-8");
    }
    if (extras.approvalPolicy) {
      fs.mkdirSync(path.join(dir, "policies"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "policies", "approval.json"),
        JSON.stringify(extras.approvalPolicy),
        "utf-8",
      );
    }
  }

  it("registers 24 channels including bundle channels", () => {
    const { ipcMain, handlers } = buildMockIpc();
    const res = registerSessionCoreIpc(ipcMain);
    expect(res.channels).toHaveLength(24);
    expect(res.channels).toEqual(
      expect.arrayContaining(["bundle:load", "bundle:info", "bundle:unload"]),
    );
    expect(handlers.size).toBe(24);
  });

  it("bundle:load loads and resolves a bundle with AGENTS.md + USER.md", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const bundleDir = path.join(tmpHome, "test-bundle");
    createTestBundle(
      bundleDir,
      { id: "desktop-test", name: "Desktop Test", mode: "local" },
      {
        agentsMd: "You are a desktop assistant.",
        userMd: "# Profile\nPrefers Vue3.",
      },
    );

    const res = await invoke("bundle:load", { bundlePath: bundleDir });
    expect(res.ok).toBe(true);
    expect(res.data.resolved.manifest.id).toBe("desktop-test");
    expect(res.data.resolved.systemPrompt).toBe("You are a desktop assistant.");
    expect(res.data.resolved.seedResult.seeded).toBe(1);
    expect(res.data.bundle.hasAgentsMd).toBe(true);
    expect(res.data.bundle.hasUserMd).toBe(true);
    expect(res.data.loadedAt).toBeGreaterThan(0);
  });

  it("bundle:load seeds USER.md idempotently", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const bundleDir = path.join(tmpHome, "idem-bundle");
    createTestBundle(
      bundleDir,
      { id: "idem-test", name: "Idempotent", mode: "local" },
      { userMd: "# Profile\nLikes Rust.\n# Tone\nBe concise." },
    );

    const r1 = await invoke("bundle:load", { bundlePath: bundleDir });
    expect(r1.data.resolved.seedResult.seeded).toBe(2);

    const r2 = await invoke("bundle:load", { bundlePath: bundleDir });
    expect(r2.data.resolved.seedResult.seeded).toBe(0);
    expect(r2.data.resolved.seedResult.skipped).toBe(2);
  });

  it("bundle:load applies approval policy to session", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const bundleDir = path.join(tmpHome, "approval-bundle");
    createTestBundle(
      bundleDir,
      { id: "ap-test", name: "Approval", mode: "local" },
      { approvalPolicy: { default: "trusted" } },
    );

    const created = await invoke("session:create", { agentId: "ap-agent" });
    const sid = created.data.sessionId;

    const res = await invoke("bundle:load", {
      bundlePath: bundleDir,
      sessionId: sid,
    });
    expect(res.ok).toBe(true);

    const policy = await invoke("session:policy:get", sid);
    expect(policy.data.policy).toBe("trusted");
  });

  it("bundle:load returns error for invalid path", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const res = await invoke("bundle:load", {
      bundlePath: path.join(tmpHome, "does-not-exist"),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not a directory/);
  });

  it("bundle:load rejects missing bundlePath", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const res = await invoke("bundle:load", {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/bundlePath/);
  });

  it("bundle:info returns null when no bundle loaded", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const res = await invoke("bundle:info");
    expect(res.ok).toBe(true);
    expect(res.data).toBeNull();
  });

  it("bundle:info returns cached bundle after load", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const bundleDir = path.join(tmpHome, "info-bundle");
    createTestBundle(bundleDir, {
      id: "info-test",
      name: "Info",
      mode: "local",
    });

    await invoke("bundle:load", { bundlePath: bundleDir });
    const info = await invoke("bundle:info");
    expect(info.ok).toBe(true);
    expect(info.data.resolved.manifest.id).toBe("info-test");
  });

  it("bundle:unload clears the cached bundle", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const bundleDir = path.join(tmpHome, "unload-bundle");
    createTestBundle(bundleDir, {
      id: "unload-test",
      name: "Unload",
      mode: "local",
    });

    await invoke("bundle:load", { bundlePath: bundleDir });
    const unloaded = await invoke("bundle:unload");
    expect(unloaded.ok).toBe(true);
    expect(unloaded.data.unloaded).toBe(true);

    const info = await invoke("bundle:info");
    expect(info.data).toBeNull();
  });

  it("bundle:unload returns unloaded=false when nothing was loaded", async () => {
    const { ipcMain, invoke } = buildMockIpc();
    registerSessionCoreIpc(ipcMain);
    const res = await invoke("bundle:unload");
    expect(res.ok).toBe(true);
    expect(res.data.unloaded).toBe(false);
  });
});
