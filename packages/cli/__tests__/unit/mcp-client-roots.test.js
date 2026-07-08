/**
 * MCP roots capability (Claude-Code 2.1.203 parity).
 *
 * roots is a CLIENT capability: the server asks the client for its workspace
 * roots via a server→client `roots/list` request, and the client announces
 * changes with `notifications/roots/list_changed`. Before this feature, any
 * server-initiated request fell into the notification branch of
 * _handleMessage and never got a response — the server hung until its own
 * timeout. Now: roots/list is answered with the session working directories
 * (explicit roots or process.cwd()), ping is acked, and unknown requests get
 * a JSON-RPC -32601 error instead of silence.
 *
 * A fake child (EventEmitter) is injected via _deps.spawn; stdin.write
 * records every frame so the tests can assert what the client sent.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { pathToFileURL } from "url";
import { MCPClient } from "../../src/lib/mcp-client.js";

function handshakeResult(method) {
  switch (method) {
    case "initialize":
      return {
        serverInfo: { name: "fake", version: "1" },
        capabilities: { tools: {} },
      };
    case "tools/list":
      return { tools: [] };
    case "resources/list":
      return { resources: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      return undefined;
  }
}

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = () => {
    proc.killed = true;
  };
  const stdin = new EventEmitter();
  proc.written = []; // every parsed frame the client wrote
  stdin.write = (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data).trim());
    } catch {
      return true;
    }
    proc.written.push(msg);
    if (msg.id === undefined || msg.method === undefined) return true;
    const result = handshakeResult(msg.method);
    if (result !== undefined) {
      setImmediate(() => {
        proc.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n",
          ),
        );
      });
    }
    return true;
  };
  proc.stdin = stdin;
  return proc;
}

/** Emit a server→client frame and yield the event loop so it is processed. */
async function fromServer(proc, frame) {
  proc.stdout.emit("data", Buffer.from(JSON.stringify(frame) + "\n"));
  await new Promise((r) => setImmediate(r));
}

describe("MCPClient roots capability", () => {
  let proc;

  beforeEach(async () => {
    const mod = await import("../../src/lib/mcp-client.js");
    proc = makeFakeProc();
    mod._deps.spawn = () => proc;
  });

  it("advertises roots (listChanged) in the initialize capabilities", async () => {
    const client = new MCPClient();
    await client.connect("srv", { command: "fake-mcp" });
    const init = proc.written.find((m) => m.method === "initialize");
    expect(init.params.capabilities.roots).toEqual({ listChanged: true });
  });

  it("answers a server roots/list request with the cwd by default", async () => {
    const client = new MCPClient();
    await client.connect("srv", { command: "fake-mcp" });

    await fromServer(proc, {
      jsonrpc: "2.0",
      id: "srv-req-1",
      method: "roots/list",
    });

    const resp = proc.written.find((m) => m.id === "srv-req-1");
    expect(resp).toBeDefined();
    expect(resp.error).toBeUndefined();
    expect(resp.result.roots).toEqual([
      { uri: pathToFileURL(process.cwd()).href, name: process.cwd() },
    ]);
  });

  it("answers with explicit roots when configured", async () => {
    const dir = process.cwd(); // a real path keeps pathToFileURL happy on all OSes
    const client = new MCPClient({ roots: [dir] });
    await client.connect("srv", { command: "fake-mcp" });

    await fromServer(proc, { jsonrpc: "2.0", id: 77, method: "roots/list" });

    const resp = proc.written.find((m) => m.id === 77);
    expect(resp.result.roots).toEqual([
      { uri: pathToFileURL(dir).href, name: dir },
    ]);
  });

  it("acks a server ping request", async () => {
    const client = new MCPClient();
    await client.connect("srv", { command: "fake-mcp" });

    await fromServer(proc, { jsonrpc: "2.0", id: "p1", method: "ping" });

    const resp = proc.written.find((m) => m.id === "p1");
    expect(resp.result).toEqual({});
    expect(resp.error).toBeUndefined();
  });

  it("answers an unknown server request with -32601 instead of silence", async () => {
    const client = new MCPClient();
    await client.connect("srv", { command: "fake-mcp" });

    await fromServer(proc, {
      jsonrpc: "2.0",
      id: "u1",
      method: "sampling/createMessage",
    });

    const resp = proc.written.find((m) => m.id === "u1");
    expect(resp.error.code).toBe(-32601);
    expect(resp.error.message).toContain("sampling/createMessage");
  });

  it("still emits plain notifications (no id) as before", async () => {
    const client = new MCPClient();
    await client.connect("srv", { command: "fake-mcp" });
    const seen = [];
    client.on("notification", (n) => seen.push(n));

    await fromServer(proc, {
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("notifications/tools/list_changed");
    // and no response frame was written for it
    expect(
      proc.written.some((m) => m.id !== undefined && m.result === null),
    ).toBe(false);
  });

  it("setRoots broadcasts roots/list_changed to connected servers", async () => {
    const client = new MCPClient();
    await client.connect("srv", { command: "fake-mcp" });

    client.setRoots(["/some/new/root"]);
    const notes = proc.written.filter(
      (m) => m.method === "notifications/roots/list_changed",
    );
    expect(notes).toHaveLength(1);

    // Unchanged roots → no duplicate broadcast
    client.setRoots(["/some/new/root"]);
    expect(
      proc.written.filter(
        (m) => m.method === "notifications/roots/list_changed",
      ),
    ).toHaveLength(1);
  });

  it("notifyRootsListChanged broadcasts unconditionally (cwd-derived roots)", async () => {
    const client = new MCPClient();
    await client.connect("srv", { command: "fake-mcp" });

    client.notifyRootsListChanged();
    client.notifyRootsListChanged();
    expect(
      proc.written.filter(
        (m) => m.method === "notifications/roots/list_changed",
      ),
    ).toHaveLength(2);
  });
});
