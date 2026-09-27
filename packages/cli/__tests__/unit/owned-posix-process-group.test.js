import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  inspectPosixProcessGroup,
  spawnOwnedPosixProcessGroup,
} from "../../src/lib/process-execution-broker/owned-posix-process-group.js";

const invocation = {
  cwd: path.resolve("."),
  env: {},
  graceMs: 1,
  confirmMs: 1,
};

function fake(states) {
  const child = new EventEmitter();
  const channel = new EventEmitter();
  channel.writable = true;
  channel.destroyed = false;
  channel.write = vi.fn();
  channel.destroy = () => {
    channel.destroyed = true;
  };
  child.pid = 42;
  child.stdio = [
    new PassThrough(),
    new PassThrough(),
    new PassThrough(),
    channel,
  ];
  child.kill = vi.fn();
  const native = {
    spawn: vi.fn(() => child),
    spawnSync: vi.fn(),
    platform: "linux",
    inspectGroup: vi.fn(() => states),
  };
  const owner = spawnOwnedPosixProcessGroup("node", ["-v"], invocation, native);
  return { owner, child, native, channel };
}

describe("owned POSIX group ownership contract", () => {
  it.each([null, ["S"], ["?"]])(
    "does not treat a supervisor close as cleanup: %j",
    async (states) => {
      const { owner, child, channel } = fake(states);
      channel.emit("data", Buffer.from('{"type":"terminating"}\n'));
      child.emit("close", null, "SIGKILL");
      const result = await owner.completion;
      expect(result.cleanup.confirmed).toBe(false);
      expect(owner.terminate("SIGKILL")).toBe(false);
      expect(child.kill).not.toHaveBeenCalled();
    },
  );

  it("requires an intentional cleanup receipt even when no live group remains", async () => {
    const { owner, child } = fake([]);
    child.emit("close", null, "SIGKILL");
    expect((await owner.completion).cleanup).toMatchObject({
      groupStopped: true,
      confirmed: false,
    });
  });

  it("does not upgrade zombie-only groups to hostile descendant containment", async () => {
    const { owner, child, channel } = fake(["Z", "X"]);
    channel.emit("data", Buffer.from('{"type":"terminating"}\n'));
    child.emit("close", null, "SIGKILL");
    expect((await owner.completion).cleanup).toMatchObject({
      confirmed: true,
      processTreeContained: false,
    });
  });

  it("de-duplicates stop requests and escalates once without native kill", async () => {
    const { owner, child, channel } = fake([]);
    owner.terminate();
    owner.terminate();
    owner.terminate("SIGKILL");
    owner.terminate();
    expect(
      channel.write.mock.calls
        .slice(1)
        .map(([line]) => JSON.parse(line).signal),
    ).toEqual(["SIGTERM", "SIGKILL"]);
    channel.emit("data", Buffer.from('{"type":"terminating"}\n'));
    child.emit("close", null, "SIGKILL");
    await owner.completion;
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("rejects malformed control output without signalling a stale PID", async () => {
    const { owner, child, channel } = fake([]);
    channel.emit("data", Buffer.from('{"type":"terminating"}\ninvalid\n'));
    child.emit("close", null, "SIGKILL");
    expect((await owner.completion).cleanup).toMatchObject({
      confirmed: false,
      protocolError: "invalid-control-reply",
    });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("does not silently accept descriptor, shell, or sandbox options", () => {
    const native = { platform: "linux", spawn: vi.fn(), spawnSync: vi.fn() };
    for (const extra of [
      { stdio: ["pipe"] },
      { shell: true },
      { sandboxPolicy: {} },
    ]) {
      expect(() =>
        spawnOwnedPosixProcessGroup(
          "node",
          [],
          { ...invocation, ...extra },
          native,
        ),
      ).toThrow("Unsupported");
    }
    expect(native.spawn).not.toHaveBeenCalled();
  });

  it("fails closed on macOS probe errors and unparseable snapshots", () => {
    for (const result of [
      { status: 1, stdout: "" },
      { status: 0, stdout: "invalid" },
      { status: 0, stdout: "" },
    ]) {
      expect(
        inspectPosixProcessGroup(42, {
          platform: "darwin",
          spawnSync: () => result,
        }),
      ).toBeNull();
    }
    expect(
      inspectPosixProcessGroup(42, {
        platform: "darwin",
        spawnSync: () => ({ status: 0, stdout: "42 Z\n43 S+\n" }),
      }),
    ).toEqual(["Z"]);
  });
});
