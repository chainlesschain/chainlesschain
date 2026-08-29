#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  createGraphProductionCutoverReceipt,
  normalizeGraphProductionCutoverEvidence,
} from "../src/lib/graph-kernel/production-cutover-evidence.js";
import { loadGraphRuntimeSurfaceManifest } from "../src/lib/graph-kernel/runtime-surface-manifest.js";

function usage() {
  return [
    "Usage:",
    "  node packages/cli/scripts/graph-production-cutover-evidence.mjs \\",
    "    --evidence <production-evidence.json> \\",
    "    --expected-commit <sha> [--expected-repository <owner/repo>] \\",
    "    [--expected-environment <name>] [--expected-run-id <id>] \\",
    "    [--expected-run-attempt <number>] \\",
    "    [--manifest <path>] [--output <path>]",
    "",
    "The command only verifies a complete, externally produced rollout bundle.",
    "It never fabricates shadow traffic, canary results, rollback drills, or",
    "legacy-writer observations.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (
      [
        "--evidence",
        "--expected-commit",
        "--expected-repository",
        "--expected-environment",
        "--expected-run-id",
        "--expected-run-attempt",
        "--manifest",
        "--output",
      ].includes(argument)
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      options[
        argument
          .slice(2)
          .replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())
      ] = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function readJson(file, field) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${field} is not a file: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function writeJson(value, output) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (!output) {
    process.stdout.write(serialized);
    return;
  }
  const resolved = path.resolve(output);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, serialized, "utf8");
  process.stdout.write(`${resolved}\n`);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.evidence || !options.expectedCommit) {
    throw new Error(
      `--evidence and --expected-commit are required\n${usage()}`,
    );
  }
  const manifest = options.manifest
    ? loadGraphRuntimeSurfaceManifest(path.resolve(options.manifest))
    : loadGraphRuntimeSurfaceManifest();
  const evidence = readJson(options.evidence, "--evidence");
  normalizeGraphProductionCutoverEvidence(evidence, {
    manifest,
    expectedCommitSha: options.expectedCommit,
    expectedRepository: options.expectedRepository,
    expectedEnvironment: options.expectedEnvironment,
    expectedWorkflowRunId: options.expectedRunId,
    expectedWorkflowRunAttempt: options.expectedRunAttempt,
  });
  writeJson(
    createGraphProductionCutoverReceipt(evidence, {
      manifest,
      expectedCommitSha: options.expectedCommit,
      expectedRepository: options.expectedRepository,
      expectedEnvironment: options.expectedEnvironment,
      expectedWorkflowRunId: options.expectedRunId,
      expectedWorkflowRunAttempt: options.expectedRunAttempt,
    }),
    options.output,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error?.code ? `${error.code}: ` : ""}${error?.message || error}\n`,
  );
  process.exitCode = 1;
}
