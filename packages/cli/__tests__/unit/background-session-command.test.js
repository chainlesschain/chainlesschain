import { describe, expect, it } from "vitest";
import {
  formatBackgroundAgentDetails,
  formatBackgroundAgentLine,
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
