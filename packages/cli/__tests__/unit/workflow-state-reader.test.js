import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  listWorkflowSessions,
  readWorkflowSession,
} from "../../src/lib/workflow-state-reader.js";

function makeTmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-wf-reader-"));
}
function cleanup(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function writeSession(projectRoot, id, files) {
  const dir = path.join(projectRoot, ".chainlesschain", "sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, "utf-8");
  }
}

describe("workflow-state-reader", () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = makeTmpProject();
  });
  afterEach(() => cleanup(projectRoot));

  it("listWorkflowSessions returns [] when dir missing", () => {
    expect(listWorkflowSessions(projectRoot)).toEqual([]);
  });

  it("lists all sessions with stage and approved flags", () => {
    writeSession(projectRoot, "s1", {
      "intent.md": "# Intent\n",
      "mode.json": JSON.stringify({
        stage: "intent",
        updatedAt: "2026-04-08T00:00:00Z",
      }),
    });
    writeSession(projectRoot, "s2", {
      "intent.md": "# Intent\n",
      "plan.md":
        "---\nsession: s2\napproved: true\nupdated: 2026-04-08T01:00:00Z\n---\n\n# Plan\n",
      "mode.json": JSON.stringify({
        stage: "plan",
        updatedAt: "2026-04-08T01:00:00Z",
      }),
    });

    const list = listWorkflowSessions(projectRoot);
    expect(list).toHaveLength(2);
    // sorted by updatedAt desc
    expect(list[0].sessionId).toBe("s2");
    expect(list[0].approved).toBe(true);
    expect(list[1].sessionId).toBe("s1");
    expect(list[1].approved).toBe(null); // no plan.md
  });

  it("readWorkflowSession returns null for missing session", () => {
    expect(readWorkflowSession(projectRoot, "nope")).toBe(null);
  });

  it("readWorkflowSession reads intent, plan, progress, mode", () => {
    writeSession(projectRoot, "sess-1", {
      "intent.md": "# Intent\n\ngoal text",
      "plan.md":
        "---\napproved: false\n---\n\n# Plan: T\n\n## Steps\n\n1. step a\n",
      "progress.log": "[2026-04-08T00:00:00Z] first line\n",
      "mode.json": JSON.stringify({ stage: "plan", updatedAt: "now" }),
    });

    const data = readWorkflowSession(projectRoot, "sess-1");
    expect(data.sessionId).toBe("sess-1");
    expect(data.intent).toContain("goal text");
    expect(data.plan).toContain("step a");
    expect(data.planApproved).toBe(false);
    expect(data.progress).toContain("first line");
    expect(data.mode.stage).toBe("plan");
  });

  it("rejects unsafe sessionId", () => {
    expect(() => readWorkflowSession(projectRoot, "../evil")).toThrow(
      /sessionId/,
    );
  });
});
