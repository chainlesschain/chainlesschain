/**
 * MCP stdio transport: fail fast when the server process dies.
 *
 * A request sent to a stdio MCP server registers a pending promise with a 30s
 * timeout. If the server process crashes/exits while requests are in flight,
 * those promises must reject *immediately* with a clear error — not hang for the
 * full 30 seconds until the timeout fires. The process `close`/`error` handlers
 * drain `entry._pending`.
 *
 * A fake child process (EventEmitter) is injected via _deps.spawn; its stdin
 * auto-answers the connect handshake (initialize / tools|resources|prompts list)
 * but never answers tools/call, so the call stays pending until we kill it.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { MCPClient } from "../../src/lib/mcp-client.js";

// Handshake auto-responder: returns a result for the methods connect() issues,
// and `undefined` for tools/call so that request stays pending.
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
  proc.stdin = {
    write: (data) => {
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
    },
  };
  return proc;
}

describe("MCPClient stdio — fail fast on process death", () => {
  let client;
  let proc;

  beforeEach(async () => {
    const mod = await import("../../src/lib/mcp-client.js");
    client = new MCPClient();
    proc = makeFakeProc();
    mod._deps.spawn = () => proc;
  });

  it("rejects an in-flight request when the process closes (no 30s hang)", async () => {
    const connectResult = await client.connect("srv", { command: "fake-mcp" });
    expect(connectResult.tools).toEqual([{ name: "doit" }]);

    const callPromise = client.callTool("srv", "doit", {});
    // Server crashes before answering tools/call.
    proc.emit("close", 1);

    await expect(callPromise).rejects.toThrow(/process exited/i);
  });

  it("rejects an in-flight request when the process errors", async () => {
    await client.connect("srv", { command: "fake-mcp" });

    const callPromise = client.callTool("srv", "doit", {});
    proc.emit("error", new Error("spawn ENOENT"));

    await expect(callPromise).rejects.toThrow(/process error/i);
  });

  it("does not throw when the process closes with nothing pending", async () => {
    await client.connect("srv", { command: "fake-mcp" });
    // No in-flight request — draining an empty pending map is a no-op.
    expect(() => proc.emit("close", 0)).not.toThrow();
  });
});
