import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";
import {
  validateWorkflow,
  topoSort,
  planBatches,
  substitutePlaceholders,
  listWorkflows,
  getWorkflow,
  saveWorkflow,
  removeWorkflow,
  executeWorkflow,
  _deps,
} from "../../src/lib/cowork-workflow.js";

function installFakeFs() {
  const files = new Map();
  const dirs = new Set();
  _deps.existsSync = vi.fn((p) => files.has(p) || dirs.has(p));
  _deps.mkdirSync = vi.fn((p) => {
    dirs.add(p);
  });
  _deps.readFileSync = vi.fn((p) => {
    if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
    return files.get(p);
  });
  _deps.writeFileSync = vi.fn((p, body) => {
    files.set(p, body);
  });
  _deps.readdirSync = vi.fn((p) => {
    const sep = p.includes("\\") ? "\\" : "/";
    const prefix = p.endsWith(sep) ? p : p + sep;
    return [...files.keys()]
      .filter((f) => f.startsWith(prefix))
      .map((f) => f.slice(prefix.length))
      .filter((f) => !f.includes("/") && !f.includes("\\"));
  });
  _deps.unlinkSync = vi.fn((p) => {
    if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
    files.delete(p);
  });
  _deps.appendFileSync = vi.fn((p, body) => {
    files.set(p, (files.get(p) || "") + body);
  });
  _deps.now = () => new Date("2026-04-15T12:00:00Z").getTime();
  return files;
}

const VALID_WF = {
  id: "wf-1",
  name: "Docs pipeline",
  steps: [
    { id: "fetch", templateId: null, message: "Find relevant files" },
    {
      id: "summarize",
      templateId: "writing",
      message: "Summarize: ${step.fetch.summary}",
      dependsOn: ["fetch"],
    },
  ],
};

describe("validateWorkflow", () => {
  it("accepts a well-formed workflow", () => {
    const { valid, errors } = validateWorkflow(VALID_WF);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it("rejects missing id/name", () => {
    expect(validateWorkflow({ steps: [] }).valid).toBe(false);
  });

  it("rejects duplicate step ids", () => {
    const wf = {
      id: "x",
      name: "x",
      steps: [
        { id: "a", message: "m" },
        { id: "a", message: "m" },
      ],
    };
    const { valid, errors } = validateWorkflow(wf);
    expect(valid).toBe(false);
    expect(errors.some((e) => /duplicate/.test(e))).toBe(true);
  });

  it("rejects unknown dependsOn", () => {
    const wf = {
      id: "x",
      name: "x",
      steps: [{ id: "a", message: "m", dependsOn: ["ghost"] }],
    };
    const { valid, errors } = validateWorkflow(wf);
    expect(valid).toBe(false);
    expect(errors.some((e) => /ghost/.test(e))).toBe(true);
  });

  it("detects cycles", () => {
    const wf = {
      id: "x",
      name: "x",
      steps: [
        { id: "a", message: "m", dependsOn: ["b"] },
        { id: "b", message: "m", dependsOn: ["a"] },
      ],
    };
    const { valid, errors } = validateWorkflow(wf);
    expect(valid).toBe(false);
    expect(errors.some((e) => /cycle/.test(e))).toBe(true);
  });
});

describe("topoSort / planBatches", () => {
  it("orders dependencies before dependents", () => {
    const order = topoSort(VALID_WF.steps);
    expect(order.map((s) => s.id)).toEqual(["fetch", "summarize"]);
  });

  it("groups independent steps into one batch", () => {
    const steps = [
      { id: "a", message: "m" },
      { id: "b", message: "m" },
      { id: "c", message: "m", dependsOn: ["a", "b"] },
    ];
    const batches = planBatches(steps);
    expect(batches).toHaveLength(2);
    expect(batches[0].map((s) => s.id).sort()).toEqual(["a", "b"]);
    expect(batches[1].map((s) => s.id)).toEqual(["c"]);
  });
});

describe("substitutePlaceholders", () => {
  it("replaces ${step.<id>.<field>} tokens", () => {
    const results = new Map([
      [
        "fetch",
        {
          status: "completed",
          taskId: "t-1",
          result: {
            summary: "found 3 files",
            tokenCount: 42,
            iterationCount: 1,
          },
        },
      ],
    ]);
    expect(
      substitutePlaceholders(
        "saw ${step.fetch.summary} (task=${step.fetch.taskId}, tok=${step.fetch.tokenCount})",
        results,
      ),
    ).toBe("saw found 3 files (task=t-1, tok=42)");
  });

  it("resolves unknown tokens to empty string", () => {
    expect(
      substitutePlaceholders("before ${step.ghost.summary} after", new Map()),
    ).toBe("before  after");
  });

  it("passes through non-strings", () => {
    expect(substitutePlaceholders(null, new Map())).toBeNull();
  });
});

describe("persistence", () => {
  beforeEach(() => installFakeFs());

  it("saves and reads back a workflow", () => {
    saveWorkflow("/project", VALID_WF);
    expect(getWorkflow("/project", "wf-1")).toEqual(VALID_WF);
  });

  it("listWorkflows returns [] when dir missing", () => {
    expect(listWorkflows("/project")).toEqual([]);
  });

  it("listWorkflows returns saved workflows", () => {
    saveWorkflow("/project", VALID_WF);
    saveWorkflow("/project", { ...VALID_WF, id: "wf-2", name: "Other" });
    const wfs = listWorkflows("/project");
    expect(wfs).toHaveLength(2);
  });

  it("rejects invalid workflows on save", () => {
    expect(() => saveWorkflow("/project", { id: "x" })).toThrow(/Invalid/);
  });

  it("removeWorkflow returns false when missing", () => {
    expect(removeWorkflow("/project", "nope")).toBe(false);
  });

  it("removeWorkflow removes the file", () => {
    saveWorkflow("/project", VALID_WF);
    expect(removeWorkflow("/project", "wf-1")).toBe(true);
    expect(getWorkflow("/project", "wf-1")).toBeNull();
  });
});

describe("executeWorkflow", () => {
  beforeEach(() => installFakeFs());

  it("throws when runTask is not injected", async () => {
    _deps.runTask = null;
    await expect(
      executeWorkflow({ workflow: VALID_WF, cwd: "/project" }),
    ).rejects.toThrow(/runTask/);
  });

  it("runs steps in dependency order and substitutes placeholders", async () => {
    const calls = [];
    _deps.runTask = vi.fn(async ({ userMessage, templateId }) => {
      calls.push({ userMessage, templateId });
      return {
        taskId: `task-${calls.length}`,
        status: "completed",
        result: {
          summary: `output of ${templateId || "free"}`,
          tokenCount: 10,
          iterationCount: 1,
        },
      };
    });
    const out = await executeWorkflow({ workflow: VALID_WF, cwd: "/project" });
    expect(out.status).toBe("completed");
    expect(calls).toHaveLength(2);
    expect(calls[0].userMessage).toBe("Find relevant files");
    expect(calls[1].userMessage).toBe("Summarize: output of free");
  });

  it("runs independent steps in parallel", async () => {
    const wf = {
      id: "parallel",
      name: "Parallel",
      steps: [
        { id: "a", message: "do a" },
        { id: "b", message: "do b" },
      ],
    };
    let inFlight = 0;
    let maxInFlight = 0;
    _deps.runTask = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { taskId: "t", status: "completed", result: { summary: "ok" } };
    });
    await executeWorkflow({ workflow: wf, cwd: "/project" });
    expect(maxInFlight).toBe(2);
  });

  it("halts on failure by default", async () => {
    _deps.runTask = vi.fn(async ({ userMessage }) => {
      if (userMessage.includes("Find")) {
        return { taskId: "t1", status: "failed", result: { summary: "boom" } };
      }
      return { taskId: "t2", status: "completed", result: { summary: "ok" } };
    });
    const out = await executeWorkflow({ workflow: VALID_WF, cwd: "/project" });
    expect(out.status).toBe("failed");
    expect(_deps.runTask).toHaveBeenCalledTimes(1);
  });

  it("continues on failure when continueOnError set", async () => {
    _deps.runTask = vi.fn(async ({ userMessage }) => {
      if (userMessage.includes("Find")) {
        return { taskId: "t1", status: "failed", result: { summary: "boom" } };
      }
      return { taskId: "t2", status: "completed", result: { summary: "ok" } };
    });
    const out = await executeWorkflow({
      workflow: VALID_WF,
      cwd: "/project",
      continueOnError: true,
    });
    expect(out.status).toBe("partial");
    expect(_deps.runTask).toHaveBeenCalledTimes(2);
  });

  it("appends to workflow-history.jsonl", async () => {
    const files = installFakeFs();
    _deps.runTask = vi.fn(async () => ({
      taskId: "t",
      status: "completed",
      result: { summary: "ok" },
    }));
    await executeWorkflow({ workflow: VALID_WF, cwd: "/project" });
    const histPath = join(
      "/project",
      ".chainlesschain",
      "cowork",
      "workflow-history.jsonl",
    );
    expect(files.has(histPath)).toBe(true);
    const lines = files.get(histPath).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).workflowId).toBe("wf-1");
  });
});
