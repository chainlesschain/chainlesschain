import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LOG_TRUNCATION_NOTICE,
  buildBackgroundDispatchArgs,
  formatBackgroundAgentDetails,
  formatBackgroundAgentLine,
  readLogFromOffset,
  replyBackgroundAgent,
  summarizeSideEffects,
} from "../../src/commands/background-session.js";

describe("background-session command helpers", () => {
  it.each(["--help", "--no-worktree", "--dangerously-skip-permissions"])(
    "keeps option-looking dashboard prompt %s inside --print",
    (prompt) => {
      const args = buildBackgroundDispatchArgs(prompt);
      expect(args).toEqual(["agent", "--bg", `--print=${prompt}`]);
      expect(args).not.toContain(prompt);
    },
  );

  it("formats background agent rows with stable status, age and cwd", () => {
    const line = formatBackgroundAgentLine(
      {
        id: "bg-123",
        status: "running",
        startedAt: 1_000,
        endedAt: null,
        cwd: "C:\\repo",
        title: "Fix tests",
      },
      66_000,
    );

    expect(line).toContain("bg-123");
    expect(line).toContain("running");
    expect(line).toContain("1m 5s");
    expect(line).toContain("C:\\repo");
    expect(line).toContain("Fix tests");
  });

  it("formats a detailed background agent view with recent output and actions", () => {
    const text = formatBackgroundAgentDetails(
      {
        id: "bg-123",
        status: "running",
        startedAt: 1_000,
        cwd: "C:\\repo",
        title: "Fix tests",
        pid: 10,
        workerPid: 10,
        agentPid: 11,
        sessionId: "sess-1",
        logFile: "C:\\logs\\bg-123.log",
      },
      "line one\nline two\n",
      { now: 66_000 },
    );

    expect(text).toContain("Background agent bg-123");
    expect(text).toContain("status: running");
    expect(text).toContain("title: Fix tests");
    expect(text).toContain("line two");
    expect(text).toContain("cc attach bg-123");
    expect(text).toContain("cc logs bg-123 -n 100");
    expect(text).toContain("cc daemon stop bg-123");
  });

  it("shows phase, turns and interactive transport availability", () => {
    const text = formatBackgroundAgentDetails(
      {
        id: "bg-9",
        status: "running",
        startedAt: 1_000,
        phase: "idle",
        turnCount: 3,
        transport: { pipe: "\\\\.\\pipe\\cc-bg-bg-9", token: "t" },
      },
      "",
      { now: 2_000 },
    );
    expect(text).toContain("phase: idle");
    expect(text).toContain("turns: 3");
    expect(text).toContain("transport: interactive attach available");
  });

  it("renders the bounded governance and side-effect summaries", () => {
    const text = formatBackgroundAgentDetails(
      {
        id: "bg-gov",
        status: "running",
        startedAt: 1_000,
        governance: {
          owner: "background:bg-gov",
          permissionMode: "auto",
          resourceBudget: { maxTurns: 8, maxCostUsd: 3.5 },
        },
        sideEffects: { total: 3, unsettled: 1, unknown: 1 },
      },
      "",
      { now: 2_000 },
    );
    expect(text).toContain("owner: background:bg-gov");
    expect(text).toContain("permissionMode: auto");
    expect(text).toContain("budget: turns=8 costUsd=3.5");
    expect(text).toContain("sideEffects: total=3 unsettled=1 unknown=1");
  });

  it("summarizes ledger state without exposing operation metadata", () => {
    expect(
      summarizeSideEffects({
        ops: [
          { state: "prepared", meta: { secret: "must-not-leak" } },
          { state: "started" },
          { state: "committed" },
          { state: "unknown" },
        ],
      }),
    ).toEqual({
      total: 4,
      prepared: 1,
      started: 1,
      committed: 1,
      failed: 0,
      unknown: 1,
      unsettled: 2,
    });
  });

  it("queues a background reply through the authenticated transport and waits for acceptance", async () => {
    const sent = [];
    let closed = false;
    const state = {
      id: "bg-reply",
      status: "running",
      phase: "needs_input",
      sessionId: "session-reply",
      transport: { pipe: "fixture-pipe", token: "fixture-token" },
    };
    const result = await replyBackgroundAgent("bg-reply", "  answer beta  ", {
      supervisor: {
        readBackgroundAgentState: () => state,
        effectiveBackgroundAgentState: (value) => value,
      },
      readSessionSnapshot: () => ({ verified: true }),
      connectBackgroundSession: async ({ onEvent }) => ({
        send(message) {
          sent.push(message);
          queueMicrotask(() => onEvent({ type: "accepted", queued: 2 }));
        },
        close() {
          closed = true;
        },
      }),
      timeoutMs: 500,
    });

    expect(sent).toEqual([{ type: "prompt", text: "answer beta" }]);
    expect(result).toEqual({
      id: "bg-reply",
      sessionId: "session-reply",
      accepted: true,
      queued: 2,
      priorPhase: "needs_input",
    });
    expect(closed).toBe(true);
  });

  it("fails closed before sending when the canonical transcript is unverified", async () => {
    let sent = false;
    const state = {
      id: "bg-unverified",
      status: "running",
      transport: { pipe: "fixture-pipe", token: "fixture-token" },
    };
    await expect(
      replyBackgroundAgent("bg-unverified", "answer", {
        supervisor: {
          readBackgroundAgentState: () => state,
          effectiveBackgroundAgentState: (value) => value,
        },
        readSessionSnapshot: () => ({ verified: false }),
        connectBackgroundSession: async () => ({
          send() {
            sent = true;
          },
          close() {},
        }),
      }),
    ).rejects.toMatchObject({
      code: "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
    });
    expect(sent).toBe(false);
  });

  it("refuses terminal or non-interactive sessions instead of inventing a reply route", async () => {
    const supervisor = {
      readBackgroundAgentState: () => ({
        id: "bg-done",
        status: "completed",
      }),
      effectiveBackgroundAgentState: (value) => value,
    };
    await expect(
      replyBackgroundAgent("bg-done", "answer", { supervisor }),
    ).rejects.toThrow(/use daemon resume/u);
  });
});

describe("readLogFromOffset — follow truncation/rotation (Gap 3)", () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-bg-follow-"));
    file = join(dir, "bg.log");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("streams the growth delta on a normal append", () => {
    writeFileSync(file, "hello ", "utf-8");
    const first = readLogFromOffset(file, 0);
    expect(first.text).toBe("hello ");
    writeFileSync(file, "hello world", "utf-8");
    const second = readLogFromOffset(file, first.offset);
    expect(second.text).toBe("world");
    expect(second.truncated).toBeUndefined();
  });

  it("on truncation emits a marker and resumes from the tail — NOT the whole file", () => {
    // Build a large log, remember the offset, then rotate to a small file.
    const big = "OLD-LINE\n".repeat(2000); // ~18 KB of stale content
    writeFileSync(file, big, "utf-8");
    const offset = big.length;
    writeFileSync(file, "FRESH-AFTER-ROTATE\n", "utf-8"); // truncated/rotated

    const out = readLogFromOffset(file, offset);
    expect(out.truncated).toBe(true);
    expect(out.text).toContain(LOG_TRUNCATION_NOTICE);
    expect(out.text).toContain("FRESH-AFTER-ROTATE");
    // RED anchor: the old content must NOT be replayed.
    expect(out.text).not.toContain("OLD-LINE");
    expect(out.offset).toBe("FRESH-AFTER-ROTATE\n".length);
  });

  it("caps the resumed tail at 4 KB when a rotated file is itself large", () => {
    writeFileSync(file, "X".repeat(50_000), "utf-8");
    const offset = 60_000; // pretend we were reading a much larger prior file
    const out = readLogFromOffset(file, offset);
    expect(out.truncated).toBe(true);
    // marker + newline framing + at most 4096 bytes of tail
    expect(out.text.length).toBeLessThanOrEqual(
      LOG_TRUNCATION_NOTICE.length + 2 + 4096,
    );
  });
});
