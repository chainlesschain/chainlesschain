import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileFunction, constants as vmConstants } from "node:vm";
import {
  selectDiagnosticTasks,
  diagnosticCandidate,
  readDiagnosticReceipt,
} from "../../scripts/verify01-review-pack-diagnostic.mjs";
import { VERIFY01_REVIEW_SPECS } from "../../scripts/verify01-review-specs.mjs";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const catalog = JSON.parse(
  fs.readFileSync(
    path.join(
      repository,
      "docs/research/cli/verify01-plan-2026-10-04/tasks.json",
    ),
    "utf8",
  ),
);
const nativeImport = compileFunction("return import(url)", ["url"], {
  importModuleDynamically: vmConstants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
});

// Execute only the additional generated controls here, with real Vitest
// assertions and real subject bytes. An explicit commit enables the same
// checks against the frozen source without requiring history in shallow CI.
// Baseline module imports run
// in the isolated Docker diagnostic; importing them here would register their
// whole suites recursively. Dependencies keep their real module identities.
async function controlFailures(task, spec, source) {
  const subjectPath = path.resolve(repository, spec.sourcePath);
  let subject = source.replace(
    /\bfrom\s+(["'])([^"']+)\1/gu,
    (match, quote, name) => {
      if (name.startsWith("node:")) return match;
      const url = name.startsWith(".")
        ? pathToFileURL(path.resolve(path.dirname(subjectPath), name)).href
        : import.meta.resolve(name);
      return "from " + JSON.stringify(url);
    },
  );
  if (spec.taskId === "verify-30") {
    subject =
      "const module = { exports: {} };\n" +
      subject +
      "\nexport { inspectImageBudget };";
  }
  const subjectModule = await nativeImport(
    "data:text/javascript;base64," + Buffer.from(subject).toString("base64"),
  );
  const cases = [];
  const load = async (name) => {
    if (name === "vitest")
      return { it: (_title, run) => cases.push(run), expect };
    if (name.startsWith("node:")) return nativeImport(name);
    if (!name.startsWith(".")) return nativeImport(import.meta.resolve(name));
    const filename = path.resolve(
      repository,
      path.dirname(task.expectedFiles[0]),
      name,
    );
    return filename === subjectPath
      ? subjectModule
      : nativeImport(pathToFileURL(filename).href);
  };
  const body = diagnosticCandidate(task, spec)
    .replace(/^import "[^"\n]+";\n/gmu, "")
    .replace(
      /^import\s+([^;]+?)\s+from\s+("[^"\n]+");/gmu,
      (_match, bindings, name) => {
        const declaration = bindings.trim().startsWith("{")
          ? bindings.replace(/\s+as\s+/gu, ": ")
          : "{ default: " + bindings.trim() + " }";
        return "const " + declaration + " = await load(" + name + ");";
      },
    );
  await new Function("load", "return (async () => {\n" + body + "\n})();")(
    load,
  );
  expect(cases.length).toBeGreaterThan(0);
  const errors = [];
  for (const run of cases) {
    try {
      await run();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

describe("real Docker review diagnostic admission", () => {
  it.each([
    "verify-07",
    "verify-08",
    "verify-09",
    "verify-12",
    "verify-20",
    "verify-21",
    "verify-30",
  ])(
    "%s controls accept real behavior and reject each frozen mutant with an assertion",
    async (taskId) => {
      const task = catalog.tasks.find((entry) => entry.id === taskId);
      const spec = VERIFY01_REVIEW_SPECS.find(
        (entry) => entry.taskId === taskId,
      );
      const commit = process.env.VERIFY01_CONTROL_SOURCE_COMMIT;
      if (commit) expect(commit).toMatch(/^[a-f0-9]{40}$/u);
      const source = commit
        ? execFileSync("git", ["show", commit + ":" + spec.sourcePath], {
            cwd: repository,
            encoding: "utf8",
            windowsHide: true,
          })
        : fs.readFileSync(path.join(repository, spec.sourcePath), "utf8");
      expect(await controlFailures(task, spec, source)).toEqual([]);
      for (const mutant of spec.mutants) {
        expect(source.split(mutant.find)).toHaveLength(2);
        const failures = await controlFailures(
          task,
          spec,
          source.replace(mutant.find, mutant.replace),
        );
        expect(failures.length, mutant.name).toBeGreaterThan(0);
        expect(
          failures.every((error) => error.name === "AssertionError"),
          mutant.name,
        ).toBe(true);
      }
    },
  );

  it("uses bounded cursor controls without repeating baseline pagination walks in the candidate", () => {
    const spec = VERIFY01_REVIEW_SPECS.find(
      (entry) => entry.taskId === "verify-07",
    );
    const task = catalog.tasks.find((entry) => entry.id === "verify-07");
    const candidate = diagnosticCandidate(task, spec);
    expect(spec.baselineTests).toEqual([
      "packages/cli/__tests__/unit/session-transcript-history.test.js",
    ]);
    expect(candidate).not.toContain("unit/session-transcript-history.test.js");
    expect(candidate).toContain("createSessionTranscriptHistoryProjection");
    expect(candidate).not.toMatch(/\bwhile\s*\(/u);
  });

  it("keeps the document control explicit about missing-sample PASS claims", () => {
    const spec = VERIFY01_REVIEW_SPECS.find(
      (entry) => entry.taskId === "verify-34",
    );
    const task = catalog.tasks.find((entry) => entry.id === "verify-34");
    expect(diagnosticCandidate(task, spec)).toMatch(
      /(?:not|never)[^\n]{0,60}(?:PASS|改善)/iu,
    );
  });
  it("partitions all 36 tasks exactly once and rejects invalid shards", () => {
    const tasks = VERIFY01_REVIEW_SPECS.map(({ taskId }) => ({ id: taskId }));
    const shards = Array.from({ length: 6 }, (_, i) =>
      selectDiagnosticTasks(tasks, `${i + 1}/6`),
    );
    expect(shards.every((shard) => shard.length === 6)).toBe(true);
    expect(new Set(shards.flat().map(({ id }) => id)).size).toBe(36);
    for (const shard of ["0/6", "7/6", "1/37", "NaN/6", "1.5/6", "1", "1/0"])
      expect(() => selectDiagnosticTasks(tasks, shard)).toThrow();
  });

  it("imports frozen definitions with their original module identity across workspaces", () => {
    const task = {
      expectedFiles: ["packages/vscode-extension/__tests__/verify-25.test.js"],
    };
    const spec = VERIFY01_REVIEW_SPECS.find(
      ({ taskId }) => taskId === "verify-25",
    );
    const body = diagnosticCandidate(task, spec);
    expect(body).toContain(
      'import "../../cli/__tests__/unit/vscode-ext-draft-store.test.js";',
    );
    expect(body).toContain("not an agent task outcome");
    expect(body).not.toContain("it.skip");
    expect(() => diagnosticCandidate({ expectedFiles: [] }, spec)).toThrow();
  });

  it("binds the actual raw receipt bytes, task, stage and verdict", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "review-diagnostic-receipt-"),
    );
    fs.mkdirSync(path.join(root, "acceptance-evidence"));
    const name = "verify-01-check-abcd.json";
    const file = path.join(root, "acceptance-evidence", name);
    const receipt = {
      taskId: "verify-01",
      stage: "check",
      pass: false,
      providerAssessed: false,
      productionAttested: false,
    };
    const bytes = Buffer.from(JSON.stringify(receipt));
    const digest = "sha256:" + createHash("sha256").update(bytes).digest("hex");
    const verdict = { pass: false, receipt: name, receiptDigest: digest };
    fs.writeFileSync(file, bytes);
    try {
      expect(
        readDiagnosticReceipt(
          root,
          "verify-01",
          "check",
          JSON.stringify(verdict),
        ).receipt,
      ).toEqual(receipt);
      expect(() =>
        readDiagnosticReceipt(
          root,
          "verify-02",
          "check",
          JSON.stringify(verdict),
        ),
      ).toThrow();
      expect(() =>
        readDiagnosticReceipt(
          root,
          "verify-01",
          "setup",
          JSON.stringify(verdict),
        ),
      ).toThrow();
      expect(() =>
        readDiagnosticReceipt(
          root,
          "verify-01",
          "check",
          JSON.stringify({ ...verdict, pass: true }),
        ),
      ).toThrow();
      expect(() =>
        readDiagnosticReceipt(
          root,
          "verify-01",
          "check",
          JSON.stringify({ ...verdict, receipt: "../forged.json" }),
        ),
      ).toThrow();
      fs.appendFileSync(file, " ");
      expect(() =>
        readDiagnosticReceipt(
          root,
          "verify-01",
          "check",
          JSON.stringify(verdict),
        ),
      ).toThrow(/bytes changed/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
