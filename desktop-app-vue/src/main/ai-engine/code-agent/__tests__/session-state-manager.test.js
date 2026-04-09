/**
 * SessionStateManager — unit tests focused on the member-session API
 * that $team / SubRuntimePool rely on for fan-out isolation.
 *
 * Uses real tmp dirs (fs is not mockable in Vitest forks pool).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { SessionStateManager, STAGES } = require("../session-state-manager.js");

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-ssm-"));
}
function cleanup(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("SessionStateManager — member sessions", () => {
  let projectRoot;
  let manager;
  const parentId = "parent-session";

  beforeEach(() => {
    projectRoot = makeTmp();
    manager = new SessionStateManager({ projectRoot });
    manager.writeIntent(parentId, { goal: "parallel X" });
    manager.writePlan(parentId, {
      title: "Parent plan",
      steps: ["a", "b", "c"],
    });
    manager.approvePlan(parentId);
  });
  afterEach(() => cleanup(projectRoot));

  it("memberSessionId builds a safe deterministic id", () => {
    expect(manager.memberSessionId(parentId, 0, "executor")).toBe(
      `${parentId}.m0-executor`,
    );
    expect(manager.memberSessionId(parentId, 3, "reviewer")).toBe(
      `${parentId}.m3-reviewer`,
    );
    // Non-alphanumeric role chars are stripped so the id stays regex-safe.
    expect(manager.memberSessionId(parentId, 1, "weird/role!")).toBe(
      `${parentId}.m1-weirdrole`,
    );
  });

  it("memberSessionId rejects bad input", () => {
    expect(() => manager.memberSessionId(parentId, -1, "executor")).toThrow(
      /memberIdx/,
    );
    expect(() => manager.memberSessionId("bad id!", 0, "executor")).toThrow();
  });

  it("createMemberSession writes isolated intent.md and approved plan.md", () => {
    const { memberId, dir } = manager.createMemberSession(parentId, 0, {
      role: "executor",
      steps: ["step-a", "step-b"],
    });
    expect(memberId).toBe(`${parentId}.m0-executor`);
    expect(fs.existsSync(path.join(dir, "intent.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "plan.md"))).toBe(true);

    const plan = manager.readPlan(memberId);
    expect(plan).toBeTruthy();
    expect(plan.approved).toBe(true);
    expect(plan.raw).toContain("step-a");
    expect(plan.raw).toContain("step-b");

    const stage = manager.getStage(memberId);
    expect(stage.stage).toBe(STAGES.EXECUTE);
  });

  it("createMemberSession refuses when parent has no plan", () => {
    const m2 = new SessionStateManager({ projectRoot });
    m2.writeIntent("noplan", { goal: "x" });
    expect(() =>
      m2.createMemberSession("noplan", 0, { role: "executor", steps: [] }),
    ).toThrow(/no plan/);
  });

  it("createMemberSession refuses when parent plan is not approved", () => {
    manager.writeIntent("unapproved", { goal: "x" });
    manager.writePlan("unapproved", { title: "p", steps: ["s"] });
    expect(() =>
      manager.createMemberSession("unapproved", 0, {
        role: "executor",
        steps: [],
      }),
    ).toThrow(/not approved/);
  });

  it("member sessions can appendProgress independently of parent", () => {
    manager.createMemberSession(parentId, 0, {
      role: "executor",
      steps: ["x"],
    });
    manager.createMemberSession(parentId, 1, {
      role: "executor",
      steps: ["y"],
    });
    const id0 = `${parentId}.m0-executor`;
    const id1 = `${parentId}.m1-executor`;
    manager.appendProgress(id0, "m0 did x");
    manager.appendProgress(id1, "m1 did y");

    // Parent's own progress log remains untouched.
    expect(manager.readProgress(parentId)).toBe("");
    expect(manager.readProgress(id0)).toMatch(/m0 did x/);
    expect(manager.readProgress(id1)).toMatch(/m1 did y/);
  });

  it("listMemberSessions returns only children of the given parent", () => {
    manager.createMemberSession(parentId, 0, { role: "executor", steps: [] });
    manager.createMemberSession(parentId, 1, { role: "reviewer", steps: [] });
    // Unrelated session must not leak in.
    manager.writeIntent("other", { goal: "x" });

    const members = manager.listMemberSessions(parentId);
    expect(members).toEqual([
      `${parentId}.m0-executor`,
      `${parentId}.m1-reviewer`,
    ]);
  });

  it("readMemberProgress aggregates progress across members", () => {
    manager.createMemberSession(parentId, 0, { role: "executor", steps: [] });
    manager.createMemberSession(parentId, 1, { role: "executor", steps: [] });
    manager.appendProgress(`${parentId}.m0-executor`, "done 0");
    manager.appendProgress(`${parentId}.m1-executor`, "done 1");

    const rows = manager.readMemberProgress(parentId);
    expect(rows).toHaveLength(2);
    expect(rows[0].memberId).toBe(`${parentId}.m0-executor`);
    expect(rows[0].progress).toMatch(/done 0/);
    expect(rows[1].progress).toMatch(/done 1/);
  });

  it("listMemberSessions returns [] for a parent with no members", () => {
    expect(manager.listMemberSessions(parentId)).toEqual([]);
  });
});
