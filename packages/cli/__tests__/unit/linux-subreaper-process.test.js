import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  encodeLinuxSubreaperLaunch,
  spawnLinuxSubreaper,
  spawnLinuxSubreaperChild,
} from "../../src/lib/process-execution-broker/linux-subreaper-process.js";

const options = {
  cwd: path.resolve("."),
  env: {},
  helperPath: path.resolve("supervisor"),
};
function create(facade = false, extra = {}, inspect = () => {}) {
  const channel = new EventEmitter();
  channel.writable = true;
  channel.destroyed = false;
  channel.write = vi.fn();
  channel.destroy = () => {
    channel.destroyed = true;
  };
  const child = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 456;
  child.stdio = [null, null, null, channel];
  const native = { platform: "linux", spawn: vi.fn(() => child) };
  inspect({ child, channel });
  return {
    child,
    channel,
    native,
    owner: (facade ? spawnLinuxSubreaperChild : spawnLinuxSubreaper)(
      "node",
      [],
      { ...options, ...extra },
      native,
    ),
  };
}
const messages =
  '{"type":"started","pid":123}\n{"type":"target-exit","code":0,"signal":0,"spawnErrno":0}\n{"type":"cleanup","confirmed":true,"rootReaped":true,"reaped":2}\n';

describe("Linux subreaper control contract", () => {
  it("attaches the blocked supervisor before transmitting the target launch frame", async () => {
    let fixture;
    const hook = vi.fn((child) => {
      expect(child).toBe(fixture.child);
      expect(fixture.channel.write).not.toHaveBeenCalled();
    });
    const { child, channel, owner } = create(
      false,
      { beforeLaunch: hook },
      (value) => {
        fixture = value;
      },
    );
    expect(hook).toHaveBeenCalledOnce();
    expect(channel.write).toHaveBeenCalledOnce();
    channel.emit("data", Buffer.from(messages));
    child.emit("close", 0, null);
    await owner.completion;
  });
  it("closes the blocked control channel without launching the target when attachment fails", () => {
    let fixture;
    expect(() =>
      create(
        false,
        {
          beforeLaunch() {
            throw new Error("attach denied");
          },
        },
        (value) => {
          fixture = value;
        },
      ),
    ).toThrow("attach denied");
    expect(fixture.channel.write).not.toHaveBeenCalled();
    expect(fixture.channel.destroyed).toBe(true);
    fixture.child.emit("close", 1, null);
  });
  it("requires ordered kernel cleanup and successful supervisor close", async () => {
    const { owner, child, channel } = create();
    channel.emit("data", Buffer.from(messages));
    child.emit("close", 0, null);
    expect((await owner.completion).cleanup).toMatchObject({
      confirmed: true,
      descendantsReaped: true,
      reaped: 2,
      processTreeContained: false,
    });
    expect(owner.terminate("SIGKILL")).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
  });
  it.each(["missing", "early", "duplicate", "truncated", "killed"])(
    "does not confirm invalid or lost cleanup: %s",
    async (kind) => {
      const { owner, child, channel } = create();
      const data =
        kind === "missing"
          ? messages.split("\n").slice(0, 2).join("\n") + "\n"
          : kind === "early"
            ? messages.split("\n")[2] + "\n"
            : kind === "duplicate"
              ? messages + messages
              : kind === "truncated"
                ? messages + "{"
                : messages;
      channel.emit("data", Buffer.from(data));
      child.emit(
        "close",
        kind === "killed" ? null : 0,
        kind === "killed" ? "SIGKILL" : null,
      );
      expect((await owner.completion).cleanup.confirmed).toBe(false);
    },
  );
  it("de-duplicates control requests without calling ChildProcess.kill", async () => {
    const { owner, child, channel } = create();
    owner.terminate();
    owner.terminate();
    owner.terminate("SIGKILL");
    owner.terminate();
    expect(channel.write.mock.calls.slice(1).map(([value]) => value)).toEqual([
      "T",
      "K",
    ]);
    channel.emit("data", Buffer.from(messages));
    child.emit("close", 0, null);
    await owner.completion;
    expect(child.kill).not.toHaveBeenCalled();
  });
  it("preserves empty values and exact UTF-8 framing", () => {
    const frame = encodeLinuxSubreaperLaunch("node", ["", "中文😀"], {
      ...options,
      env: { EMPTY: "", VALUE: "完成" },
      graceMs: 300,
    });
    expect(frame.subarray(0, 8).toString()).toBe("CCSUBR01");
    expect(frame.readUInt32BE(8)).toBe(frame.length);
    expect(frame.readUInt32BE(12)).toBe(3);
    expect(frame.readUInt32BE(16)).toBe(2);
    expect(frame.readUInt32BE(20)).toBe(300);
    const strings = [];
    let offset = 24;
    while (offset < frame.length) {
      const length = frame.readUInt32BE(offset);
      offset += 4;
      strings.push(frame.subarray(offset, offset + length).toString());
      offset += length;
    }
    expect(strings).toEqual([
      options.cwd,
      "node",
      "",
      "中文😀",
      "EMPTY=",
      "VALUE=完成",
    ]);
  });
  it("rejects invalid/oversized plans and unknown process controls before spawn", () => {
    expect(() =>
      encodeLinuxSubreaperLaunch("node", ["x\0y"], options),
    ).toThrow();
    expect(() =>
      encodeLinuxSubreaperLaunch("node", ["x".repeat(1024 * 1024)], options),
    ).toThrow();
    expect(() =>
      encodeLinuxSubreaperLaunch("node", [], {
        ...options,
        env: { "A=B": "x" },
      }),
    ).toThrow();
    const native = { platform: "linux", spawn: vi.fn() };
    expect(() =>
      spawnLinuxSubreaper("node", [], { ...options, shell: true }, native),
    ).toThrow();
    expect(native.spawn).not.toHaveBeenCalled();
  });
  it.each([0, 6000, 2147483647])(
    "preserves a caller grace period of %s ms",
    (graceMs) => {
      expect(
        encodeLinuxSubreaperLaunch("node", [], {
          ...options,
          graceMs,
        }).readUInt32BE(20),
      ).toBe(graceMs);
    },
  );
});

describe("Linux subreaper Broker child facade", () => {
  it("keeps the close fence until both cleanup receipt and native close", async () => {
    const { owner, child, channel } = create(true);
    const events = [];
    owner.on("exit", (...args) => events.push(["exit", ...args]));
    owner.on("close", (...args) => events.push(["close", ...args]));
    channel.emit("data", Buffer.from(messages));
    child.emit("exit", 0, null);
    expect(owner.exitCode).toBeNull();
    expect(events).toEqual([]);
    child.emit("close", 0, null);
    await owner.ownedProcessTreeClosed;
    expect(events).toEqual([
      ["exit", 0, null],
      ["close", 0, null],
    ]);
    expect(owner.sandboxTargetPid).toBe(123);
    expect(owner.ownedProcessTreeEvidence.cleanup.confirmed).toBe(true);
    child.emit("close", 0, null);
    expect(events).toHaveLength(2);
  });
  it("reports target exec failure before releasing a confirmed close", async () => {
    const { owner, child, channel } = create(true);
    const events = [];
    owner.on("error", (error) => events.push(error.code));
    owner.on("close", (code) => events.push(code));
    channel.emit(
      "data",
      Buffer.from(
        messages.replace(
          '"code":0,"signal":0,"spawnErrno":0',
          '"code":127,"signal":0,"spawnErrno":2',
        ),
      ),
    );
    child.emit("close", 0, null);
    await owner.ownedProcessTreeClosed;
    expect(events).toEqual(["EXTERNAL_AGENT_SPAWN_FAILED", 127]);
  });
  it("does not release ownership after supervisor loss even with a prior receipt", async () => {
    const { owner, child, channel } = create(true);
    const error = vi.fn();
    const close = vi.fn();
    const unconfirmed = vi.fn();
    owner.on("error", error);
    owner.on("close", close);
    owner.on("cleanup:unconfirmed", unconfirmed);
    channel.emit("data", Buffer.from(messages));
    child.emit("close", null, "SIGKILL");
    await owner.ownedProcessTreeClosed;
    expect(error.mock.calls[0][0].code).toBe(
      "EXTERNAL_AGENT_CLEANUP_UNCONFIRMED",
    );
    expect(close).not.toHaveBeenCalled();
    expect(unconfirmed).toHaveBeenCalledOnce();
    expect(owner.exitCode).toBeNull();
    expect(owner.signalCode).toBeNull();
    expect(owner.kill()).toBe(false);
  });
  it("closes a native spawn that never acquired a PID with the spawn error", async () => {
    const { owner, child } = create(true);
    child.pid = undefined;
    const events = [];
    owner.on("error", (error) => events.push(error.code));
    owner.on("close", (code) => events.push(code));
    child.emit("error", new Error("ENOENT"));
    child.emit("close", -2, null);
    await owner.ownedProcessTreeClosed;
    expect(events).toEqual(["EXTERNAL_AGENT_SPAWN_FAILED", -1]);
  });
  it("signals over the private control channel and exposes the target signal", async () => {
    const { owner, child, channel } = create(true);
    owner.kill();
    owner.kill();
    owner.kill("SIGKILL");
    expect(owner.killed).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
    expect(channel.write.mock.calls.slice(1).map(([value]) => value)).toEqual([
      "T",
      "K",
    ]);
    channel.emit(
      "data",
      Buffer.from(
        messages.replace('"code":0,"signal":0', '"code":-1,"signal":9'),
      ),
    );
    child.emit("close", 0, null);
    await owner.ownedProcessTreeClosed;
    expect(owner.exitCode).toBeNull();
    expect(owner.signalCode).toBe("SIGKILL");
  });
});
