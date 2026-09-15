#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "..");
export const MAP_PATH = "tests/fixtures/claude-2.1.221-238-security-map.json";

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function parseMap(bytes) {
  const map = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!Array.isArray(map.rows)) {
    throw new Error(`${MAP_PATH} must contain a rows array`);
  }
  return map;
}

export function checkStagedSecurityMap({ mapBytes, readBlob, stagedPaths }) {
  const map = parseMap(mapBytes);
  const changed = new Set(stagedPaths);
  const producerPaths = new Set(
    map.rows.map((row) => String(row?.producer?.path || "")),
  );
  const relevant =
    changed.has(MAP_PATH) ||
    [...changed].some((filePath) => producerPaths.has(filePath));
  if (!relevant) return { checked: false, issues: [] };

  const issues = [];
  for (const row of map.rows) {
    const producerPath = String(row?.producer?.path || "");
    const testId = String(row?.testId || "");
    if (!producerPath || !testId) {
      issues.push({ id: String(row?.id || "unknown"), kind: "shape" });
      continue;
    }
    let source;
    try {
      source = readBlob(producerPath);
    } catch {
      issues.push({ id: row.id, kind: "missing-producer", producerPath });
      continue;
    }
    const actual = sha256(source);
    const expected = row.producer.sha256;
    if (actual !== expected) {
      issues.push({
        id: row.id,
        kind: "digest",
        producerPath,
        expected,
        actual,
      });
    }
    if (!source.toString("utf8").includes(testId)) {
      issues.push({
        id: row.id,
        kind: "missing-test-id",
        producerPath,
        testId,
      });
    }
  }
  return { checked: true, issues };
}

function stagedPaths() {
  return execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    },
  )
    .split(/\r?\n/u)
    .filter(Boolean);
}

function readIndexBlob(relativePath) {
  return execFileSync("git", ["show", `:${relativePath}`], {
    cwd: REPOSITORY_ROOT,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function runStagedSecurityMapCheck() {
  const result = checkStagedSecurityMap({
    mapBytes: readIndexBlob(MAP_PATH),
    readBlob: readIndexBlob,
    stagedPaths: stagedPaths(),
  });
  if (!result.checked) return result;
  if (result.issues.length === 0) return result;

  console.error("Claude security map does not match the staged commit:");
  for (const issue of result.issues) {
    if (issue.kind === "digest") {
      console.error(`- ${issue.id}: ${issue.producerPath}`);
      console.error(`  expected ${issue.expected}`);
      console.error(`  actual   ${issue.actual}`);
    } else if (issue.kind === "missing-test-id") {
      console.error(
        `- ${issue.id}: mapped test id is absent from ${issue.producerPath}`,
      );
    } else if (issue.kind === "missing-producer") {
      console.error(
        `- ${issue.id}: staged producer is missing: ${issue.producerPath}`,
      );
    } else {
      console.error(`- ${issue.id}: mapping row is incomplete`);
    }
  }
  throw new Error(
    `Update ${MAP_PATH} with the reviewed producer digest before committing.`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runStagedSecurityMapCheck();
}
