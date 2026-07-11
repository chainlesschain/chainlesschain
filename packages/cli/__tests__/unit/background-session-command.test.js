import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LOG_TRUNCATION_NOTICE,
  formatBackgroundAgentDetails,
  formatBackgroundAgentLine,
  readLogFromOffset,
} from "../../src/commands/background-session.js";

describe("background-session command helpers", () => {
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
