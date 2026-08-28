#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { receiptDigest } from "./verify-signed-desktop-skill-matrix.mjs";

const SCHEMA = "chainlesschain.desktop-signed-skill-install/v1";
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const PLATFORMS = new Set(["linux", "macos", "windows"]);

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function assertion(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256File(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

export function createInstallReceipt(options) {
  const platform = String(options.platform || "");
  const commitSha = String(options.commitSha || "");
  const challengeDigest = String(options.challengeDigest || "");
  const artifact = path.resolve(options.artifact || "");
  const executable = path.resolve(options.executable || "");
  assertion(PLATFORMS.has(platform), "unsupported install platform");
  assertion(
    COMMIT_SHA.test(commitSha),
    "install receipt requires an exact commit SHA",
  );
  assertion(
    SHA256.test(challengeDigest),
    "install receipt requires a challenge digest",
  );
  assertion(
    options.fresh === true,
    "install receipt requires a fresh installation",
  );
  assertion(options.exitCode === 0, "installer did not exit successfully");
  assertion(fs.statSync(artifact).isFile(), "installer artifact is not a file");
  const executableStat = fs.statSync(executable);
  assertion(executableStat.isFile(), "installed executable is not a file");
  const method = String(options.installationMethod || "").trim();
  assertion(
    method.length > 0 && method.length <= 128,
    "installation method is required",
  );
  const receipt = {
    schema: SCHEMA,
    platform,
    commitSha,
    artifactSha256: sha256File(artifact),
    challengeDigest,
    fresh: true,
    installed: true,
    exitCode: 0,
    installationMethod: method,
    installedExecutableName: path.basename(executable),
    installedExecutableBytes: executableStat.size,
    installedExecutableSha256: sha256File(executable),
  };
  receipt.receiptDigest = receiptDigest(receipt);
  return Object.freeze(receipt);
}

async function main(argv = process.argv.slice(2)) {
  const output = argument(argv, "--output");
  assertion(output, "--output is required");
  const receipt = createInstallReceipt({
    platform: argument(argv, "--platform"),
    commitSha: argument(argv, "--expected-sha"),
    challengeDigest: argument(argv, "--challenge"),
    artifact: argument(argv, "--artifact"),
    executable: argument(argv, "--executable"),
    installationMethod: argument(argv, "--installation-method"),
    exitCode: Number(argument(argv, "--exit-code")),
    fresh: argv.includes("--fresh-install"),
  });
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  process.stdout.write(`Fresh ${receipt.platform} install receipt recorded\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
