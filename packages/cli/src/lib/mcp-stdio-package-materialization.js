/**
 * Fixed-version, content-addressed npm materialization for MCP stdio servers.
 *
 * JavaScript package launchers are resolvers and downloaders, not executable
 * identities. An explicitly approved materialization normalizes supported
 * npx/npm/pnpm/yarn/bunx/corepack source invocations to one exact npm package
 * version, installs it with lifecycle scripts disabled, verifies every
 * transitive lock entry has registry integrity, snapshots the exact installed
 * bytes, and bundles the reachable JavaScript closure into one guarded CJS
 * capsule. Runtime resolution never invokes the dynamic launcher or the live
 * node_modules entrypoint: it re-verifies both the provenance tree and capsule,
 * then returns the current Node runtime plus the pinned capsule.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { getCacheDir, getMachineSecurityAnchorDir } from "./paths.js";
import {
  mutateSecurityStore,
  readSecurityStore,
  writeSecurityStore,
} from "./durable-security-store.js";
import { sanitizeMcpStdioHostEnvironment } from "./mcp-stdio-environment.js";

export const MCP_STDIO_PACKAGE_MATERIALIZATION_REQUIRED_CODE =
  "CC_MCP_STDIO_PACKAGE_MATERIALIZATION_REQUIRED";
export const MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE =
  "CC_MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID";
export const MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE =
  "CC_MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED";
export const MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE =
  "CC_MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED";

const MATERIALIZATION_SCHEMA =
  "chainlesschain.mcp-stdio-package-materialization/v5";
const MATERIALIZATION_VERSION = 5;
const CAPSULE_SCHEMA = "chainlesschain.mcp-stdio-node-capsule/v4";
const CAPSULE_RELATIVE_PATH = "capsule/server.cjs";
const CAPSULE_BUILDER = "esbuild-wasm";
const CAPSULE_BUILDER_VERSION = "0.28.1";
const CAPSULE_BUILDER_WASM_SHA256 =
  "cc8c5e14db584cd75c6c9fc16e1aae3d5b8e99ab7f333aeee71f59e23fa9f24e";
const CAPSULE_BUILDER_WASM_BYTES = 13_940_120;
const CAPSULE_BUILDER_API_SHA256 =
  "4ec4cc1b6f2fdd0a117aa20ab5c49da9868ce7329322082a457927cdc64d89c1";
const CAPSULE_BUILDER_API_BYTES = 133_235;
const CAPSULE_RESOLVER_SCHEMA =
  "chainlesschain.mcp-stdio-immutable-vfs-resolver/v1";
const CAPSULE_WORKER_SCHEMA =
  "chainlesschain.mcp-stdio-capsule-builder-worker/v1";
const CAPSULE_BUILD_TIMEOUT_MS = 120_000;
const CAPSULE_WORKER_MAX_OLD_GENERATION_MB = 256;
// Updated with the checked-in source digest whenever either pinned host module
// changes. The worker receives source bytes, never a pathname to execute.
const CAPSULE_BUILDER_WORKER_SHA256 =
  "1386f5ad51ba9e946fbf676d8aba4c8a11b3219916a413ac6fc24578d998ace1";
const CAPSULE_BUILDER_WORKER_BYTES = 16_293;
const CAPSULE_RESOLVER_SHA256 =
  "48e1fc27454e6dcfd3018849912699e6ef8417db1716d1c8eff2cd1072a786d2";
const CAPSULE_RESOLVER_BYTES = 24_417;
const CAPSULE_STDIN_WRAPPER_SCHEMA =
  "chainlesschain.mcp-stdio-capsule-stdin-wrapper/v1";
const CAPSULE_BUILTIN_POLICY_SCHEMA =
  "chainlesschain.mcp-stdio-static-builtin-policy/v2";
const CAPSULE_EXECUTION_CONTEXT_ISOLATION =
  "required-mcp-os-sandbox-boundaries-v1";
// These builtins can create a fresh JavaScript isolate/process or evaluate
// code through a privileged runtime surface. Same-realm Module guards do not
// propagate there, so their presence is bound explicitly to the capsule
// manifest and is admissible only through the product's mandatory
// filesystem/network/process-tree/code-snapshot OS sandbox contract.
const CAPSULE_EXECUTION_CONTEXT_BUILTINS = new Set([
  "child_process", // spawn-inventory-audit: static-execution-context-builtin
  "cluster",
  "inspector",
  "inspector/promises",
  "vm",
  "worker_threads",
]);
const CAPSULE_BUILTIN_ALLOWLIST_MARKER =
  "__CHAINLESSCHAIN_MCP_STATIC_BUILTIN_ALLOWLIST_8F43C70E__";
const INDEX_LABEL = "MCP stdio package materialization index";
const MANIFEST_LABEL = "MCP stdio package materialization manifest";
const MAX_FILES = 10_000;
// Source bytes cross a Worker boundary and are copied into the immutable VFS
// and browser realm. Keep the external-memory ceiling well below the V8 heap
// limit because Worker resourceLimits do not bound ArrayBuffer/WASM memory.
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_CAPSULE_BYTES = 32 * 1024 * 1024;
const MAX_DEPTH = 64;
const HASH_CHUNK_BYTES = 1024 * 1024;
const EXACT_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

export const _deps = {
  fs,
  onVfsSnapshotCaptured: null,
  processBrokerRunSync: null,
  Worker,
};

const require = createRequire(import.meta.url);
const NODE_BUILTINS = new Set(
  builtinModules.flatMap((name) => [
    name,
    name.startsWith("node:") ? name : `node:${name}`,
  ]),
);

function materializationError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "McpStdioPackageMaterializationError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function executableBasename(value) {
  return path
    .basename(String(value || ""))
    .replace(/\.(?:exe|com|cmd|bat)$/i, "")
    .toLowerCase();
}

export function getMcpStdioPackageMaterializationRoot(options = {}) {
  return path.resolve(
    options.root ||
      process.env.CC_MCP_PACKAGE_MATERIALIZATION_ROOT ||
      path.join(getCacheDir(), "mcp-stdio-package-materializations-v5"),
  );
}

export function getMcpStdioPackageMaterializationIndexPath(options = {}) {
  return path.resolve(
    options.indexPath ||
      process.env.CC_MCP_PACKAGE_MATERIALIZATION_INDEX ||
      path.join(
        getMachineSecurityAnchorDir(),
        "mcp-stdio-package-materializations-v5.json",
      ),
  );
}

export function parseExactNpmPackageSpec(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "MCP package materialization requires an exact npm package@version",
    );
  }
  const separator = value.startsWith("@")
    ? value.indexOf("@", value.indexOf("/") + 1)
    : value.lastIndexOf("@");
  if (separator <= 0) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      `MCP npm package spec must use an exact version: ${value}`,
    );
  }
  const name = value.slice(0, separator);
  const version = value.slice(separator + 1);
  if (!PACKAGE_NAME.test(name) || !EXACT_VERSION.test(version)) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      `MCP npm package spec must use a registry name and exact version: ${value}`,
    );
  }
  return Object.freeze({ name, version, spec: `${name}@${version}` });
}

function skipYesFlag(args, start) {
  let index = start;
  while (args[index] === "-y" || args[index] === "--yes") index += 1;
  return index;
}

function packageArgumentIndex(config) {
  const command = executableBasename(config?.command);
  const args = Array.isArray(config?.args) ? [...config.args] : [];
  let index = 0;
  let launcher = command;

  if (["npx", "bunx", "pnpx"].includes(command)) {
    index = skipYesFlag(args, 0);
  } else if (command === "npm") {
    if (args[index] !== "exec") return null;
    launcher = "npm-exec";
    index = skipYesFlag(args, index + 1);
    if (args[index] === "--") index += 1;
  } else if (command === "pnpm") {
    if (args[index] !== "dlx") return null;
    launcher = "pnpm-dlx";
    index = skipYesFlag(args, index + 1);
  } else if (command === "yarn" || command === "yarnpkg") {
    if (args[index] !== "dlx") return null;
    launcher = `${command}-dlx`;
    index = skipYesFlag(args, index + 1);
  } else if (command === "corepack") {
    const manager = executableBasename(args[index]);
    if (!["pnpm", "yarn", "yarnpkg"].includes(manager)) return null;
    if (args[index + 1] !== "dlx") return null;
    launcher = `corepack-${manager}-dlx`;
    index = skipYesFlag(args, index + 2);
  } else {
    return null;
  }

  return Object.freeze({ args, index, launcher });
}

export function parseNpmPackageLauncherInvocation(config, packageSpec) {
  const exact = parseExactNpmPackageSpec(packageSpec);
  const parsed = packageArgumentIndex(config);
  if (!parsed) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      `MCP fixed npm materialization does not support source launcher ${String(config?.command)}`,
    );
  }
  if (parsed.args[parsed.index] !== exact.spec) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      `MCP package launcher must name the same exact package spec ${exact.spec} without unbound resolver flags`,
    );
  }
  return Object.freeze({
    ...exact,
    launcher: parsed.launcher,
    passthroughArgs: Object.freeze(parsed.args.slice(parsed.index + 1)),
  });
}

// Compatibility export for callers introduced with the original npx-only
// materializer. Its semantics intentionally expand to all normalized npm
// package launchers while retaining the stable API name.
export const parseNpxMaterializationInvocation =
  parseNpmPackageLauncherInvocation;

function resolveNpmCli(options = {}) {
  const candidates = [
    options.npmCli,
    process.env.npm_execpath,
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
    path.resolve(
      path.dirname(process.execPath),
      "..",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
    path.resolve(
      path.dirname(process.execPath),
      "..",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const resolved = path.resolve(candidate);
      const stat = _deps.fs.statSync(resolved);
      if (stat.isFile()) return resolved;
    } catch {
      // Try the next explicit npm CLI location.
    }
  }
  throw materializationError(
    MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
    "A local npm-cli.js could not be resolved for fixed package materialization",
  );
}

function defaultInstallRunner({
  directory,
  packageSpec,
  npmCli,
  env,
  processBrokerRunSync: injectedProcessBrokerRunSync,
}) {
  const runThroughProcessBroker =
    injectedProcessBrokerRunSync || _deps.processBrokerRunSync;
  if (typeof runThroughProcessBroker !== "function") {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
      "MCP package materialization requires a host-owned Process Broker runner",
    );
  }
  const result = runThroughProcessBroker(
    process.execPath,
    [
      npmCli,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--omit=dev",
      "--save-exact",
      "--package-lock=true",
      "--install-strategy=nested",
      packageSpec,
    ],
    {
      cwd: directory,
      env: sanitizeMcpStdioHostEnvironment(env),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    const detail = String(
      result.stderr || result.error?.message || "npm failed",
    )
      .trim()
      .slice(0, 2000);
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
      `npm fixed package materialization failed: ${detail}`,
      { cause: result.error, exitCode: result.status },
    );
  }
}

function packageDirectory(treeRoot, packageName) {
  return path.join(treeRoot, "node_modules", ...packageName.split("/"));
}

function readJson(file, label) {
  try {
    const value = JSON.parse(_deps.fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("top-level value must be an object");
    }
    return value;
  } catch (cause) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      `${label} is unavailable or invalid: ${cause.message}`,
      { cause, file },
    );
  }
}

function validateNpmLock(treeRoot, exact) {
  const lockPath = path.join(treeRoot, "package-lock.json");
  const lock = readJson(lockPath, "npm package-lock.json");
  if (!Number.isInteger(lock.lockfileVersion) || lock.lockfileVersion < 2) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "npm materialization requires package-lock v2 or newer",
    );
  }
  const packages = lock.packages;
  if (!packages || typeof packages !== "object" || Array.isArray(packages)) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "npm materialization lock has no packages map",
    );
  }
  const rootVersion = packages[""]?.dependencies?.[exact.name];
  if (rootVersion !== exact.version) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "npm materialization lock does not bind the requested exact root version",
    );
  }
  let packageCount = 0;
  for (const [location, entry] of Object.entries(packages)) {
    if (location === "") continue;
    packageCount += 1;
    if (
      !entry ||
      typeof entry !== "object" ||
      entry.link === true ||
      typeof entry.version !== "string" ||
      !EXACT_VERSION.test(entry.version) ||
      typeof entry.resolved !== "string" ||
      !/^https:\/\//i.test(entry.resolved) ||
      typeof entry.integrity !== "string" ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity)
    ) {
      throw materializationError(
        MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
        `npm transitive lock entry is not registry-integrity pinned: ${location}`,
      );
    }
  }
  if (packageCount === 0) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "npm materialization lock contains no installed package",
    );
  }
  return Object.freeze({
    lockPath,
    lockSha256: sha256(_deps.fs.readFileSync(lockPath)),
    packageCount,
  });
}

function resolvePackageEntrypoint(treeRoot, exact, requestedBin) {
  const root = packageDirectory(treeRoot, exact.name);
  const packageJson = readJson(
    path.join(root, "package.json"),
    "npm package.json",
  );
  if (
    packageJson.name !== exact.name ||
    packageJson.version !== exact.version
  ) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "installed npm package identity does not match the requested exact spec",
    );
  }
  let binName;
  let binPath;
  if (typeof packageJson.bin === "string") {
    binName = packageJson.name.replace(/^@[^/]+\//, "");
    binPath = packageJson.bin;
    if (requestedBin && requestedBin !== binName) {
      throw materializationError(
        MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
        `requested npm bin ${requestedBin} is not exported by ${exact.spec}`,
      );
    }
  } else if (
    packageJson.bin &&
    typeof packageJson.bin === "object" &&
    !Array.isArray(packageJson.bin)
  ) {
    const names = Object.keys(packageJson.bin).sort();
    binName = requestedBin || (names.length === 1 ? names[0] : null);
    if (!binName || typeof packageJson.bin[binName] !== "string") {
      throw materializationError(
        MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
        `npm package ${exact.spec} exports multiple bins; select one explicitly`,
      );
    }
    binPath = packageJson.bin[binName];
  } else {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      `npm package ${exact.spec} does not export an executable bin`,
    );
  }
  const entrypoint = path.resolve(root, binPath);
  const relative = path.relative(treeRoot, entrypoint);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "npm package bin resolves outside the materialized tree",
    );
  }
  const stat = _deps.fs.lstatSync(entrypoint);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "npm package bin must be one regular non-symlink file",
    );
  }
  const headerBuffer = Buffer.allocUnsafe(
    Math.max(1, Math.min(stat.size, 256)),
  );
  const headerDescriptor = _deps.fs.openSync(entrypoint, "r");
  let headerBytes;
  try {
    headerBytes = _deps.fs.readSync(
      headerDescriptor,
      headerBuffer,
      0,
      headerBuffer.length,
      0,
    );
  } finally {
    _deps.fs.closeSync(headerDescriptor);
  }
  const header = headerBuffer.subarray(0, headerBytes).toString("utf8");
  if (
    ![".js", ".cjs", ".mjs"].includes(path.extname(entrypoint).toLowerCase()) &&
    !/^#![^\r\n]*\bnode(?:\.exe)?(?:\s|$)/i.test(header)
  ) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "npm package bin must be a direct Node entrypoint; native or secondary-runtime bins require a separate materializer",
    );
  }
  return Object.freeze({
    binName,
    entrypoint,
    entrypointRelative: relative.split(path.sep).join("/"),
  });
}

function materializationFileMode(mode) {
  return Number(mode) & (process.platform === "win32" ? 0o666 : 0o777);
}

function hashFile(file, expectedBytes) {
  let descriptor;
  try {
    descriptor = _deps.fs.openSync(
      file,
      Number(_deps.fs.constants.O_RDONLY) |
        Number(_deps.fs.constants.O_NOFOLLOW || 0) |
        Number(_deps.fs.constants.O_NONBLOCK || 0),
    );
    const before = _deps.fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size !== BigInt(expectedBytes)) {
      throw new Error("file size or type changed before hashing");
    }
    const digest = crypto.createHash("sha256");
    const chunk = Buffer.allocUnsafe(
      Math.max(1, Math.min(expectedBytes, HASH_CHUNK_BYTES)),
    );
    let offset = 0;
    while (offset < expectedBytes) {
      const count = _deps.fs.readSync(
        descriptor,
        chunk,
        0,
        Math.min(chunk.length, expectedBytes - offset),
        offset,
      );
      if (count <= 0) throw new Error("file ended before its observed size");
      digest.update(chunk.subarray(0, count));
      offset += count;
    }
    const after = _deps.fs.fstatSync(descriptor, { bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error("file changed while it was being hashed");
    }
    return Object.freeze({
      sha256: digest.digest("hex"),
      // Node can synthesize pathname and descriptor execute bits differently
      // on Windows. Record the descriptor view used to read the bytes and keep
      // only permissions; the regular-file type is validated independently.
      mode: materializationFileMode(after.mode),
    });
  } finally {
    if (descriptor !== undefined) _deps.fs.closeSync(descriptor);
  }
}

function collectTree(
  root,
  {
    maxFiles = MAX_FILES,
    maxTotalBytes = MAX_TOTAL_BYTES,
    maxFileBytes = MAX_FILE_BYTES,
  } = {},
) {
  const files = [];
  let totalBytes = 0;
  const visit = (directory, depth) => {
    if (depth > MAX_DEPTH) {
      throw new Error("materialized dependency tree exceeds the depth limit");
    }
    const entries = _deps.fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === ".bin" && entry.isDirectory()) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        throw new Error(
          `materialized dependency tree contains a symlink: ${relative}`,
        );
      }
      if (entry.isDirectory()) {
        visit(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(
          `materialized dependency tree contains a special file: ${relative}`,
        );
      }
      const stat = _deps.fs.statSync(absolute, { bigint: true });
      if (stat.size < 0n || stat.size > BigInt(maxFileBytes)) {
        throw new Error(
          `materialized file exceeds the size limit: ${relative}`,
        );
      }
      totalBytes += Number(stat.size);
      if (files.length >= maxFiles || totalBytes > maxTotalBytes) {
        throw new Error(
          "materialized dependency tree exceeds its aggregate budget",
        );
      }
      const attested = hashFile(absolute, Number(stat.size));
      files.push({
        path: relative,
        bytes: Number(stat.size),
        mode: attested.mode,
        sha256: attested.sha256,
      });
    }
  };
  visit(root, 0);
  return Object.freeze({
    files: Object.freeze(files.map((entry) => Object.freeze(entry))),
    fileCount: files.length,
    totalBytes,
    closureDigest: sha256(canonicalJson(files)),
  });
}

function resolveContainedPath(root, relative, label) {
  if (
    typeof relative !== "string" ||
    !relative ||
    relative.includes("\0") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${label} has an invalid relative path`);
  }
  const resolved = path.resolve(root, ...relative.split("/"));
  const observed = path.relative(path.resolve(root), resolved);
  if (
    observed === "" ||
    observed === ".." ||
    observed.startsWith(`..${path.sep}`) ||
    path.isAbsolute(observed)
  ) {
    throw new Error(`${label} escapes its root`);
  }
  return resolved;
}

function snapshotFileIdentity(stat) {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  });
}

function sameSnapshotFileIdentity(left, right) {
  return Boolean(
    left &&
    right &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs,
  );
}

function openSnapshotInputDescriptor(file) {
  return _deps.fs.openSync(
    file,
    Number(_deps.fs.constants.O_RDONLY) |
      Number(_deps.fs.constants.O_NOFOLLOW || 0) |
      Number(_deps.fs.constants.O_NONBLOCK || 0),
  );
}

function snapshotIdentityThroughDescriptor(file) {
  let descriptor;
  try {
    descriptor = openSnapshotInputDescriptor(file);
    const stat = _deps.fs.fstatSync(descriptor, { bigint: true });
    if (!stat.isFile()) {
      throw new Error("MCP capsule build input descriptor is not regular");
    }
    return snapshotFileIdentity(stat);
  } finally {
    if (descriptor !== undefined) _deps.fs.closeSync(descriptor);
  }
}

function readSnapshotInputAttestation(canonicalSnapshotRoot, inputRelative) {
  const realpath = _deps.fs.realpathSync.native || _deps.fs.realpathSync;
  const requested = resolveContainedPath(
    canonicalSnapshotRoot,
    inputRelative,
    "MCP capsule build input",
  );
  const pathBefore = _deps.fs.lstatSync(requested, { bigint: true });
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile()) {
    throw new Error(
      `MCP capsule build input is not one regular file: ${inputRelative}`,
    );
  }
  const canonicalPath = realpath(requested);
  const reboundRelative = path
    .relative(canonicalSnapshotRoot, canonicalPath)
    .split(path.sep)
    .join("/");
  if (reboundRelative !== inputRelative) {
    throw new Error(
      `MCP capsule build input changed through a path alias: ${inputRelative}`,
    );
  }

  let descriptor;
  try {
    descriptor = openSnapshotInputDescriptor(canonicalPath);
    const descriptorBefore = _deps.fs.fstatSync(descriptor, { bigint: true });
    const pathIdentityBefore = snapshotFileIdentity(pathBefore);
    const descriptorIdentityBefore = snapshotFileIdentity(descriptorBefore);
    // Node's Windows pathname and descriptor stat projections do not share a
    // stable dev/ino namespace on every filesystem. Bind the pathname to the
    // primary reader with a second descriptor instead: descriptor-to-
    // descriptor identity is stable, while pathname metadata is checked only
    // against the later pathname view. This retains file-ID binding without
    // falling back to mutable size/timestamp comparisons.
    const pathnameDescriptorIdentityBefore =
      snapshotIdentityThroughDescriptor(canonicalPath);
    if (
      !descriptorBefore.isFile() ||
      descriptorBefore.size < 0n ||
      descriptorBefore.size > BigInt(MAX_FILE_BYTES) ||
      !sameSnapshotFileIdentity(
        descriptorIdentityBefore,
        pathnameDescriptorIdentityBefore,
      )
    ) {
      throw new Error(
        `MCP capsule build input identity changed before read: ${inputRelative}`,
      );
    }

    const bytes = Number(descriptorBefore.size);
    // Slow buffers own their ArrayBuffer, so ownership can be transferred to
    // the isolated builder Worker without detaching an unrelated slab.
    const content = Buffer.allocUnsafeSlow(bytes);
    let offset = 0;
    while (offset < bytes) {
      const count = _deps.fs.readSync(
        descriptor,
        content,
        offset,
        bytes - offset,
        offset,
      );
      if (count <= 0) {
        throw new Error(
          `MCP capsule build input ended during read: ${inputRelative}`,
        );
      }
      offset += count;
    }

    const descriptorAfter = _deps.fs.fstatSync(descriptor, { bigint: true });
    const pathAfter = _deps.fs.lstatSync(requested, { bigint: true });
    const canonicalPathAfter = realpath(requested);
    if (
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      canonicalPathAfter !== canonicalPath
    ) {
      throw new Error(
        `MCP capsule build input changed during read: ${inputRelative}`,
      );
    }
    const descriptorIdentityAfter = snapshotFileIdentity(descriptorAfter);
    const pathIdentityAfter = snapshotFileIdentity(pathAfter);
    const pathnameDescriptorIdentityAfter =
      snapshotIdentityThroughDescriptor(canonicalPathAfter);
    if (
      !sameSnapshotFileIdentity(
        descriptorIdentityBefore,
        descriptorIdentityAfter,
      ) ||
      !sameSnapshotFileIdentity(pathIdentityBefore, pathIdentityAfter) ||
      !sameSnapshotFileIdentity(
        descriptorIdentityAfter,
        pathnameDescriptorIdentityAfter,
      )
    ) {
      throw new Error(
        `MCP capsule build input changed during read: ${inputRelative}`,
      );
    }
    return Object.freeze({
      path: inputRelative,
      canonicalPath,
      bytes,
      sha256: sha256(content),
      identity: descriptorIdentityAfter,
      content,
    });
  } finally {
    if (descriptor !== undefined) _deps.fs.closeSync(descriptor);
  }
}

function readPinnedCapsuleAsset({
  root,
  relativePath,
  bytes,
  sha256: expectedSha256,
  label,
}) {
  const observed = readSnapshotInputAttestation(root, relativePath);
  if (
    observed.bytes !== bytes ||
    observed.sha256 !== expectedSha256 ||
    materializationFileMode(observed.identity.mode) === 0
  ) {
    throw new Error(`${label} identity is invalid`);
  }
  return observed;
}

function resolvePinnedCapsuleBuilder() {
  // Vitest can evaluate this module through a non-file URL when desktop tests
  // import the CLI process broker transitively. Resolve host-only assets only
  // when a capsule build actually needs them; production builds still fail
  // closed if the module does not have a file-backed identity.
  const workerPath = fileURLToPath(
    new URL("./mcp-stdio-capsule-builder-worker.cjs", import.meta.url),
  );
  const resolverPath = fileURLToPath(
    new URL("./mcp-stdio-immutable-vfs-resolver.cjs", import.meta.url),
  );
  const realpath = _deps.fs.realpathSync.native || _deps.fs.realpathSync;
  const packageJsonPath = realpath(
    require.resolve("esbuild-wasm/package.json"),
  );
  const packageRoot = path.dirname(packageJsonPath);
  const packageJsonAsset = readSnapshotInputAttestation(
    packageRoot,
    "package.json",
  );
  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonAsset.content.toString("utf8"));
  } catch {
    throw new Error("MCP capsule builder package identity is invalid");
  }
  if (
    packageJson.name !== CAPSULE_BUILDER ||
    packageJson.version !== CAPSULE_BUILDER_VERSION
  ) {
    throw new Error(
      `MCP capsule builder must be ${CAPSULE_BUILDER}@${CAPSULE_BUILDER_VERSION}`,
    );
  }
  const api = readPinnedCapsuleAsset({
    root: packageRoot,
    relativePath: "lib/browser.js",
    bytes: CAPSULE_BUILDER_API_BYTES,
    sha256: CAPSULE_BUILDER_API_SHA256,
    label: "MCP capsule builder API",
  });
  const wasm = readPinnedCapsuleAsset({
    root: packageRoot,
    relativePath: "esbuild.wasm",
    bytes: CAPSULE_BUILDER_WASM_BYTES,
    sha256: CAPSULE_BUILDER_WASM_SHA256,
    label: "MCP capsule builder WASM",
  });
  const worker = readPinnedCapsuleAsset({
    root: path.dirname(workerPath),
    relativePath: path.basename(workerPath),
    bytes: CAPSULE_BUILDER_WORKER_BYTES,
    sha256: CAPSULE_BUILDER_WORKER_SHA256,
    label: "MCP capsule builder Worker",
  });
  const resolver = readPinnedCapsuleAsset({
    root: path.dirname(resolverPath),
    relativePath: path.basename(resolverPath),
    bytes: CAPSULE_RESOLVER_BYTES,
    sha256: CAPSULE_RESOLVER_SHA256,
    label: "MCP capsule immutable VFS resolver",
  });
  return Object.freeze({
    apiSource: api.content.toString("utf8"),
    apiBytes: api.bytes,
    apiSha256: api.sha256,
    wasmBytes: wasm.content,
    wasmSha256: wasm.sha256,
    workerSource: worker.content.toString("utf8"),
    workerSha256: worker.sha256,
    resolverSource: resolver.content.toString("utf8"),
    resolverSha256: resolver.sha256,
  });
}

function capsuleWorkerError(payload) {
  const error = new Error(
    String(payload?.message || "MCP capsule builder Worker failed").slice(
      0,
      8_000,
    ),
  );
  error.name = String(payload?.name || "Error").slice(0, 200);
  if (typeof payload?.code === "string") error.code = payload.code;
  if (typeof payload?.stack === "string") error.stack = payload.stack;
  return error;
}

async function runCapsuleBuilderWorker({
  builder,
  files,
  fileCount,
  totalBytes,
  entryPath,
  vfsRoot,
  banner,
}) {
  const nonce = crypto.randomBytes(32).toString("hex");
  const transferList = [builder.wasmBytes.buffer];
  for (const record of files) transferList.push(record[1].buffer);
  let worker;
  let timer;
  const listeners = {};
  try {
    worker = new _deps.Worker(builder.workerSource, {
      eval: true,
      resourceLimits: {
        maxOldGenerationSizeMb: CAPSULE_WORKER_MAX_OLD_GENERATION_MB,
        maxYoungGenerationSizeMb: 64,
        stackSizeMb: 8,
      },
      transferList,
      workerData: {
        schema: CAPSULE_WORKER_SCHEMA,
        nonce,
        browserApiSource: builder.apiSource,
        resolverSource: builder.resolverSource,
        wasmBytes: builder.wasmBytes,
        builderVersion: CAPSULE_BUILDER_VERSION,
        files,
        fileCount,
        totalBytes,
        entryPath,
        vfsRoot,
        banner,
        maxOutputBytes: MAX_CAPSULE_BYTES,
        maxMetafileBytes: 16 * 1024 * 1024,
      },
    });
    return await new Promise((resolve, reject) => {
      let settled = false;
      let terminal = null;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      listeners.message = (message) => {
        if (terminal) {
          fail(
            new Error(
              "MCP capsule builder Worker emitted two terminal messages",
            ),
          );
          return;
        }
        if (!message || message.nonce !== nonce) {
          fail(new Error("MCP capsule builder Worker nonce mismatch"));
          return;
        }
        terminal = message;
      };
      listeners.messageerror = () => {
        fail(new Error("MCP capsule builder Worker message was not cloneable"));
      };
      listeners.error = (error) => fail(error);
      listeners.exit = (code) => {
        if (settled) return;
        if (code !== 0) {
          fail(
            new Error(`MCP capsule builder Worker exited with status ${code}`),
          );
          return;
        }
        if (!terminal) {
          fail(new Error("MCP capsule builder Worker exited without a result"));
          return;
        }
        if (terminal.ok !== true) {
          fail(capsuleWorkerError(terminal.error));
          return;
        }
        settled = true;
        resolve(terminal);
      };
      worker.on("message", listeners.message);
      worker.once("messageerror", listeners.messageerror);
      worker.once("error", listeners.error);
      worker.once("exit", listeners.exit);
      timer = setTimeout(() => {
        fail(new Error("MCP capsule builder Worker timed out"));
      }, CAPSULE_BUILD_TIMEOUT_MS);
      timer.unref?.();
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (worker) {
      if (listeners.message) worker.off("message", listeners.message);
      if (listeners.messageerror) {
        worker.off("messageerror", listeners.messageerror);
      }
      if (listeners.error) worker.off("error", listeners.error);
      if (listeners.exit) worker.off("exit", listeners.exit);
      await worker.terminate();
    }
  }
}

function capsuleRuntimeGuard() {
  return `;(() => {
  const Module = require("node:module");
  const known = new Set(Module.builtinModules.flatMap((name) => [name, name.startsWith("node:") ? name : "node:" + name]));
  const allowed = new Set(${CAPSULE_BUILTIN_ALLOWLIST_MARKER});
  const originalLoad = Module._load;
  const originalResolveFilename = Module._resolveFilename;
  const blocked = (kind, request) => {
    const error = new Error("MCP stdio capsule blocked " + kind + (request === undefined ? "" : ": " + String(request)));
    error.code = kind === "native module loading"
      ? "CC_MCP_STDIO_NATIVE_MODULE_BLOCKED"
      : kind === "builtin module loading" || kind === "internal binding loading"
        ? "CC_MCP_STDIO_BUILTIN_MODULE_BLOCKED"
        : "CC_MCP_STDIO_EXTERNAL_MODULE_BLOCKED";
    throw error;
  };
  const assertAllowedModule = (kind, request) => {
    if (typeof request !== "string") blocked(kind, request);
    if (known.has(request) && !allowed.has(request)) {
      blocked("builtin module loading", request);
    }
    if (!known.has(request)) blocked(kind, request);
  };
  Object.defineProperty(Module, "_load", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: function(request) {
      assertAllowedModule("external module loading", request);
      return Reflect.apply(originalLoad, this, arguments);
    },
  });
  Object.defineProperty(Module, "_resolveFilename", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: function(request) {
      assertAllowedModule("external module resolution", request);
      return Reflect.apply(originalResolveFilename, this, arguments);
    },
  });
  if (typeof process.getBuiltinModule === "function") {
    const originalGetBuiltinModule = process.getBuiltinModule;
    Object.defineProperty(process, "getBuiltinModule", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: function(request) {
        if (typeof request !== "string" || !allowed.has(request)) {
          blocked("builtin module loading", request);
        }
        return Reflect.apply(originalGetBuiltinModule, this, arguments);
      },
    });
  }
  for (const bindingName of ["binding", "_linkedBinding"]) {
    if (typeof process[bindingName] !== "function") continue;
    Object.defineProperty(process, bindingName, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: function(request) { blocked("internal binding loading", request); },
    });
  }
  Object.defineProperty(process, "dlopen", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: function() { blocked("native module loading"); },
  });
})();`;
}

function expandBuiltinAllowlist(externalBuiltins) {
  const allowed = new Set();
  for (const name of externalBuiltins) {
    const canonical = name.startsWith("node:") ? name.slice(5) : name;
    allowed.add(canonical);
    allowed.add(`node:${canonical}`);
  }
  return Object.freeze([...allowed].sort());
}

function executionContextBuiltins(externalBuiltins) {
  return Object.freeze(
    [
      ...new Set(
        externalBuiltins
          .map((name) => (name.startsWith("node:") ? name.slice(5) : name))
          .filter((name) => CAPSULE_EXECUTION_CONTEXT_BUILTINS.has(name))
          .map((name) => `node:${name}`),
      ),
    ].sort(),
  );
}

function bindCapsuleBuiltinAllowlist(outputBytes, allowedBuiltins) {
  const source = Buffer.from(
    outputBytes.buffer,
    outputBytes.byteOffset,
    outputBytes.byteLength,
  ).toString("utf8");
  const markerCount = source.split(CAPSULE_BUILTIN_ALLOWLIST_MARKER).length - 1;
  if (markerCount !== 1) {
    throw new Error(
      "MCP capsule output did not retain exactly one host builtin-policy marker",
    );
  }
  const output = Buffer.from(
    source.replace(
      CAPSULE_BUILTIN_ALLOWLIST_MARKER,
      JSON.stringify(allowedBuiltins),
    ),
    "utf8",
  );
  if (output.length <= 0 || output.length > MAX_CAPSULE_BYTES) {
    throw new Error("MCP capsule output exceeds its post-policy byte limit");
  }
  return output;
}

export function esbuildRelativeEntrypointArg(
  entrypointRelative,
  canonicalSnapshotRoot,
  canonicalEntrypoint,
) {
  if (
    typeof entrypointRelative !== "string" ||
    entrypointRelative.length === 0 ||
    entrypointRelative.includes("\0") ||
    entrypointRelative.includes("\\") ||
    path.posix.isAbsolute(entrypointRelative) ||
    /^[A-Za-z]:/.test(entrypointRelative) ||
    path.posix.normalize(entrypointRelative) !== entrypointRelative ||
    entrypointRelative === "." ||
    entrypointRelative === ".." ||
    entrypointRelative.startsWith("../")
  ) {
    throw new Error(
      "MCP capsule entrypoint must be one canonical relative POSIX path",
    );
  }
  for (const [label, candidate] of [
    ["snapshot root", canonicalSnapshotRoot],
    ["entrypoint", canonicalEntrypoint],
  ]) {
    if (
      typeof candidate !== "string" ||
      candidate.includes("\0") ||
      !path.isAbsolute(candidate) ||
      path.normalize(candidate) !== candidate
    ) {
      throw new Error(`MCP capsule ${label} must be canonical and absolute`);
    }
  }
  const reboundRelative = path
    .relative(canonicalSnapshotRoot, canonicalEntrypoint)
    .split(path.sep)
    .join("/");
  if (reboundRelative !== entrypointRelative) {
    throw new Error("MCP capsule entrypoint escaped its canonical snapshot");
  }
  // This is a logical source label for esbuild's stdin mode, not a positional
  // entrypoint. Positional node_modules paths are package-classified by the
  // native Windows CLI even when they are absolute or repeatedly prefixed.
  return entrypointRelative;
}

async function buildCapsule({
  treeRoot,
  entrypointRelative,
  closure,
  staging,
}) {
  const capsuleRoot = path.join(staging, "capsule");
  const capsulePath = path.join(staging, ...CAPSULE_RELATIVE_PATH.split("/"));
  const realpath = _deps.fs.realpathSync.native || _deps.fs.realpathSync;
  const canonicalTreeRoot = realpath(treeRoot);
  const vfsRoot = "/chainlesschain-source";
  const wrapperRelative = "__chainlesschain_capsule_entry__.cjs";
  const wrapperPath = `${vfsRoot}/${wrapperRelative}`;
  const maxOutputBytes = MAX_CAPSULE_BYTES;
  const maxMetafileBytes = 16 * 1024 * 1024;
  _deps.fs.mkdirSync(capsuleRoot, { recursive: false, mode: 0o700 });
  const sourceEntrypoint = resolveContainedPath(
    canonicalTreeRoot,
    entrypointRelative,
    "MCP capsule entrypoint",
  );
  const canonicalEntrypoint = realpath(sourceEntrypoint);
  const boundEntrypointRelative = esbuildRelativeEntrypointArg(
    entrypointRelative,
    canonicalTreeRoot,
    canonicalEntrypoint,
  );
  if (closure.files.some((record) => record.path === wrapperRelative)) {
    throw new Error("MCP capsule source collides with its host wrapper");
  }

  const closureByPath = new Map(
    closure.files.map((record) => [record.path, record]),
  );
  const expectedByVfsPath = new Map();
  const workerFiles = [];
  for (const record of closure.files) {
    const observed = readSnapshotInputAttestation(
      canonicalTreeRoot,
      record.path,
    );
    if (
      observed.bytes !== record.bytes ||
      observed.sha256 !== record.sha256 ||
      materializationFileMode(observed.identity.mode) !== record.mode
    ) {
      throw new Error(
        `MCP capsule build input changed before capture: ${record.path}`,
      );
    }
    const vfsPath = `${vfsRoot}/${record.path}`;
    expectedByVfsPath.set(vfsPath, record);
    workerFiles.push([vfsPath, observed.content]);
  }
  if (!closureByPath.has(entrypointRelative)) {
    throw new Error("MCP capsule entrypoint is outside its closure");
  }
  const wrapperSpecifier = `./${boundEntrypointRelative}`;
  const wrapperSource = Buffer.from(
    `"use strict";\nrequire(${JSON.stringify(wrapperSpecifier)});\n`,
    "utf8",
  );
  const ownedWrapperSource = Buffer.allocUnsafeSlow(wrapperSource.length);
  wrapperSource.copy(ownedWrapperSource);
  const wrapperBytes = ownedWrapperSource.length;
  const wrapperSha256 = sha256(ownedWrapperSource);
  expectedByVfsPath.set(wrapperPath, {
    path: wrapperRelative,
    bytes: wrapperBytes,
    sha256: wrapperSha256,
    wrapper: true,
  });
  workerFiles.push([wrapperPath, ownedWrapperSource]);

  const builder = resolvePinnedCapsuleBuilder();
  if (typeof _deps.onVfsSnapshotCaptured === "function") {
    await _deps.onVfsSnapshotCaptured(
      Object.freeze({
        treeRoot: canonicalTreeRoot,
        fileCount: closure.fileCount,
        totalBytes: closure.totalBytes,
        closureDigest: closure.closureDigest,
      }),
    );
  }
  const result = await runCapsuleBuilderWorker({
    builder,
    files: workerFiles,
    fileCount: workerFiles.length,
    totalBytes: closure.totalBytes + wrapperBytes,
    entryPath: wrapperPath,
    vfsRoot,
    banner: capsuleRuntimeGuard(),
  });
  if (
    !(result.output instanceof Uint8Array) ||
    result.output.byteLength <= 0 ||
    result.output.byteLength > maxOutputBytes ||
    !result.metafile ||
    typeof result.metafile !== "object" ||
    !result.metafile.inputs ||
    typeof result.metafile.inputs !== "object" ||
    !result.metafile.outputs ||
    typeof result.metafile.outputs !== "object" ||
    Buffer.byteLength(JSON.stringify(result.metafile)) > maxMetafileBytes ||
    !Array.isArray(result.warnings) ||
    result.warnings.length !== 0 ||
    !result.audit ||
    result.audit.root !== vfsRoot ||
    result.audit.fileCount !== workerFiles.length ||
    !Array.isArray(result.audit.loaded) ||
    !Array.isArray(result.audit.resolutions)
  ) {
    throw new Error("MCP capsule builder Worker result is invalid");
  }

  const metafileInputs = new Map();
  for (const [input, metadata] of Object.entries(result.metafile.inputs)) {
    const prefix = "cc-immutable-vfs:";
    if (!input.startsWith(prefix)) {
      throw new Error(`MCP capsule build reported a non-VFS input: ${input}`);
    }
    const vfsPath = input.slice(prefix.length);
    if (
      !vfsPath.startsWith(`${vfsRoot}/`) ||
      path.posix.normalize(vfsPath) !== vfsPath ||
      metafileInputs.has(vfsPath) ||
      !metadata ||
      typeof metadata !== "object"
    ) {
      throw new Error(`MCP capsule build reported an unsafe input: ${input}`);
    }
    metafileInputs.set(vfsPath, metadata);
  }
  const loaded = [...result.audit.loaded];
  if (
    new Set(loaded).size !== loaded.length ||
    loaded.some(
      (input) =>
        typeof input !== "string" ||
        !input.startsWith(`${vfsRoot}/`) ||
        path.posix.normalize(input) !== input,
    ) ||
    canonicalJson([...metafileInputs.keys()].sort()) !==
      canonicalJson([...loaded].sort())
  ) {
    throw new Error("MCP capsule metafile did not match immutable VFS loads");
  }
  const inputs = loaded
    .filter((input) => input !== wrapperPath)
    .sort()
    .map((input) => {
      const expected = expectedByVfsPath.get(input);
      const metadata = metafileInputs.get(input);
      if (!expected || expected.wrapper || metadata?.bytes !== expected.bytes) {
        throw new Error(`MCP capsule build used an unattested input: ${input}`);
      }
      return {
        path: expected.path,
        bytes: expected.bytes,
        sha256: expected.sha256,
      };
    });
  const wrapperMetadata = metafileInputs.get(wrapperPath);
  if (
    wrapperMetadata?.bytes !== wrapperBytes ||
    !inputs.some((input) => input.path === entrypointRelative)
  ) {
    throw new Error("MCP capsule build did not bind its approved entrypoint");
  }

  const externalBuiltins = [];
  if (Object.keys(result.metafile.outputs).length !== 1) {
    throw new Error("MCP capsule build emitted an invalid output graph");
  }
  for (const output of Object.values(result.metafile.outputs)) {
    if (!output || typeof output !== "object") {
      throw new Error("MCP capsule build metadata is invalid");
    }
    for (const imported of output.imports || []) {
      if (!imported.external || !NODE_BUILTINS.has(imported.path)) {
        throw new Error(
          `MCP capsule build retained an external dependency: ${imported.path}`,
        );
      }
      externalBuiltins.push(imported.path);
    }
  }
  for (const resolution of result.audit.resolutions) {
    if (
      !resolution ||
      typeof resolution !== "object" ||
      (resolution.external === true
        ? !NODE_BUILTINS.has(resolution.path)
        : !expectedByVfsPath.has(resolution.path))
    ) {
      throw new Error("MCP capsule resolver audit is invalid");
    }
  }

  const normalizedExternalBuiltins = Object.freeze(
    [...new Set(externalBuiltins)].sort(),
  );
  const allowedBuiltins = expandBuiltinAllowlist(normalizedExternalBuiltins);
  const transitiveBuiltins = executionContextBuiltins(
    normalizedExternalBuiltins,
  );
  const output = bindCapsuleBuiltinAllowlist(result.output, allowedBuiltins);
  let descriptor;
  try {
    descriptor = _deps.fs.openSync(
      capsulePath,
      Number(_deps.fs.constants.O_WRONLY) |
        Number(_deps.fs.constants.O_CREAT) |
        Number(_deps.fs.constants.O_EXCL) |
        Number(_deps.fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    let offset = 0;
    while (offset < output.length) {
      const written = _deps.fs.writeSync(
        descriptor,
        output,
        offset,
        output.length - offset,
        offset,
      );
      if (written <= 0) throw new Error("MCP capsule output write stalled");
      offset += written;
    }
    _deps.fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) _deps.fs.closeSync(descriptor);
  }

  const postBuildClosure = collectTree(treeRoot);
  if (
    postBuildClosure.fileCount !== closure.fileCount ||
    postBuildClosure.totalBytes !== closure.totalBytes ||
    postBuildClosure.closureDigest !== closure.closureDigest ||
    canonicalJson(postBuildClosure.files) !== canonicalJson(closure.files)
  ) {
    throw new Error("MCP package dependency closure changed during bundling");
  }
  const capsuleClosure = collectTree(capsuleRoot, {
    maxFiles: 1,
    maxTotalBytes: MAX_CAPSULE_BYTES,
    maxFileBytes: MAX_CAPSULE_BYTES,
  });
  if (
    capsuleClosure.fileCount !== 1 ||
    capsuleClosure.files[0]?.path !== path.basename(capsulePath)
  ) {
    throw new Error("MCP capsule output is not one regular file");
  }
  return Object.freeze({
    schema: CAPSULE_SCHEMA,
    relativePath: CAPSULE_RELATIVE_PATH,
    sha256: capsuleClosure.files[0].sha256,
    bytes: capsuleClosure.files[0].bytes,
    closureDigest: capsuleClosure.closureDigest,
    builder: CAPSULE_BUILDER,
    builderVersion: CAPSULE_BUILDER_VERSION,
    builderWasmSha256: builder.wasmSha256,
    builderApiSha256: builder.apiSha256,
    builderWorkerSha256: builder.workerSha256,
    resolverSchema: CAPSULE_RESOLVER_SCHEMA,
    resolverSha256: builder.resolverSha256,
    wrapperSchema: CAPSULE_STDIN_WRAPPER_SCHEMA,
    wrapperSha256,
    nodeTarget: "node22",
    inputCount: inputs.length,
    inputDigest: sha256(canonicalJson(inputs)),
    externalBuiltins: normalizedExternalBuiltins,
    builtinPolicy: Object.freeze({
      schema: CAPSULE_BUILTIN_POLICY_SCHEMA,
      mode: "static-external-only",
      allowedBuiltins,
      executionContextBuiltins: transitiveBuiltins,
      transitiveIsolation:
        transitiveBuiltins.length > 0
          ? CAPSULE_EXECUTION_CONTEXT_ISOLATION
          : "not-required",
    }),
  });
}

function assertSafeGeneration(root, generation) {
  if (typeof generation !== "string" || !/^[a-f0-9]{64}$/.test(generation)) {
    throw new TypeError("MCP materialization generation is invalid");
  }
  const directory = path.resolve(root, generation);
  const relative = path.relative(path.resolve(root), directory);
  if (relative !== generation || path.isAbsolute(relative)) {
    throw new TypeError("MCP materialization generation escapes its root");
  }
  return directory;
}

function validateManifest(manifest) {
  if (
    manifest?.schema !== MATERIALIZATION_SCHEMA ||
    manifest.version !== MATERIALIZATION_VERSION ||
    typeof manifest.sourceFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceFingerprint) ||
    typeof manifest.generation !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.generation) ||
    typeof manifest.package?.name !== "string" ||
    typeof manifest.package?.version !== "string" ||
    !EXACT_VERSION.test(manifest.package.version) ||
    typeof manifest.lockSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.lockSha256) ||
    typeof manifest.entrypointRelative !== "string" ||
    manifest.capsule?.schema !== CAPSULE_SCHEMA ||
    manifest.capsule?.relativePath !== CAPSULE_RELATIVE_PATH ||
    typeof manifest.capsule?.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.capsule.sha256) ||
    !Number.isSafeInteger(manifest.capsule?.bytes) ||
    manifest.capsule.bytes <= 0 ||
    manifest.capsule.bytes > MAX_CAPSULE_BYTES ||
    typeof manifest.capsule?.closureDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.capsule.closureDigest) ||
    manifest.capsule?.builder !== CAPSULE_BUILDER ||
    manifest.capsule?.builderVersion !== CAPSULE_BUILDER_VERSION ||
    manifest.capsule?.builderWasmSha256 !== CAPSULE_BUILDER_WASM_SHA256 ||
    manifest.capsule?.builderApiSha256 !== CAPSULE_BUILDER_API_SHA256 ||
    manifest.capsule?.builderWorkerSha256 !== CAPSULE_BUILDER_WORKER_SHA256 ||
    manifest.capsule?.resolverSchema !== CAPSULE_RESOLVER_SCHEMA ||
    manifest.capsule?.resolverSha256 !== CAPSULE_RESOLVER_SHA256 ||
    manifest.capsule?.wrapperSchema !== CAPSULE_STDIN_WRAPPER_SCHEMA ||
    typeof manifest.capsule?.wrapperSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.capsule.wrapperSha256) ||
    manifest.capsule?.nodeTarget !== "node22" ||
    !Number.isSafeInteger(manifest.capsule?.inputCount) ||
    manifest.capsule.inputCount <= 0 ||
    typeof manifest.capsule?.inputDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.capsule.inputDigest) ||
    !Array.isArray(manifest.capsule?.externalBuiltins) ||
    manifest.capsule.externalBuiltins.some(
      (name) => typeof name !== "string" || !NODE_BUILTINS.has(name),
    ) ||
    manifest.capsule?.builtinPolicy?.schema !== CAPSULE_BUILTIN_POLICY_SCHEMA ||
    manifest.capsule?.builtinPolicy?.mode !== "static-external-only" ||
    !Array.isArray(manifest.capsule?.builtinPolicy?.allowedBuiltins) ||
    manifest.capsule.builtinPolicy.allowedBuiltins.some(
      (name) => typeof name !== "string" || !NODE_BUILTINS.has(name),
    ) ||
    !Array.isArray(manifest.capsule?.builtinPolicy?.executionContextBuiltins) ||
    manifest.capsule.builtinPolicy.executionContextBuiltins.some(
      (name) =>
        typeof name !== "string" ||
        !name.startsWith("node:") ||
        !CAPSULE_EXECUTION_CONTEXT_BUILTINS.has(name.slice(5)),
    ) ||
    !["not-required", CAPSULE_EXECUTION_CONTEXT_ISOLATION].includes(
      manifest.capsule?.builtinPolicy?.transitiveIsolation,
    ) ||
    !Array.isArray(manifest.files) ||
    !Number.isSafeInteger(manifest.fileCount) ||
    !Number.isSafeInteger(manifest.totalBytes) ||
    typeof manifest.closureDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.closureDigest)
  ) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "MCP package materialization manifest is invalid",
    );
  }
  if (
    manifest.fileCount !== manifest.files.length ||
    manifest.files.length > MAX_FILES ||
    manifest.totalBytes > MAX_TOTAL_BYTES ||
    manifest.capsule.inputCount > manifest.fileCount ||
    canonicalJson(manifest.capsule.externalBuiltins) !==
      canonicalJson([...new Set(manifest.capsule.externalBuiltins)].sort()) ||
    canonicalJson(manifest.capsule.builtinPolicy.allowedBuiltins) !==
      canonicalJson(
        expandBuiltinAllowlist(manifest.capsule.externalBuiltins),
      ) ||
    canonicalJson(manifest.capsule.builtinPolicy.executionContextBuiltins) !==
      canonicalJson(
        executionContextBuiltins(manifest.capsule.externalBuiltins),
      ) ||
    manifest.capsule.builtinPolicy.transitiveIsolation !==
      (manifest.capsule.builtinPolicy.executionContextBuiltins.length > 0
        ? CAPSULE_EXECUTION_CONTEXT_ISOLATION
        : "not-required") ||
    sha256(canonicalJson(manifest.files)) !== manifest.closureDigest
  ) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "MCP package materialization manifest closure is invalid",
    );
  }
  return manifest;
}

function verifyPublishedGeneration(root, record, expectedFingerprint) {
  const generationRoot = assertSafeGeneration(root, record.generation);
  const manifestPath = path.join(generationRoot, "manifest.json");
  const manifest = validateManifest(readJson(manifestPath, MANIFEST_LABEL));
  if (
    manifest.generation !== record.generation ||
    manifest.sourceFingerprint !== expectedFingerprint ||
    sha256(canonicalJson(manifest)) !== record.manifestDigest
  ) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE,
      "MCP package materialization authority or manifest changed",
    );
  }
  const treeRoot = path.join(generationRoot, "tree");
  let observed;
  try {
    observed = collectTree(treeRoot);
  } catch (cause) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE,
      `MCP package materialization could not be re-attested: ${cause.message}`,
      { cause },
    );
  }
  if (
    observed.fileCount !== manifest.fileCount ||
    observed.totalBytes !== manifest.totalBytes ||
    observed.closureDigest !== manifest.closureDigest ||
    canonicalJson(observed.files) !== canonicalJson(manifest.files)
  ) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE,
      "MCP package materialization dependency closure changed",
    );
  }
  let sourceEntrypoint;
  let entrypoint;
  try {
    sourceEntrypoint = resolveContainedPath(
      treeRoot,
      manifest.entrypointRelative,
      "MCP package materialization source entrypoint",
    );
    entrypoint = resolveContainedPath(
      generationRoot,
      manifest.capsule.relativePath,
      "MCP package materialization capsule",
    );
  } catch (cause) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      cause.message,
      { cause },
    );
  }
  if (
    !manifest.files.some(
      (file) =>
        file.path === manifest.entrypointRelative &&
        resolveContainedPath(
          treeRoot,
          file.path,
          "MCP package materialization source file",
        ) === sourceEntrypoint,
    )
  ) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "MCP package materialization source entrypoint is outside its closure",
    );
  }
  const capsuleRoot = path.dirname(entrypoint);
  let capsuleClosure;
  try {
    capsuleClosure = collectTree(capsuleRoot, {
      maxFiles: 1,
      maxTotalBytes: MAX_CAPSULE_BYTES,
      maxFileBytes: MAX_CAPSULE_BYTES,
    });
  } catch (cause) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE,
      `MCP package capsule could not be re-attested: ${cause.message}`,
      { cause },
    );
  }
  if (
    capsuleClosure.fileCount !== 1 ||
    capsuleClosure.totalBytes !== manifest.capsule.bytes ||
    capsuleClosure.closureDigest !== manifest.capsule.closureDigest ||
    capsuleClosure.files[0]?.path !== path.basename(entrypoint) ||
    capsuleClosure.files[0]?.sha256 !== manifest.capsule.sha256
  ) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE,
      "MCP package capsule changed",
    );
  }
  return Object.freeze({
    generationRoot,
    treeRoot,
    capsuleRoot,
    entrypoint,
    manifest: Object.freeze(manifest),
    identity: Object.freeze({
      schema: MATERIALIZATION_SCHEMA,
      sourceFingerprint: manifest.sourceFingerprint,
      generation: manifest.generation,
      package: Object.freeze({ ...manifest.package }),
      binName: manifest.binName,
      lockSha256: manifest.lockSha256,
      packageCount: manifest.packageCount,
      entrypointRelative: manifest.entrypointRelative,
      capsule: Object.freeze({
        ...manifest.capsule,
        externalBuiltins: Object.freeze([...manifest.capsule.externalBuiltins]),
        builtinPolicy: Object.freeze({
          ...manifest.capsule.builtinPolicy,
          allowedBuiltins: Object.freeze([
            ...manifest.capsule.builtinPolicy.allowedBuiltins,
          ]),
          executionContextBuiltins: Object.freeze([
            ...manifest.capsule.builtinPolicy.executionContextBuiltins,
          ]),
        }),
      }),
      closureDigest: manifest.closureDigest,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
    }),
  });
}

export async function materializeMcpStdioNpmPackage({
  approvalRecord,
  config,
  packageSpec,
  binName,
  root: explicitRoot,
  indexPath: explicitIndexPath,
  npmCli: explicitNpmCli,
  installRunner = defaultInstallRunner,
  processBrokerRunSync,
  env = process.env,
  now = Date.now(),
}) {
  if (
    !approvalRecord ||
    typeof approvalRecord.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(approvalRecord.fingerprint)
  ) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "MCP package materialization requires a valid execution approval",
    );
  }
  const source = parseNpmPackageLauncherInvocation(config, packageSpec);
  const root = getMcpStdioPackageMaterializationRoot({ root: explicitRoot });
  const indexPath = getMcpStdioPackageMaterializationIndexPath({
    indexPath: explicitIndexPath,
  });
  _deps.fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const staging = path.join(root, `.staging-${crypto.randomUUID()}`);
  const treeRoot = path.join(staging, "tree");
  let published = false;
  try {
    _deps.fs.mkdirSync(treeRoot, { recursive: true, mode: 0o700 });
    writeSecurityStore(
      path.join(treeRoot, "package.json"),
      "MCP npm materialization root package",
      {
        name: "chainlesschain-mcp-materialization",
        version: "1.0.0",
        private: true,
        dependencies: { [source.name]: source.version },
      },
    );
    installRunner({
      directory: treeRoot,
      packageSpec: source.spec,
      npmCli: resolveNpmCli({ npmCli: explicitNpmCli }),
      env,
      processBrokerRunSync,
    });
    const lock = validateNpmLock(treeRoot, source);
    const entry = resolvePackageEntrypoint(treeRoot, source, binName);
    const closure = collectTree(treeRoot);
    const capsule = await buildCapsule({
      treeRoot,
      entrypointRelative: entry.entrypointRelative,
      closure,
      staging,
    });
    const generation = sha256(
      canonicalJson({
        sourceFingerprint: approvalRecord.fingerprint,
        package: source.spec,
        binName: entry.binName,
        passthroughArgs: source.passthroughArgs,
        lockSha256: lock.lockSha256,
        closureDigest: closure.closureDigest,
        capsule,
      }),
    );
    const manifest = {
      schema: MATERIALIZATION_SCHEMA,
      version: MATERIALIZATION_VERSION,
      generation,
      sourceFingerprint: approvalRecord.fingerprint,
      package: { name: source.name, version: source.version },
      binName: entry.binName,
      passthroughArgs: [...source.passthroughArgs],
      lockSha256: lock.lockSha256,
      packageCount: lock.packageCount,
      entrypointRelative: entry.entrypointRelative,
      capsule,
      closureDigest: closure.closureDigest,
      fileCount: closure.fileCount,
      totalBytes: closure.totalBytes,
      files: closure.files,
    };
    const manifestDigest = sha256(canonicalJson(manifest));
    writeSecurityStore(
      path.join(staging, "manifest.json"),
      MANIFEST_LABEL,
      manifest,
    );
    const generationRoot = assertSafeGeneration(root, generation);
    try {
      _deps.fs.renameSync(staging, generationRoot);
      published = true;
    } catch (cause) {
      // Windows reports EPERM rather than EEXIST when the destination
      // generation already exists. Never classify by errno alone: only an
      // actually present destination may enter the exact verification path.
      if (!_deps.fs.existsSync(generationRoot)) throw cause;
    }
    const record = {
      generation,
      manifestDigest,
      packageSpec: source.spec,
      materializedAt: new Date(now).toISOString(),
    };
    const verified = verifyPublishedGeneration(
      root,
      record,
      approvalRecord.fingerprint,
    );
    mutateSecurityStore(indexPath, INDEX_LABEL, (index) => {
      index[approvalRecord.fingerprint] = record;
    });
    return Object.freeze({
      status: "materialized",
      generation,
      manifestDigest,
      root: verified.generationRoot,
      identity: verified.identity,
    });
  } catch (cause) {
    if (cause?.code?.startsWith?.("CC_MCP_STDIO_PACKAGE_")) throw cause;
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_FAILED_CODE,
      `MCP fixed package materialization failed: ${cause.message}`,
      { cause },
    );
  } finally {
    if (!published && _deps.fs.existsSync(staging)) {
      _deps.fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}

export function resolveMcpStdioPackageMaterialization({
  approvalRecord,
  root: explicitRoot,
  indexPath: explicitIndexPath,
}) {
  const fingerprint = approvalRecord?.fingerprint;
  if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_REQUIRED_CODE,
      "MCP dynamic launcher requires a valid fixed package materialization approval",
    );
  }
  const indexPath = getMcpStdioPackageMaterializationIndexPath({
    indexPath: explicitIndexPath,
  });
  const index = readSecurityStore(indexPath, INDEX_LABEL);
  const record = index[fingerprint];
  if (!record) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_REQUIRED_CODE,
      "MCP dynamic launcher has no fixed package generation; run 'cc mcp materialize-package <name>'",
    );
  }
  const root = getMcpStdioPackageMaterializationRoot({ root: explicitRoot });
  const verified = verifyPublishedGeneration(root, record, fingerprint);
  return Object.freeze({
    command: process.execPath,
    args: Object.freeze([
      verified.entrypoint,
      ...(verified.manifest.passthroughArgs || []),
    ]),
    identity: verified.identity,
    generationRoot: verified.generationRoot,
    treeRoot: verified.treeRoot,
    capsuleRoot: verified.capsuleRoot,
    manifestDigest: record.manifestDigest,
  });
}

export function reattestMcpStdioPackageMaterialization(materialization) {
  if (
    !materialization ||
    typeof materialization !== "object" ||
    typeof materialization.generationRoot !== "string" ||
    typeof materialization.manifestDigest !== "string" ||
    typeof materialization.identity?.generation !== "string"
  ) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE,
      "MCP package materialization launch authority is invalid",
    );
  }
  const root = path.dirname(materialization.generationRoot);
  const record = {
    generation: materialization.identity.generation,
    manifestDigest: materialization.manifestDigest,
  };
  const verified = verifyPublishedGeneration(
    root,
    record,
    materialization.identity.sourceFingerprint,
  );
  if (
    canonicalJson(verified.identity) !== canonicalJson(materialization.identity)
  ) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE,
      "MCP package materialization identity changed before spawn",
    );
  }
  return verified;
}
