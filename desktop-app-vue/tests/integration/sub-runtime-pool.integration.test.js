/**
 * Real-spawn integration test for SubRuntimePool.
 *
 * Unlike the unit test — which drives a fake child — this test uses the
 * actual `child_process.spawn(process.execPath, [entryFile])` path so we
 * prove end-to-end that:
 *   1. The sub-runtime entry boots and emits its "ready" line
 *   2. stdin JSON-lines commands reach the child
 *   3. The child creates an isolated member session on disk
 *   4. progress / done events stream back over stdout
 *   5. Parent process reaps the child on shutdown
 *
 * Runs under plain Node (not Electron). In CI or when vitest runs via node,
 * `ELECTRON_RUN_AS_NODE=1` is effectively a no-op but harmless, so this test
 * works on any developer machine without requiring a real Electron binary.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  SubRuntimePool,
} = require("../../src/main/ai-engine/code-agent/sub-runtime-pool.js");
const {
  SessionStateManager,
} = require("../../src/main/ai-engine/code-agent/session-state-manager.js");

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-subrt-int-"));
}
function cleanup(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("SubRuntimePool — real spawn integration", () => {
  let projectRoot;
  const parentId = "int-parent";

  beforeEach(() => {
    projectRoot = makeTmp();
    const mgr = new SessionStateManager({ projectRoot });
    mgr.writeIntent(parentId, { goal: "real-spawn test" });
    mgr.writePlan(parentId, {
      title: "parallel",
      steps: ["a", "b", "c", "d"],
    });
    mgr.approvePlan(parentId);
  });
  afterEach(() => cleanup(projectRoot));

  it("spawns 2 real sub-runtimes, each writes its own member progress.log", async () => {
    const pool = new SubRuntimePool({
      maxSize: 2,
      readyTimeoutMs: 10_000,
      runTimeoutMs: 15_000,
    });

    const results = await pool.dispatch({
      projectRoot,
      sessionId: parentId,
      assignments: [
        { memberIdx: 0, role: "executor", steps: ["a1", "a2"] },
        { memberIdx: 1, role: "reviewer", steps: ["r1"] },
      ],
    });

    await pool.shutdown();

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results[0].memberId).toBe(`${parentId}.m0-executor`);
    expect(results[1].memberId).toBe(`${parentId}.m1-reviewer`);

    // Each member must have its own isolated progress.log written by the
    // corresponding child process — not by the parent.
    const log0 = fs.readFileSync(
      path.join(
        projectRoot,
        ".chainlesschain",
        "sessions",
        `${parentId}.m0-executor`,
        "progress.log",
      ),
      "utf-8",
    );
    expect(log0).toContain("[executor] a1");
    expect(log0).toContain("[executor] a2");

    const log1 = fs.readFileSync(
      path.join(
        projectRoot,
        ".chainlesschain",
        "sessions",
        `${parentId}.m1-reviewer`,
        "progress.log",
      ),
      "utf-8",
    );
    expect(log1).toContain("[reviewer] r1");

    // Parent's own progress.log must NOT have been touched by the children
    // (the $team handler is what writes aggregated lines; here we call the
    // pool directly so the parent log stays empty).
    const parentLog = path.join(
      projectRoot,
      ".chainlesschain",
      "sessions",
      parentId,
      "progress.log",
    );
    expect(fs.existsSync(parentLog)).toBe(false);
  }, 30_000);

  it("real-spawn reports errors from child without killing the pool", async () => {
    const pool = new SubRuntimePool({
      maxSize: 1,
      readyTimeoutMs: 10_000,
      runTimeoutMs: 15_000,
    });

    // Ask the child to work against a non-existent parent — the child
    // should respond with a JSON error line and exit cleanly.
    const [res] = await pool.dispatch({
      projectRoot,
      sessionId: "nonexistent-parent",
      assignments: [{ memberIdx: 0, role: "executor", steps: ["a"] }],
    });

    await pool.shutdown();

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/createMemberSession failed/);
  }, 30_000);
});
