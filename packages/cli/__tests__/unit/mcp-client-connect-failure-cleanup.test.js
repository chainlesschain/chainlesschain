/**
 * MCP stdio transport: don't leak the child process when the connect handshake
 * fails.
 *
 * connect() spawns a stdio child, binds stdout/stderr/close/error listeners,
 * then awaits the `initialize` request. If that request fails (broken stdin
 * pipe, a non-MCP command that never answers, handshake timeout), the catch
 * path used to only flip state + drop the entry from `this.servers` and rethrow
 * — leaving the child running with its listeners bound. Since the entry is gone
 * from the registry, disconnect() can never reach it, and an alive-but-silent
 * process fires neither `close` nor `error`, so nothing ever reaps it.
 *
 * A fake child (EventEmitter) is injected via _deps.spawn; its stdin throws on
 * write to simulate a failed handshake, and `kill`/listener counts let us assert
 * the teardown happened.
 */

import { describe, it, expect } from "vitest";
import { EventEmitter } from "events";
import { MCPClient } from "../../src/lib/mcp-client.js";

// A child whose stdin write fails — `_sendRequest("initialize")` rejects at once.
function makeBrokenProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = () => {
    proc.killed = true;
  };
  proc.stdin = {
    write: () => {
      throw new Error("EPIPE: broken pipe");
    },
  };
  return proc;
}

describe("MCPClient stdio — connect-failure cleanup", () => {
  it("kills the spawned child and removes its listeners when the handshake fails", async () => {
    const mod = await import("../../src/lib/mcp-client.js");
    const client = new MCPClient();
    const proc = makeBrokenProc();
    mod._deps.spawn = () => proc;

    await expect(
      client.connect("srv", { command: "fake-mcp" }),
    ).rejects.toThrow(/EPIPE/);

    // The orphan-prevention invariant: process reaped, registry clean,
    // listeners dropped (no dangling stdout/stderr/close/error handlers).
    expect(proc.killed).toBe(true);
    expect(client.servers.has("srv")).toBe(false);
    expect(proc.listenerCount("close")).toBe(0);
    expect(proc.listenerCount("error")).toBe(0);
    expect(proc.stdout.listenerCount("data")).toBe(0);
    expect(proc.stderr.listenerCount("data")).toBe(0);
  });

  it("leaves no process to clean up for an http transport failure", async () => {
    // HTTP transport spawns no child; the same catch path must be a no-op for
    // entry.process === undefined (the `if (entry.process)` guard).
    const mod = await import("../../src/lib/mcp-client.js");
    const client = new MCPClient();
    mod._deps.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(
      client.connect("web", { url: "http://127.0.0.1:1/mcp" }),
    ).rejects.toThrow();
    expect(client.servers.has("web")).toBe(false);
  });
});
