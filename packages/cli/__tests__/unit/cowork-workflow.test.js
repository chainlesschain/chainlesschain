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
  resolveForEachItems,
  substituteItem,
  shouldRunStep,
  retryDelayFor,
  withTimeout,
  runStepWithRetry,
  isLoopStep,
  loopIterationCap,
  substituteLoopVars,
  evalLoopContinue,
  runLoopStep,
  runPipeline,
  MAX_FAN_OUT,
  MAX_LOOP_ITERATIONS,
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
  // Simulate atomic temp+rename in the in-memory fs.
  _deps.renameSync = vi.fn((from, to) => {
    if (!files.has(from)) throw new Error(`ENOENT: ${from}`);
    files.set(to, files.get(from));
    files.delete(from);
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
    const files = installFakeFs();
    saveWorkflow("/project", VALID_WF);
    expect(getWorkflow("/project", "wf-1")).toEqual(VALID_WF);
    // Atomic write: the temp sibling was renamed away, none left behind.
    expect([...files.keys()].some((k) => k.endsWith(".tmp"))).toBe(false);
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

// ─── N3: when + forEach ──────────────────────────────────────────────────────

describe("N3: validateWorkflow accepts when/forEach", () => {
  it("accepts step with string when", () => {
    const wf = {
      id: "w",
      name: "W",
      steps: [{ id: "a", message: "x", when: "${step.x.status} == 'ok'" }],
    };
    expect(validateWorkflow(wf).valid).toBe(true);
  });

  it("rejects non-string when", () => {
    const wf = {
      id: "w",
      name: "W",
      steps: [{ id: "a", message: "x", when: 123 }],
    };
    expect(validateWorkflow(wf).errors.join(" ")).toMatch(/when must be/);
  });

  it("accepts forEach array literal", () => {
    const wf = {
      id: "w",
      name: "W",
      steps: [{ id: "a", message: "x ${item}", forEach: ["a", "b"] }],
    };
    expect(validateWorkflow(wf).valid).toBe(true);
  });

  it("accepts forEach reference string", () => {
    const wf = {
      id: "w",
      name: "W",
      steps: [{ id: "a", message: "x ${item}", forEach: "${step.x.items}" }],
    };
    expect(validateWorkflow(wf).valid).toBe(true);
  });

  it("rejects non-array non-string forEach", () => {
    const wf = {
      id: "w",
      name: "W",
      steps: [{ id: "a", message: "x", forEach: 42 }],
    };
    expect(validateWorkflow(wf).errors.join(" ")).toMatch(/forEach must be/);
  });
});

describe("N3: resolveForEachItems", () => {
  it("returns array literal verbatim", () => {
    expect(resolveForEachItems([1, 2, 3], new Map())).toEqual([1, 2, 3]);
  });

  it("resolves reference to step result array", () => {
    const r = new Map([["x", { result: { items: ["a", "b"] } }]]);
    expect(resolveForEachItems("${step.x.items}", r)).toEqual(["a", "b"]);
  });

  it("throws when ref resolves to non-array", () => {
    const r = new Map([["x", { result: { summary: "nope" } }]]);
    expect(() => resolveForEachItems("${step.x.summary}", r)).toThrow(
      /did not resolve to an array/,
    );
  });

  it("throws when array exceeds MAX_FAN_OUT", () => {
    const big = new Array(MAX_FAN_OUT + 1).fill(1);
    expect(() => resolveForEachItems(big, new Map())).toThrow(/MAX_FAN_OUT/);
  });

  it("throws on bare string without ${} wrapper", () => {
    expect(() => resolveForEachItems("step.x.items", new Map())).toThrow(
      /wrapped/,
    );
  });
});

describe("N3: substituteItem", () => {
  it("replaces ${item} with string", () => {
    expect(substituteItem("hello ${item}", "world")).toBe("hello world");
  });

  it("stringifies non-string items", () => {
    expect(substituteItem("value: ${item}", { a: 1 })).toBe('value: {"a":1}');
  });

  it("leaves template unchanged if no token", () => {
    expect(substituteItem("no token", "x")).toBe("no token");
  });

  it("inserts the item literally — $-sequences are not replace patterns", () => {
    // $& $` $' would expand to match/pre/post; $$ would collapse to $.
    expect(substituteItem("x=${item}", "a$&b $`c $'d")).toBe("x=a$&b $`c $'d");
    expect(substituteItem("v=${item}", "$$")).toBe("v=$$");
    expect(substituteItem("${item}-${item}", "Z")).toBe("Z-Z");
  });
});

describe("N3: shouldRunStep", () => {
  it("returns true when no when clause", () => {
    expect(shouldRunStep({ id: "a", message: "x" }, new Map())).toBe(true);
  });

  it("returns true on satisfied condition", () => {
    const r = new Map([
      ["a", { status: "completed", result: { summary: "ok" } }],
    ]);
    expect(
      shouldRunStep(
        { id: "b", message: "x", when: "${step.a.status} == 'completed'" },
        r,
      ),
    ).toBe(true);
  });

  it("returns false on unsatisfied condition", () => {
    const r = new Map([["a", { status: "failed" }]]);
    expect(
      shouldRunStep(
        { id: "b", message: "x", when: "${step.a.status} == 'completed'" },
        r,
      ),
    ).toBe(false);
  });

  it("throws on invalid expression", () => {
    expect(() =>
      shouldRunStep(
        { id: "b", message: "x", when: "totally bogus!" },
        new Map(),
      ),
    ).toThrow(/invalid when on step/);
  });
});

describe("N3: executeWorkflow with when-skip", () => {
  beforeEach(() => {
    installFakeFs();
    _deps.runTask = vi.fn(async ({ userMessage }) => ({
      taskId: `t-${userMessage}`,
      status: "completed",
      result: { summary: `OK:${userMessage}`, tokenCount: 10 },
    }));
  });

  it("skips step when condition is false", async () => {
    const wf = {
      id: "w",
      name: "W",
      steps: [
        { id: "a", message: "first" },
        {
          id: "b",
          message: "second",
          dependsOn: ["a"],
          when: "${step.a.status} == 'failed'",
        },
      ],
    };
    const rec = await executeWorkflow({ workflow: wf, cwd: "/p" });
    const b = rec.steps.find((s) => s.id === "b");
    expect(b.status).toBe("skipped");
    expect(b.result.summary).toMatch(/when-condition false/);
    expect(_deps.runTask).toHaveBeenCalledTimes(1); // only step a ran
  });

  it("runs step when condition is true", async () => {
    const wf = {
      id: "w",
      name: "W",
      steps: [
        { id: "a", message: "first" },
        {
          id: "b",
          message: "second",
          dependsOn: ["a"],
          when: "${step.a.status} == 'completed'",
        },
      ],
    };
    const rec = await executeWorkflow({ workflow: wf, cwd: "/p" });
    const b = rec.steps.find((s) => s.id === "b");
    expect(b.status).toBe("completed");
    expect(_deps.runTask).toHaveBeenCalledTimes(2);
  });
});

describe("N3: executeWorkflow with forEach", () => {
  beforeEach(() => {
    installFakeFs();
    _deps.runTask = vi.fn(async ({ userMessage }) => ({
      taskId: `t-${userMessage}`,
      status: "completed",
      result: { summary: `done:${userMessage}` },
    }));
  });

  it("expands forEach array into N runs with substituted ${item}", async () => {
    const wf = {
      id: "w",
      name: "W",
      steps: [
        {
          id: "fan",
          message: "process ${item}",
          forEach: ["alpha", "beta", "gamma"],
        },
      ],
    };
    const rec = await executeWorkflow({ workflow: wf, cwd: "/p" });
    expect(_deps.runTask).toHaveBeenCalledTimes(3);
    const messages = _deps.runTask.mock.calls.map((c) => c[0].userMessage);
    expect(messages.sort()).toEqual([
      "process alpha",
      "process beta",
      "process gamma",
    ]);
    // Child records present
    const childIds = rec.steps.map((s) => s.id);
    expect(childIds).toContain("fan[0]");
    expect(childIds).toContain("fan[2]");
  });

  it("aggregates forEach children for downstream reference", async () => {
    const wf = {
      id: "w",
      name: "W",
      steps: [
        { id: "fan", message: "x ${item}", forEach: ["a", "b"] },
        {
          id: "post",
          message: "after",
          dependsOn: ["fan"],
          when: "${step.fan.status} == 'completed'",
        },
      ],
    };
    const rec = await executeWorkflow({ workflow: wf, cwd: "/p" });
    const post = rec.steps.find((s) => s.id === "post");
    expect(post.status).toBe("completed");
  });

  it("skips forEach when items resolve empty", async () => {
    const wf = {
      id: "w",
      name: "W",
      steps: [{ id: "fan", message: "${item}", forEach: [] }],
    };
    const rec = await executeWorkflow({ workflow: wf, cwd: "/p" });
    expect(rec.steps[0].status).toBe("skipped");
    expect(_deps.runTask).not.toHaveBeenCalled();
  });

  it("expands forEach reference to prior step's array", async () => {
    _deps.runTask = vi.fn(async ({ userMessage }) => {
      if (userMessage === "fetch") {
        return {
          taskId: "t-fetch",
          status: "completed",
          result: { items: ["x", "y"], summary: "fetched" },
        };
      }
      return {
        taskId: `t-${userMessage}`,
        status: "completed",
        result: { summary: userMessage },
      };
    });
    const wf = {
      id: "w",
      name: "W",
      steps: [
        { id: "fetch", message: "fetch" },
        {
          id: "each",
          message: "handle ${item}",
          dependsOn: ["fetch"],
          forEach: "${step.fetch.items}",
        },
      ],
    };
    const rec = await executeWorkflow({ workflow: wf, cwd: "/p" });
    const children = rec.steps.filter((s) => s.id.startsWith("each["));
    expect(children).toHaveLength(2);
  });

  it("fails the forEach step when ref resolves to non-array", async () => {
    const wf = {
      id: "w",
      name: "W",
      steps: [
        { id: "fetch", message: "fetch" },
        {
          id: "each",
          message: "${item}",
          dependsOn: ["fetch"],
          forEach: "${step.fetch.summary}",
        },
      ],
    };
    const rec = await executeWorkflow({
      workflow: wf,
      cwd: "/p",
      continueOnError: true,
    });
    const each = rec.steps.find((s) => s.id === "each");
    expect(each.status).toBe("failed");
  });
});

// ─── Per-step retry / timeout ─────────────────────────────────────────────────

describe("validateWorkflow accepts retry/timeout fields", () => {
  it("accepts valid retries/timeoutMs/retryDelayMs/retryBackoff", () => {
    const wf = {
      id: "w",
      name: "W",
      steps: [
        {
          id: "a",
          message: "x",
          retries: 2,
          timeoutMs: 1000,
          retryDelayMs: 50,
          retryBackoff: "exponential",
        },
      ],
    };
    expect(validateWorkflow(wf).valid).toBe(true);
  });

  it("rejects negative/non-integer retries", () => {
    expect(
      validateWorkflow({
        id: "w",
        name: "W",
        steps: [{ id: "a", message: "x", retries: -1 }],
      }).errors.join(),
    ).toMatch(/retries must be a non-negative integer/);
    expect(
      validateWorkflow({
        id: "w",
        name: "W",
        steps: [{ id: "a", message: "x", retries: 1.5 }],
      }).valid,
    ).toBe(false);
  });

  it("rejects non-positive timeoutMs", () => {
    expect(
      validateWorkflow({
        id: "w",
        name: "W",
        steps: [{ id: "a", message: "x", timeoutMs: 0 }],
      }).errors.join(),
    ).toMatch(/timeoutMs must be a positive number/);
  });

  it("rejects unknown retryBackoff", () => {
    expect(
      validateWorkflow({
        id: "w",
        name: "W",
        steps: [{ id: "a", message: "x", retryBackoff: "linear" }],
      }).errors.join(),
    ).toMatch(/retryBackoff must be/);
  });
});

describe("retryDelayFor", () => {
  it("returns 0 when no base delay", () => {
    expect(retryDelayFor({}, 1)).toBe(0);
  });
  it("fixed backoff returns base verbatim", () => {
    expect(retryDelayFor({ retryDelayMs: 100 }, 1)).toBe(100);
    expect(retryDelayFor({ retryDelayMs: 100 }, 3)).toBe(100);
  });
  it("exponential backoff doubles per prior attempt", () => {
    const step = { retryDelayMs: 100, retryBackoff: "exponential" };
    expect(retryDelayFor(step, 1)).toBe(100);
    expect(retryDelayFor(step, 2)).toBe(200);
    expect(retryDelayFor(step, 3)).toBe(400);
  });
});

describe("withTimeout", () => {
  it("passes through when no timeout set", async () => {
    await expect(withTimeout(async () => 42, 0)).resolves.toBe(42);
  });
  it("resolves when the task wins the race", async () => {
    await expect(withTimeout(async () => "ok", 1000)).resolves.toBe("ok");
  });
  it("rejects with a timeout error when the timer fires first", async () => {
    const orig = _deps.setTimeout;
    // Fire the timeout immediately, deterministically.
    _deps.setTimeout = (fn) => {
      fn();
      return 0;
    };
    try {
      await expect(
        withTimeout(() => new Promise(() => {}), 10),
      ).rejects.toThrow(/timed out after 10ms/);
    } finally {
      _deps.setTimeout = orig;
    }
  });
});

describe("runStepWithRetry", () => {
  beforeEach(() => {
    _deps.sleep = vi.fn(async () => {}); // no real waiting
  });

  it("succeeds on first try without retrying", async () => {
    _deps.runTask = vi.fn(async () => ({
      taskId: "t",
      status: "completed",
      result: { summary: "ok" },
    }));
    const r = await runStepWithRetry({
      step: { id: "a", retries: 3 },
      message: "go",
    });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(_deps.runTask).toHaveBeenCalledTimes(1);
  });

  it("retries a thrown task up to retries+1 times then fails", async () => {
    _deps.runTask = vi.fn(async () => {
      throw new Error("boom");
    });
    const r = await runStepWithRetry({
      step: { id: "a", retries: 2, retryDelayMs: 10 },
      message: "go",
    });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(3);
    expect(_deps.runTask).toHaveBeenCalledTimes(3);
    expect(_deps.sleep).toHaveBeenCalledTimes(2); // one sleep between each retry
    expect(r.error.message).toBe("boom");
  });

  it("retries a non-completed status and succeeds on a later attempt", async () => {
    let n = 0;
    _deps.runTask = vi.fn(async () => {
      n++;
      return n < 3
        ? { taskId: "t", status: "failed", result: { summary: "nope" } }
        : { taskId: "t", status: "completed", result: { summary: "yes" } };
    });
    const r = await runStepWithRetry({
      step: { id: "a", retries: 5 },
      message: "go",
    });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(r.entry.result.summary).toBe("yes");
  });
});

describe("executeWorkflow retry/timeout integration", () => {
  beforeEach(() => {
    installFakeFs();
    _deps.sleep = vi.fn(async () => {});
  });

  it("recovers a flaky step via retries and reports attempts", async () => {
    let n = 0;
    _deps.runTask = vi.fn(async () => {
      n++;
      return n < 2
        ? { taskId: "t", status: "failed", result: { summary: "flaky" } }
        : { taskId: "t", status: "completed", result: { summary: "ok" } };
    });
    const wf = {
      id: "retry-wf",
      name: "Retry",
      steps: [{ id: "a", message: "do a", retries: 3 }],
    };
    const out = await executeWorkflow({ workflow: wf, cwd: "/project" });
    expect(out.status).toBe("completed");
    const a = out.steps.find((s) => s.id === "a");
    expect(a.status).toBe("completed");
    expect(a.result.attempts).toBe(2);
    expect(_deps.runTask).toHaveBeenCalledTimes(2);
  });

  it("leaves single-attempt result shape unchanged (no attempts field)", async () => {
    _deps.runTask = vi.fn(async () => ({
      taskId: "t",
      status: "completed",
      result: { summary: "ok" },
    }));
    const wf = {
      id: "plain-wf",
      name: "Plain",
      steps: [{ id: "a", message: "do a" }],
    };
    const out = await executeWorkflow({ workflow: wf, cwd: "/project" });
    const a = out.steps.find((s) => s.id === "a");
    expect(a.result).toEqual({ summary: "ok" });
    expect(a.result.attempts).toBeUndefined();
  });

  it("fails a step that times out on every attempt", async () => {
    _deps.runTask = vi.fn(() => new Promise(() => {})); // never resolves
    const origSetTimeout = _deps.setTimeout;
    _deps.setTimeout = (fn) => {
      fn();
      return 0;
    };
    try {
      const wf = {
        id: "to-wf",
        name: "Timeout",
        steps: [{ id: "a", message: "do a", timeoutMs: 10, retries: 1 }],
      };
      const out = await executeWorkflow({ workflow: wf, cwd: "/project" });
      expect(out.status).toBe("failed");
      const a = out.steps.find((s) => s.id === "a");
      expect(a.status).toBe("failed");
      expect(a.result.summary).toMatch(/timed out after 10ms/);
      expect(a.result.attempts).toBe(2);
      expect(_deps.runTask).toHaveBeenCalledTimes(2);
    } finally {
      _deps.setTimeout = origSetTimeout;
    }
  });
});

// ─── while / until loop nodes ─────────────────────────────────────────────────

describe("validateWorkflow accepts loop fields", () => {
  const wfWith = (extra) => ({
    id: "w",
    name: "W",
    steps: [{ id: "a", message: "x", ...extra }],
  });
  it("accepts loopUntil + maxIterations", () => {
    expect(
      validateWorkflow(
        wfWith({
          loopUntil: "${self.status} == 'completed'",
          maxIterations: 5,
        }),
      ).valid,
    ).toBe(true);
  });
  it("accepts loopWhile", () => {
    expect(validateWorkflow(wfWith({ loopWhile: "${iter} < 3" })).valid).toBe(
      true,
    );
  });
  it("rejects setting both loopWhile and loopUntil", () => {
    expect(
      validateWorkflow(
        wfWith({ loopWhile: "a", loopUntil: "b" }),
      ).errors.join(),
    ).toMatch(/cannot set both loopWhile and loopUntil/);
  });
  it("rejects combining a loop with forEach", () => {
    expect(
      validateWorkflow(
        wfWith({ loopUntil: "${iter} >= 2", forEach: [1, 2] }),
      ).errors.join(),
    ).toMatch(/cannot combine a loop with forEach/);
  });
  it("rejects non-positive/non-integer maxIterations", () => {
    expect(validateWorkflow(wfWith({ maxIterations: 0 })).valid).toBe(false);
    expect(validateWorkflow(wfWith({ maxIterations: 2.5 })).valid).toBe(false);
  });
  it("rejects non-string loopWhile", () => {
    expect(validateWorkflow(wfWith({ loopWhile: 5 })).valid).toBe(false);
  });
});

describe("isLoopStep / loopIterationCap", () => {
  it("detects loop steps", () => {
    expect(isLoopStep({ loopWhile: "x" })).toBe(true);
    expect(isLoopStep({ loopUntil: "x" })).toBe(true);
    expect(isLoopStep({ message: "x" })).toBe(false);
  });
  it("defaults to MAX_LOOP_ITERATIONS and clamps", () => {
    expect(loopIterationCap({})).toBe(MAX_LOOP_ITERATIONS);
    expect(loopIterationCap({ maxIterations: 5 })).toBe(5);
    expect(loopIterationCap({ maxIterations: 9999 })).toBe(MAX_LOOP_ITERATIONS);
  });
});

describe("substituteLoopVars", () => {
  it("substitutes ${iter} and ${self.<field>}", () => {
    const resultsById = new Map([
      ["a", { status: "completed", result: { summary: "prev" } }],
    ]);
    const out = substituteLoopVars("try ${iter}: ${self.summary}", {
      stepId: "a",
      iter: 2,
      resultsById,
    });
    expect(out).toBe("try 2: prev");
  });
  it("renders empty self on the first iteration", () => {
    const out = substituteLoopVars("[${self.summary}]", {
      stepId: "a",
      iter: 1,
      resultsById: new Map(),
    });
    expect(out).toBe("[]");
  });
});

describe("evalLoopContinue", () => {
  const results = (status) =>
    new Map([["a", { status, result: { summary: status } }]]);
  it("loopWhile continues while true", () => {
    expect(
      evalLoopContinue(
        { loopWhile: "${iter} < 3" },
        { stepId: "a", iter: 2, resultsById: results("completed") },
      ),
    ).toBe(true);
    expect(
      evalLoopContinue(
        { loopWhile: "${iter} < 3" },
        { stepId: "a", iter: 3, resultsById: results("completed") },
      ),
    ).toBe(false);
  });
  it("loopUntil stops when the expression becomes true", () => {
    expect(
      evalLoopContinue(
        { loopUntil: "${self.status} == 'completed'" },
        { stepId: "a", iter: 1, resultsById: results("failed") },
      ),
    ).toBe(true); // not yet completed → keep going
    expect(
      evalLoopContinue(
        { loopUntil: "${self.status} == 'completed'" },
        { stepId: "a", iter: 1, resultsById: results("completed") },
      ),
    ).toBe(false); // completed → stop
  });
});

describe("runLoopStep", () => {
  beforeEach(() => {
    _deps.sleep = vi.fn(async () => {});
  });

  it("loops until ${iter} reaches the bound, reporting iterations", async () => {
    _deps.runTask = vi.fn(async () => ({
      taskId: "t",
      status: "completed",
      result: { summary: "ok" },
    }));
    const out = await runLoopStep({
      step: { id: "a", message: "poll ${iter}", loopWhile: "${iter} < 3" },
      recordId: "a",
      resultsById: new Map(),
    });
    expect(out.status).toBe("completed");
    expect(out.result.iterations).toBe(3);
    expect(out.result.loopStop).toBe("condition");
    expect(out.result.loopExhausted).toBe(false);
    expect(_deps.runTask).toHaveBeenCalledTimes(3);
  });

  it("stops on loopUntil once the task result satisfies it", async () => {
    let n = 0;
    _deps.runTask = vi.fn(async () => {
      n++;
      return {
        taskId: "t",
        status: "completed",
        result: { summary: n >= 2 ? "SUCCESS" : "pending" },
      };
    });
    const out = await runLoopStep({
      step: {
        id: "a",
        message: "check",
        loopUntil: "${self.summary} contains 'SUCCESS'",
      },
      recordId: "a",
      resultsById: new Map(),
    });
    expect(out.result.iterations).toBe(2);
    expect(out.result.loopStop).toBe("condition");
  });

  it("marks loopExhausted when the cap is hit before the condition", async () => {
    _deps.runTask = vi.fn(async () => ({
      taskId: "t",
      status: "completed",
      result: { summary: "never-done" },
    }));
    const out = await runLoopStep({
      step: {
        id: "a",
        message: "x",
        loopUntil: "${self.summary} == 'done'",
        maxIterations: 3,
      },
      recordId: "a",
      resultsById: new Map(),
    });
    expect(out.result.iterations).toBe(3);
    expect(out.result.loopExhausted).toBe(true);
    expect(out.result.loopStop).toBe("cap");
    expect(_deps.runTask).toHaveBeenCalledTimes(3);
  });

  it("aborts the loop when an iteration fails", async () => {
    _deps.runTask = vi.fn(async () => ({
      taskId: "t",
      status: "failed",
      result: { summary: "boom" },
    }));
    const out = await runLoopStep({
      step: { id: "a", message: "x", loopWhile: "${iter} < 9" },
      recordId: "a",
      resultsById: new Map(),
    });
    expect(out.status).toBe("failed");
    expect(out.result.iterations).toBe(1);
    expect(out.result.loopStop).toBe("failed");
    expect(_deps.runTask).toHaveBeenCalledTimes(1);
  });

  it("fails on a malformed loop condition", async () => {
    _deps.runTask = vi.fn(async () => ({
      taskId: "t",
      status: "completed",
      result: { summary: "ok" },
    }));
    const out = await runLoopStep({
      step: { id: "a", message: "x", loopWhile: "${bogus.ref}" },
      recordId: "a",
      resultsById: new Map(),
    });
    expect(out.status).toBe("failed");
    expect(out.result.loopStop).toBe("bad-condition");
    expect(out.result.summary).toMatch(/invalid loop condition/);
  });
});

describe("executeWorkflow loop integration", () => {
  beforeEach(() => {
    installFakeFs();
    _deps.sleep = vi.fn(async () => {});
  });

  it("runs a loop node end-to-end and feeds its result downstream", async () => {
    let polls = 0;
    _deps.runTask = vi.fn(async ({ userMessage }) => {
      if (userMessage.startsWith("poll")) {
        polls++;
        return {
          taskId: "t",
          status: "completed",
          result: { summary: polls >= 3 ? "READY" : "waiting" },
        };
      }
      return { taskId: "t", status: "completed", result: { summary: "done" } };
    });
    const wf = {
      id: "loop-wf",
      name: "Loop",
      steps: [
        {
          id: "wait",
          message: "poll attempt ${iter}",
          loopUntil: "${self.summary} contains 'READY'",
          maxIterations: 10,
        },
        {
          id: "after",
          message: "Proceed because ${step.wait.summary}",
          dependsOn: ["wait"],
        },
      ],
    };
    const out = await executeWorkflow({ workflow: wf, cwd: "/project" });
    expect(out.status).toBe("completed");
    const wait = out.steps.find((s) => s.id === "wait");
    expect(wait.result.iterations).toBe(3);
    expect(wait.result.loopStop).toBe("condition");
    // downstream step saw the loop's final summary
    const afterCall = _deps.runTask.mock.calls.find((c) =>
      c[0].userMessage.startsWith("Proceed"),
    );
    expect(afterCall[0].userMessage).toBe("Proceed because READY");
  });
});

// ─── No-barrier pipeline scheduling ───────────────────────────────────────────

describe("pipeline mode (no-barrier scheduling)", () => {
  beforeEach(() => installFakeFs());

  it("starts a dependent before a slow independent sibling finishes", async () => {
    // Batch mode would block C (level 1) until BOTH A and slow B (level 0)
    // finish. Pipeline mode starts C as soon as its only dep A completes.
    let cRanWhileBPending = false;
    let bResolved = false;
    let releaseB;
    const bGate = new Promise((r) => {
      releaseB = r;
    });
    _deps.runTask = vi.fn(async ({ userMessage }) => {
      if (userMessage === "A") {
        return { taskId: "a", status: "completed", result: { summary: "a" } };
      }
      if (userMessage === "B") {
        await bGate;
        bResolved = true;
        return { taskId: "b", status: "completed", result: { summary: "b" } };
      }
      // C
      cRanWhileBPending = !bResolved;
      return { taskId: "c", status: "completed", result: { summary: "c" } };
    });
    const wf = {
      id: "pipe",
      name: "Pipe",
      pipeline: true,
      steps: [
        { id: "A", message: "A" },
        { id: "B", message: "B" },
        { id: "C", message: "C", dependsOn: ["A"] },
      ],
    };
    const run = executeWorkflow({ workflow: wf, cwd: "/project" });
    await new Promise((r) => setTimeout(r, 15)); // let A settle + C launch
    expect(cRanWhileBPending).toBe(true);
    releaseB();
    const out = await run;
    expect(out.status).toBe("completed");
    expect(out.steps.map((s) => s.id).sort()).toEqual(["A", "B", "C"]);
  });

  it("produces the same outcome set as batch mode for a DAG", async () => {
    const mkRun = () =>
      vi.fn(async ({ userMessage }) => ({
        taskId: "t",
        status: "completed",
        result: { summary: `out:${userMessage}` },
      }));
    const wf = {
      id: "dag",
      name: "DAG",
      steps: [
        { id: "a", message: "a" },
        { id: "b", message: "b" },
        { id: "c", message: "use ${step.a.summary}", dependsOn: ["a"] },
        { id: "d", message: "use ${step.b.summary}", dependsOn: ["b", "c"] },
      ],
    };
    _deps.runTask = mkRun();
    const batch = await executeWorkflow({ workflow: wf, cwd: "/project" });
    _deps.runTask = mkRun();
    const pipe = await executeWorkflow({
      workflow: wf,
      cwd: "/project",
      pipeline: true,
    });
    expect(pipe.status).toBe(batch.status);
    const norm = (rec) =>
      rec.steps
        .map((s) => `${s.id}:${s.status}`)
        .sort()
        .join(",");
    expect(norm(pipe)).toBe(norm(batch));
  });

  it("respects maxParallel as a concurrency cap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    _deps.runTask = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { taskId: "t", status: "completed", result: { summary: "ok" } };
    });
    const wf = {
      id: "p",
      name: "P",
      pipeline: true,
      steps: [
        { id: "a", message: "a" },
        { id: "b", message: "b" },
        { id: "c", message: "c" },
        { id: "d", message: "d" },
      ],
    };
    await executeWorkflow({ workflow: wf, cwd: "/project", maxParallel: 2 });
    expect(maxInFlight).toBe(2);
  });

  it("halts scheduling on failure and skips the rest (continueOnError off)", async () => {
    _deps.runTask = vi.fn(async ({ userMessage }) => {
      if (userMessage === "a") {
        return { taskId: "t", status: "failed", result: { summary: "boom" } };
      }
      return { taskId: "t", status: "completed", result: { summary: "ok" } };
    });
    const wf = {
      id: "chain",
      name: "Chain",
      pipeline: true,
      steps: [
        { id: "a", message: "a" },
        { id: "b", message: "b", dependsOn: ["a"] },
        { id: "c", message: "c", dependsOn: ["b"] },
      ],
    };
    const out = await executeWorkflow({ workflow: wf, cwd: "/project" });
    expect(out.status).toBe("failed");
    const byId = Object.fromEntries(out.steps.map((s) => [s.id, s.status]));
    expect(byId.a).toBe("failed");
    expect(byId.b).toBe("skipped");
    expect(byId.c).toBe("skipped");
    expect(_deps.runTask).toHaveBeenCalledTimes(1);
  });

  it("continues past failure when continueOnError is set", async () => {
    _deps.runTask = vi.fn(async ({ userMessage }) => {
      if (userMessage === "trigger") {
        return { taskId: "t", status: "failed", result: { summary: "boom" } };
      }
      return { taskId: "t", status: "completed", result: { summary: "ok" } };
    });
    const wf = {
      id: "coe",
      name: "COE",
      pipeline: true,
      steps: [
        { id: "a", message: "trigger" },
        { id: "b", message: "after a=${step.a.status}", dependsOn: ["a"] },
      ],
    };
    const out = await executeWorkflow({
      workflow: wf,
      cwd: "/project",
      continueOnError: true,
    });
    expect(out.status).toBe("partial");
    expect(_deps.runTask).toHaveBeenCalledTimes(2);
    // downstream ran even though its dep failed, and saw the failed status
    const after = _deps.runTask.mock.calls.find((c) =>
      c[0].userMessage.startsWith("after"),
    );
    expect(after[0].userMessage).toBe("after a=failed");
  });

  it("expands a forEach step and feeds its parent aggregate downstream", async () => {
    _deps.runTask = vi.fn(async ({ userMessage }) => ({
      taskId: "t",
      status: "completed",
      result: { summary: userMessage },
    }));
    const wf = {
      id: "fe",
      name: "FE",
      pipeline: true,
      steps: [
        { id: "src", message: "src" },
        { id: "fan", message: "do ${item}", forEach: ["x", "y"] },
        {
          id: "join",
          message: "joined: ${step.fan.summary}",
          dependsOn: ["fan"],
        },
      ],
    };
    const out = await executeWorkflow({ workflow: wf, cwd: "/project" });
    expect(out.status).toBe("completed");
    // forEach children appear in the step list (not the parent)
    const ids = out.steps.map((s) => s.id);
    expect(ids).toContain("fan[0]");
    expect(ids).toContain("fan[1]");
    expect(ids).not.toContain("fan");
    // downstream join saw the aggregated parent summary
    const joinCall = _deps.runTask.mock.calls.find((c) =>
      c[0].userMessage.startsWith("joined"),
    );
    expect(joinCall[0].userMessage).toBe("joined: do x\ndo y");
  });

  it("runPipeline runs an independent set with no deps", async () => {
    _deps.runTask = vi.fn(async () => ({
      taskId: "t",
      status: "completed",
      result: { summary: "ok" },
    }));
    const resultsById = new Map();
    const { stepOutcomes, anyFailure } = await runPipeline({
      steps: [
        { id: "a", message: "a" },
        { id: "b", message: "b" },
      ],
      resultsById,
      maxParallel: 4,
    });
    expect(anyFailure).toBe(false);
    expect(stepOutcomes.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });
});
