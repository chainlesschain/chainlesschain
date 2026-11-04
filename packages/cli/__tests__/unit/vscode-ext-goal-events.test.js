import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const require = createRequire(import.meta.url);
const {
  buildGoalWatchArgs,
  createGoalEventDecoder,
  startGoalWatch,
} = require("../../../vscode-extension/src/goal-events.js");
const input = {
  id: "goal-1",
  name: "observer",
  scope: "project",
  connection: "C:/private connection.json",
};
const goalRef = {
  id: input.id,
  storeId: "project-goals-12345678-1234-1234-1234-123456789abc",
  revision: 2,
  controlGeneration: 1,
};
const ready = () => ({
  schema: "chainlesschain.goal-extension-stream/v1",
  kind: "ready",
  source: "desktop-project",
  plugin: { name: input.name, scope: input.scope, version: "0.1.0" },
  goalRef,
  observedAt: "2026-11-04T12:00:00.000Z",
  delivery: "polling",
  replay: false,
});
const event = (summary = "Historical risk check 变化") => {
  const { goalRef, ...base } = ready();
  return {
    ...base,
    kind: "event",
    event: {
      type: "risk.review.completed",
      goalRef,
      summary,
      occurredAt: base.observedAt,
    },
  };
};
const line = (value) => Buffer.from(JSON.stringify(value) + "\n");
describe("VS Code desktop goal event protocol", () => {
  it("uses fixed bounded watch arguments and keeps native connection paths in one argument", () => {
    const args = buildGoalWatchArgs(input);
    expect(args.slice(0, 3)).toEqual(["goal", "watch", "goal-1"]);
    expect(args).toContain("--connection=C:/private connection.json");
    expect(args).toContain("--duration=60");
    expect(args).toContain("--interval=1000");
    expect(() =>
      buildGoalWatchArgs({ ...input, connection: undefined }),
    ).toThrow();
    expect(() => buildGoalWatchArgs({ ...input, id: "../unsafe" })).toThrow();
  });
  it("frames split UTF-8 and projects only inert text with the initial binding", () => {
    const output = [];
    const decoder = createGoalEventDecoder(input, (record) =>
      output.push(record),
    );
    const bytes = Buffer.concat([
      line(ready()),
      line(event("<script>变化</script>")),
    ]);
    for (let i = 0; i < bytes.length; i++)
      decoder.push(bytes.subarray(i, i + 1));
    decoder.finish();
    expect(output.map((x) => x.kind)).toEqual(["ready", "event"]);
    expect(output[1].text).toContain("<script>变化</script>");
    expect(output[1]).not.toHaveProperty("plugin");
  });
  it.each([
    "source",
    "plugin",
    "version",
    "goal",
    "revision",
    "type",
    "key",
    "time",
    "control",
    "duplicate-ready",
  ])("rejects %s changes or extra authority fields", (kind) => {
    const decoder = createGoalEventDecoder(input, () => {});
    decoder.push(line(ready()));
    let value = event();
    if (kind === "source") value.source = "standalone";
    if (kind === "plugin") value.plugin.name = "other";
    if (kind === "version") value.plugin.version = "0.2.0";
    if (kind === "goal") value.event.goalRef = { ...goalRef, id: "other" };
    if (kind === "revision") value.event.goalRef = { ...goalRef, revision: 3 };
    if (kind === "type") value.event.type = "action.execute";
    if (kind === "key") value.key = "must not display";
    if (kind === "time") value.event.occurredAt = "old";
    if (kind === "control") value.event.summary = "bad\u001b[1m";
    if (kind === "duplicate-ready") value = ready();
    expect(() => decoder.push(line(value))).toThrow();
  });
  it("rejects events without ready, partial lines, invalid UTF-8 and oversized output", () => {
    expect(() =>
      createGoalEventDecoder(input, () => {}).push(line(event())),
    ).toThrow();
    const partial = createGoalEventDecoder(input, () => {});
    partial.push(Buffer.from(JSON.stringify(ready())));
    expect(() => partial.finish()).toThrow();
    expect(() =>
      createGoalEventDecoder(input, () => {}).push(Buffer.from([0xff])),
    ).toThrow();
    expect(() =>
      createGoalEventDecoder(input, () => {}).push(Buffer.alloc(16385, 65)),
    ).toThrow();
    const bounded = createGoalEventDecoder(input, () => {});
    bounded.push(line(ready()));
    expect(() => {
      for (let i = 0; i < 1000; i++)
        bounded.push(line(event("x".repeat(4096))));
    }).toThrow();
  });
});
function session() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 123,
    kill: vi.fn(),
  });
  const spawn = vi.fn(() => child);
  const stopProcess = vi.fn(async () => {
    child.emit("close", null);
  });
  const onRecord = vi.fn(),
    onEnd = vi.fn();
  const watch = startGoalWatch({
    command: "test.exe",
    cwd: "C:/workspace",
    input,
    onRecord,
    onEnd,
    deps: { spawn, stopProcess, platform: "linux" },
  });
  return { child, spawn, stopProcess, onRecord, onEnd, watch };
}
describe("owned goal observer process", () => {
  it("waits for process-tree termination even after the wrapper closes", async () => {
    const h = session();
    let finish;
    h.stopProcess.mockImplementation(() => {
      h.child.emit("close", null);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const stopping = h.watch.stop();
    await Promise.resolve();
    expect(h.onEnd).not.toHaveBeenCalled();
    finish();
    await stopping;
    expect(await h.watch.completion).toBe("stopped");
  });
  it("streams without a shell and distinguishes natural completion", async () => {
    const h = session();
    expect(h.spawn.mock.calls[0][2]).toMatchObject({
      shell: false,
      windowsHide: true,
      cwd: "C:/workspace",
    });
    h.child.stdout.write(line(ready()));
    h.child.stdout.write(line(event()));
    h.child.emit("close", 0);
    expect(await h.watch.completion).toBe("ended");
    expect(h.onRecord).toHaveBeenCalledTimes(2);
    await h.watch.stop();
    expect(h.stopProcess).not.toHaveBeenCalled();
  });
  it("stops the owned child and drops late records after cancellation", async () => {
    const h = session();
    h.child.stdout.write(line(ready()));
    await h.watch.stop();
    h.child.stdout.write(line(event()));
    expect(h.stopProcess).toHaveBeenCalledExactlyOnceWith(
      h.child,
      expect.anything(),
    );
    expect(h.onRecord).toHaveBeenCalledTimes(1);
    expect(await h.watch.completion).toBe("stopped");
  });
  it("rejects protocol contamination and drains stderr without displaying it", async () => {
    const h = session();
    h.child.stderr.write("SECRET stderr");
    h.child.stdout.write(line({ ...ready(), key: "SECRET" }));
    expect(await h.watch.completion).toBe("unavailable");
    expect(h.onRecord).not.toHaveBeenCalled();
    expect(h.onEnd).toHaveBeenCalledExactlyOnceWith("unavailable");
  });
  it("treats non-zero exit, startup failure and truncated output as unavailable", async () => {
    for (const mode of ["nonzero", "spawn", "truncated"]) {
      const h = session();
      if (mode === "spawn") h.child.emit("error", new Error("not installed"));
      else if (mode === "truncated")
        h.child.stdout.write(Buffer.from(JSON.stringify(ready())));
      else h.child.stdout.write(line(ready()));
      h.child.emit("close", mode === "nonzero" ? 1 : 0);
      expect(await h.watch.completion).toBe("unavailable");
    }
  });
});
