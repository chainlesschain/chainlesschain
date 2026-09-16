import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-worklog-authority-"));
const securityDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "cc-worklog-witness-"),
);
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => testDir,
  getClaudeProjectStorageDir: () => null,
  getStatePath: () => path.join(testDir, "state"),
  getMachineSecurityAnchorDir: () => securityDir,
}));
const { startSession, appendUserMessage, rebuildMessages, deleteJsonlSession } =
  await import("../../src/harness/jsonl-session-store.js");
const { TaskWorklog, readTaskWorklog } =
  await import("../../src/lib/context-memory-kernel/task-worklog-port.js");
const { JsonlSessionContextPort } =
  await import("../../src/lib/context-memory-kernel/jsonl-session-context-port.js");
afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.rmSync(securityDir, { recursive: true, force: true });
});

describe("Kernel task checkpoints backed by the real verified JSONL authority", () => {
  it("replays a revisioned checkpoint, rebuilds Markdown and preserves canonical conversation messages", () => {
    const env = {
      CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
    };
    startSession("worklog-authority-source", { title: "source" });
    appendUserMessage("worklog-authority-source", "Fix parser");
    const source = new TaskWorklog({
      cwd: testDir,
      sessionId: "worklog-authority-source",
      env,
    });
    source.user("Fix parser");
    source.record({ type: "result", result: "Next: reproduce empty input" });
    const checkpoint = new JsonlSessionContextPort({
      sessionId: source.sessionId,
    }).readTaskCheckpoint().checkpoint;
    expect(checkpoint.revision).toBe(2);
    expect(checkpoint.state.lastAssistant).toContain("empty input");
    expect(rebuildMessages(source.sessionId)).toEqual([
      { role: "user", content: "Fix parser" },
    ]);
    fs.unlinkSync(source.file);
    startSession("worklog-authority-target", { title: "target" });
    const target = new TaskWorklog({
      cwd: testDir,
      sessionId: "worklog-authority-target",
      env,
    });
    target.inherit(source.sessionId);
    expect(readTaskWorklog(testDir, source.sessionId).state.objective).toBe(
      "Fix parser",
    );
    expect(target.state.lastAssistant).toContain("empty input");
    const restored = new TaskWorklog({
      cwd: testDir,
      sessionId: target.sessionId,
      env,
    });
    expect(restored.state.parentSessionId).toBe(source.sessionId);
    deleteJsonlSession(source.sessionId);
    expect(() => target.readHistory(source.sessionId)).toThrow();
  });
});
