import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnBindingLog } from "../../src/lib/turn-binding.js";

const testDir = join(tmpdir(), `cc-checkpoint-timeline-${process.pid}`);
const sessionsDir = join(testDir, "sessions");

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => testDir,
}));

const store = await import("../../src/harness/jsonl-session-store.js");
const bindings = await import("../../src/lib/turn-binding-store.js");

describe("checkpoint timeline atomic session commit", () => {
  beforeEach(() => mkdirSync(sessionsDir, { recursive: true }));
  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("compare-and-appends only at the exact transcript head", () => {
    const first = store.appendEvent("timeline-cas", "user_message", {
      role: "user",
      content: "one",
    });
    const claimed = store.appendEventIfHead(
      "timeline-cas",
      "checkpoint_timeline_action_intent",
      { revision: "r1" },
      first.hash,
    );
    expect(claimed.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      store.appendEventIfHead(
        "timeline-cas",
        "checkpoint_timeline_action_intent",
        { revision: "stale" },
        first.hash,
      ),
    ).toThrowError(expect.objectContaining({ code: "SESSION_REVISION_STALE" }));
  });

  it("one composite event atomically replaces replay messages and binding", () => {
    const first = store.appendEvent("timeline-commit", "user_message", {
      role: "user",
      content: "old",
    });
    const log = new TurnBindingLog();
    log.startTurn("turn-kept", { conversationOffset: 2 });
    const messages = [
      { role: "system", content: "system" },
      { role: "user", content: "kept" },
    ];
    const committed = store.appendEventIfHead(
      "timeline-commit",
      bindings.TURN_BINDING_TIMELINE_EVENT,
      {
        action: "restore-conversation",
        messages,
        binding: log.toJSON(),
      },
      first.hash,
    );
    store.appendEvent("timeline-commit", "checkpoint_timeline_action", {
      status: "completed",
    });

    expect(committed.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.rebuildMessages("timeline-commit")).toEqual(messages);
    expect(bindings.loadTurnBindingLog("timeline-commit").list()).toEqual([
      expect.objectContaining({ turnId: "turn-kept", conversationOffset: 2 }),
    ]);
  });
});
