#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MAP_PATH,
  validateSecurityMap,
} from "./verify-claude-security-map.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const require = createRequire(import.meta.url);
const VITEST_ENTRY = path.join(
  path.dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    assert.ok(argv[index]?.startsWith("--") && argv[index + 1]);
    options[
      argv[index]
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = argv[index + 1];
  }
  return options;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function mappedVitestInvocation({
  mapPath = DEFAULT_MAP_PATH,
  output,
} = {}) {
  assert.equal(typeof output, "string");
  assert.ok(output.length > 0);
  const { map } = validateSecurityMap(mapPath);
  const testFiles = [
    ...new Set(
      map.rows.map((row) => {
        const absolute = path.resolve(REPOSITORY_ROOT, row.producer.path);
        const relative = path.relative(PACKAGE_ROOT, absolute);
        assert.ok(
          relative && !relative.startsWith("..") && !path.isAbsolute(relative),
          `${row.id} producer must be a CLI test`,
        );
        return relative;
      }),
    ),
  ].sort();
  const testNamePattern = [...new Set(map.rows.map((row) => row.testId))]
    .sort()
    .map(escapeRegExp)
    .join("|");
  return {
    executable: process.execPath,
    args: [
      VITEST_ENTRY,
      "run",
      ...testFiles,
      "-t",
      testNamePattern,
      "--reporter=json",
      `--outputFile=${path.resolve(output)}`,
    ],
    cwd: PACKAGE_ROOT,
    testFiles,
    testNamePattern,
  };
}

export function runMappedSecurityTests(options = {}) {
  const invocation = mappedVitestInvocation(options);
  fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: invocation.cwd,
    encoding: "utf8",
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`mapped security tests exited with ${result.status}`);
  }
  if (!fs.existsSync(path.resolve(options.output))) {
    throw new Error("mapped security tests did not produce a JSON report");
  }
  return invocation;
}

const options = parseArgs(process.argv.slice(2));
runMappedSecurityTests({
  mapPath: options.map,
  output: options.output,
});
