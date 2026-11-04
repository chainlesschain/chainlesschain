import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { input, packet } = require("../fixtures/goal-history.cjs");
const {
  buildGoalReplayArgs,
  parseGoalHistory,
  startGoalReplay,
  historyFailure,
} = require("../../../vscode-extension/src/goal-history.js");
describe("explicit retained history protocol", () => {
  it("builds one fixed replay page with explicit checkpoint mode", () => {
    const args = buildGoalReplayArgs(input);
    expect(args.slice(0, 3)).toEqual(["goal", "replay", "goal-1"]);
    expect(args).toContain("--checkpoint=" + input.checkpoint);
    expect(args).toContain("--checkpoint-mode=new");
    for (const changed of [
      { checkpointMode: "auto" },
      { checkpoint: "" },
      { connection: "" },
      { id: "../bad" },
    ])
      expect(() => buildGoalReplayArgs({ ...input, ...changed })).toThrow();
  });
  it("accepts filtered sequence gaps and pins subsequent page identity", () => {
    const raw = packet(),
      first = parseGoalHistory(JSON.stringify(raw), input);
    const entry = structuredClone(raw.entries[0]);
    entry.sequence = 3;
    entry.id = "goal-event-" + "b".repeat(64);
    raw.entries.push(entry);
    expect(
      parseGoalHistory(JSON.stringify(raw), input, first.binding).text,
    ).toContain("<script>");
    raw.plugin.version = "0.2.0";
    expect(() =>
      parseGoalHistory(JSON.stringify(raw), input, first.binding),
    ).toThrow();
  });
  it.each([
    "schema",
    "extra",
    "plugin",
    "goal",
    "store",
    "revision",
    "generation",
    "duplicate",
    "order",
    "outside",
    "source",
    "type",
    "summary",
    "time",
    "cursor",
    "count",
    "retention",
    "more",
    "empty",
    "oversized",
  ])("rejects invalid %s", (kind) => {
    const raw = packet(),
      entry = raw.entries[0];
    switch (kind) {
      case "schema":
        raw.schema = "wrong";
        break;
      case "extra":
        raw.key = "secret";
        break;
      case "plugin":
        raw.plugin.name = "other";
        break;
      case "goal":
        raw.goalRef.id = "other";
        break;
      case "store":
        raw.goalRef.storeId = "other";
        break;
      case "revision":
        entry.sourceRef.revision = 3;
        break;
      case "generation":
        entry.sourceRef.controlGeneration = 2;
        break;
      case "duplicate":
        raw.entries.push(structuredClone(entry));
        break;
      case "order":
        entry.sequence = 0;
        break;
      case "outside":
        entry.sequence = 4;
        break;
      case "source":
        entry.sourceRef.id = "other";
        break;
      case "type":
        entry.event.type = "action.execute";
        break;
      case "summary":
        entry.event.summary = "bad\u001b";
        break;
      case "time":
        entry.event.occurredAt = "2026-11-03T12:00:00.000Z";
        break;
      case "cursor":
        raw.nextCursor = "invalid cursor";
        break;
      case "count":
        raw.scannedCount = 21;
        break;
      case "retention":
        raw.highWatermark = 1001;
        break;
      case "more":
        raw.scannedCount = 0;
        raw.entries = [];
        break;
      case "empty":
        raw.highWatermark = 0;
        break;
      case "oversized":
        raw.key = "x".repeat(128 * 1024);
        break;
    }
    expect(() => parseGoalHistory(JSON.stringify(raw), input)).toThrow();
  });
  it("accepts an empty new journal and a caught-up page", () => {
    const raw = packet();
    Object.assign(raw, {
      entries: [],
      scannedCount: 0,
      hasMore: false,
      highWatermark: 0,
      nextCursor: null,
    });
    expect(parseGoalHistory(JSON.stringify(raw), input).hasMore).toBe(false);
    raw.highWatermark = 3;
    raw.nextCursor = "signed_cursor";
    expect(parseGoalHistory(JSON.stringify(raw), input).text).toContain(
      "Check again explicitly",
    );
  });
  it.each([0, 1])("never publishes before successful exit %s", async (code) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const end = vi.fn();
    const replay = startGoalReplay({
      command: "cc",
      cwd: "C:/workspace",
      input,
      onEnd: end,
      deps: { platform: "linux", spawn: () => child },
    });
    child.stdout.write(JSON.stringify(packet()));
    child.stderr.write("NEVER DISPLAY secret");
    expect(end).not.toHaveBeenCalled();
    child.emit("close", code);
    const result = await replay.completion;
    expect(result.state).toBe(code === 0 ? "saved" : "unconfirmed");
    expect(JSON.stringify(result)).not.toContain("NEVER DISPLAY");
  });
  it.each(["cancel", "oversized", "utf8", "malformed"])(
    "fails closed through %s and waits for termination",
    async (mode) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      let reaped;
      const stopProcess = vi.fn(
        () =>
          new Promise((resolve) => {
            reaped = resolve;
          }),
      );
      const end = vi.fn();
      const replay = startGoalReplay({
        command: "cc",
        input,
        onEnd: end,
        deps: { platform: "linux", spawn: () => child, stopProcess },
      });
      if (mode === "cancel") replay.stop();
      else if (mode === "oversized")
        child.stdout.write(Buffer.alloc(128 * 1024 + 1));
      else
        child.stdout.write(mode === "utf8" ? Buffer.from([255]) : "bad json");
      child.emit("close", 0);
      await Promise.resolve();
      if (reaped) expect(end).not.toHaveBeenCalled();
      reaped?.();
      expect((await replay.completion).state).not.toBe("saved");
    },
  );
  it("maps fixed errors without forwarding stderr", () => {
    for (const code of [
      "GOAL_EVENT_HISTORY_GAP",
      "GOAL_EVENT_HISTORY_REGRESSED",
      "GOAL_EVENT_CHECKPOINT_EXISTS",
      "GOAL_EVENT_CHECKPOINT_MISSING",
      "GOAL_EVENT_CHECKPOINT_BINDING_CONFLICT",
    ]) {
      expect(historyFailure("NEVER DISPLAY " + code)).not.toContain(
        "NEVER DISPLAY",
      );
    }
    expect(historyFailure("private path")).toContain(
      "may already have advanced",
    );
  });
});
