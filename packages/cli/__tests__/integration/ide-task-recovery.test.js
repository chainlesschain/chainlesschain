import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentLoop } from "../helpers/test-model-egress.js";
import { TaskProgressTracker } from "../../src/lib/task-progress-tracker.js";
import { hashLine } from "../../src/lib/hashline.js";
import {
  mockToolCallMessage,
  mockTextMessage,
} from "../../src/harness/mock-llm-provider.js";

describe("IDE task recovery", () => {
  let cwd;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cc-ide-recovery-"));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("refreshes hashes and completes an edit while exploration remains paused", async () => {
    const file = join(cwd, "version.txt");
    writeFileSync(file, "version=1\n");
    const tracker = new TaskProgressTracker();
    for (let i = 0; i < 24; i++)
      tracker.record("search_files", { matches: [] });
    let calls = 0;
    const events = [];
    for await (const event of agentLoop(
      [{ role: "user", content: "Update version.txt to version=2" }],
      {
        cwd,
        taskProgressTracker: tracker,
        contextMemorySkipPlanning: true,
        autoMicroCompact: false,
        maxIterations: 8,
        chatFn: async (messages, options) => {
          calls++;
          if (calls === 1)
            return {
              message: mockToolCallMessage(
                "edit_file_hashed",
                {
                  path: "version.txt",
                  anchor_hash: "badbad",
                  expected_line: "version=1",
                  new_line: "version=2",
                },
                "bad-edit",
              ),
            };
          if (calls === 2) {
            const failure = events.find(
              (e) => e.type === "tool-result" && e.tool === "edit_file_hashed",
            ).result;
            expect(failure.error).toBe("hash_mismatch");
            expect(options.disabledTools || []).not.toContain("read_file");
            return {
              message: mockToolCallMessage(
                "read_file",
                failure.recoveryRead,
                "refresh",
              ),
            };
          }
          if (calls === 3) {
            const refreshed = events.find(
              (e) => e.type === "tool-result" && e.tool === "read_file",
            ).result;
            expect(refreshed.readRecovery.action).toBe("edit-anchor-refresh");
            expect(refreshed.content).toContain(hashLine("version=1"));
            expect(tracker.intervention.recovery).toBe(true);
            return {
              message: mockToolCallMessage(
                "edit_file_hashed",
                {
                  path: "version.txt",
                  anchor_hash: hashLine("version=1"),
                  expected_line: "version=1",
                  new_line: "version=2",
                },
                "good-edit",
              ),
            };
          }
          return { message: mockTextMessage("Updated version.txt") };
        },
      },
    ))
      events.push(event);
    expect(readFileSync(file, "utf8")).toBe("version=2\n");
    expect(tracker.intervention).toBeNull();
    expect(calls).toBe(4);
  });

  it("yields after completed tools and preserves their results for the next user message", async () => {
    writeFileSync(join(cwd, "context.txt"), "retained evidence");
    const messages = [
      { role: "user", content: "Inspect context.txt then continue" },
    ];
    let pending = false;
    let calls = 0;
    const events = [];
    for await (const event of agentLoop(messages, {
      cwd,
      contextMemorySkipPlanning: true,
      autoMicroCompact: false,
      shouldYieldToUser: () => pending,
      chatFn: async () => {
        calls++;
        return {
          message: mockToolCallMessage(
            "read_file",
            { path: "context.txt" },
            "read-context",
          ),
        };
      },
    })) {
      events.push(event);
      if (event.type === "tool-result") pending = true;
    }
    expect(calls).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: "run-ended",
      reason: "user-input-pending",
    });
    expect(
      messages.some(
        (m) =>
          m.role === "tool" &&
          m.tool_call_id === "read-context" &&
          m.content.includes("retained evidence"),
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "response-complete")).toBe(false);
  });
});
