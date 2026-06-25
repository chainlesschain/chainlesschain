/**
 * MCP stdio transport: a broken stdin pipe must not crash the CLI.
 *
 * Writing to a stdio MCP server that has closed its stdin read end (or died
 * mid-write) makes the stdin pipe emit an ASYNCHRONOUS 'error' (EPIPE). In Node
 * an 'error' event with no listener is an uncaught exception that terminates the
 * process — and the try/catch around stdin.write only catches synchronous
 * throws, not this async event. The client must attach a stdin 'error' listener
 * so a misbehaving/crashing server can't take down the whole CLI: it drains
 * in-flight requests with a clear error and emits `server-error`.
 *
 * A fake child (EventEmitter) is injected via _deps.spawn; here stdin is itself
 * an EventEmitter (as a real child's stdin Writable is) so the test can emit the
 * EPIPE the way Node would.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { MCPClient } from "../../src/lib/mcp-client.js";

function handshakeResult(method) {
  switch (method) {
    case "initialize":
      return {
        serverInfo: { name: "fake", version: "1" },
        capabilities: { tools: {} },
      };
    case "tools/list":
      return { tools: [{ name: "doit" }] };
    case "resources/list":
      return { resources: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      return undefined; // tools/call → no answer, stays pending
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
  // stdin is an EventEmitter (like a real child's Writable) so we can emit the
  // async EPIPE; write() still auto-answers the connect handshake.
  const stdin = new EventEmitter();
  stdin.write = (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data).trim());
    } catch {
      return true;
    }
    if (msg.id === undefined) return true; // notification — no response
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

describe("MCPClient stdio — broken stdin pipe doesn't crash the CLI", () => {
  let client;
  let proc;

  beforeEach(async () => {
    const mod = await import("../../src/lib/mcp-client.js");
    client = new MCPClient();
    proc = makeFakeProc();
    mod._deps.spawn = () => proc;
  });

  it("attaches an 'error' listener to stdin so EPIPE never goes unhandled", async () => {
    await client.connect("srv", { command: "fake-mcp" });
    // A real unhandled 'error' on an EventEmitter throws synchronously from
    // emit(); with the listener attached it must NOT throw.
    expect(() =>
      proc.stdin.emit("error", new Error("write EPIPE")),
    ).not.toThrow();
    expect(proc.stdin.listenerCount("error")).toBe(1);
  });

  it("rejects in-flight requests and emits server-error on a stdin EPIPE", async () => {
    await client.connect("srv", { command: "fake-mcp" });

    const errors = [];
    client.on("server-error", (e) => errors.push(e));

    const callPromise = client.callTool("srv", "doit", {});
    // tools/call is written but never answered; the pipe then breaks.
    proc.stdin.emit("error", new Error("write EPIPE"));

    await expect(callPromise).rejects.toThrow(/stdin error/i);
    expect(errors.some((e) => /EPIPE/i.test(e.error))).toBe(true);
  });

  it("marks the server ERROR after a stdin pipe failure", async () => {
    await client.connect("srv", { command: "fake-mcp" });
    proc.stdin.emit("error", new Error("write EPIPE"));
    const srv = client.listServers().find((s) => s.name === "srv");
    expect(srv.state).toBe("error");
  });
});
