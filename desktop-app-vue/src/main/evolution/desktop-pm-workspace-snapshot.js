"use strict";

const { createHash } = require("node:crypto");
const { lstat, readFile, readdir, realpath } = require("node:fs/promises");
const path = require("node:path");
const { types } = require("node:util");

const WORKSPACE_SEAL_SCHEMA = "chainlesschain.desktop-pm-workspace-seal/v1";
const WORKSPACE_SNAPSHOT_CAPTURE_SCHEMA =
  "chainlesschain.desktop-pm-workspace-snapshot-capture/v1";
const WORKSPACE_ARCHIVE_SCHEMA =
  "chainlesschain.desktop-pm-workspace-archive/v1";
const WORKSPACE_SNAPSHOT_DOMAIN =
  "chainlesschain.desktop-pm-workspace-snapshot/v1";
const WORKSPACE_PATH_DOMAIN = "chainlesschain.desktop-pm-workspace-path/v1";
const WORKSPACE_POLICY_DOMAIN =
  "chainlesschain.desktop-pm-workspace-capture-policy/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_FILE_COUNT_LIMIT = 100_000;
const MAX_SNAPSHOT_BYTES_LIMIT = 2 * 1024 * 1024 * 1024;
const SNAPSHOTTERS = new WeakMap();

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !("value" in descriptor);
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;
}

function hashBytes(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(value)
    .digest("hex")}`;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`);
  }
  return value;
}

function positiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${label} is outside its allowed range`);
  }
  return value;
}

function samePath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function portableRelative(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4096 ||
    value.includes("\0") ||
    path.isAbsolute(value)
  ) {
    throw new TypeError(`${label} must be a bounded relative path`);
  }
  const portable = value.replaceAll("\\", "/");
  const normalized = path.posix.normalize(portable);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized !== portable.replace(/^\.\//u, "")
  ) {
    throw new TypeError(`${label} is not canonical`);
  }
  return normalized;
}

function includePaths(value) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 ||
    value.length > 1024 ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError(
      "workspace includePaths must be a dense nonempty array",
    );
  }
  const result = value.map((entry, index) =>
    portableRelative(entry, `includePaths[${index}]`),
  );
  if (new Set(result).size !== result.length) {
    throw new TypeError("workspace includePaths must be unique");
  }
  const sorted = [...result].sort();
  if (
    sorted.some((entry, index) =>
      sorted.slice(index + 1).some((other) => other.startsWith(`${entry}/`)),
    )
  ) {
    throw new TypeError("workspace includePaths cannot overlap");
  }
  return Object.freeze(sorted);
}

function metadataEntry(relativePath, metadata, type) {
  return Object.freeze({
    path: relativePath,
    type,
    size: type === "file" ? metadata.size : 0,
    modifiedMs: Math.trunc(metadata.mtimeMs),
  });
}

async function scanEntry(root, absolute, relativePath, state, includeBytes) {
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink()) {
    throw new Error(
      `workspace snapshot rejects symbolic link: ${relativePath}`,
    );
  }
  const resolved = await realpath(absolute);
  if (!insideRoot(root, resolved)) {
    throw new Error(
      `workspace snapshot path escaped its root: ${relativePath}`,
    );
  }
  if (metadata.isDirectory()) {
    state.metadata.push(metadataEntry(relativePath, metadata, "directory"));
    if (includeBytes) {
      state.entries.push(
        Object.freeze({ path: relativePath, type: "directory" }),
      );
    }
    const children = await readdir(resolved, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      const childRelative = `${relativePath}/${child.name}`;
      await scanEntry(
        root,
        path.join(resolved, child.name),
        childRelative,
        state,
        includeBytes,
      );
    }
    return;
  }
  if (!metadata.isFile()) {
    throw new Error(`workspace snapshot rejects special file: ${relativePath}`);
  }
  state.fileCount += 1;
  if (state.fileCount > state.maxFileCount) {
    throw new Error("workspace snapshot exceeds its file-count budget");
  }
  state.totalBytes += metadata.size;
  if (
    metadata.size > state.maxFileBytes ||
    state.totalBytes > state.maxSnapshotBytes
  ) {
    throw new Error("workspace snapshot exceeds its byte budget");
  }
  state.metadata.push(metadataEntry(relativePath, metadata, "file"));
  if (includeBytes) {
    const bytes = await readFile(resolved);
    const after = await lstat(resolved);
    if (
      bytes.byteLength !== metadata.size ||
      after.size !== metadata.size ||
      Math.trunc(after.mtimeMs) !== Math.trunc(metadata.mtimeMs)
    ) {
      throw new Error(
        `workspace file changed while capturing: ${relativePath}`,
      );
    }
    state.entries.push(
      Object.freeze({
        path: relativePath,
        type: "file",
        bytes: bytes.toString("base64"),
      }),
    );
  }
}

async function scanWorkspace(captured, root, includeBytes) {
  const state = {
    entries: [],
    metadata: [],
    fileCount: 0,
    totalBytes: 0,
    maxFileCount: captured.maxFileCount,
    maxFileBytes: captured.maxFileBytes,
    maxSnapshotBytes: captured.maxSnapshotBytes,
  };
  for (const relativePath of captured.includePaths) {
    const absolute = path.resolve(root, ...relativePath.split("/"));
    if (!insideRoot(root, absolute)) {
      throw new Error("workspace snapshot include path escaped its root");
    }
    await scanEntry(root, absolute, relativePath, state, includeBytes);
  }
  state.metadata.sort((left, right) =>
    left.path.localeCompare(right.path, "en"),
  );
  state.entries.sort((left, right) =>
    left.path.localeCompare(right.path, "en"),
  );
  return state;
}

async function canonicalRoot(captured) {
  const metadata = await lstat(captured.workspaceRoot);
  const resolved = await realpath(captured.workspaceRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Desktop PM workspace root must be a real directory");
  }
  if (!samePath(resolved, captured.workspaceRoot)) {
    throw new Error(
      "Desktop PM workspace root cannot traverse a symbolic link",
    );
  }
  return resolved;
}

function verifyDesktopPmWorkspaceSnapshotCapture(
  value,
  expectedManifestDigest,
) {
  exact(
    value,
    ["schema", "seal", "bytes"],
    "Desktop PM workspace snapshot capture",
  );
  if (
    value.schema !== WORKSPACE_SNAPSHOT_CAPTURE_SCHEMA ||
    !Buffer.isBuffer(value.bytes) ||
    Object.getPrototypeOf(value.bytes) !== Buffer.prototype
  ) {
    throw new TypeError("Desktop PM workspace snapshot capture is invalid");
  }
  exact(
    value.seal,
    [
      "schema",
      "manifestDigest",
      "workspaceRootDigest",
      "capturePolicyDigest",
      "workspaceSnapshotDigest",
      "workspaceSnapshotBytes",
      "workspaceFileCount",
      "snapshotMethod",
      "sealDigest",
    ],
    "Desktop PM workspace seal",
  );
  const core = {
    schema: value.seal.schema,
    manifestDigest: digest(value.seal.manifestDigest, "manifestDigest"),
    workspaceRootDigest: digest(
      value.seal.workspaceRootDigest,
      "workspaceRootDigest",
    ),
    capturePolicyDigest: digest(
      value.seal.capturePolicyDigest,
      "capturePolicyDigest",
    ),
    workspaceSnapshotDigest: digest(
      value.seal.workspaceSnapshotDigest,
      "workspaceSnapshotDigest",
    ),
    workspaceSnapshotBytes: value.seal.workspaceSnapshotBytes,
    workspaceFileCount: value.seal.workspaceFileCount,
    snapshotMethod: value.seal.snapshotMethod,
  };
  if (
    core.schema !== WORKSPACE_SEAL_SCHEMA ||
    core.manifestDigest !== expectedManifestDigest ||
    core.snapshotMethod !== "bounded-canonical-workspace-archive" ||
    !Number.isSafeInteger(core.workspaceSnapshotBytes) ||
    core.workspaceSnapshotBytes < 1 ||
    core.workspaceSnapshotBytes > MAX_SNAPSHOT_BYTES_LIMIT ||
    !Number.isSafeInteger(core.workspaceFileCount) ||
    core.workspaceFileCount < 0 ||
    core.workspaceFileCount > MAX_FILE_COUNT_LIMIT ||
    core.workspaceSnapshotBytes !== value.bytes.byteLength ||
    core.workspaceSnapshotDigest !==
      hashBytes(WORKSPACE_SNAPSHOT_DOMAIN, value.bytes)
  ) {
    throw new Error("Desktop PM workspace snapshot binding is invalid");
  }
  const seal = Object.freeze({
    ...core,
    sealDigest: digest(value.seal.sealDigest, "workspace sealDigest"),
  });
  if (seal.sealDigest !== hash(WORKSPACE_SEAL_SCHEMA, core)) {
    throw new Error("Desktop PM workspace seal digest mismatch");
  }
  return Object.freeze({ seal, bytes: Buffer.from(value.bytes) });
}

function createDesktopPmWorkspaceSnapshotter(options = {}) {
  exact(
    options,
    [
      "manifestDigest",
      "workspaceRoot",
      "includePaths",
      "maxFileCount",
      "maxFileBytes",
      "maxSnapshotBytes",
    ],
    "Desktop PM workspace snapshotter options",
  );
  if (
    typeof options.workspaceRoot !== "string" ||
    !path.isAbsolute(options.workspaceRoot)
  ) {
    throw new TypeError("Desktop PM workspace root must be absolute");
  }
  const normalized = Object.freeze({
    manifestDigest: digest(options.manifestDigest, "manifestDigest"),
    workspaceRoot: path.resolve(options.workspaceRoot),
    includePaths: includePaths(options.includePaths),
    maxFileCount: positiveInteger(
      options.maxFileCount,
      "maxFileCount",
      MAX_FILE_COUNT_LIMIT,
    ),
    maxFileBytes: positiveInteger(
      options.maxFileBytes,
      "maxFileBytes",
      MAX_SNAPSHOT_BYTES_LIMIT,
    ),
    maxSnapshotBytes: positiveInteger(
      options.maxSnapshotBytes,
      "maxSnapshotBytes",
      MAX_SNAPSHOT_BYTES_LIMIT,
    ),
  });
  if (normalized.maxFileBytes > normalized.maxSnapshotBytes) {
    throw new TypeError("maxFileBytes cannot exceed maxSnapshotBytes");
  }
  const snapshotter = Object.freeze({});
  SNAPSHOTTERS.set(snapshotter, normalized);
  return snapshotter;
}

function captureDesktopPmWorkspaceSnapshotter(value) {
  const captured = SNAPSHOTTERS.get(value);
  if (!captured) {
    throw new TypeError(
      "a branded Desktop PM workspace snapshotter is required",
    );
  }
  return Object.freeze({
    manifestDigest: captured.manifestDigest,
    captureWorkspaceSnapshot: async () => {
      const root = await canonicalRoot(captured);
      const workspaceRootDigest = hash(WORKSPACE_PATH_DOMAIN, root);
      const capturePolicyDigest = hash(WORKSPACE_POLICY_DOMAIN, {
        manifestDigest: captured.manifestDigest,
        workspaceRootDigest,
        includePaths: captured.includePaths,
        maxFileCount: captured.maxFileCount,
        maxFileBytes: captured.maxFileBytes,
        maxSnapshotBytes: captured.maxSnapshotBytes,
      });
      const first = await scanWorkspace(captured, root, true);
      const second = await scanWorkspace(captured, root, false);
      if (canonical(first.metadata) !== canonical(second.metadata)) {
        throw new Error("Desktop PM workspace changed while capturing");
      }
      const archive = {
        schema: WORKSPACE_ARCHIVE_SCHEMA,
        capturePolicyDigest,
        entries: first.entries,
      };
      const bytes = Buffer.from(canonical(archive), "utf8");
      if (
        bytes.byteLength < 1 ||
        bytes.byteLength > captured.maxSnapshotBytes
      ) {
        throw new Error("Desktop PM workspace archive exceeds its byte budget");
      }
      const core = {
        schema: WORKSPACE_SEAL_SCHEMA,
        manifestDigest: captured.manifestDigest,
        workspaceRootDigest,
        capturePolicyDigest,
        workspaceSnapshotDigest: hashBytes(WORKSPACE_SNAPSHOT_DOMAIN, bytes),
        workspaceSnapshotBytes: bytes.byteLength,
        workspaceFileCount: first.fileCount,
        snapshotMethod: "bounded-canonical-workspace-archive",
      };
      return Object.freeze({
        schema: WORKSPACE_SNAPSHOT_CAPTURE_SCHEMA,
        seal: Object.freeze({
          ...core,
          sealDigest: hash(WORKSPACE_SEAL_SCHEMA, core),
        }),
        bytes,
      });
    },
  });
}

module.exports = {
  WORKSPACE_ARCHIVE_SCHEMA,
  WORKSPACE_SEAL_SCHEMA,
  WORKSPACE_SNAPSHOT_CAPTURE_SCHEMA,
  WORKSPACE_SNAPSHOT_DOMAIN,
  captureDesktopPmWorkspaceSnapshotter,
  createDesktopPmWorkspaceSnapshotter,
  verifyDesktopPmWorkspaceSnapshotCapture,
};
