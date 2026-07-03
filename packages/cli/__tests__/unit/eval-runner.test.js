import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runEvalSuite, formatEvalReport } from "../../src/lib/eval/runner.js";
import { BUILTIN_TASKS, getSuite } from "../../src/lib/eval/tasks.js";
import { TelemetryRecorder } from "../../src/lib/telemetry/span-recorder.js";

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
  } else if (/calc\.js/.test(prompt)) {
    // fix-failing-test: repair the module so the test harness passes.
    fs.writeFileSync(
      path.join(cwd, "calc.js"),
      "export function sum(a, b) {\n  return a + b;\n}\n",
      "utf8",
    );
  } else if (/oldTotal/.test(prompt)) {
    // refactor-rename: rename across BOTH files, preserve behavior.
    fs.writeFileSync(
      path.join(cwd, "util.js"),
      "export function computeTotal(nums) {\n  return nums.reduce((a, b) => a + b, 0);\n}\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(cwd, "main.js"),
      "import { computeTotal } from './util.js';\nconsole.log(computeTotal([1, 2, 3]));\n",
      "utf8",
    );
  } else if (/verify\.mjs/.test(prompt)) {
    // write-test: a genuine verifier that exercises slugify's behavior.
    fs.writeFileSync(
      path.join(cwd, "verify.mjs"),
      "import { slugify } from './slug.mjs';\n" +
        "const cases = [['Hello World', 'hello-world'], ['  A_B ', 'a-b']];\n" +
        "for (const [inp, want] of cases) {\n" +
        "  const got = slugify(inp);\n" +
        "  if (got !== want) {\n" +
        "    console.error(`slugify(${JSON.stringify(inp)}) = ${JSON.stringify(got)}, want ${want}`);\n" +
        "    process.exit(1);\n" +
        "  }\n" +
        "}\n" +
        "process.exit(0);\n",
      "utf8",
    );
  } else if (/greet\.mjs/.test(prompt)) {
    // migrate-signature: options-object API + updated callers.
    fs.writeFileSync(
      path.join(cwd, "greet.mjs"),
      "export function greet({ name, excited }) {\n" +
        "  return `Hello, ${name}!` + (excited ? '!!' : '');\n" +
        "}\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(cwd, "app.mjs"),
      "import { greet } from './greet.mjs';\n" +
        "console.log(greet({ name: 'Ada', excited: false }));\n" +
        "console.log(greet({ name: 'Bob', excited: true }));\n",
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
    expect(summary.total).toBe(BUILTIN_TASKS.length);
    expect(summary.passRate).toBeCloseTo(1 / BUILTIN_TASKS.length, 5);
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
    expect(summary.total).toBe(BUILTIN_TASKS.length);
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
    const n = BUILTIN_TASKS.length;
    expect(report).toMatch(new RegExp(`Eval: ${n}/${n} passed \\(100\\.0%\\)`));
    expect(report).toMatch(/✔ create-file/);
  });
});

describe("runEvalSuite telemetry", () => {
  it("records a span per task and classifies failures when a recorder is passed", async () => {
    const recorder = new TelemetryRecorder();
    // Solve none → every task is a check_failed span.
    const summary = await runEvalSuite(BUILTIN_TASKS, {
      runAgent: noopAgent,
      recorder,
    });
    expect(summary.telemetry).toBeTruthy();
    expect(summary.telemetry.durations["eval.task"].count).toBe(
      BUILTIN_TASKS.length,
    );
    expect(summary.telemetry.durations["eval.task"].errors).toBe(
      BUILTIN_TASKS.length,
    );
    expect(summary.telemetry.failures.check_failed).toBe(BUILTIN_TASKS.length);
    // OTLP export carries one span per task.
    expect(recorder.toOtlp().resourceSpans[0].scopeSpans[0].spans).toHaveLength(
      BUILTIN_TASKS.length,
    );
  });

  it("omits telemetry when no recorder is passed (back-compat)", async () => {
    const summary = await runEvalSuite(BUILTIN_TASKS, { runAgent: noopAgent });
    expect(summary.telemetry).toBeUndefined();
  });
});

describe("write-test task rigor", () => {
  it("rejects a rubber-stamp verifier that ignores the implementation", async () => {
    const task = BUILTIN_TASKS.find((t) => t.id === "write-test");
    expect(task).toBeTruthy();
    // A verifier that always exits 0 — passes the correct impl but does not
    // actually test anything, so the check's mutation step must catch it.
    const weakAgent = async ({ cwd }) => {
      fs.writeFileSync(
        path.join(cwd, "verify.mjs"),
        "process.exit(0);\n",
        "utf8",
      );
      return { ok: true };
    };
    const summary = await runEvalSuite([task], { runAgent: weakAgent });
    expect(summary.passed).toBe(0);
    expect(summary.results[0].detail).toMatch(/not meaningful/);
  });
});

describe("migrate-signature task rigor", () => {
  it("rejects leaving a caller on the old positional signature", async () => {
    const task = BUILTIN_TASKS.find((t) => t.id === "migrate-signature");
    // Migrates greet.mjs but forgets to update app.mjs → old positional call
    // remains, so the check must fail it.
    const halfAgent = async ({ cwd }) => {
      fs.writeFileSync(
        path.join(cwd, "greet.mjs"),
        "export function greet({ name, excited }) {\n  return `Hello, ${name}!` + (excited ? '!!' : '');\n}\n",
        "utf8",
      );
      // app.mjs left untouched (still positional).
      return { ok: true };
    };
    const summary = await runEvalSuite([task], { runAgent: halfAgent });
    expect(summary.passed).toBe(0);
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
