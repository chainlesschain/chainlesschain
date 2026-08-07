/**
 * Fixed-version, content-addressed npm materialization for MCP stdio servers.
 *
 * `npx` is a package resolver and downloader, not an executable identity. An
 * explicitly approved materialization installs one exact package version with
 * lifecycle scripts disabled, verifies every transitive lock entry has
 * registry integrity, and publishes a private generation whose complete file
 * closure is hashed. Runtime resolution never invokes the dynamic launcher:
 * it re-verifies the generation and returns the current Node runtime plus the
 * pinned package entrypoint.
 */

import crypto from "node:crypto";
import fs from "node:fs";
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
  "chainlesschain.mcp-stdio-package-materialization/v1";
const MATERIALIZATION_VERSION = 1;
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
      path.join(getCacheDir(), "mcp-stdio-package-materializations-v1"),
  );
}

export function getMcpStdioPackageMaterializationIndexPath(options = {}) {
  return path.resolve(
    options.indexPath ||
      process.env.CC_MCP_PACKAGE_MATERIALIZATION_INDEX ||
      path.join(
        getMachineSecurityAnchorDir(),
        "mcp-stdio-package-materializations-v1.json",
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

export function parseNpxMaterializationInvocation(config, packageSpec) {
  const launcher = executableBasename(config?.command);
  if (launcher !== "npx") {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      `MCP fixed npm materialization currently requires an npx source invocation, not ${String(config?.command)}`,
    );
  }
  const exact = parseExactNpmPackageSpec(packageSpec);
  const args = Array.isArray(config?.args) ? [...config.args] : [];
  let index = 0;
  while (args[index] === "-y" || args[index] === "--yes") index += 1;
  if (args[index] !== exact.spec) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      `npx source invocation must name the same exact package spec ${exact.spec}`,
    );
  }
  return Object.freeze({
    ...exact,
    launcher,
    passthroughArgs: Object.freeze(args.slice(index + 1)),
  });
}

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
  const entrypoint = path.resolve(
    treeRoot,
    ...manifest.entrypointRelative.split("/"),
  );
  const relative = path.relative(treeRoot, entrypoint);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw materializationError(
      MCP_STDIO_PACKAGE_MATERIALIZATION_INVALID_CODE,
      "MCP package materialization entrypoint escapes its tree",
    );
  }
  return Object.freeze({
    generationRoot,
    treeRoot,
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
  const source = parseNpxMaterializationInvocation(config, packageSpec);
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
    const generation = sha256(
      canonicalJson({
        sourceFingerprint: approvalRecord.fingerprint,
        package: source.spec,
        binName: entry.binName,
        passthroughArgs: source.passthroughArgs,
        lockSha256: lock.lockSha256,
        closureDigest: closure.closureDigest,
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
      "--no-global-search-paths",
      verified.entrypoint,
      ...(verified.manifest.passthroughArgs || []),
    ]),
    identity: verified.identity,
    generationRoot: verified.generationRoot,
    treeRoot: verified.treeRoot,
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
