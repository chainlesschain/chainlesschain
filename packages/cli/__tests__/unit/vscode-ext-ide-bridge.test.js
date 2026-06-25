/**
 * VS Code IDE-bridge extension (Phase 1) — verified WITHOUT a VS Code host:
 *   1. interop: the extension's embedded MCP server driven by the REAL CLI
 *      MCPClient (initialize → tools/list → tools/call for all 4 tools + auth).
 *   2. tool logic: buildIdeTools against a fake editor facade.
 *   3. discovery contract: lockfile written by the extension is read back by
 *      the CLI's Phase-0 ide-bridge reader (editor-writes ↔ CLI-reads).
 *
 * Lives in the CLI suite so it runs in CI and can import the CLI MCPClient +
 * ide-bridge directly. The extension modules are pure Node (no `vscode`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";

import { IdeMcpServer } from "../../../vscode-extension/src/mcp-http-server.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";
import lockfile from "../../../vscode-extension/src/lockfile.js";
import { MCPClient } from "../../src/harness/mcp-client.js";
import {
  _deps as ideDeps,
  readIdeLocks,
  discoverIdeServer,
} from "../../src/lib/ide-bridge.js";

// A fake VS Code editor facade with deterministic state.
function fakeFacade() {
  return {
    getSelection: async () => ({
      file: "/abs/ws/src/a.js",
      languageId: "javascript",
      selection: {
        start: { line: 3, character: 2 },
        end: { line: 3, character: 9 },
      },
      text: "foo()",
    }),
    getDiagnostics: async ({ path: p } = {}) => {
      const all = [
        {
          file: "/abs/ws/src/a.js",
          severity: "error",
          message: "boom",
          line: 3,
        },
        {
          file: "/abs/ws/src/b.js",
          severity: "warning",
          message: "meh",
          line: 1,
        },
      ];
      return p ? all.filter((d) => d.file === p) : all;
    },
    getOpenEditors: async () => [
      { file: "/abs/ws/src/a.js", active: true, languageId: "javascript" },
      { file: "/abs/ws/src/b.js", active: false, languageId: "javascript" },
    ],
    openDiff: vi.fn(async (args) => ({
      outcome: "accepted",
      path: args.path,
      finalText: args.modifiedText,
    })),
  };
}

describe("buildIdeTools (fake facade)", () => {
  const tools = buildIdeTools(fakeFacade());
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  it("exposes the 4 IDE tools with schemas", () => {
    expect(Object.keys(byName).sort()).toEqual([
      "getDiagnostics",
      "getOpenEditors",
      "getSelection",
      "openDiff",
    ]);
    expect(byName.openDiff.inputSchema.required).toEqual([
      "path",
      "modifiedText",
    ]);
  });

  it("getSelection returns the active selection", async () => {
    expect(await byName.getSelection.handler({})).toMatchObject({
      file: "/abs/ws/src/a.js",
      text: "foo()",
    });
  });

  it("getDiagnostics scopes by path", async () => {
    const all = await byName.getDiagnostics.handler({});
    expect(all.diagnostics).toHaveLength(2);
    const scoped = await byName.getDiagnostics.handler({
      path: "/abs/ws/src/a.js",
    });
    expect(scoped.diagnostics).toHaveLength(1);
  });

  it("openDiff requires path + modifiedText", async () => {
    await expect(byName.openDiff.handler({ path: "/x" })).rejects.toThrow(
      /requires/,
    );
    expect(
      await byName.openDiff.handler({ path: "/x", modifiedText: "new" }),
    ).toMatchObject({ outcome: "accepted", finalText: "new" });
  });
});

describe("IdeMcpServer ↔ CLI MCPClient interop", () => {
  let server;
  let client;
  const TOKEN = "interop-secret";

  beforeEach(async () => {
    server = new IdeMcpServer({
      tools: buildIdeTools(fakeFacade()),
      token: TOKEN,
    });
    await server.start({ port: 0 });
    client = new MCPClient();
  });

  afterEach(async () => {
    try {
      await client.disconnectAll();
    } catch {
      /* ignore */
    }
    await server.stop();
  });

  it("connects, lists 4 tools, and calls getSelection over Streamable HTTP", async () => {
    const r = await client.connect("ide", {
      url: server.url(),
      transport: "http",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.tools.map((t) => t.name).sort()).toEqual([
      "getDiagnostics",
      "getOpenEditors",
      "getSelection",
      "openDiff",
    ]);

    const res = await client.callTool("ide", "getSelection", {});
    const payload = JSON.parse(res.content[0].text);
    expect(payload).toMatchObject({ file: "/abs/ws/src/a.js", text: "foo()" });
  });

  it("calls openDiff with arguments and gets a shown result", async () => {
    await client.connect("ide", {
      url: server.url(),
      transport: "http",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const res = await client.callTool("ide", "openDiff", {
      path: "/abs/ws/src/a.js",
      modifiedText: "bar()",
    });
    expect(JSON.parse(res.content[0].text)).toMatchObject({
      outcome: "accepted",
      finalText: "bar()",
    });
  });

  it("surfaces a tool error as an isError result, not a transport failure", async () => {
    await client.connect("ide", {
      url: server.url(),
      transport: "http",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const res = await client.callTool("ide", "openDiff", { path: "/x" }); // missing modifiedText
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/requires/);
  });

  it("rejects a connection with the wrong bearer token", async () => {
    await expect(
      client.connect("ide", {
        url: server.url(),
        transport: "http",
        headers: { Authorization: "Bearer WRONG" },
      }),
    ).rejects.toThrow();
  });
});

describe("IdeMcpServer onActivity hook (UI feed)", () => {
  let server;
  let client;
  const TOKEN = "activity-secret";
  let events;

  beforeEach(async () => {
    events = [];
    server = new IdeMcpServer({
      tools: buildIdeTools(fakeFacade()),
      token: TOKEN,
      onActivity: (e) => events.push(e),
    });
    await server.start({ port: 0 });
    client = new MCPClient();
  });

  afterEach(async () => {
    try {
      await client.disconnectAll();
    } catch {
      /* ignore */
    }
    await server.stop();
  });

  it("emits a connect event on initialize and a tool event per call", async () => {
    await client.connect("ide", {
      url: server.url(),
      transport: "http",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    await client.callTool("ide", "getSelection", {});
    await client.callTool("ide", "openDiff", { path: "/p" }); // missing modifiedText → tool error

    expect(events.some((e) => e.type === "connect")).toBe(true);
    const tools = events.filter((e) => e.type === "tool");
    expect(tools.find((e) => e.tool === "getSelection")?.ok).toBe(true);
    expect(tools.find((e) => e.tool === "openDiff")?.ok).toBe(false); // surfaced as activity
  });
});

describe("openDiff blocking review round-trip (Phase 2)", () => {
  let server;
  let client;
  const TOKEN = "review-secret";

  // A facade whose openDiff resolves only AFTER a delay, simulating the user
  // taking time to accept — the HTTP response stays open until they decide.
  function deferredReviewFacade(delayMs, outcome) {
    const base = fakeFacade();
    base.openDiff = vi.fn(
      (args) =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                outcome === "rejected"
                  ? { outcome: "rejected", path: args.path }
                  : {
                      outcome: "accepted",
                      path: args.path,
                      finalText: args.modifiedText,
                    },
              ),
            delayMs,
          ),
        ),
    );
    return base;
  }

  afterEach(async () => {
    try {
      await client?.disconnectAll();
    } catch {
      /* ignore */
    }
    await server?.stop();
  });

  it("disables Node request/socket timeouts so a long review is not cut", async () => {
    server = new IdeMcpServer({ tools: [], token: TOKEN });
    await server.start({ port: 0 });
    expect(server._server.requestTimeout).toBe(0);
    expect(server._server.timeout).toBe(0);
  });

  it("holds the call open until the user accepts, then returns finalText", async () => {
    server = new IdeMcpServer({
      tools: buildIdeTools(deferredReviewFacade(180, "accepted")),
      token: TOKEN,
    });
    await server.start({ port: 0 });
    client = new MCPClient();
    await client.connect("ide", {
      url: server.url(),
      transport: "http",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const t0 = Date.now();
    const res = await client.callTool("ide", "openDiff", {
      path: "/abs/ws/src/a.js",
      modifiedText: "applied()",
    });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150); // actually waited
    expect(JSON.parse(res.content[0].text)).toMatchObject({
      outcome: "accepted",
      finalText: "applied()",
    });
  });

  it("returns outcome:rejected when the user declines", async () => {
    server = new IdeMcpServer({
      tools: buildIdeTools(deferredReviewFacade(20, "rejected")),
      token: TOKEN,
    });
    await server.start({ port: 0 });
    client = new MCPClient();
    await client.connect("ide", {
      url: server.url(),
      transport: "http",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const res = await client.callTool("ide", "openDiff", {
      path: "/abs/ws/src/a.js",
      modifiedText: "nope()",
    });
    const out = JSON.parse(res.content[0].text);
    expect(out.outcome).toBe("rejected");
    expect(out.finalText).toBeUndefined();
  });
});

describe("lockfile ↔ CLI Phase-0 reader contract", () => {
  let tmp;
  const lockOrig = { ...lockfile._deps };
  const ideOrig = { ...ideDeps };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ide-lock-"));
    // Both sides point at the same fake home.
    lockfile._deps.homedir = () => tmp;
    lockfile._deps.now = () => 1_700_000_000_000;
    ideDeps.homedir = () => tmp;
    ideDeps.now = () => 1_700_000_000_000;
    ideDeps.processAlive = () => true; // pretend the editor pid is alive
  });

  afterEach(() => {
    Object.assign(lockfile._deps, lockOrig);
    Object.assign(ideDeps, ideOrig);
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("extension writes a lock the CLI discovers + maps to an MCP config", () => {
    const file = lockfile.writeLock({
      port: 53777,
      token: "abc",
      workspaceFolders: ["/abs/ws"],
    });
    expect(fs.existsSync(file)).toBe(true);

    const locks = readIdeLocks();
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({ port: 53777, transport: "http" });

    const chosen = discoverIdeServer({ cwd: "/abs/ws/src", env: {} });
    expect(chosen).toMatchObject({ port: 53777, token: "abc" });

    // env fast-path also resolves it
    const viaEnv = discoverIdeServer({
      cwd: "/elsewhere",
      env: { CHAINLESSCHAIN_IDE_PORT: "53777" },
    });
    expect(viaEnv.port).toBe(53777);
  });

  it("removeLock makes the CLI no longer discover it", () => {
    lockfile.writeLock({
      port: 53777,
      token: "abc",
      workspaceFolders: ["/abs/ws"],
    });
    expect(readIdeLocks()).toHaveLength(1);
    expect(lockfile.removeLock(53777)).toBe(true);
    expect(readIdeLocks()).toHaveLength(0);
  });
});

describe("IdeMcpServer post-listen 'error' guard", () => {
  it("swallows a later server error (routes to onError) instead of throwing", async () => {
    const errors = [];
    const server = new IdeMcpServer({
      tools: [],
      token: "t",
      onError: (e) => errors.push(e),
    });
    await server.start({ port: 0 });
    // After listen() the one-shot start-error listener is removed; a server
    // 'error' with no listener would be thrown uncaught by Node. The persistent
    // guard must absorb it and surface it via onError.
    const boom = new Error("socket boom");
    expect(() => server._server.emit("error", boom)).not.toThrow();
    expect(errors).toContain(boom);
    await server.stop();
  });

  it("a server without onError still doesn't throw on a post-listen error", async () => {
    const server = new IdeMcpServer({ tools: [], token: "t" });
    await server.start({ port: 0 });
    expect(() => server._server.emit("error", new Error("x"))).not.toThrow();
    await server.stop();
  });
});
