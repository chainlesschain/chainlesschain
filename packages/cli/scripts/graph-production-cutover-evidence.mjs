#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  createGraphProductionCutoverReceipt,
  normalizeGraphProductionCutoverEvidence,
} from "../src/lib/graph-kernel/production-cutover-evidence.js";
import {
  loadTrustedGraphRuntimeSurfaceManifest,
  loadTrustedJsonFile,
} from "./assemble-graph-production-cutover-evidence.mjs";
import { verifyGraphProductionAttestationCertificate } from "./verify-graph-production-attestation-certificate.mjs";

function usage() {
  return [
    "Usage:",
    "  node packages/cli/scripts/graph-production-cutover-evidence.mjs \\",
    "    --evidence <production-evidence.json> \\",
    "    --expected-commit <sha> [--expected-repository <owner/repo>] \\",
    "    [--expected-workflow <path>] [--expected-environment <name>] \\",
    "    [--expected-run-id <id>] \\",
    "    --expected-run-attempt <number> --expected-registry-digest <digest> \\",
    "    --jobs-inventory <paginated-file> [--output <path>]",
    "    [--attestation-verification <gh-json> --producer-run <run-json> \\",
    "     --selected-artifact <artifact-json> --server-url <url>]",
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
        "--expected-workflow",
        "--expected-environment",
        "--expected-run-id",
        "--expected-run-attempt",
        "--expected-registry-digest",
        "--jobs-inventory",
        "--attestation-verification",
        "--producer-run",
        "--selected-artifact",
        "--server-url",
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

function writeJson(value, output) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (!output) {
    process.stdout.write(serialized);
    return;
  }
  const resolved = path.resolve(output);
  if (!fs.existsSync(path.dirname(resolved)) || fs.existsSync(resolved)) {
    throw new Error(
      "receipt output must be a new file in an existing directory",
    );
  }
  fs.writeFileSync(resolved, serialized, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`${resolved}\n`);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (
    !options.evidence ||
    !options.expectedCommit ||
    !options.expectedRegistryDigest ||
    !options.jobsInventory
  ) {
    throw new Error(
      `--evidence and --expected-commit are required\n${usage()}`,
    );
  }
  const manifest = loadTrustedGraphRuntimeSurfaceManifest();
  const evidence = loadTrustedJsonFile(options.evidence, {
    field: "--evidence",
    maximumBytes: 64 * 1024 * 1024,
  });
  const jobsInventory = loadTrustedJsonFile(options.jobsInventory, {
    field: "--jobs-inventory",
  });
  const attestationFields = [
    "attestationVerification",
    "producerRun",
    "selectedArtifact",
    "serverUrl",
  ];
  const suppliedAttestationFields = attestationFields.filter(
    (field) => options[field],
  );
  let verificationClock = Date.now;
  if (suppliedAttestationFields.length > 0) {
    if (
      suppliedAttestationFields.length !== attestationFields.length ||
      !options.expectedRepository ||
      !options.expectedWorkflow ||
      !options.expectedRunId ||
      !options.expectedRunAttempt
    ) {
      throw new Error(
        "trusted close-time verification requires the complete attestation, run, artifact, server, and expected identity inputs",
      );
    }
    const producerRun = loadTrustedJsonFile(options.producerRun, {
      field: "--producer-run",
    });
    const selectedArtifact = loadTrustedJsonFile(options.selectedArtifact, {
      field: "--selected-artifact",
    });
    const verified = verifyGraphProductionAttestationCertificate(
      loadTrustedJsonFile(options.attestationVerification, {
        field: "--attestation-verification",
      }),
      {
        serverUrl: options.serverUrl.replace(/\/$/u, ""),
        repository: options.expectedRepository,
        workflow: options.expectedWorkflow,
        commitSha: options.expectedCommit,
        runId: options.expectedRunId,
        runAttempt: options.expectedRunAttempt,
        run: producerRun,
        artifact: selectedArtifact,
      },
    );
    verificationClock = () => verified.trustedTimestampMs;
  }
  const verificationOptions = {
    manifest,
    expectedCommitSha: options.expectedCommit,
    expectedRepository: options.expectedRepository,
    expectedWorkflow: options.expectedWorkflow,
    expectedEnvironment: options.expectedEnvironment,
    expectedWorkflowRunId: options.expectedRunId,
    expectedWorkflowRunAttempt: options.expectedRunAttempt,
    expectedRegistryDigest: options.expectedRegistryDigest,
    expectedChallenge: evidence?.provenance?.challenge,
    jobsInventory,
    clock: verificationClock,
  };
  normalizeGraphProductionCutoverEvidence(evidence, {
    ...verificationOptions,
  });
  writeJson(
    createGraphProductionCutoverReceipt(evidence, {
      ...verificationOptions,
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
