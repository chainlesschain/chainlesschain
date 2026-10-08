import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const issued = new WeakMap();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * MAX_FILE_BYTES;
const MAX_FILES = 64;
const V1_LIMITS = Object.freeze({
  version: 1,
  files: MAX_FILES,
  fileBytes: MAX_FILE_BYTES,
  totalBytes: MAX_TOTAL_BYTES,
  directories: 128,
  pathBytes: 180,
  depth: 8,
});
const V2_LIMITS = Object.freeze({
  version: 2,
  files: 20000,
  fileBytes: 32 * MAX_FILE_BYTES,
  totalBytes: 512 * MAX_FILE_BYTES,
  directories: 20000,
  pathBytes: 1024,
  depth: 32,
});
function requireCondition(condition, message) {
  if (!condition) throw new Error(`Windows native evaluator: ${message}`);
}
function readBoundedBytes(file, maxBytes) {
  const named = fs.lstatSync(file, { bigint: true });
  requireCondition(
    named.isFile() &&
      !named.isSymbolicLink() &&
      named.nlink === 1n &&
      named.size <= BigInt(maxBytes),
    "plain bounded file required",
  );
  const fd = fs.openSync(file, fs.constants.O_RDONLY);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    requireCondition(
      before.isFile() && before.nlink === 1n && before.size <= BigInt(maxBytes),
      "opened file exceeds byte limit or is linked",
    );
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = fs.readSync(fd, bytes, count, bytes.length - count, count);
      if (!read) break;
      count += read;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const current = fs.lstatSync(file, { bigint: true });
    const reopened = fs.openSync(file, fs.constants.O_RDONLY);
    let second;
    try {
      second = fs.fstatSync(reopened, { bigint: true });
    } finally {
      fs.closeSync(reopened);
    }
    const same = (left, right) =>
      ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"].every(
        (key) => left[key] === right[key],
      );
    // Compare pathname identities and descriptor identities in their own
    // domains; on Windows their inode representations can differ.
    requireCondition(
      count === Number(before.size) &&
        same(named, current) &&
        same(before, after) &&
        same(after, second),
      "file changed during bounded capture",
    );
    return bytes.subarray(0, count);
  } finally {
    fs.closeSync(fd);
  }
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
      : {
          bytes: Number(stat.size),
          sha256: hash(readBoundedBytes(file, maxBytes)),
        }),
  };
}
function relativeFile(value, limits = V1_LIMITS) {
  requireCondition(
    typeof value === "string" && value.length <= limits.pathBytes,
    "invalid relative file",
  );
  const parts = value.split("/");
  requireCondition(
    parts.length <= limits.depth &&
      parts.every(
        (part) =>
          (limits.version === 1
            ? /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u
            : /^(?!\.{1,2}$)[^\\:*?<>|"]+$/u
          ).test(part) &&
          [...part].every((character) => character.charCodeAt(0) >= 32) &&
          !part.endsWith(" ") &&
          !part.endsWith(".") &&
          !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part),
      ),
    "invalid relative file",
  );
  return parts;
}
function snapshotFile(root, relative, limits = V1_LIMITS) {
  const parts = relativeFile(relative, limits);
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    identity(current, index < parts.length - 1, limits.fileBytes);
  }
  const before = identity(current, false, limits.fileBytes);
  requireCondition(
    before.bytes <= limits.fileBytes,
    "source file exceeds byte limit",
  );
  const bytes = readBoundedBytes(current, limits.fileBytes);
  const after = identity(current, false, limits.fileBytes);
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
  return createEvaluator(options, V1_LIMITS);
}

/** Explicit v2 capsule transport. Snapshots bind every copied byte; these
 * bindings never grant review admission, registry trust, or model access.
 * v1's size/identity/one-shot contract remains independent.
 */
export function createWindowsNativeCapsuleEvaluator(options) {
  requireCondition(
    options && Array.isArray(options.snapshots),
    "capsule snapshots required",
  );
  const { snapshots, binding, ...base } = options;
  requireCondition(
    base.files === undefined,
    "capsule paths must come from snapshots",
  );
  requireCondition(
    binding &&
      Object.keys(binding).sort().join(",") ===
        "inventoryDigest,lockDigest,planDigest,projectCommit,runtime",
    "capsule binding incomplete",
  );
  for (const key of ["inventoryDigest", "lockDigest", "planDigest"])
    requireCondition(
      /^sha256:[a-f0-9]{64}$/u.test(binding[key] || ""),
      "capsule digest invalid",
    );
  requireCondition(
    /^[a-f0-9]{40}$/u.test(binding.projectCommit || ""),
    "capsule project identity invalid",
  );
  const runtime = binding.runtime;
  requireCondition(
    runtime &&
      runtime.platform === process.platform &&
      runtime.architecture === process.arch &&
      runtime.nodeVersion === process.version &&
      runtime.modulesAbi === process.versions.modules &&
      /^sha256:[a-f0-9]{64}$/u.test(runtime.executableDigest || ""),
    "capsule runtime binding differs",
  );
  for (const snapshot of snapshots)
    requireCondition(
      snapshot &&
        Number.isSafeInteger(snapshot.bytes) &&
        snapshot.bytes >= 0 &&
        snapshot.bytes <= V2_LIMITS.fileBytes &&
        /^sha256:[a-f0-9]{64}$/u.test(snapshot.digest || ""),
      "capsule file binding invalid",
    );
  return createEvaluator(
    { ...base, files: snapshots.map((item) => item.path) },
    V2_LIMITS,
    { snapshots, binding },
  );
}

function createEvaluator(options, limits, capsule = null) {
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
    Array.isArray(files) && files.length > 0 && files.length <= limits.files,
    `expected 1..${limits.files} source files`,
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
  const captures = [];
  let capturedBytes = Buffer.byteLength(checkSource);
  for (const relative of files) {
    const parts = relativeFile(relative, limits);
    let file = source;
    for (const [index, part] of parts.entries()) {
      file = path.join(file, part);
      identity(file, index < parts.length - 1, limits.fileBytes);
    }
    const descriptor = identity(file, false, limits.fileBytes);
    requireCondition(
      capturedBytes + descriptor.bytes <= limits.totalBytes,
      "stage exceeds byte limit",
    );
    const bytes = snapshotFile(source, relative, limits);
    requireCondition(
      bytes.length === descriptor.bytes && hash(bytes) === descriptor.sha256,
      "source changed before capture",
    );
    capturedBytes += bytes.length;
    captures.push({ relative, bytes });
  }
  if (capsule)
    for (const [index, capture] of captures.entries())
      requireCondition(
        capture.bytes.length === capsule.snapshots[index].bytes &&
          `sha256:${hash(capture.bytes)}` === capsule.snapshots[index].digest,
        "capsule source changed after inventory",
      );
  const directoryNames = new Set(["", "workspace", "control", "scratch"]);
  for (const file of files) {
    const parts = relativeFile(file, limits);
    for (let depth = 1; depth < parts.length; depth++)
      directoryNames.add(`workspace/${parts.slice(0, depth).join("/")}`);
  }
  requireCondition(
    directoryNames.size <= limits.directories,
    "too many stage directories",
  );
  requireCondition(
    captures.reduce(
      (total, file) => total + file.bytes.length,
      Buffer.byteLength(checkSource),
    ) <= limits.totalBytes,
    "stage exceeds byte limit",
  );
  const sourceRuntime = identity(
    fs.realpathSync.native(process.execPath),
    false,
    128 * MAX_FILE_BYTES,
  );
  if (capsule)
    requireCondition(
      `sha256:${sourceRuntime.sha256}` ===
        capsule.binding.runtime.executableDigest,
      "runtime bytes changed after inventory",
    );
  const root = fs.mkdtempSync(
    path.join(
      fs.realpathSync.native(os.tmpdir()),
      limits.version === 1 ? "cc-native-evaluator-" : "cc-native-capsule-",
    ),
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
    const target = path.join(
      workspace,
      ...relativeFile(capture.relative, limits),
    );
    ensure(path.dirname(target));
    fs.writeFileSync(target, capture.bytes, { flag: "wx", mode: 0o600 });
    stagedFiles.push(identity(target, false, limits.fileBytes));
  }
  const check = path.join(control, "check.cjs");
  fs.writeFileSync(check, checkSource, { flag: "wx", mode: 0o600 });
  stagedFiles.push(identity(check));
  requireCondition(
    directories.size <= limits.directories,
    "too many stage directories",
  );
  const manifest = Object.freeze({
    version: limits.version,
    ...(capsule
      ? {
          capsuleBinding: Object.freeze({
            ...capsule.binding,
            runtime: Object.freeze({ ...capsule.binding.runtime }),
          }),
        }
      : {}),
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
  // The existing byte-loaded helper transports an integrity-bound invocation
  // file (8 MiB), never an expanded command line. Reserve space for Base64 and
  // launch metadata, and reject oversize before any policy can be issued.
  requireCondition(
    Buffer.byteLength(JSON.stringify(manifest)) <= 4 * MAX_FILE_BYTES,
    "native manifest exceeds transport bound",
  );
  const manifestDigest = hash(JSON.stringify(manifest));
  const token = Object.freeze({
    kind:
      limits.version === 1
        ? "windows-native-evaluator-v1"
        : "windows-native-capsule-v2",
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
      let receiptIdentity;
      try {
        receiptIdentity = identity(receiptPath);
      } catch (cause) {
        const error = new Error(
          `Windows native evaluator: native settlement unavailable; stage retained (${cause.message}); supervisor status=${result.status}, signal=${result.signal}, error=${result.error?.message || "none"}, stderr=${String(result.stderr || "").trim()}`,
          { cause },
        );
        error.nativeEvaluator = { result, manifestDigest, stage: root };
        throw error;
      }
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
