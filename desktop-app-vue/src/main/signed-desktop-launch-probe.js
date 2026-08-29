"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const RECEIPT_SCHEMA = "chainlesschain.desktop-signed-skill-launch/v1";
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function receiptDigest(value) {
  const unsigned = { ...value };
  delete unsigned.receiptDigest;
  return `sha256:${crypto
    .createHash("sha256")
    .update("cc.desktop-signed-skill-receipt/v1\0", "utf8")
    .update(JSON.stringify(canonicalValue(unsigned)), "utf8")
    .digest("hex")}`;
}

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function sha256File(file) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex")}`;
}

function atomicWriteJson(target, value) {
  const resolved = path.resolve(target);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  fs.renameSync(temporary, resolved);
}

async function maybeRunSignedDesktopLaunchProbe(options = {}) {
  const argv = options.argv || process.argv;
  const output = argument(argv, "--cc-signed-skill-launch-output");
  if (!output) return false;

  const app = options.app;
  if (!app || typeof app.getAppPath !== "function") {
    throw new Error("signed Desktop launch probe requires Electron app");
  }
  const expectedCommit = argument(argv, "--cc-signed-skill-launch-commit");
  const artifactSha256 = argument(argv, "--cc-signed-skill-artifact-sha256");
  const challengeDigest = argument(argv, "--cc-signed-skill-launch-challenge");
  if (!COMMIT_SHA.test(expectedCommit || "")) {
    throw new Error("signed Desktop launch probe requires an exact commit SHA");
  }
  if (!DIGEST.test(artifactSha256 || "")) {
    throw new Error("signed Desktop launch probe requires an artifact digest");
  }
  if (!DIGEST.test(challengeDigest || "")) {
    throw new Error("signed Desktop launch probe requires a challenge digest");
  }

  const buildInfoPath =
    options.buildInfoPath || path.join(__dirname, "build-info.json");
  const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
  if (buildInfo.commitSha !== expectedCommit) {
    throw new Error("packaged Desktop build commit does not match candidate");
  }
  const appPath = path.resolve(app.getAppPath());
  const appPathStat = fs.statSync(appPath);
  if (
    app.isPackaged !== true ||
    !appPath.toLowerCase().endsWith("app.asar") ||
    !appPathStat.isFile()
  ) {
    throw new Error("signed Desktop launch probe requires packaged ASAR");
  }
  const platform =
    options.platform ||
    { darwin: "macos", linux: "linux", win32: "windows" }[process.platform];
  if (!platform) {
    throw new Error(
      "signed Desktop launch probe requires a supported platform",
    );
  }

  const receipt = {
    schema: RECEIPT_SCHEMA,
    status: "passed",
    platform,
    commitSha: expectedCommit,
    artifactSha256,
    challengeDigest,
    started: true,
    isPackaged: true,
    asar: true,
    appAsarBytes: appPathStat.size,
    appAsarSha256: sha256File(appPath),
    electronVersion:
      options.electronVersion || process.versions.electron || null,
    appVersion: app.getVersion(),
  };
  if (!receipt.electronVersion || !receipt.appVersion) {
    throw new Error("packaged Desktop runtime identity is incomplete");
  }
  receipt.receiptDigest = receiptDigest(receipt);
  atomicWriteJson(output, receipt);
  app.quit();
  return true;
}

module.exports = {
  RECEIPT_SCHEMA,
  maybeRunSignedDesktopLaunchProbe,
  receiptDigest,
};
