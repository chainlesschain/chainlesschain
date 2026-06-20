/**
 * MCP stdio transport: a multi-byte UTF-8 character split across two stdout
 * `data` chunks must be reassembled, not corrupted into U+FFFD.
 *
 * A fake child process (EventEmitter) is injected via _deps.spawn. It answers
 * the connect handshake normally, but answers tools/call by emitting the JSON
 * response in TWO Buffer chunks split one byte into a 3-byte Chinese character —
 * exactly what a real stdio MCP server returning Chinese tool output can do when
 * the kernel splits the pipe write across `data` events.
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
      return undefined;
  }
}

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {};
  proc.stdin = {
    write: (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data).trim());
      } catch {
        return true;
      }
      if (msg.id === undefined) return true; // notification

      if (msg.method === "tools/call") {
        const obj = {
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: [{ type: "text", text: "你好世界" }] },
        };
        const buf = Buffer.from(JSON.stringify(obj) + "\n", "utf-8");
        // Split one byte INTO the first Chinese char (你 = 3 bytes), so each
        // chunk decoded independently would yield U+FFFD.
        const cut = buf.indexOf(Buffer.from("你", "utf-8")) + 1;
        setImmediate(() => {
          proc.stdout.emit("data", buf.subarray(0, cut));
          proc.stdout.emit("data", buf.subarray(cut));
        });
        return true;
      }

      const result = handshakeResult(msg.method);
      if (result !== undefined) {
        setImmediate(() => {
          proc.stdout.emit(
            "data",
            Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n"),
          );
        });
      }
      return true;
    },
  };
  return proc;
}

describe("MCPClient stdio — UTF-8 split across stdout chunks", () => {
  let client;
  let proc;

  beforeEach(async () => {
    const mod = await import("../../src/lib/mcp-client.js");
    client = new MCPClient();
    proc = makeFakeProc();
    mod._deps.spawn = () => proc;
  });

  it("reassembles a multi-byte char split across stdout chunks (no mojibake)", async () => {
    await client.connect("srv", { command: "fake-mcp" });
    const res = await client.callTool("srv", "doit", {});
    const json = JSON.stringify(res);
    expect(json).toContain("你好世界"); // intact, not "�好世界"
    expect(json).not.toContain("�"); // no replacement chars
  });
});
