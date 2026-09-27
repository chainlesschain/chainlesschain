import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  encodeLinuxSubreaperLaunch,
  spawnLinuxSubreaper,
} from "../../src/lib/process-execution-broker/linux-subreaper-process.js";

const options = {
  cwd: path.resolve("."),
  env: {},
  helperPath: path.resolve("supervisor"),
};
function create() {
  const channel = new EventEmitter();
  channel.writable = true;
  channel.destroyed = false;
  channel.write = vi.fn();
  channel.destroy = () => {
    channel.destroyed = true;
  };
  const child = new EventEmitter();
  child.kill = vi.fn();
  child.stdio = [null, null, null, channel];
  const native = { platform: "linux", spawn: vi.fn(() => child) };
  return {
    child,
    channel,
    native,
    owner: spawnLinuxSubreaper("node", [], options, native),
  };
}
const messages =
  '{"type":"started","pid":123}\n{"type":"target-exit","code":0,"signal":0,"spawnErrno":0}\n{"type":"cleanup","confirmed":true,"rootReaped":true,"reaped":2}\n';

describe("Linux subreaper control contract", () => {
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
});
