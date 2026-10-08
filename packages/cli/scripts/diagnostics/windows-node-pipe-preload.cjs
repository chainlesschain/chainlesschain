"use strict";
// Experimental fixed preload, not a sandbox boundary or admission capability.
// The supervisor must capture/guard this file, its sibling manifest and addon.
// An uninstrumented child is unsupported; callers must check its own receipt.
const fs = require("node:fs");
const path = require("node:path").win32;
const { createHash } = require("node:crypto");

const SCHEMA = "chainlesschain/windows-node-pipe-adapter@1";
const MANIFEST_NAME = "windows-node-pipe-adapter.manifest.json";
const SID_ENV = "CC_WINDOWS_APPCONTAINER_SID";
const requireCondition = (condition, detail) => {
  if (!condition) throw new Error(`Experimental pipe adapter: ${detail}`);
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const plainPath = (value) => {
  requireCondition(
    typeof value === "string" &&
      /^[A-Za-z]:\\/.test(value) &&
      path.normalize(value) === value &&
      !/["%]/.test(value) &&
      !Array.from(value).some((character) => character.charCodeAt(0) < 32) &&
      !value.slice(2).includes(":"),
    "normalized absolute drive path required",
  );
  return value;
};
const samePath = (left, right) =>
  plainPath(left).toLowerCase() === plainPath(right).toLowerCase();
const readPlain = (file, maxBytes) => {
  plainPath(file);
  const before = fs.lstatSync(file);
  requireCondition(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1 &&
      before.size > 0 &&
      before.size <= maxBytes,
    "bounded plain guarded file required",
  );
  const bytes = fs.readFileSync(file);
  const after = fs.lstatSync(file);
  requireCondition(
    bytes.length === before.size &&
      ["dev", "ino", "size", "mtimeMs", "ctimeMs", "nlink"].every(
        (key) => before[key] === after[key],
      ),
    "guarded file identity changed",
  );
  return bytes;
};
const verifyIdentity = (identity, resolvedPath, actualPath, maxBytes) => {
  requireCondition(
    identity &&
      typeof identity.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(identity.sha256) &&
      samePath(resolvedPath, actualPath),
    "fixed identity/path mismatch",
  );
  requireCondition(
    digest(readPlain(resolvedPath, maxBytes)) === identity.sha256,
    "fixed file hash mismatch",
  );
};

requireCondition(
  process.platform === "win32" && process.arch === "x64",
  "Windows x64 required",
);
const manifestPath = path.join(__dirname, MANIFEST_NAME);
const manifest = JSON.parse(readPlain(manifestPath, 16384).toString("utf8"));
requireCondition(
  manifest.schema === SCHEMA &&
    manifest.experimental === true &&
    manifest.admissionEligible === false &&
    manifest.expectedSidEnvironment === SID_ENV &&
    manifest.runtime?.path === "../../control/node.exe" &&
    manifest.addon?.path === "windows-node-pipe-adapter.node" &&
    manifest.preload?.path === "windows-node-pipe-preload.cjs" &&
    manifest.receiptDirectory === "../../scratch/adapter-receipts" &&
    manifest.nodeVersion === process.versions.node &&
    manifest.nodeModuleVersion === process.versions.modules,
  "manifest version/runtime contract mismatch",
);
// Resolution only locates the four exact allowlisted relative paths. It is not
// a canonical-path proof: the supervisor's guarded private tree supplies that.
const preloadPath = path.resolve(__dirname, manifest.preload.path);
const runtimePath = path.resolve(__dirname, manifest.runtime.path);
const addonPath = path.resolve(__dirname, manifest.addon.path);
verifyIdentity(manifest.preload, preloadPath, __filename, 128 * 1024);
verifyIdentity(
  manifest.runtime,
  runtimePath,
  process.execPath,
  256 * 1024 * 1024,
);
verifyIdentity(manifest.addon, addonPath, addonPath, 32 * 1024 * 1024);
const sid = process.env[SID_ENV];
requireCondition(
  typeof sid === "string" && /^S-1-15-2-(?:[0-9]+-)*[0-9]+$/.test(sid),
  "supervisor AppContainer SID is missing or malformed",
);
const receiptDirectory = plainPath(
  path.resolve(__dirname, manifest.receiptDirectory),
);
const directory = fs.lstatSync(receiptDirectory);
requireCondition(
  directory.isDirectory() && !directory.isSymbolicLink(),
  "plain private receipt directory required",
);

// No environment-controlled addon path and no global child_process patch.
const addon = require(addonPath);
const inspect = (raw) => {
  const receipt = JSON.parse(raw);
  requireCondition(
    receipt.schema === SCHEMA &&
      receipt.experimental === true &&
      receipt.admissionEligible === false &&
      receipt.state === 2 &&
      receipt.patches === 2 &&
      receipt.pid === process.pid &&
      receipt.appContainerSid === sid &&
      receipt.capabilityCount === 0 &&
      receipt.inJob === true &&
      receipt.installError === 0,
    "native installation/token receipt mismatch",
  );
  return receipt;
};
const installation = inspect(addon.install(sid, process.pid));
const record = (phase, native, exitCode) => {
  const receipt = {
    schema: SCHEMA,
    experimental: true,
    admissionEligible: false,
    phase,
    pid: process.pid,
    ppid: process.ppid,
    execPath: process.execPath,
    nodeVersion: process.versions.node,
    manifestSha256: digest(readPlain(manifestPath, 16384)),
    preloadSha256: manifest.preload.sha256,
    addonSha256: manifest.addon.sha256,
    runtimeSha256: manifest.runtime.sha256,
    ...(exitCode === undefined ? {} : { exitCode }),
    native,
  };
  // Separate immutable receipts avoid overwriting another PID's evidence.
  fs.writeFileSync(
    path.join(receiptDirectory, `pipe-adapter-${process.pid}-${phase}.json`),
    JSON.stringify(receipt) + "\n",
    { flag: "wx", encoding: "utf8" },
  );
  return receipt;
};
record("installed", installation);
process.once("exit", (exitCode) => {
  record("exit", inspect(addon.snapshot()), exitCode);
});

// Deliberately explicit: only children launched using this contract and having
// matching native receipts count as adapted. NODE_OPTIONS can be cleared by a
// caller, so inherited configuration alone never proves descendant coverage.
// NODE_OPTIONS treats backslashes inside quotes as escapes, including on
// Windows. Forward slashes preserve the same absolute module path.
const preloadOption = `--require="${preloadPath.replace(/\\/gu, "/")}"`;
module.exports = Object.freeze({
  schema: SCHEMA,
  experimental: true,
  admissionEligible: false,
  installation: Object.freeze(installation),
  snapshot: () => Object.freeze(inspect(addon.snapshot())),
  childContract: () =>
    Object.freeze({
      executable: runtimePath,
      execArgv: Object.freeze(["--require", preloadPath]),
      environment: Object.freeze({
        [SID_ENV]: sid,
        NODE_OPTIONS: preloadOption,
      }),
      requiredReceipt:
        "matching installed and exit receipts for actual child PID",
      unsupported: Object.freeze([
        "NUL",
        "realpath",
        "uninstrumented-descendants",
      ]),
    }),
});
