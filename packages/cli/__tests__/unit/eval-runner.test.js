import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runEvalSuite, formatEvalReport } from "../../src/lib/eval/runner.js";
import {
  BUILTIN_TASKS,
  getSuite,
  _deps as taskDeps,
} from "../../src/lib/eval/tasks.js";
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
  } else if (/build\.mjs/.test(prompt)) {
    // fix-build: reconcile the export name so app.mjs's import links.
    fs.writeFileSync(
      path.join(cwd, "config.mjs"),
      'export const VERSION = "1.0.0";\n',
      "utf8",
    );
  } else if (/stringutil/.test(prompt)) {
    // upgrade-dependency: bump the manifest + adapt the caller, leave the dep.
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify(
        { name: "app", type: "module", dependencies: { stringutil: "^2.0.0" } },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(cwd, "app.mjs"),
      'import { toTitle } from "./stringutil.mjs";\n' +
        "export function label(s) {\n  return toTitle(s);\n}\n",
      "utf8",
    );
  } else if (/readNote/.test(prompt)) {
    // secure-path: confine reads to BASE (reject ../ and absolute escapes).
    fs.writeFileSync(
      path.join(cwd, "notes.mjs"),
      "import fs from 'node:fs';\n" +
        "import path from 'node:path';\n" +
        "import { fileURLToPath } from 'node:url';\n" +
        "const BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'notes');\n" +
        "export function readNote(name) {\n" +
        "  const resolved = path.resolve(BASE, name);\n" +
        "  if (resolved !== BASE && !resolved.startsWith(BASE + path.sep)) {\n" +
        "    throw new Error('refusing to read outside notes/');\n" +
        "  }\n" +
        "  return fs.readFileSync(resolved, 'utf8');\n" +
        "}\n",
      "utf8",
    );
  }
  return { ok: true, output: "done" };
}

// An agent that does nothing — every check should fail.
async function noopAgent() {
  return { ok: true, output: "" };
}

describe("eval task process checks", () => {
  it("routes task scripts through the Broker with literal argv", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-eval-broker-"));
    const original = taskDeps.execFileSync;
    const calls = [];
    try {
      const task = BUILTIN_TASKS.find(
        (entry) => entry.id === "fix-syntax-error",
      );
      task.setup(dir);
      taskDeps.execFileSync = (...args) => {
        calls.push(args);
        return "OK\n";
      };

      expect(task.check(dir)).toEqual({
        pass: true,
        detail: "node bug.js prints OK",
      });
      expect(calls).toEqual([
        [
          process.execPath,
          ["bug.js"],
          expect.objectContaining({
            cwd: dir,
            origin: "eval:task-check",
            policy: "allow",
            scope: "eval",
            shell: false,
          }),
        ],
      ]);
    } finally {
      taskDeps.execFileSync = original;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

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

describe("secure-path task rigor", () => {
  it("rejects an insufficient fix that resolves paths but omits the containment check", async () => {
    const task = BUILTIN_TASKS.find((t) => t.id === "secure-path");
    expect(task).toBeTruthy();
    // A realistic insufficient fix: switches to path.resolve (which fully
    // honors `../`) but forgets to verify the result stays inside BASE — so the
    // relative-traversal probe still leaks the secret.
    const naiveAgent = async ({ cwd }) => {
      fs.writeFileSync(
        path.join(cwd, "notes.mjs"),
        "import fs from 'node:fs';\n" +
          "import path from 'node:path';\n" +
          "import { fileURLToPath } from 'node:url';\n" +
          "const BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'notes');\n" +
          "export function readNote(name) {\n" +
          "  const resolved = path.resolve(BASE, name);\n" + // resolves .. but no guard
          "  return fs.readFileSync(resolved, 'utf8');\n" +
          "}\n",
        "utf8",
      );
      return { ok: true };
    };
    const summary = await runEvalSuite([task], { runAgent: naiveAgent });
    expect(summary.passed).toBe(0);
  });
});

describe("fix-build task rigor", () => {
  it("rejects neutering the build harness instead of fixing the modules", async () => {
    const task = BUILTIN_TASKS.find((t) => t.id === "fix-build");
    expect(task).toBeTruthy();
    // Bypass the real fix by making build.mjs succeed unconditionally.
    const cheatAgent = async ({ cwd }) => {
      fs.writeFileSync(
        path.join(cwd, "build.mjs"),
        'console.log("BUILD OK");\n',
        "utf8",
      );
      return { ok: true };
    };
    const summary = await runEvalSuite([task], { runAgent: cheatAgent });
    expect(summary.passed).toBe(0);
    expect(summary.results[0].detail).toMatch(/edited/);
  });

  it("rejects a rewritten build.mjs that keeps the assertion TEXT present", async () => {
    // The presence-regex bypass: define a local banner() so the assertion
    // string still appears but app.mjs/config.mjs are never linked. Only a
    // byte-compare of the harness catches this.
    const task = BUILTIN_TASKS.find((t) => t.id === "fix-build");
    const cheatAgent = async ({ cwd }) => {
      fs.writeFileSync(
        path.join(cwd, "build.mjs"),
        'const banner = () => "v1.0.0";\n' +
          'if (banner() !== "v1.0.0") process.exit(1);\n' +
          'console.log("BUILD OK");\n',
        "utf8",
      );
      return { ok: true };
    };
    const summary = await runEvalSuite([task], { runAgent: cheatAgent });
    expect(summary.passed).toBe(0);
    expect(summary.results[0].detail).toMatch(/edited/);
  });
});

describe("fix-failing-test task rigor", () => {
  it("rejects prepending an early exit that keeps the assertions present", async () => {
    // The presence-regex bypass: `ALL OK` + exit(0) BEFORE the loop — the
    // assertion text survives a regex check but never executes, and calc.js
    // stays broken. Only a byte-compare of the harness catches this.
    const task = BUILTIN_TASKS.find((t) => t.id === "fix-failing-test");
    expect(task).toBeTruthy();
    const cheatAgent = async ({ cwd }) => {
      const harness = path.join(cwd, "run-checks.mjs");
      fs.writeFileSync(
        harness,
        "console.log('ALL OK');\nprocess.exit(0);\n" +
          fs.readFileSync(harness, "utf8"),
        "utf8",
      );
      return { ok: true };
    };
    const summary = await runEvalSuite([task], { runAgent: cheatAgent });
    expect(summary.passed).toBe(0);
    expect(summary.results[0].detail).toMatch(/edited/);
  });
});

describe("upgrade-dependency task rigor", () => {
  it("rejects editing the vendored dependency to dodge the upgrade", async () => {
    const task = BUILTIN_TASKS.find((t) => t.id === "upgrade-dependency");
    expect(task).toBeTruthy();
    // Instead of adapting the caller, re-add the old export to the dependency.
    const cheatAgent = async ({ cwd }) => {
      fs.appendFileSync(
        path.join(cwd, "stringutil.mjs"),
        "export const capitalize = toTitle;\n",
        "utf8",
      );
      return { ok: true };
    };
    const summary = await runEvalSuite([task], { runAgent: cheatAgent });
    expect(summary.passed).toBe(0);
    expect(summary.results[0].detail).toMatch(/dependency was edited/);
  });

  it("rejects overwriting the run.mjs harness so app.mjs is never executed", async () => {
    // run.mjs had NO guard at all: overwrite it with a bare OK, bump the
    // manifest, and drop `toTitle` as text into a BROKEN app.mjs — every
    // textual sub-check passes while the caller was never adapted.
    const task = BUILTIN_TASKS.find((t) => t.id === "upgrade-dependency");
    const cheatAgent = async ({ cwd }) => {
      fs.writeFileSync(path.join(cwd, "run.mjs"), 'console.log("OK");\n');
      const pkgFile = path.join(cwd, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
      pkg.dependencies.stringutil = "^2.0.0";
      fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
      fs.writeFileSync(
        path.join(cwd, "app.mjs"),
        "// toTitle mentioned, nothing works\nthrow new Error('broken');\n",
      );
      return { ok: true };
    };
    const summary = await runEvalSuite([task], { runAgent: cheatAgent });
    expect(summary.passed).toBe(0);
    expect(summary.results[0].detail).toMatch(/run\.mjs was edited/);
  });
});

describe("edit locality (无关改动率)", () => {
  const localityTask = {
    id: "locality",
    prompt: "edit a.txt",
    expectedFiles: ["a.txt"],
    setup: (dir) => fs.writeFileSync(path.join(dir, "a.txt"), "1", "utf8"),
    check: () => ({ pass: true }),
  };

  it("reports zero unrelated changes when only expected files are touched", async () => {
    const agent = async ({ cwd }) => {
      fs.writeFileSync(path.join(cwd, "a.txt"), "2", "utf8");
      return { ok: true };
    };
    const s = await runEvalSuite([localityTask], { runAgent: agent });
    expect(s.results[0].changedFiles).toContain("a.txt");
    expect(s.results[0].unrelatedChanges).toEqual([]);
    expect(s.unrelatedChangeRate).toBe(0);
  });

  it("flags a file changed OUTSIDE the expected surface", async () => {
    const agent = async ({ cwd }) => {
      fs.writeFileSync(path.join(cwd, "a.txt"), "2", "utf8");
      fs.mkdirSync(path.join(cwd, "sub"));
      fs.writeFileSync(path.join(cwd, "sub", "stray.txt"), "x", "utf8");
      return { ok: true };
    };
    const s = await runEvalSuite([localityTask], { runAgent: agent });
    expect(s.results[0].unrelatedChanges).toEqual(["sub/stray.txt"]);
    expect(s.tasksWithUnrelatedChanges).toBe(1);
    expect(s.unrelatedChangeRate).toBe(1);
  });

  it("counts a deleted expected file as changed but not unrelated", async () => {
    const agent = async ({ cwd }) => {
      fs.rmSync(path.join(cwd, "a.txt"));
      return { ok: true };
    };
    const s = await runEvalSuite([localityTask], { runAgent: agent });
    expect(s.results[0].changedFiles).toContain("a.txt");
    expect(s.results[0].unrelatedChanges).toEqual([]);
  });

  it("does not measure a task that declares no expectedFiles", async () => {
    const task = { ...localityTask, expectedFiles: undefined };
    const agent = async ({ cwd }) => {
      fs.writeFileSync(path.join(cwd, "whatever.txt"), "x", "utf8");
      return { ok: true };
    };
    const s = await runEvalSuite([task], { runAgent: agent });
    expect(s.results[0].unrelatedChanges).toBeNull();
    expect(s.unrelatedChangeRate).toBe(0); // no measured tasks
  });

  it("the perfect solver makes NO unrelated changes across the builtin suite", async () => {
    // Validates that every builtin task's declared expectedFiles matches what a
    // correct solution actually touches — a drift guard on the declarations.
    const s = await runEvalSuite(BUILTIN_TASKS, { runAgent: perfectAgent });
    expect(s.unrelatedChangeRate).toBe(0);
    expect(
      s.results.every((r) => (r.unrelatedChanges || []).length === 0),
    ).toBe(true);
  });

  it("surfaces the unrelated-change rate in the formatted report", async () => {
    const agent = async ({ cwd }) => {
      fs.writeFileSync(path.join(cwd, "a.txt"), "2", "utf8");
      fs.writeFileSync(path.join(cwd, "stray.txt"), "x", "utf8");
      return { ok: true };
    };
    const s = await runEvalSuite([localityTask], { runAgent: agent });
    const report = formatEvalReport(s);
    expect(report).toMatch(/Unrelated-change rate: 100\.0%/);
    expect(report).toMatch(/\[\+1 unrelated: stray\.txt\]/);
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
