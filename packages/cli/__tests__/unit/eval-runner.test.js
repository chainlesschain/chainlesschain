import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runEvalSuite, formatEvalReport } from "../../src/lib/eval/runner.js";
import { BUILTIN_TASKS, getSuite } from "../../src/lib/eval/tasks.js";

// A "perfect agent" that actually performs each built-in task in its workspace,
// so the objective checks pass — this validates BOTH the harness scoring AND
// that the task checks accept a correct solution.
async function perfectAgent({ prompt, cwd }) {
  if (/greeting\.txt/.test(prompt)) {
    fs.writeFileSync(
      path.join(cwd, "greeting.txt"),
      "Hello, ChainlessChain!",
      "utf8",
    );
  } else if (/bug\.js/.test(prompt)) {
    fs.writeFileSync(path.join(cwd, "bug.js"), 'console.log("OK");\n', "utf8");
  } else if (/math\.js/.test(prompt)) {
    fs.writeFileSync(
      path.join(cwd, "math.js"),
      "export function mul(a, b) {\n  return a * b;\n}\nexport function add(a, b) {\n  return a + b;\n}\n",
      "utf8",
    );
  }
  return { ok: true, output: "done" };
}

// An agent that does nothing — every check should fail.
async function noopAgent() {
  return { ok: true, output: "" };
}

describe("runEvalSuite", () => {
  it("scores 100% when a perfect agent solves every built-in task", async () => {
    const summary = await runEvalSuite(BUILTIN_TASKS, {
      runAgent: perfectAgent,
    });
    expect(summary.total).toBe(BUILTIN_TASKS.length);
    expect(summary.passed).toBe(BUILTIN_TASKS.length);
    expect(summary.passRate).toBe(1);
    expect(summary.results.every((r) => r.pass)).toBe(true);
  });

  it("scores 0% when the agent does nothing", async () => {
    const summary = await runEvalSuite(BUILTIN_TASKS, { runAgent: noopAgent });
    expect(summary.passed).toBe(0);
    expect(summary.passRate).toBe(0);
    expect(summary.results.every((r) => !r.pass)).toBe(true);
  });

  it("computes a partial pass rate", async () => {
    // Solve only the greeting task.
    const partial = async ({ prompt, cwd }) => {
      if (/greeting\.txt/.test(prompt)) {
        fs.writeFileSync(
          path.join(cwd, "greeting.txt"),
          "Hello, ChainlessChain!",
          "utf8",
        );
      }
      return { ok: true };
    };
    const summary = await runEvalSuite(BUILTIN_TASKS, { runAgent: partial });
    expect(summary.passed).toBe(1);
    expect(summary.total).toBe(3);
    expect(summary.passRate).toBeCloseTo(1 / 3, 5);
  });

  it("records an agent crash as a task failure without aborting the suite", async () => {
    const crashOnce = (() => {
      let n = 0;
      return async ({ prompt, cwd }) => {
        n++;
        if (n === 1) throw new Error("boom");
        // solve the rest
        return perfectAgent({ prompt, cwd });
      };
    })();
    const summary = await runEvalSuite(BUILTIN_TASKS, { runAgent: crashOnce });
    // First task failed (agent threw); the suite kept going.
    expect(summary.results[0].pass).toBe(false);
    expect(summary.results[0].error).toMatch(/agent error: boom/);
    expect(summary.total).toBe(3);
  });

  it("throws when runAgent is missing", async () => {
    await expect(runEvalSuite(BUILTIN_TASKS, {})).rejects.toThrow(
      /runAgent is required/,
    );
  });

  it("marks a malformed task (no check) as failed, not a crash", async () => {
    const summary = await runEvalSuite([{ id: "bad", prompt: "do a thing" }], {
      runAgent: perfectAgent,
    });
    expect(summary.results[0].pass).toBe(false);
    expect(summary.results[0].error).toMatch(/check\(\) is required/);
  });
});

describe("formatEvalReport", () => {
  it("renders a pass-rate header and per-task lines", async () => {
    const summary = await runEvalSuite(BUILTIN_TASKS, {
      runAgent: perfectAgent,
    });
    const report = formatEvalReport(summary);
    expect(report).toMatch(/Eval: 3\/3 passed \(100\.0%\)/);
    expect(report).toMatch(/✔ create-file/);
  });
});

describe("getSuite", () => {
  it("returns the builtin suite by default", () => {
    expect(getSuite()).toBe(BUILTIN_TASKS);
    expect(getSuite("builtin")).toBe(BUILTIN_TASKS);
  });
  it("throws on an unknown suite", () => {
    expect(() => getSuite("nope")).toThrow(/unknown eval suite/);
  });
});
