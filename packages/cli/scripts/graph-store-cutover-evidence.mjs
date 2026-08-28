#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  GRAPH_STORE_CUTOVER_EVIDENCE_SCHEMA,
  graphStoreCutoverCoverage,
  graphStoreEvidenceDigest,
  normalizeGraphStoreCutoverEvidence,
} from "../src/lib/graph-kernel/store-cutover-evidence.js";
import { loadGraphRuntimeSurfaceManifest } from "../src/lib/graph-kernel/runtime-surface-manifest.js";

function values(name) {
  const output = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      output.push(process.argv[index + 1]);
    }
  }
  return output;
}

function value(name) {
  return values(name).at(-1) || null;
}

function fail(message) {
  const error = new Error(message);
  error.name = "GraphStoreCutoverEvidenceCliError";
  return error;
}

function readEvidence(target) {
  const file = path.resolve(target);
  const stats = fs.statSync(file);
  if (!stats.isFile() || stats.size > 4 * 1024 * 1024) {
    throw fail(`evidence must be a JSON file no larger than 4 MiB: ${file}`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const record = parsed.storeEvidence || parsed;
  return {
    file,
    sourceArtifactDigest:
      typeof parsed.evidenceDigest === "string" ? parsed.evidenceDigest : null,
    record: normalizeGraphStoreCutoverEvidence(record),
  };
}

function evidenceFilesInDirectory(target) {
  const directory = path.resolve(target);
  if (!fs.statSync(directory).isDirectory()) {
    throw fail(`evidence directory is not a directory: ${directory}`);
  }
  const pending = [directory];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
        if (
          parsed?.storeEvidence ||
          parsed?.schema === GRAPH_STORE_CUTOVER_EVIDENCE_SCHEMA
        ) {
          files.push(candidate);
        }
      }
    }
  }
  return files.sort();
}

function main() {
  const evidenceFiles = [
    ...values("--evidence"),
    ...values("--evidence-dir").flatMap(evidenceFilesInDirectory),
  ];
  if (evidenceFiles.length === 0) {
    throw fail("at least one --evidence file is required");
  }
  const expectedCommit = String(value("--expected-commit") || "")
    .trim()
    .toLowerCase();
  const records = evidenceFiles.map(readEvidence);
  const coverage = graphStoreCutoverCoverage(
    loadGraphRuntimeSurfaceManifest(),
    records.map((entry) => entry.record),
  );
  if (expectedCommit && coverage.commitSha !== expectedCommit) {
    throw fail(
      `store evidence commit ${coverage.commitSha} does not match ${expectedCommit}`,
    );
  }
  if (
    process.argv.includes("--require-complete") &&
    coverage.completeEntryCount !== coverage.migratableEntryCount
  ) {
    throw fail(
      `store evidence is incomplete: ${coverage.completeEntryCount}/${coverage.migratableEntryCount} entries`,
    );
  }
  const report = {
    ...coverage,
    sources: records.map((entry) => ({
      file: entry.file,
      platform: entry.record.platform,
      evidenceDigest: entry.record.evidenceDigest,
      sourceArtifactDigest: entry.sourceArtifactDigest,
    })),
  };
  report.evidenceDigest = graphStoreEvidenceDigest(report);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const output = value("--output");
  if (output) {
    const target = path.resolve(output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, serialized, "utf8");
  } else {
    process.stdout.write(serialized);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
