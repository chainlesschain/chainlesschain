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
  "chainlesschain.mcp-stdio-package-materialization/v2";
const MATERIALIZATION_VERSION = 2;
const CAPSULE_SCHEMA = "chainlesschain.mcp-stdio-node-capsule/v1";
const CAPSULE_RELATIVE_PATH = "capsule/server.cjs";
const CAPSULE_BUILDER = "esbuild";
const CAPSULE_BUILDER_VERSION = "0.28.1";
const CAPSULE_STDIN_WRAPPER_SCHEMA =
  "chainlesschain.mcp-stdio-capsule-stdin-wrapper/v1";
const CAPSULE_STDIN_WRAPPER_SOURCEFILE = "chainlesschain-capsule-entry.cjs";
const CAPSULE_BUILDER_BINARIES = Object.freeze({
  "darwin-arm64": Object.freeze({
    packageName: "@esbuild/darwin-arm64",
    relativePath: "bin/esbuild",
    sha256: "e2dc9a52440a2a34f09434a2f4843cb1e30f84e40dcf238976ec61ef8cd7f36a",
  }),
  "darwin-x64": Object.freeze({
    packageName: "@esbuild/darwin-x64",
    relativePath: "bin/esbuild",
    sha256: "dd53ccf32f9b5b3ab30d41388ef1fc8f81c44ca57ee7a32a7364a1753308d009",
  }),
  "linux-arm64": Object.freeze({
    packageName: "@esbuild/linux-arm64",
    relativePath: "bin/esbuild",
    sha256: "51e829ba36f36be6d9aea6e329ddc4f9350302339b16aaca96a3cb97f64a8ebb",
  }),
  "linux-ia32": Object.freeze({
    packageName: "@esbuild/linux-ia32",
    relativePath: "bin/esbuild",
    sha256:
      "9cd7515a75d6f96b0aa055861cf987888b4765c890501b6274f4bdff4061a5e0d9fd",
  }),
  "linux-x64": Object.freeze({
    packageName: "@esbuild/linux-x64",
    relativePath: "bin/esbuild",
    sha256: "0c6588b092a2c291a72bab90659f3c9e0e25e0fe59c9ac12b4dae4d945e5548c",
  }),
  "win32-arm64": Object.freeze({
    packageName: "@esbuild/win32-arm64",
    relativePath: "esbuild.exe",
    sha256: "bfb8798ab678f1ce4a723739f4a3eabab3244d7a04eeb12be2eb9f58095c13ef",
  }),
  "win32-ia32": Object.freeze({
    packageName: "@esbuild/win32-ia32",
    relativePath: "esbuild.exe",
    sha256: "8fa99b6e0945830fce8d7e208fdb21763aa4aea875751f4a0eec7f6e262af1dd",
  }),
  "win32-x64": Object.freeze({
    packageName: "@esbuild/win32-x64",
    relativePath: "esbuild.exe",
    sha256: "ec02ee9b14ab332416fedd10614dfb80eed5304d94f67745067c011934a8c3c3",
  }),
});
const INDEX_LABEL = "MCP stdio package materialization index";
const MANIFEST_LABEL = "MCP stdio package materialization manifest";
const MAX_FILES = 50_000;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_DEPTH = 64;
const HASH_CHUNK_BYTES = 1024 * 1024;
const EXACT_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

export const _deps = {
  fs,
  processBrokerRunSync: null,
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
      path.join(getCacheDir(), "mcp-stdio-package-materializations-v2"),
  );
}

export function getMcpStdioPackageMaterializationIndexPath(options = {}) {
  return path.resolve(
    options.indexPath ||
      process.env.CC_MCP_PACKAGE_MATERIALIZATION_INDEX ||
      path.join(
        getMachineSecurityAnchorDir(),
        "mcp-stdio-package-materializations-v2.json",
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
    return digest.digest("hex");
  } finally {
    if (descriptor !== undefined) _deps.fs.closeSync(descriptor);
  }
}

function collectTree(root) {
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
      if (stat.size < 0n || stat.size > BigInt(MAX_FILE_BYTES)) {
        throw new Error(
          `materialized file exceeds the size limit: ${relative}`,
        );
      }
      totalBytes += Number(stat.size);
      if (files.length >= MAX_FILES || totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(
          "materialized dependency tree exceeds its aggregate budget",
        );
      }
      files.push({
        path: relative,
        bytes: Number(stat.size),
        mode: Number(stat.mode),
        sha256: hashFile(absolute, Number(stat.size)),
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

function copyAttestedFile(sourceRoot, snapshotRoot, record) {
  const source = resolveContainedPath(
    sourceRoot,
    record.path,
    "MCP capsule source",
  );
  const destination = resolveContainedPath(
    snapshotRoot,
    record.path,
    "MCP capsule snapshot",
  );
  _deps.fs.mkdirSync(path.dirname(destination), {
    recursive: true,
    mode: 0o700,
  });
  let sourceDescriptor;
  let destinationDescriptor;
  try {
    sourceDescriptor = _deps.fs.openSync(
      source,
      Number(_deps.fs.constants.O_RDONLY) |
        Number(_deps.fs.constants.O_NOFOLLOW || 0) |
        Number(_deps.fs.constants.O_NONBLOCK || 0),
    );
    const before = _deps.fs.fstatSync(sourceDescriptor, { bigint: true });
    if (!before.isFile() || before.size !== BigInt(record.bytes)) {
      throw new Error(`MCP capsule source changed before copy: ${record.path}`);
    }
    destinationDescriptor = _deps.fs.openSync(
      destination,
      Number(_deps.fs.constants.O_WRONLY) |
        Number(_deps.fs.constants.O_CREAT) |
        Number(_deps.fs.constants.O_EXCL) |
        Number(_deps.fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    const digest = crypto.createHash("sha256");
    const chunk = Buffer.allocUnsafe(
      Math.max(1, Math.min(record.bytes, HASH_CHUNK_BYTES)),
    );
    let offset = 0;
    while (offset < record.bytes) {
      const count = _deps.fs.readSync(
        sourceDescriptor,
        chunk,
        0,
        Math.min(chunk.length, record.bytes - offset),
        offset,
      );
      if (count <= 0) {
        throw new Error(`MCP capsule source ended during copy: ${record.path}`);
      }
      digest.update(chunk.subarray(0, count));
      let written = 0;
      while (written < count) {
        const writeCount = _deps.fs.writeSync(
          destinationDescriptor,
          chunk,
          written,
          count - written,
          offset + written,
        );
        if (writeCount <= 0) {
          throw new Error(
            `MCP capsule snapshot ended during copy: ${record.path}`,
          );
        }
        written += writeCount;
      }
      offset += count;
    }
    const after = _deps.fs.fstatSync(sourceDescriptor, { bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      digest.digest("hex") !== record.sha256
    ) {
      throw new Error(`MCP capsule source changed during copy: ${record.path}`);
    }
    _deps.fs.fchmodSync(destinationDescriptor, record.mode & 0o777);
    _deps.fs.fsyncSync(destinationDescriptor);
  } finally {
    if (destinationDescriptor !== undefined) {
      _deps.fs.closeSync(destinationDescriptor);
    }
    if (sourceDescriptor !== undefined) _deps.fs.closeSync(sourceDescriptor);
  }
  if (hashFile(destination, record.bytes) !== record.sha256) {
    throw new Error(`MCP capsule snapshot copy is invalid: ${record.path}`);
  }
}

function createAttestedSnapshot(treeRoot, closure, staging) {
  const snapshotRoot = path.join(
    staging,
    `.capsule-source-${crypto.randomUUID()}`,
  );
  _deps.fs.mkdirSync(snapshotRoot, { recursive: false, mode: 0o700 });
  for (const record of closure.files) {
    copyAttestedFile(treeRoot, snapshotRoot, record);
  }
  const observed = collectTree(snapshotRoot);
  if (
    observed.fileCount !== closure.fileCount ||
    observed.totalBytes !== closure.totalBytes ||
    observed.closureDigest !== closure.closureDigest ||
    canonicalJson(observed.files) !== canonicalJson(closure.files)
  ) {
    throw new Error(
      "MCP capsule source snapshot does not match its attestation",
    );
  }
  return snapshotRoot;
}

function resolveCapsuleBuilderBinary() {
  const platform = `${process.platform}-${process.arch}`;
  const expected = CAPSULE_BUILDER_BINARIES[platform];
  if (!expected) {
    throw new Error(`MCP capsule builder does not support ${platform}`);
  }
  const packageJsonPath = require.resolve(
    `${expected.packageName}/package.json`,
  );
  const packageJson = JSON.parse(
    _deps.fs.readFileSync(packageJsonPath, "utf8"),
  );
  if (
    packageJson.name !== expected.packageName ||
    packageJson.version !== CAPSULE_BUILDER_VERSION
  ) {
    throw new Error(
      `MCP capsule builder must be ${expected.packageName}@${CAPSULE_BUILDER_VERSION}`,
    );
  }
  const candidate = path.join(
    path.dirname(packageJsonPath),
    ...expected.relativePath.split("/"),
  );
  const realpath = _deps.fs.realpathSync.native || _deps.fs.realpathSync;
  const binary = realpath(candidate);
  const stat = _deps.fs.lstatSync(binary);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size <= 0 ||
    stat.size > MAX_FILE_BYTES ||
    hashFile(binary, stat.size) !== expected.sha256
  ) {
    throw new Error("MCP capsule builder binary identity is invalid");
  }
  return Object.freeze({
    binary,
    platform,
    sha256: expected.sha256,
  });
}

function capsuleRuntimeGuard() {
  return `;(() => {
  const Module = require("node:module");
  const allowed = new Set(Module.builtinModules.flatMap((name) => [name, name.startsWith("node:") ? name : "node:" + name]));
  const originalLoad = Module._load;
  const blocked = (kind, request) => {
    const error = new Error("MCP stdio capsule blocked " + kind + (request === undefined ? "" : ": " + String(request)));
    error.code = kind === "native module loading" ? "CC_MCP_STDIO_NATIVE_MODULE_BLOCKED" : "CC_MCP_STDIO_EXTERNAL_MODULE_BLOCKED";
    throw error;
  };
  Object.defineProperty(Module, "_load", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: function(request) {
      if (typeof request !== "string" || !allowed.has(request)) blocked("external module loading", request);
      return Reflect.apply(originalLoad, this, arguments);
    },
  });
  Object.defineProperty(process, "dlopen", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: function() { blocked("native module loading"); },
  });
})();`;
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

function buildCapsule({
  treeRoot,
  entrypointRelative,
  closure,
  staging,
  processBrokerRunSync,
  env,
}) {
  const snapshotRoot = createAttestedSnapshot(treeRoot, closure, staging);
  const capsuleRoot = path.join(staging, "capsule");
  const capsulePath = path.join(staging, ...CAPSULE_RELATIVE_PATH.split("/"));
  const metafilePath = path.join(
    staging,
    `.capsule-meta-${crypto.randomUUID()}.json`,
  );
  const realpath = _deps.fs.realpathSync.native || _deps.fs.realpathSync;
  const canonicalSnapshotRoot = realpath(snapshotRoot);
  _deps.fs.mkdirSync(capsuleRoot, { recursive: false, mode: 0o700 });
  try {
    const snapshotEntrypoint = resolveContainedPath(
      snapshotRoot,
      entrypointRelative,
      "MCP capsule entrypoint",
    );
    const canonicalEntrypoint = realpath(snapshotEntrypoint);
    const canonicalEntrypointRelative = path
      .relative(canonicalSnapshotRoot, canonicalEntrypoint)
      .split(path.sep)
      .join("/");
    if (canonicalEntrypointRelative !== entrypointRelative) {
      throw new Error("MCP capsule entrypoint changed through a path alias");
    }
    const boundEntrypointRelative = esbuildRelativeEntrypointArg(
      entrypointRelative,
      canonicalSnapshotRoot,
      canonicalEntrypoint,
    );
    const entryRecord = closure.files.find(
      (record) => record.path === entrypointRelative,
    );
    const entryInput = _deps.fs.readFileSync(canonicalEntrypoint);
    if (
      !entryRecord ||
      entryInput.length !== entryRecord.bytes ||
      sha256(entryInput) !== entryRecord.sha256
    ) {
      throw new Error("MCP capsule entrypoint changed before bundling");
    }
    const wrapperSpecifier = `./${boundEntrypointRelative}`;
    const wrapperSource = Buffer.from(
      `"use strict";\nrequire(${JSON.stringify(wrapperSpecifier)});\n`,
      "utf8",
    );
    const wrapperSha256 = sha256(wrapperSource);
    const builder = resolveCapsuleBuilderBinary();
    const runThroughProcessBroker =
      processBrokerRunSync || _deps.processBrokerRunSync;
    if (typeof runThroughProcessBroker !== "function") {
      throw new Error(
        "MCP capsule construction requires a host-owned Process Broker runner",
      );
    }
    const result = runThroughProcessBroker(
      builder.binary,
      [
        "--bundle",
        "--charset=utf8",
        "--format=cjs",
        "--legal-comments=none",
        "--loader=js",
        "--log-level=warning",
        `--metafile=${metafilePath}`,
        `--outfile=${capsulePath}`,
        "--packages=bundle",
        "--platform=node",
        "--preserve-symlinks",
        "--supported:dynamic-import=false",
        `--sourcefile=${CAPSULE_STDIN_WRAPPER_SOURCEFILE}`,
        "--target=node22",
        "--tree-shaking=false",
        `--banner:js=${capsuleRuntimeGuard()}`,
      ],
      {
        cwd: canonicalSnapshotRoot,
        env: sanitizeMcpStdioHostEnvironment(env),
        encoding: "utf8",
        input: wrapperSource,
        shell: false,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const stderr = String(result?.stderr || "").trim();
    if (result?.error || result?.status !== 0 || stderr) {
      const detail = String(
        result?.error?.message || stderr || "esbuild failed",
      )
        .trim()
        .slice(0, 2000);
      throw new Error(`MCP capsule build failed closed: ${detail}`);
    }
    const metafile = JSON.parse(_deps.fs.readFileSync(metafilePath, "utf8"));
    if (
      !metafile ||
      typeof metafile !== "object" ||
      !metafile.inputs ||
      typeof metafile.inputs !== "object" ||
      !metafile.outputs ||
      typeof metafile.outputs !== "object"
    ) {
      throw new Error("MCP capsule build metadata is invalid");
    }
    const sourceByPath = new Map(
      closure.files.map((record) => [record.path, record]),
    );
    const wrapperInput = metafile.inputs[CAPSULE_STDIN_WRAPPER_SOURCEFILE];
    if (
      !wrapperInput ||
      wrapperInput.bytes !== wrapperSource.length ||
      !Array.isArray(wrapperInput.imports) ||
      wrapperInput.imports.length !== 1 ||
      wrapperInput.imports[0]?.kind !== "require-call" ||
      wrapperInput.imports[0]?.original !== wrapperSpecifier
    ) {
      throw new Error("MCP capsule build did not bind its stdin wrapper");
    }
    const inputs = Object.keys(metafile.inputs)
      .map((input) => input.split(path.sep).join("/"))
      .filter((input) => input !== CAPSULE_STDIN_WRAPPER_SOURCEFILE)
      .sort()
      .map((input) => {
        const absolute = realpath(
          path.resolve(canonicalSnapshotRoot, ...input.split("/")),
        );
        const relative = path
          .relative(canonicalSnapshotRoot, absolute)
          .split(path.sep)
          .join("/");
        const record = sourceByPath.get(relative);
        if (!record) {
          throw new Error(
            `MCP capsule build used an unattested input: ${input}`,
          );
        }
        return {
          path: relative,
          bytes: record.bytes,
          sha256: record.sha256,
        };
      });
    if (new Set(inputs.map((input) => input.path)).size !== inputs.length) {
      throw new Error("MCP capsule build reported duplicate input aliases");
    }
    if (
      inputs.length === 0 ||
      !inputs.some((input) => input.path === entrypointRelative)
    ) {
      throw new Error("MCP capsule build did not bind its approved entrypoint");
    }
    const externalBuiltins = [];
    for (const output of Object.values(metafile.outputs)) {
      for (const imported of output.imports || []) {
        if (!imported.external || !NODE_BUILTINS.has(imported.path)) {
          throw new Error(
            `MCP capsule build retained an external dependency: ${imported.path}`,
          );
        }
        externalBuiltins.push(imported.path);
      }
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
    const capsuleClosure = collectTree(capsuleRoot);
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
      builderPlatform: builder.platform,
      builderBinarySha256: builder.sha256,
      wrapperSchema: CAPSULE_STDIN_WRAPPER_SCHEMA,
      wrapperSha256,
      nodeTarget: "node22",
      inputCount: inputs.length,
      inputDigest: sha256(canonicalJson(inputs)),
      externalBuiltins: Object.freeze([...new Set(externalBuiltins)].sort()),
    });
  } finally {
    if (_deps.fs.existsSync(metafilePath)) _deps.fs.rmSync(metafilePath);
    _deps.fs.rmSync(snapshotRoot, { recursive: true, force: true });
  }
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
    manifest.capsule.bytes > MAX_FILE_BYTES ||
    typeof manifest.capsule?.closureDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.capsule.closureDigest) ||
    manifest.capsule?.builder !== CAPSULE_BUILDER ||
    manifest.capsule?.builderVersion !== CAPSULE_BUILDER_VERSION ||
    typeof manifest.capsule?.builderPlatform !== "string" ||
    !CAPSULE_BUILDER_BINARIES[manifest.capsule.builderPlatform] ||
    manifest.capsule?.builderBinarySha256 !==
      CAPSULE_BUILDER_BINARIES[manifest.capsule.builderPlatform]?.sha256 ||
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
    capsuleClosure = collectTree(capsuleRoot);
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
      }),
      closureDigest: manifest.closureDigest,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
    }),
  });
}

export function materializeMcpStdioNpmPackage({
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
    const capsule = buildCapsule({
      treeRoot,
      entrypointRelative: entry.entrypointRelative,
      closure,
      staging,
      processBrokerRunSync,
      env,
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
