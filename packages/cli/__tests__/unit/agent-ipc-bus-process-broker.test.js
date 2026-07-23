import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { _deps, AgentIPCBus } from "../../src/lib/agent-ipc-bus.js";

const originalSpawn = _deps.spawn;

afterEach(() => {
  _deps.spawn = originalSpawn;
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn();
  child.exitCode = null;
  return child;
}

describe("AgentIPCBus process Broker contract", () => {
  it("spawns a subagent with literal argv, identity env, and provenance", async () => {
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const bus = new AgentIPCBus();

    const pending = bus.spawnAgentProcess(
      "agent executable",
      ["--prompt", "value with spaces"],
      {
        agentId: "agent-1",
        initTimeoutMs: 1,
        heartbeatMs: 60000,
        env: { CUSTOM_AGENT_ENV: "yes" },
        spawnOptions: { windowsHide: true },
      },
    );
    child.stdout.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`,
      ),
    );

    await expect(pending).resolves.toMatchObject({
      process: child,
      agentId: "agent-1",
    });
    expect(_deps.spawn).toHaveBeenCalledWith(
      "agent executable",
      ["--prompt", "value with spaces"],
      expect.objectContaining({
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        origin: "agent-ipc:subagent",
        policy: "allow",
        scope: "agent-ipc",
        shell: false,
        env: expect.objectContaining({
          CHAINLESSCHAIN_AGENT_ID: "agent-1",
          CHAINLESSCHAIN_AGENT_MODE: "subagent",
          CHAINLESSCHAIN_IPC_PROTOCOL: "jsonrpc-stdio-v1",
          CUSTOM_AGENT_ENV: "yes",
        }),
      }),
    );

    child.emit("exit", 0, null);
  });
});
