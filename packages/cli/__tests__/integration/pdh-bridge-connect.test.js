/**
 * PDH bridge (design module 101) — cc-side discover → connect → call, end to end.
 *
 * Until now the full chain was only verified MANUALLY ("跨设备验证法": run the
 * Android bridge, `adb forward`, hand-write a PC lockfile, then eyeball
 * `resolveAgentMcp` returning `connected:[{server:pdh}]`). This test automates
 * that whole path in CI with NO device:
 *
 *   discoverPdhServer (real lockfile scan / env fast-path)
 *     → pdhServerToMcpConfig (bearer header + longRunning)
 *       → setupMcpFromConfig → real MCPClient.connect over Streamable HTTP
 *         → tools/list → tools/call
 *
 * The device side is faked by `IdeMcpServer` — a generic, protocol-faithful
 * minimal MCP server (Streamable HTTP, protocolVersion 2024-11-05, Bearer auth,
 * Mcp-Session-Id). The Android PDH bridge speaks the IDENTICAL dialect (Ktor
 * CIO, same protocol version + bearer), so connecting the real cc MCPClient to
 * this server proves the cc half against the exact wire contract.
 *
 * The real `discoverPdhServer` reads `~/.chainlesschain/pdh-bridge/*.json`; we
 * point its `_deps.homedir` at a temp dir for the duration of the test (restored
 * in afterEach) so it scans our fresh lockfile and never touches a real device
 * lock or the user's home.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";

import { IdeMcpServer } from "../../../vscode-extension/src/mcp-http-server.js";
import {
  _deps as bridgeDeps,
  discoverPdhServer,
  readPdhLocks,
} from "../../src/lib/pdh-bridge.js";
import { loadPdhMcp, resolveAgentMcp } from "../../src/runtime/mcp-config.js";

const TOKEN = "pdh-secret-token";

// PDH-shaped tools the fake device bridge advertises. Mirrors the real bridge's
// tool surface closely enough to exercise discovery + a real round-trip call.
function pdhTools() {
  return [
    {
      name: "pdh_ping",
      description: "Liveness probe",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({
        pong: true,
        device: "test-pixel",
        tools: 3,
      }),
    },
    {
      name: "list_collectors",
      description: "List on-device collectors",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({
        collectors: ["system-data", "weibo", "bilibili"],
      }),
    },
    {
      // A blocking collect tool that yields an assist_required payload — proves
      // the longRunning/blocking-tool data contract round-trips over MCP.
      name: "collect_system_data",
      description: "Collect system data (may require a manual step)",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({
        status: "assist_required",
        message: "请在系统设置授予联系人权限后继续",
        resumeToken: "resume-abc",
      }),
    },
  ];
}

/** Write a fresh (live pid, recent mtime) PDH lockfile into `homeDir`. */
function writeLock(
  homeDir,
  { port, url, token = TOKEN, pid = process.pid, startedAt = Date.now() } = {},
) {
  const dir = path.join(homeDir, ".chainlesschain", "pdh-bridge");
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${port}.json`);
  fs.writeFileSync(
    fp,
    JSON.stringify({
      kind: "pdh-bridge",
      device: "test-pixel",
      appUid: 10368,
      transport: "http",
      url,
      port,
      token,
      pid,
      started_at: startedAt,
    }),
    "utf-8",
  );
  return fp;
}

describe("PDH bridge — discover → connect → call (no device)", () => {
  let server;
  let tmpHome;
  let realHomedir;
  let out;

  beforeEach(async () => {
    server = new IdeMcpServer({ tools: pdhTools(), token: TOKEN });
    await server.start({ port: 0 });
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-bridge-it-"));
    // Redirect the real discoverPdhServer's lockfile scan at our temp home.
    realHomedir = bridgeDeps.homedir;
    bridgeDeps.homedir = () => tmpHome;
  });

  afterEach(async () => {
    bridgeDeps.homedir = realHomedir;
    try {
      if (out?.mcpClient?.disconnectAll) await out.mcpClient.disconnectAll();
    } catch {
      /* ignore */
    }
    out = undefined;
    await server.stop();
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("env fast-path: connects pdh, exposes mcp__pdh__* tools, round-trips pdh_ping", async () => {
    const port = new URL(server.url()).port;
    writeLock(tmpHome, { port, url: server.url() });

    out = await loadPdhMcp({ env: { CHAINLESSCHAIN_PDH_PORT: port } });

    // connected as the reserved server `pdh` with all 3 tools.
    expect(out).toBeTruthy();
    const pdh = out.connected.find((c) => c.server === "pdh");
    expect(pdh).toMatchObject({ server: "pdh", tools: 3 });

    // Tools are namespaced mcp__pdh__* for the agent loop.
    const names = out.extraToolDefinitions.map((d) => d.function.name).sort();
    expect(names).toEqual([
      "mcp__pdh__collect_system_data",
      "mcp__pdh__list_collectors",
      "mcp__pdh__pdh_ping",
    ]);
    expect(out.externalToolExecutors["mcp__pdh__pdh_ping"]).toMatchObject({
      kind: "mcp",
      serverName: "pdh",
      toolName: "pdh_ping",
    });

    // Real tools/call over the live HTTP MCP transport.
    const res = await out.mcpClient.callTool("pdh", "pdh_ping", {});
    expect(JSON.parse(res.content[0].text)).toMatchObject({
      pong: true,
      device: "test-pixel",
    });
  });

  it("scan path (no env): picks the newest live lock and connects", async () => {
    const port = new URL(server.url()).port;
    // An older, dead lock for a port nothing listens on + the live one.
    writeLock(tmpHome, {
      port: 19999,
      url: "http://127.0.0.1:19999/mcp",
      pid: 0,
      startedAt: Date.now() - 1_000,
    });
    writeLock(tmpHome, {
      port,
      url: server.url(),
      startedAt: Date.now(),
    });

    out = await loadPdhMcp({ env: {} }); // no CHAINLESSCHAIN_PDH_PORT
    const pdh = out.connected.find((c) => c.server === "pdh");
    expect(pdh).toMatchObject({ server: "pdh", tools: 3 });
  });

  it("blocking collect tool round-trips its assist_required payload", async () => {
    const port = new URL(server.url()).port;
    writeLock(tmpHome, { port, url: server.url() });
    out = await loadPdhMcp({ env: { CHAINLESSCHAIN_PDH_PORT: port } });

    const res = await out.mcpClient.callTool("pdh", "collect_system_data", {});
    expect(JSON.parse(res.content[0].text)).toMatchObject({
      status: "assist_required",
      resumeToken: "resume-abc",
    });
  });

  it("wrong bearer token → no connection, no throw (graceful)", async () => {
    const port = new URL(server.url()).port;
    writeLock(tmpHome, { port, url: server.url(), token: "wrong-token" });

    const errs = [];
    out = await loadPdhMcp(
      { env: { CHAINLESSCHAIN_PDH_PORT: port } },
      { writeErr: (s) => errs.push(s) },
    );
    // The lock is discovered (token mismatch is a connect-time failure), so a
    // result object exists but `pdh` is NOT in connected.
    expect(out.connected.find((c) => c.server === "pdh")).toBeUndefined();
    expect(errs.join("")).toMatch(/failed to connect "pdh"/);
  });

  it("stale lock (dead pid + old mtime) is filtered → nothing discovered", async () => {
    const fp = writeLock(tmpHome, {
      port: 18510,
      url: "http://127.0.0.1:18510/mcp",
      pid: 0, // dead
    });
    // Backdate mtime past the 30s TTL so isStale() trips.
    const old = Date.now() / 1000 - 120;
    fs.utimesSync(fp, old, old);

    expect(readPdhLocks()).toEqual([]);
    expect(discoverPdhServer({ env: {} })).toBeNull();
    out = await loadPdhMcp({ env: {} });
    expect(out).toBeNull(); // nothing found, best-effort returns into|null
  });

  it("resolveAgentMcp wires pdh when --pdh and other sources disabled", async () => {
    const port = new URL(server.url()).port;
    writeLock(tmpHome, { port, url: server.url() });

    out = await resolveAgentMcp({
      pdh: true, // force PDH discovery
      env: { CHAINLESSCHAIN_PDH_PORT: port },
      includeRegistered: false,
      projectMcp: false,
      ide: false,
      jetbrains: false,
    });
    const pdh = out.connected.find((c) => c.server === "pdh");
    expect(pdh).toMatchObject({ server: "pdh", tools: 3 });
  });
});
