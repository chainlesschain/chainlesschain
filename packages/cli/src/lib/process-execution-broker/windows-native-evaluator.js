import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const issued = new WeakMap();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * MAX_FILE_BYTES;
const MAX_FILES = 64;
function requireCondition(condition, message) {
  if (!condition) throw new Error(`Windows native evaluator: ${message}`);
}
function identity(file, directory = false, maxBytes = MAX_FILE_BYTES) {
  const stat = fs.lstatSync(file, { bigint: true });
  requireCondition(
    !stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()),
    "plain paths required",
  );
  if (!directory)
    requireCondition(stat.nlink === 1n, "hard-linked files are forbidden");
  if (!directory)
    requireCondition(stat.size <= BigInt(maxBytes), "file exceeds byte limit");
  requireCondition(
    fs.realpathSync.native(file).toLowerCase() ===
      path.resolve(file).toLowerCase(),
    "path alias forbidden",
  );
  return {
    path: file,
    dev: String(stat.dev),
    ino: String(stat.ino),
    ...(directory
      ? {}
      : { bytes: Number(stat.size), sha256: hash(fs.readFileSync(file)) }),
  };
}
function relativeFile(value) {
  requireCondition(
    typeof value === "string" && value.length <= 180,
    "invalid relative file",
  );
  const parts = value.split("/");
  requireCondition(
    parts.length <= 8 &&
      parts.every(
        (part) =>
          /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u.test(part) &&
          !part.endsWith(".") &&
          !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part),
      ),
    "invalid relative file",
  );
  return parts;
}
function snapshotFile(root, relative) {
  const parts = relativeFile(relative);
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    identity(current, index < parts.length - 1);
  }
  const before = identity(current);
  requireCondition(before.bytes <= MAX_FILE_BYTES, "source file exceeds 1 MiB");
  const bytes = fs.readFileSync(current);
  const after = identity(current);
  requireCondition(
    JSON.stringify(before) === JSON.stringify(after) &&
      hash(bytes) === before.sha256,
    "source changed during capture",
  );
  return bytes;
}

/** Narrow first-stage native evaluator, not a general workspace sandbox.
 * No existing directory can be nominated as its staging or ACL target.
 * Source bytes and the trusted evaluator are copied before any policy exists.
 */
export function createWindowsNativeEvaluator(options) {
  requireCondition(process.platform === "win32", "Windows host required");
  requireCondition(
    options &&
      Object.keys(options).every((key) =>
        ["sourceRoot", "files", "checkSource", "wallTimeMs"].includes(key),
      ),
    "unknown factory option",
  );
  const { sourceRoot, files, checkSource, wallTimeMs = 10000 } = options;
  requireCondition(
    Number.isSafeInteger(wallTimeMs) &&
      wallTimeMs >= 1 &&
      wallTimeMs <= 3600000,
    "invalid wall-time limit",
  );
  requireCondition(
    Array.isArray(files) && files.length > 0 && files.length <= MAX_FILES,
    "expected 1..64 source files",
  );
  requireCondition(
    new Set(files.map((file) => String(file).toLowerCase())).size ===
      files.length,
    "duplicate source file",
  );
  requireCondition(
    typeof checkSource === "string" &&
      Buffer.byteLength(checkSource) > 0 &&
      Buffer.byteLength(checkSource) <= MAX_FILE_BYTES,
    "check must be bounded source bytes",
  );
  const source = path.resolve(sourceRoot);
  identity(source, true);
  const captures = files.map((relative) => ({
    relative,
    bytes: snapshotFile(source, relative),
  }));
  const directoryNames = new Set(["", "workspace", "control", "scratch"]);
  for (const file of files) {
    const parts = relativeFile(file);
    for (let depth = 1; depth < parts.length; depth++)
      directoryNames.add(`workspace/${parts.slice(0, depth).join("/")}`);
  }
  requireCondition(directoryNames.size <= 128, "too many stage directories");
  requireCondition(
    captures.reduce(
      (total, file) => total + file.bytes.length,
      Buffer.byteLength(checkSource),
    ) <= MAX_TOTAL_BYTES,
    "stage exceeds 8 MiB",
  );
  const sourceRuntime = identity(
    fs.realpathSync.native(process.execPath),
    false,
    128 * MAX_FILE_BYTES,
  );
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-native-evaluator-"),
  );
  const directories = new Set([root]);
  const ensure = (directory) => {
    if (directories.has(directory)) return;
    ensure(path.dirname(directory));
    fs.mkdirSync(directory, { mode: 0o700 });
    directories.add(directory);
  };
  const workspace = path.join(root, "workspace");
  const control = path.join(root, "control");
  const scratch = path.join(root, "scratch");
  for (const directory of [workspace, control, scratch]) ensure(directory);
  // Copy the runtime too: granting access to a caller-owned installation would
  // widen the ACL change beyond this factory's private stage.
  const runtimePath = path.join(control, "node.exe");
  fs.copyFileSync(sourceRuntime.path, runtimePath, fs.constants.COPYFILE_EXCL);
  const runtime = identity(runtimePath, false, 128 * MAX_FILE_BYTES);
  requireCondition(
    runtime.bytes === sourceRuntime.bytes &&
      runtime.sha256 === sourceRuntime.sha256,
    "runtime changed during capture",
  );
  const stagedFiles = [];
  for (const capture of captures) {
    const target = path.join(workspace, ...relativeFile(capture.relative));
    ensure(path.dirname(target));
    fs.writeFileSync(target, capture.bytes, { flag: "wx", mode: 0o600 });
    stagedFiles.push(identity(target));
  }
  const check = path.join(control, "check.cjs");
  fs.writeFileSync(check, checkSource, { flag: "wx", mode: 0o600 });
  stagedFiles.push(identity(check));
  requireCondition(directories.size <= 128, "too many stage directories");
  const manifest = Object.freeze({
    version: 1,
    root,
    workspace,
    control,
    scratch,
    check,
    wallTimeMs,
    runtime: Object.freeze(runtime),
    directories: Object.freeze(
      [...directories]
        .sort((a, b) => a.length - b.length || a.localeCompare(b))
        .map((directory) => Object.freeze(identity(directory, true))),
    ),
    files: Object.freeze(stagedFiles.map(Object.freeze)),
  });
  const manifestDigest = hash(JSON.stringify(manifest));
  const token = Object.freeze({
    kind: "windows-native-evaluator-v1",
    manifestDigest,
  });
  issued.set(token, { manifest, manifestDigest });
  let attempted = false;
  let settled = false;
  const rootIdentity = identity(root, true);
  return Object.freeze({
    root,
    manifest,
    policy: token,
    manifestDigest,
    async execute() {
      requireCondition(!attempted, "evaluator policy already consumed");
      attempted = true;
      const receiptPath = path.join(root, "settlement.json");
      requireCondition(
        !fs.existsSync(receiptPath),
        "pre-existing settlement forbidden",
      );
      const { executionBroker } = await import("./index.js");
      const result = executionBroker.spawnSync(
        runtime.path,
        [
          "--preserve-symlinks",
          "--preserve-symlinks-main",
          check,
          workspace,
          scratch,
        ],
        {
          cwd: scratch,
          shell: false,
          windowsHide: true,
          encoding: "utf8",
          timeout: wallTimeMs + 180000,
          maxBuffer: 8 * 1024 * 1024,
          env: {
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            PATH: path.dirname(runtime.path),
          },
          origin: "native-evaluator:check",
          scope: "private-staged-evaluator",
          policy: "allow",
          sandboxPolicy: {
            profile: "default",
            requiredBoundaries: [
              "filesystem",
              "network",
              "process-tree",
              "resource-limits",
            ],
            limits: { wallTimeMs },
            windowsNativeEvaluator: token,
          },
        },
      );
      const receiptIdentity = identity(receiptPath);
      requireCondition(
        receiptIdentity.bytes <= 16384,
        "invalid settlement size",
      );
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      requireCondition(
        receipt.manifestDigest === manifestDigest &&
          receipt.cleanupConfirmed === true &&
          receipt.capabilityCount === 0 &&
          receipt.loopbackExemptionAbsent === true &&
          /^[a-f0-9]{64}$/u.test(receipt.supervisorUserSidSha256),
        "native settlement unconfirmed; stage retained",
      );
      settled = true;
      return { result, receipt, manifestDigest };
    },
    dispose() {
      requireCondition(
        !attempted || settled,
        "unconfirmed native cleanup; stage retained",
      );
      issued.delete(token);
      requireCondition(
        JSON.stringify(identity(root, true)) === JSON.stringify(rootIdentity),
        "stage root identity changed",
      );
      // The only recursive target is this factory-created, identity-checked root.
      // After execution it is removed only after the native empty-Job fence.
      fs.rmSync(root, { recursive: true });
    },
  });
}

export function consumeWindowsNativeEvaluatorPolicy(token, launch, options) {
  const issuedPolicy = issued.get(token);
  requireCondition(issuedPolicy, "unissued or consumed evaluator policy");
  issued.delete(token);
  const { manifest } = issuedPolicy;
  requireCondition(
    launch.sync === true &&
      launch.command === manifest.runtime.path &&
      JSON.stringify(launch.args) ===
        JSON.stringify([
          "--preserve-symlinks",
          "--preserve-symlinks-main",
          manifest.check,
          manifest.workspace,
          manifest.scratch,
        ]) &&
      path.resolve(options.cwd) === manifest.scratch &&
      options.shell === false &&
      options.detached !== true &&
      options.sandboxPolicy.limits.wallTimeMs === manifest.wallTimeMs,
    "evaluator launch binding mismatch",
  );
  return Object.freeze({
    ...manifest,
    manifestDigest: issuedPolicy.manifestDigest,
  });
}
