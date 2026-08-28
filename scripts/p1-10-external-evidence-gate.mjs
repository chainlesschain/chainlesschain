#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const matrixPath = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "p1-10-conformance-matrix.json",
);

export function validateExternalEvidence(matrix, evidence) {
  if (evidence?.schema !== "chainlesschain.p1-10-external-evidence/v1") {
    throw new Error("invalid P1-10 external evidence schema");
  }
  if (evidence.status !== "passed") {
    throw new Error("external evidence must explicitly report passed");
  }
  if (!evidence.commit || !/^[0-9a-f]{40}$/.test(evidence.commit)) {
    throw new Error("external evidence requires an exact 40-character commit");
  }

  const required = matrix.scenarios.flatMap((scenario) =>
    scenario.cells
      .filter((cell) => cell.status === "external-required")
      .map((cell) => cell.evidenceScenario),
  );
  const results = new Map(
    (Array.isArray(evidence.results) ? evidence.results : []).map((result) => [
      result.scenario,
      result,
    ]),
  );
  for (const scenario of required) {
    const result = results.get(scenario);
    if (!result || result.status !== "passed") {
      throw new Error(`missing passing external scenario: ${scenario}`);
    }
    if (!Number.isFinite(result.durationMs) || result.durationMs <= 0) {
      throw new Error(`invalid duration for external scenario: ${scenario}`);
    }
    if (!Array.isArray(result.artifacts) || result.artifacts.length === 0) {
      throw new Error(`missing artifacts for external scenario: ${scenario}`);
    }
    if (
      scenario.includes("physical-host") &&
      (!Array.isArray(result.hosts) || new Set(result.hosts).size < 2)
    ) {
      throw new Error(`${scenario} requires at least two distinct hosts`);
    }
  }
  return { commit: evidence.commit, scenarios: required.length };
}

function parseEvidenceArgument(argv) {
  const index = argv.indexOf("--evidence");
  if (index < 0 || !argv[index + 1]) {
    throw new Error(
      "usage: node scripts/p1-10-external-evidence-gate.mjs --evidence <file.json>",
    );
  }
  return path.resolve(process.cwd(), argv[index + 1]);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    const evidencePath = parseEvidenceArgument(process.argv.slice(2));
    const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
    const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    const result = validateExternalEvidence(matrix, evidence);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
