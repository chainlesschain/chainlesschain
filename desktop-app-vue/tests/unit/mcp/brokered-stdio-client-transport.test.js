import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const {
  BrokeredStdioClientTransport,
} = require("../../../src/main/mcp/transports/brokered-stdio-client-transport.js");

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 42;
  child.exitCode = null;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

describe("BrokeredStdioClientTransport", () => {
  it("uses ProcessExecutionBroker with a pinned strong sandbox policy", async () => {
    const child = fakeChild();
    const broker = { spawn: vi.fn(() => child) };
    const transport = new BrokeredStdioClientTransport(
      {
        serverName: "filesystem",
        command: "node",
        args: ["server.js"],
        cwd: process.cwd(),
        env: { PATH: "safe-path" },
      },
      { loadProcessBroker: async () => broker },
    );

    await transport.start();

    expect(broker.spawn).toHaveBeenCalledWith(
      "node",
      ["server.js"],
      expect.objectContaining({
        origin: "mcp:stdio:filesystem",
        scope: "mcp-server",
        policy: "allow",
        shell: false,
        env: { PATH: "safe-path" },
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
      }),
    );
    const options = broker.spawn.mock.calls[0][2];
    expect(Object.isFrozen(options.sandboxPolicy)).toBe(true);
    expect(Object.isFrozen(options.sandboxPolicy.requiredBoundaries)).toBe(
      true,
    );
    expect(transport.pid).toBe(42);
  });

  it("fails closed when the ProcessExecutionBroker is unavailable", async () => {
    const transport = new BrokeredStdioClientTransport(
      { command: "node" },
      {
        loadProcessBroker: async () => {
          throw new Error("broker unavailable");
        },
      },
    );

    await expect(transport.start()).rejects.toThrow("broker unavailable");
  });
});
