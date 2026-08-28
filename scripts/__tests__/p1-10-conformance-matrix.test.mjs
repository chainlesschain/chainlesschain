import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateExternalEvidence } from "../p1-10-external-evidence-gate.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const matrix = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, "tests/fixtures/p1-10-conformance-matrix.json"),
    "utf8",
  ),
);

test("P1-10 conformance matrix covers every required local host and external cell", () => {
  assert.equal(matrix.schema, "chainlesschain.p1-10-conformance-matrix/v1");
  assert.ok(matrix.scenarios.length >= 5);
  const causal = matrix.scenarios.find(
    (scenario) => scenario.id === "causal-agent-stream",
  );
  assert.deepEqual(
    causal.cells
      .filter((cell) => cell.status === "repo-local")
      .map((cell) => cell.host)
      .sort(),
    ["cli", "desktop", "jetbrains", "python-sdk", "vscode"],
  );
  const migration = matrix.scenarios.find(
    (scenario) => scenario.id === "graph-definition-migration",
  );
  assert.ok(migration.cells.some((cell) => cell.host === "old-adapter-v0"));
  assert.ok(migration.cells.some((cell) => cell.host === "new-kernel-v1"));
  assert.ok(
    matrix.scenarios.some(
      (scenario) => scenario.id === "collaboration-crash-recovery",
    ),
  );
  assert.ok(
    matrix.scenarios.every((scenario) =>
      scenario.cells.every((cell) =>
        ["repo-local", "external-required"].includes(cell.status),
      ),
    ),
  );
});

test("every repo-local cell points to present fixture and consumer test", () => {
  for (const scenario of matrix.scenarios) {
    for (const fixture of scenario.fixtures) {
      assert.ok(fs.existsSync(path.join(repoRoot, fixture)), fixture);
    }
    for (const cell of scenario.cells.filter(
      (candidate) => candidate.status === "repo-local",
    )) {
      assert.ok(cell.consumerTest, `${scenario.id}/${cell.host}`);
      assert.ok(
        fs.existsSync(path.join(repoRoot, cell.consumerTest)),
        cell.consumerTest,
      );
    }
  }
  assert.ok(fs.existsSync(path.join(repoRoot, matrix.externalEvidenceGate)));
});

test("external evidence cannot be inferred from repository-local results", () => {
  assert.throws(
    () =>
      validateExternalEvidence(matrix, {
        schema: "chainlesschain.p1-10-external-evidence/v1",
        status: "not-run",
      }),
    /explicitly report passed/,
  );
  assert.throws(
    () =>
      validateExternalEvidence(matrix, {
        schema: "chainlesschain.p1-10-external-evidence/v1",
        status: "passed",
        commit: "a".repeat(40),
        results: [],
      }),
    /missing passing external scenario/,
  );
});
