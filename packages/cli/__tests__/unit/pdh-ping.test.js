/**
 * `cc pdh ping` — live connectivity probe for the discovered PDH bridge
 * (design module 101). The list/status/doctor inspectors only READ lockfiles;
 * this VERIFIES the server actually responds (discover → connect → pdh_ping).
 * Covers probePdhBridge's logic + the command's JSON shape and the security
 * invariant that the bearer token is never surfaced.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { registerPdhCommand, probePdhBridge } from "../../src/commands/pdh.js";

const LOCK = {
  device: "pixel-7",
  port: 41320,
  transport: "http",
  url: "http://127.0.0.1:41320/mcp",
  token: "SUPER-SECRET-TOKEN",
};

/** A fake connect result with the given tools + a recording mcpClient. */
function fakeConnect({ tools = 6, hasPing = true, callTool } = {}) {
  const disconnected = { called: false };
  const extraToolDefinitions = hasPing
    ? [{ function: { name: "mcp__pdh__pdh_ping" } }]
    : [{ function: { name: "mcp__pdh__collect_files" } }];
  return {
    result: {
      connected: [{ server: "pdh", tools }],
      extraToolDefinitions,
      mcpClient: {
        callTool:
          callTool ||
          (async () => ({ content: [{ type: "text", text: "pong" }] })),
        disconnectAll: async () => {
          disconnected.called = true;
        },
      },
    },
    disconnected,
  };
}

describe("probePdhBridge", () => {
  it("reports stage=discover when nothing is found", async () => {
    const res = await probePdhBridge({}, { discoverPdhServer: () => null });
    expect(res).toMatchObject({ ok: false, stage: "discover" });
  });

  it("reports stage=connect when the connection throws", async () => {
    const res = await probePdhBridge(
      {},
      {
        discoverPdhServer: () => LOCK,
        setupMcpFromConfig: async () => {
          throw new Error("ECONNREFUSED");
        },
      },
    );
    expect(res).toMatchObject({
      ok: false,
      stage: "connect",
      reason: "ECONNREFUSED",
      device: "pixel-7",
      port: 41320,
    });
  });

  it("reports stage=connect when the server connects with no tools", async () => {
    const res = await probePdhBridge(
      {},
      {
        discoverPdhServer: () => LOCK,
        setupMcpFromConfig: async () => ({ connected: [] }),
      },
    );
    expect(res).toMatchObject({ ok: false, stage: "connect" });
  });

  it("a successful pdh_ping round-trip returns ok with text + latency", async () => {
    const f = fakeConnect();
    let t = 1000;
    const res = await probePdhBridge(
      {},
      {
        discoverPdhServer: () => LOCK,
        setupMcpFromConfig: async () => f.result,
        now: () => (t += 25),
      },
    );
    expect(res).toMatchObject({
      ok: true,
      stage: "ping",
      device: "pixel-7",
      port: 41320,
      tools: 6,
      pingAttempted: true,
      pingOk: true,
      pingText: "pong",
    });
    expect(res.latencyMs).toBe(25);
    expect(f.disconnected.called).toBe(true); // always cleans up
  });

  it("a pdh_ping that returns isError is not ok", async () => {
    const f = fakeConnect({
      callTool: async () => ({ isError: true, content: [] }),
    });
    const res = await probePdhBridge(
      {},
      {
        discoverPdhServer: () => LOCK,
        setupMcpFromConfig: async () => f.result,
      },
    );
    expect(res).toMatchObject({ ok: false, pingOk: false });
    expect(f.disconnected.called).toBe(true);
  });

  it("a pdh_ping that throws is reported as pingError and still disconnects", async () => {
    const f = fakeConnect({
      callTool: async () => {
        throw new Error("tool timeout");
      },
    });
    const res = await probePdhBridge(
      {},
      {
        discoverPdhServer: () => LOCK,
        setupMcpFromConfig: async () => f.result,
      },
    );
    expect(res).toMatchObject({
      ok: false,
      pingOk: false,
      pingError: "tool timeout",
    });
    expect(f.disconnected.called).toBe(true);
  });

  it("falls back to connect-as-liveness when the bridge has no pdh_ping", async () => {
    const f = fakeConnect({ hasPing: false });
    const res = await probePdhBridge(
      {},
      {
        discoverPdhServer: () => LOCK,
        setupMcpFromConfig: async () => f.result,
      },
    );
    expect(res).toMatchObject({ ok: true, pingAttempted: false, pingOk: null });
  });

  it("never surfaces the bearer token", async () => {
    const f = fakeConnect();
    const res = await probePdhBridge(
      {},
      {
        discoverPdhServer: () => LOCK,
        setupMcpFromConfig: async () => f.result,
      },
    );
    expect(JSON.stringify(res)).not.toMatch(/SUPER-SECRET-TOKEN/);
  });
});

describe("cc pdh ping command", () => {
  let logSpy;
  const origExit = process.exitCode;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = origExit;
  });

  async function run(probeResult, ...argv) {
    logSpy.mockClear();
    const program = new Command();
    program.exitOverride();
    registerPdhCommand(program, { probePdhBridge: async () => probeResult });
    await program.parseAsync(["node", "cc", "pdh", "ping", ...argv]);
    return logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
  }

  it("--json emits the probe result verbatim", async () => {
    const out = await run(
      {
        ok: true,
        stage: "ping",
        device: "pixel-7",
        port: 41320,
        tools: 6,
        latencyMs: 12,
        pingAttempted: true,
        pingOk: true,
        pingText: "pong",
      },
      "--json",
    );
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({ ok: true, device: "pixel-7", tools: 6 });
  });

  it("human output shows OK + pong on success", async () => {
    const out = await run({
      ok: true,
      stage: "ping",
      device: "pixel-7",
      port: 41320,
      tools: 6,
      latencyMs: 12,
      pingAttempted: true,
      pingOk: true,
      pingText: "pong",
    });
    expect(out).toMatch(/OK/);
    expect(out).toMatch(/pong/);
    expect(process.exitCode).toBe(0);
  });

  it("sets a non-zero exit code on failure", async () => {
    await run({
      ok: false,
      stage: "connect",
      device: "pixel-7",
      port: 41320,
      reason: "ECONNREFUSED",
    });
    expect(process.exitCode).toBe(1);
  });

  it("guides to doctor when nothing is discovered", async () => {
    const out = await run({ ok: false, stage: "discover", reason: "none" });
    expect(out).toMatch(/doctor/);
  });
});
