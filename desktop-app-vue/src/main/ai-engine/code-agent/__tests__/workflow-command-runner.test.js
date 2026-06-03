/**
 * workflow-command-runner — end-to-end test that parse + dispatch +
 * handler + SessionStateManager all wire together against a real tmp dir.
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
  runWorkflowCommand,
  isWorkflowCommand,
} = require("../workflow-command-runner.js");

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-runner-"));
}
function cleanup(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("isWorkflowCommand", () => {
  it("detects workflow prefixes", () => {
    expect(isWorkflowCommand("$deep-interview x")).toBe(true);
    expect(isWorkflowCommand("$ralplan")).toBe(true);
    expect(isWorkflowCommand("hello")).toBe(false);
    expect(isWorkflowCommand("$unknown")).toBe(false);
  });
});

describe("runWorkflowCommand", () => {
  let projectRoot;
  const sessionId = "sess-x";

  beforeEach(() => {
    projectRoot = makeTmpRoot();
  });
  afterEach(() => cleanup(projectRoot));

  it("returns matched=false for non-workflow text", async () => {
    const r = await runWorkflowCommand("hello world", { projectRoot });
    expect(r.matched).toBe(false);
    expect(r.success).toBe(false);
  });

  it("end-to-end: deep-interview → ralplan → approve → ralph", async () => {
    // Step 1: intent
    const r1 = await runWorkflowCommand('$deep-interview "add OAuth"', {
      projectRoot,
      sessionId,
    });
    expect(r1.matched).toBe(true);
    expect(r1.success).toBe(true);
    expect(r1.skill).toBe("deep-interview");
    expect(fs.existsSync(r1.result.intentFile)).toBe(true);

    // Step 2: plan
    const r2 = await runWorkflowCommand("$ralplan Initial auth plan", {
      projectRoot,
      sessionId,
    });
    expect(r2.success).toBe(true);
    expect(r2.result.approved).toBe(false);

    // Step 3: approve
    const r3 = await runWorkflowCommand("$ralplan --approve", {
      projectRoot,
      sessionId,
    });
    expect(r3.success).toBe(true);
    expect(r3.result.approved).toBe(true);

    // Step 4: ralph
    const r4 = await runWorkflowCommand("$ralph start work", {
      projectRoot,
      sessionId,
    });
    expect(r4.success).toBe(true);
    expect(r4.result.mode).toBe("ralph");
    const log = fs.readFileSync(r4.result.progressFile, "utf-8");
    expect(log).toContain("start work");
  });

  it("enforces gates: ralph before plan approved", async () => {
    await runWorkflowCommand('$deep-interview "g"', {
      projectRoot,
      sessionId,
    });
    // Inject a minimal plan via $ralplan (it needs steps for $team later,
    // but ralph just needs any plan)
    await runWorkflowCommand("$ralplan T", {
      projectRoot,
      sessionId,
    });
    const res = await runWorkflowCommand("$ralph go", {
      projectRoot,
      sessionId,
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/approved/);
  });
});
