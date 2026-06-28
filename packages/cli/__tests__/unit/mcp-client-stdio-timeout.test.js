/**
 * MCP stdio transport: per-call timeout now honours the SAME config knobs as
 * the HTTP path (mcp-client-http-timeout.test.js) — `longRunning` servers are
 * exempt and `requestTimeoutMs` overrides the 30s default (0 disables).
 * Previously the stdio request hardcoded 30s, so a long-running stdio tool was
 * killed regardless of config, an inconsistency with HTTP servers.
 *
 * A fake child process (EventEmitter) is injected via _deps.spawn; its stdin
 * auto-answers the connect handshake (initialize / tools|resources|prompts list)
 * but never answers tools/call, so the call stays pending — letting us assert
 * whether a timeout timer was armed.
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

// The single in-flight pending entry for `srv` (the never-answered tools/call).
function pendingEntry(client, name = "srv") {
  const pend = client.servers.get(name)._pending;
  const [first] = [...pend.values()];
  return first;
}

describe("MCPClient stdio per-call timeout (config parity with HTTP)", () => {
  let client;
  let proc;

  beforeEach(async () => {
    const mod = await import("../../src/lib/mcp-client.js");
    client = new MCPClient();
    proc = makeFakeProc();
    mod._deps.spawn = () => proc;
  });

  it("times out a never-answered call with a tiny requestTimeoutMs", async () => {
    await client.connect("srv", {
      command: "fake-mcp",
      requestTimeoutMs: 40, // tiny so the test is fast
    });

    await expect(client.callTool("srv", "doit", {})).rejects.toThrow(
      /Request timeout/i,
    );
  });

  it("arms a timeout timer by default (regression guard for the 30s default)", async () => {
    await client.connect("srv", { command: "fake-mcp" });

    const callPromise = client.callTool("srv", "doit", {});
    await Promise.resolve(); // let _sendRequest register the pending entry
    expect(pendingEntry(client).timeout).toBeDefined();

    // Drain the pending call so the 30s timer doesn't dangle past the test.
    proc.emit("close", 0);
    await expect(callPromise).rejects.toThrow(/process exited/i);
  });

  it("does NOT arm a timer for longRunning servers (exemption)", async () => {
    await client.connect("srv", { command: "fake-mcp", longRunning: true });

    const callPromise = client.callTool("srv", "doit", {});
    await Promise.resolve();
    expect(pendingEntry(client).timeout).toBeUndefined();

    proc.emit("close", 0);
    await expect(callPromise).rejects.toThrow(/process exited/i);
  });

  it("requestTimeoutMs:0 disables the timeout (no timer armed)", async () => {
    await client.connect("srv", { command: "fake-mcp", requestTimeoutMs: 0 });

    const callPromise = client.callTool("srv", "doit", {});
    await Promise.resolve();
    expect(pendingEntry(client).timeout).toBeUndefined();

    proc.emit("close", 0);
    await expect(callPromise).rejects.toThrow(/process exited/i);
  });
});
