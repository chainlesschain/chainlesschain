/**
 * IDE bridge hot reconnect — a window reload / extension update restarts the
 * editor's MCP server on a NEW port with a NEW token. The MCPClient-level
 * reconnector (registered by loadIdeMcp) must re-scan the lockfiles
 * mid-session and retry the failed call once, instead of letting every
 * mcp__ide__* tool (and the selection/diagnostics injection riding on them)
 * silently die for the rest of the run.
 *
 * Two layers:
 *  - unit: MCPClient + fake fetch endpoints (error classification, retry-once,
 *    single-flight, null reconnector, tool errors don't reconnect)
 *  - integration: REAL extension IdeMcpServer A → stop → REAL server B on a
 *    new port/token + lockfile swap → callTool transparently reconnects.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";

import { IdeMcpServer } from "../../../vscode-extension/src/mcp-http-server.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";
import lockfile from "../../../vscode-extension/src/lockfile.js";
import {
  MCPClient,
  isLikelyConnectionError,
  _deps as clientDeps,
} from "../../src/harness/mcp-client.js";
import { _deps as ideDeps } from "../../src/lib/ide-bridge.js";
import { loadIdeMcp } from "../../src/runtime/mcp-config.js";

// ─── fake Streamable-HTTP MCP endpoint (unit layer) ─────────────────────────

function resp(status, jsonBody) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => jsonBody,
    text: async () => (jsonBody == null ? "" : JSON.stringify(jsonBody)),
  };
}
const rpc = (id, result) => resp(200, { jsonrpc: "2.0", id, result });

let nextPort = 51000;
function fakeEndpoint({ token = null, marker = "x", toolError = null } = {}) {
  const url = `http://127.0.0.1:${nextPort++}/mcp`;
  const ep = {
    url,
    token,
    calls: 0,
    async handler(_u, init) {
      const h = init.headers || {};
      const auth = h.Authorization || h.authorization;
      if (ep.token && auth !== `Bearer ${ep.token}`) {
        return resp(401, { error: "unauthorized" });
      }
      const body = JSON.parse(init.body);
      if (body.id === undefined) return resp(202, null); // notification
      if (body.method === "initialize") {
        return rpc(body.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-" + marker },
        });
      }
      if (body.method === "tools/list") {
        return rpc(body.id, {
          tools: [{ name: "ping", inputSchema: { type: "object" } }],
        });
      }
      if (body.method === "tools/call") {
        ep.calls++;
        if (toolError) {
          return resp(200, {
            jsonrpc: "2.0",
            id: body.id,
            error: { message: toolError },
          });
        }
        return rpc(body.id, {
          content: [{ type: "text", text: "pong-" + marker }],
        });
      }
      return rpc(body.id, {});
    },
  };
  return ep;
}

describe("isLikelyConnectionError", () => {
  it("classifies connection-shaped errors", () => {
    for (const m of [
      "fetch failed",
      "connect ECONNREFUSED 127.0.0.1:1",
      "HTTP 401: nope",
      "HTTP 404",
      'Server "ide" not found',
      'Server "ide" is not connected',
      "Server not available",
      "socket hang up",
    ]) {
      expect(isLikelyConnectionError(new Error(m)), m).toBe(true);
    }
  });

  it("does NOT classify tool-level failures", () => {
    for (const m of ["boom", "HTTP 500: oops", "invalid arguments", ""]) {
      expect(isLikelyConnectionError(new Error(m)), m || "(empty)").toBe(false);
    }
  });
});

describe("MCPClient hot reconnect (unit, fake fetch)", () => {
  let client;
  let endpoints;
  const origFetch = clientDeps.fetch;

  beforeEach(() => {
    endpoints = [];
    clientDeps.fetch = async (u, init) => {
      const ep = endpoints.find((e) => e.url === u);
      if (!ep) throw new TypeError("fetch failed");
      return ep.handler(u, init);
    };
    client = new MCPClient();
  });

  afterEach(async () => {
    clientDeps.fetch = origFetch;
    try {
      await client.disconnectAll();
    } catch {
      /* ignore */
    }
  });

  async function connectTo(ep, name = "ide") {
    return client.connect(name, {
      url: ep.url,
      transport: "http",
      headers: ep.token ? { Authorization: `Bearer ${ep.token}` } : {},
    });
  }

  it("retries once via the reconnector after the server vanishes", async () => {
    const a = fakeEndpoint({ token: "tok-a", marker: "a" });
    endpoints.push(a);
    await connectTo(a);
    expect(
      (await client.callTool("ide", "ping", {})).content[0].text,
    ).toBe("pong-a");

    // IDE "restarts": old endpoint gone, new one on a new port + new token.
    const b = fakeEndpoint({ token: "tok-b", marker: "b" });
    endpoints.splice(0, endpoints.length, b);
    const reconnector = vi.fn(() => ({
      url: b.url,
      transport: "http",
      headers: { Authorization: "Bearer tok-b" },
    }));
    client.setReconnector("ide", reconnector);
    const reconnected = vi.fn();
    client.on("server-reconnected", reconnected);

    const r = await client.callTool("ide", "ping", {});
    expect(r.content[0].text).toBe("pong-b");
    expect(reconnector).toHaveBeenCalledTimes(1);
    expect(reconnected).toHaveBeenCalledWith({ name: "ide", url: b.url });
    expect(client.servers.get("ide").httpUrl).toBe(b.url);
  });

  it("reconnects on 401 after a token rotation on the same port", async () => {
    const a = fakeEndpoint({ token: "old-token", marker: "a" });
    endpoints.push(a);
    await connectTo(a);
    a.token = "new-token"; // server restarted on the same port, new token
    a.marker = "a2";
    client.setReconnector("ide", () => ({
      url: a.url,
      transport: "http",
      headers: { Authorization: "Bearer new-token" },
    }));

    const r = await client.callTool("ide", "ping", {});
    expect(r.content[0].text).toBe("pong-a");
    expect(client.servers.get("ide").httpHeaders.Authorization).toBe(
      "Bearer new-token",
    );
  });

  it("propagates the original error when the reconnector finds nothing", async () => {
    const a = fakeEndpoint({ marker: "a" });
    endpoints.push(a);
    await connectTo(a);
    endpoints.length = 0; // gone for good
    const reconnector = vi.fn(() => null);
    client.setReconnector("ide", reconnector);

    await expect(client.callTool("ide", "ping", {})).rejects.toThrow(
      /fetch failed/,
    );
    expect(reconnector).toHaveBeenCalledTimes(1);
  });

  it("does NOT reconnect on tool-level errors", async () => {
    const a = fakeEndpoint({ marker: "a", toolError: "boom" });
    endpoints.push(a);
    await connectTo(a);
    const reconnector = vi.fn();
    client.setReconnector("ide", reconnector);

    await expect(client.callTool("ide", "ping", {})).rejects.toThrow("boom");
    expect(reconnector).not.toHaveBeenCalled();
  });

  it("does not retry without a reconnector", async () => {
    const a = fakeEndpoint({ marker: "a" });
    endpoints.push(a);
    await connectTo(a);
    endpoints.length = 0;
    await expect(client.callTool("ide", "ping", {})).rejects.toThrow(
      /fetch failed/,
    );
  });

  it("single-flights concurrent reconnects (parallel ide-context calls)", async () => {
    const a = fakeEndpoint({ marker: "a" });
    endpoints.push(a);
    await connectTo(a);
    const b = fakeEndpoint({ token: "tok-b", marker: "b" });
    endpoints.splice(0, endpoints.length, b);
    const reconnector = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20)); // widen the overlap window
      return {
        url: b.url,
        transport: "http",
        headers: { Authorization: "Bearer tok-b" },
      };
    });
    client.setReconnector("ide", reconnector);

    const [r1, r2] = await Promise.all([
      client.callTool("ide", "ping", {}),
      client.callTool("ide", "ping", {}),
    ]);
    expect(r1.content[0].text).toBe("pong-b");
    expect(r2.content[0].text).toBe("pong-b");
    expect(reconnector).toHaveBeenCalledTimes(1);
  });

  it("self-heals when the server entry was already dropped", async () => {
    const b = fakeEndpoint({ token: "tok-b", marker: "b" });
    endpoints.push(b);
    // No prior connect — e.g. an earlier failed reconnect deleted the entry.
    client.setReconnector("ide", () => ({
      url: b.url,
      transport: "http",
      headers: { Authorization: "Bearer tok-b" },
    }));

    const r = await client.callTool("ide", "ping", {});
    expect(r.content[0].text).toBe("pong-b");
  });
});

// ─── integration: real extension server + lockfile re-scan ──────────────────

function facade(marker) {
  return {
    getSelection: async () => ({ file: "/ws/a.js", text: "sel-" + marker }),
    getDiagnostics: async () => [],
    getOpenEditors: async () => [],
    openDiff: async () => ({ outcome: "rejected" }),
  };
}

const portOf = (server) => Number(new URL(server.url()).port);

describe("IDE hot reconnect (integration: real IdeMcpServer restart)", () => {
  let tmpHome;
  let ws;
  let serverA;
  let serverB;
  let out;
  const origHomedirReader = ideDeps.homedir;
  const origHomedirWriter = lockfile._deps.homedir;

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ide-reconnect-"));
    ws = path.join(tmpHome, "ws");
    fs.mkdirSync(ws, { recursive: true });
    ideDeps.homedir = () => tmpHome; // CLI lockfile reader
    lockfile._deps.homedir = () => tmpHome; // extension lockfile writer

    serverA = new IdeMcpServer({
      tools: buildIdeTools(facade("A")),
      token: "token-A",
    });
    await serverA.start({ port: 0 });
    lockfile.writeLock({
      port: portOf(serverA),
      token: "token-A",
      workspaceFolders: [ws],
      url: serverA.url(),
    });
    out = await loadIdeMcp({ cwd: ws, env: {} }, { writeErr: () => {} });
  });

  afterEach(async () => {
    ideDeps.homedir = origHomedirReader;
    lockfile._deps.homedir = origHomedirWriter;
    try {
      await out?.mcpClient?.disconnectAll();
    } catch {
      /* ignore */
    }
    for (const s of [serverA, serverB]) {
      try {
        await s?.stop();
      } catch {
        /* ignore */
      }
    }
    serverB = null;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("survives an IDE restart: new port + new token via lockfile re-scan", async () => {
    const r1 = await out.mcpClient.callTool("ide", "getSelection", {});
    expect(JSON.stringify(r1)).toContain("sel-A");

    // "Window reload": server A dies, B comes up on a new port + new token.
    const portA = portOf(serverA);
    await serverA.stop();
    lockfile.removeLock(portA);
    serverB = new IdeMcpServer({
      tools: buildIdeTools(facade("B")),
      token: "token-B",
    });
    await serverB.start({ port: 0 });
    lockfile.writeLock({
      port: portOf(serverB),
      token: "token-B",
      workspaceFolders: [ws],
      url: serverB.url(),
    });

    const r2 = await out.mcpClient.callTool("ide", "getSelection", {});
    expect(JSON.stringify(r2)).toContain("sel-B");
    const entry = out.mcpClient.servers.get("ide");
    expect(entry.httpUrl).toBe(serverB.url());
    expect(entry.httpHeaders.Authorization).toBe("Bearer token-B");
  });

  it("fails cleanly when the IDE is gone and no new lock appears", async () => {
    const portA = portOf(serverA);
    await serverA.stop();
    lockfile.removeLock(portA);

    await expect(
      out.mcpClient.callTool("ide", "getSelection", {}),
    ).rejects.toThrow();
  });
});
