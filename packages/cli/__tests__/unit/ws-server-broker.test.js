import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ChainlessChainWSServer } from "../../src/gateways/ws/ws-server.js";

function createChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = vi.fn();
  return child;
}

describe("WebSocket gateway process Broker", () => {
  it("spawns tokenized CLI arguments through the gateway scope", async () => {
    const child = createChild();
    const spawn = vi.fn(() => child);
    const server = new ChainlessChainWSServer({ spawn, timeout: 1000 });
    const sent = [];
    const ws = {
      OPEN: 1,
      readyState: 1,
      send: (payload) => sent.push(JSON.parse(payload)),
    };

    server._executeCommand(
      "request-1",
      ws,
      'status --json --label "two words"',
      false,
    );

    expect(spawn).toHaveBeenCalledOnce();
    const [file, args, options] = spawn.mock.calls[0];
    expect(file).toBe(process.execPath);
    expect(args.slice(1)).toEqual(["status", "--json", "--label", "two words"]);
    expect(options).toEqual(
      expect.objectContaining({
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        origin: "gateway:ws-command",
        policy: "allow",
        scope: "gateway",
        shell: false,
      }),
    );

    child.stdout.write(Buffer.from('{"ok":true}\n'));
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0);

    expect(sent.at(-1)).toMatchObject({
      id: "request-1",
      type: "result",
      success: true,
      exitCode: 0,
      stdout: '{"ok":true}\n',
    });
    expect(server.processes.has("request-1")).toBe(false);
  });

  it("kills a buffered command before retained output exceeds its byte cap", () => {
    const child = createChild();
    const server = new ChainlessChainWSServer({
      spawn: () => child,
      timeout: 1000,
      maxCommandOutputBytes: 4,
    });
    const sent = [];
    const ws = {
      OPEN: 1,
      readyState: 1,
      send: (payload) => sent.push(JSON.parse(payload)),
    };

    server._executeCommand("bounded", ws, "status", false);
    child.stdout.write(Buffer.from("12345"));
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(sent).toEqual([
      expect.objectContaining({
        id: "bounded",
        type: "error",
        code: "COMMAND_OUTPUT_TOO_LARGE",
      }),
    ]);

    child.emit("close", 0);
    expect(sent).toHaveLength(1);
    expect(server.processes.has("bounded")).toBe(false);
  });

  it("bounds stderr retained before the first streamed stdout frame", () => {
    const child = createChild();
    const server = new ChainlessChainWSServer({
      spawn: () => child,
      timeout: 1000,
      maxCommandOutputBytes: 4,
    });
    const sent = [];
    const ws = {
      OPEN: 1,
      readyState: 1,
      send: (payload) => sent.push(JSON.parse(payload)),
    };

    server._executeCommand("stream-bounded", ws, "status", true);
    child.stderr.write(Buffer.from("12345"));
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(sent).toEqual([
      expect.objectContaining({
        id: "stream-bounded",
        code: "COMMAND_OUTPUT_TOO_LARGE",
      }),
    ]);
    child.emit("close", 1);
    expect(sent).toHaveLength(1);
  });
});
