#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert.ok(key?.startsWith("--") && value, `invalid argument: ${key}`);
    options[
      key
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = value;
  }
  assert.match(options.releaseCommit || "", /^[a-f0-9]{40}$/u);
  assert.ok(options.artifactDir && options.artifactName);
  return options;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function writeFailure(options, error) {
  fs.mkdirSync(options.artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(options.artifactDir, "bootstrap-failure.json"),
    `${JSON.stringify({
      schema: "chainlesschain.execution-location-bootstrap-failure.v1",
      transport: "local",
      releaseCommit: options.releaseCommit,
      diagnosticDigest: digest(String(error?.message || "local runner failed")),
      contentEmitted: false,
    })}\n`,
    "utf8",
  );
}

function runMatrix(commonArguments, mode, extra = []) {
  const result = spawnSync(
    process.execPath,
    [
      "packages/cli/scripts/ide-roadmap-execution-location-matrix.mjs",
      "--mode",
      mode,
      ...commonArguments,
      ...extra,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`local matrix mode ${mode} failed with ${result.status}`);
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const runRoot = path.join(
    process.env.RUNNER_TEMP || os.tmpdir(),
    `cc-execution-location-local-${process.env.GITHUB_RUN_ID || process.pid}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`,
  );
  const stateRoot = path.join(runRoot, "state");
  const sourceHome = path.join(runRoot, "source-home");
  const sourceSecurityHome = path.join(runRoot, "source-security");
  const targetHome = path.join(runRoot, "target-home");
  const targetSecurityHome = path.join(runRoot, "target-security");
  const targetCli = path.resolve("packages/cli/src/index.js");
  const offlineCli = `${targetCli}.location-offline`;
  for (const directory of [
    options.artifactDir,
    stateRoot,
    sourceHome,
    sourceSecurityHome,
    targetHome,
    targetSecurityHome,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const commonArguments = [
    "--transport",
    "local",
    "--release-commit",
    options.releaseCommit,
    "--artifact-dir",
    path.resolve(options.artifactDir),
    "--artifact-name",
    options.artifactName,
    "--state-dir",
    stateRoot,
    "--source-home",
    sourceHome,
    "--source-security-home",
    sourceSecurityHome,
    "--target-home",
    targetHome,
    "--target-security-home",
    targetSecurityHome,
    "--target-cwd",
    process.cwd(),
    "--target-cli",
    targetCli,
  ];
  let movedOffline = false;
  try {
    runMatrix(commonArguments, "initialize");
    runMatrix(commonArguments, "prepare-reconnect");
    if (fs.existsSync(offlineCli)) {
      throw new Error("local outage path already exists");
    }
    fs.renameSync(targetCli, offlineCli);
    movedOffline = true;
    runMatrix(commonArguments, "probe-unavailable");
    fs.renameSync(offlineCli, targetCli);
    movedOffline = false;
    runMatrix(commonArguments, "complete-reconnect");
    runMatrix(commonArguments, "lifecycle-faults");
    runMatrix(commonArguments, "campaign", ["--iterations", "99"]);
    runMatrix(commonArguments, "finalize");
  } catch (error) {
    writeFailure(options, error);
    throw error;
  } finally {
    if (
      movedOffline &&
      fs.existsSync(offlineCli) &&
      !fs.existsSync(targetCli)
    ) {
      fs.renameSync(offlineCli, targetCli);
    }
  }
}

main();
