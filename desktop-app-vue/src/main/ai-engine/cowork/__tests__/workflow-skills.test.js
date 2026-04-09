/**
 * Canonical coding workflow — SessionStateManager + 4 workflow skills.
 *
 * Uses a real tmp dir (one per test) instead of mocking fs, which is
 * unreliable for CJS modules inlined by Vitest's forks pool.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const fs = require("fs");
const os = require("os");
const path = require("path");

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  SessionStateManager,
  STAGES,
} = require("../../code-agent/session-state-manager.js");
const deepInterview = require("../skills/builtin/deep-interview/handler.js");
const ralplan = require("../skills/builtin/ralplan/handler.js");
const ralph = require("../skills/builtin/ralph/handler.js");
const team = require("../skills/builtin/team/handler.js");

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-workflow-"));
}

function cleanup(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("SessionStateManager", () => {
  let projectRoot;
  let manager;

  beforeEach(() => {
    projectRoot = makeTmpRoot();
    manager = new SessionStateManager({ projectRoot });
  });

  afterEach(() => cleanup(projectRoot));

  it("rejects construction without projectRoot", () => {
    expect(() => new SessionStateManager({})).toThrow(/projectRoot/);
  });

  it("rejects unsafe session IDs", () => {
    expect(() => manager.sessionDir("../evil")).toThrow(/sessionId/);
    expect(() => manager.sessionDir("a b")).toThrow(/sessionId/);
  });

  it("writes intent.md and sets stage=intent", () => {
    const file = manager.writeIntent("s1", {
      goal: "Add OAuth",
      clarifications: ["Which provider?"],
      nonGoals: ["UI redesign"],
    });
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("Add OAuth");
    expect(content).toContain("Which provider?");
    expect(content).toContain("UI redesign");
    expect(manager.getStage("s1").stage).toBe(STAGES.INTENT);
  });

  it("writePlan fails without intent.md", () => {
    expect(() => manager.writePlan("s1", { title: "P", steps: ["a"] })).toThrow(
      /deep-interview first/,
    );
  });

  it("writes plan.md with approved=false by default", () => {
    manager.writeIntent("s1", { goal: "g" });
    const file = manager.writePlan("s1", {
      title: "Test plan",
      steps: ["step one", "step two"],
      tradeoffs: ["perf vs readability"],
    });
    const plan = manager.readPlan("s1");
    expect(plan.approved).toBe(false);
    expect(plan.raw).toContain("step one");
    expect(plan.raw).toContain("perf vs readability");
    expect(fs.existsSync(file)).toBe(true);
  });

  it("approvePlan flips frontmatter to approved=true", () => {
    manager.writeIntent("s1", { goal: "g" });
    manager.writePlan("s1", { title: "T", steps: ["a"] });
    manager.approvePlan("s1");
    expect(manager.readPlan("s1").approved).toBe(true);
  });

  it("appendProgress refuses if plan is not approved", () => {
    manager.writeIntent("s1", { goal: "g" });
    manager.writePlan("s1", { title: "T", steps: ["a"] });
    expect(() => manager.appendProgress("s1", "start")).toThrow(/not approved/);
  });

  it("appendProgress works after approval and sets stage=execute", () => {
    manager.writeIntent("s1", { goal: "g" });
    manager.writePlan("s1", { title: "T", steps: ["a"] });
    manager.approvePlan("s1");
    const file = manager.appendProgress("s1", "first note");
    expect(fs.readFileSync(file, "utf-8")).toContain("first note");
    expect(manager.getStage("s1").stage).toBe(STAGES.EXECUTE);
  });

  it("listSessions returns all session directories", () => {
    manager.writeIntent("alpha", { goal: "a" });
    manager.writeIntent("beta", { goal: "b" });
    const list = manager.listSessions().sort();
    expect(list).toEqual(["alpha", "beta"]);
  });
});

describe("$deep-interview handler", () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = makeTmpRoot();
  });
  afterEach(() => cleanup(projectRoot));

  it("rejects empty goal", async () => {
    const res = await deepInterview.execute({ params: {} }, { projectRoot });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/goal/);
  });

  it("writes intent.md and returns relative path", async () => {
    const res = await deepInterview.execute(
      { params: { goal: "Add OAuth", sessionId: "s1" } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.sessionId).toBe("s1");
    expect(res.result.stage).toBe("intent");
    expect(fs.existsSync(res.result.intentFile)).toBe(true);
  });

  it("auto-generates sessionId when not provided", async () => {
    const res = await deepInterview.execute(
      { params: { goal: "x" } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.sessionId).toMatch(/^session-\d+/);
  });
});

describe("$ralplan handler", () => {
  let projectRoot;
  const sessionId = "s1";

  beforeEach(() => {
    projectRoot = makeTmpRoot();
  });
  afterEach(() => cleanup(projectRoot));

  it("refuses to write plan without intent.md", async () => {
    const res = await ralplan.execute(
      { params: { sessionId, title: "T", steps: ["a"] } },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/intent\.md/);
  });

  it("requires sessionId", async () => {
    const res = await ralplan.execute({ params: {} }, { projectRoot });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/sessionId/);
  });

  it("writes plan.md with approved=false after intent exists", async () => {
    await deepInterview.execute(
      { params: { goal: "g", sessionId } },
      { projectRoot },
    );
    const res = await ralplan.execute(
      {
        params: {
          sessionId,
          title: "Auth plan",
          steps: ["design", "implement", "test"],
          tradeoffs: ["speed vs safety"],
        },
      },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.approved).toBe(false);
    const plan = fs.readFileSync(res.result.planFile, "utf-8");
    expect(plan).toContain("Auth plan");
    expect(plan).toContain("implement");
  });

  it("approve=true flips the approved flag", async () => {
    await deepInterview.execute(
      { params: { goal: "g", sessionId } },
      { projectRoot },
    );
    await ralplan.execute(
      { params: { sessionId, title: "T", steps: ["a"] } },
      { projectRoot },
    );
    const res = await ralplan.execute(
      { params: { sessionId, approve: true } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.approved).toBe(true);
    const mgr = new SessionStateManager({ projectRoot });
    expect(mgr.readPlan(sessionId).approved).toBe(true);
  });
});

describe("$ralph handler", () => {
  let projectRoot;
  const sessionId = "s1";

  beforeEach(async () => {
    projectRoot = makeTmpRoot();
    await deepInterview.execute(
      { params: { goal: "g", sessionId } },
      { projectRoot },
    );
    await ralplan.execute(
      { params: { sessionId, title: "T", steps: ["a", "b"] } },
      { projectRoot },
    );
  });
  afterEach(() => cleanup(projectRoot));

  it("refuses when plan is not approved", async () => {
    const res = await ralph.execute(
      { params: { sessionId, note: "start" } },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/approved/);
  });

  it("appends progress after approval", async () => {
    await ralplan.execute(
      { params: { sessionId, approve: true } },
      { projectRoot },
    );
    const res = await ralph.execute(
      { params: { sessionId, note: "started executing" } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.mode).toBe("ralph");
    const log = fs.readFileSync(res.result.progressFile, "utf-8");
    expect(log).toContain("started executing");
    expect(log).toContain("[ralph]");
  });

  it("refuses without sessionId", async () => {
    const res = await ralph.execute({ params: {} }, { projectRoot });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/sessionId/);
  });
});

describe("$team handler", () => {
  let projectRoot;
  const sessionId = "s1";

  beforeEach(async () => {
    projectRoot = makeTmpRoot();
    await deepInterview.execute(
      { params: { goal: "g", sessionId } },
      { projectRoot },
    );
    await ralplan.execute(
      {
        params: {
          sessionId,
          title: "T",
          steps: ["alpha", "beta", "gamma", "delta"],
        },
      },
      { projectRoot },
    );
  });
  afterEach(() => cleanup(projectRoot));

  it("refuses without approved plan", async () => {
    const res = await team.execute(
      { params: { sessionId, size: 2, role: "executor" } },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/approved/);
  });

  it("parses N:role spec from task.action", async () => {
    await ralplan.execute(
      { params: { sessionId, approve: true } },
      { projectRoot },
    );
    const res = await team.execute(
      { action: "2:executor please dispatch", params: { sessionId } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.size).toBe(2);
    expect(res.result.role).toBe("executor");
    expect(res.result.assignments).toHaveLength(2);
    const allSteps = res.result.assignments.flatMap((a) => a.steps);
    expect(allSteps.sort()).toEqual(["alpha", "beta", "delta", "gamma"]);
  });

  it("rejects unknown role", async () => {
    await ralplan.execute(
      { params: { sessionId, approve: true } },
      { projectRoot },
    );
    const res = await team.execute(
      { params: { sessionId, size: 2, role: "wizard" } },
      { projectRoot },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/role/);
  });

  it("caps size to MAX_SIZE=6", async () => {
    await ralplan.execute(
      { params: { sessionId, approve: true } },
      { projectRoot },
    );
    const res = await team.execute(
      { params: { sessionId, size: 99, role: "executor" } },
      { projectRoot },
    );
    expect(res.success).toBe(true);
    expect(res.result.size).toBe(6);
  });

  it("parseSpec helper handles malformed input", () => {
    expect(team.parseSpec("")).toEqual({});
    expect(team.parseSpec("garbage")).toEqual({});
    expect(team.parseSpec("4:tester rest of the line")).toEqual({
      size: 4,
      role: "tester",
    });
  });

  it("distributeSteps spreads evenly round-robin", () => {
    const buckets = team.distributeSteps(["a", "b", "c", "d", "e"], 3);
    expect(buckets).toEqual([["a", "d"], ["b", "e"], ["c"]]);
  });
});
