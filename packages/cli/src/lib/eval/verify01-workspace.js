/** Shared file boundaries and snapshots; no process broker or npm dependencies. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { evalDigest } from "./evidence.js";
const MAX_BYTES = 16 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024;
const MAX_DIFF_BYTES = 32 * 1024 * 1024;
const EMPTY_DELIVERABLE_DIGEST = evalDigest(Buffer.alloc(0));

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function relativeFile(value) {
  requireValue(
    typeof value === "string" &&
      value.length > 0 &&
      !value.includes("\0") &&
      !/[\\:*?<>|"]/u.test(value) &&
      !value.startsWith("/") &&
      value.split("/").every((part) => part && !/[. ]$/u.test(part)),
    "review paths must be exact relative files",
  );
  return value;
}
export function readBytes(file) {
  const descriptor = fs.openSync(file, "r");
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    requireValue(
      before.isFile() && before.size <= BigInt(MAX_BYTES),
      "input must be a regular file within 16 MiB",
    );
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < bytes.length) {
      const size = fs.readSync(
        descriptor,
        bytes,
        count,
        bytes.length - count,
        null,
      );
      if (!size) break;
      count += size;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    requireValue(
      count === Number(before.size) &&
        ["dev", "ino", "size", "mtimeNs", "ctimeNs"].every(
          (key) => before[key] === after[key],
        ),
      "input changed during read",
    );
    return bytes.subarray(0, count);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function canonicalDirectory(directory) {
  const absolute = path.resolve(directory);
  const canonical = (fs.realpathSync.native || fs.realpathSync)(absolute);
  const same =
    process.platform === "win32"
      ? canonical.toLowerCase() === absolute.toLowerCase()
      : canonical === absolute;
  const stat = fs.lstatSync(absolute);
  requireValue(
    same && stat.isDirectory() && !stat.isSymbolicLink(),
    "task directory must be canonical and unaliased",
  );
  return canonical;
}

/** Trusted preparation only: a seed contains no answer and never overwrites
 * a project file. Existing source paths are not passed to this helper. */
export function seedVerify01Deliverables(directory, expectedFiles, budget) {
  const root = canonicalDirectory(directory);
  requireValue(
    Array.isArray(expectedFiles) &&
      expectedFiles.length > 0 &&
      new Set(expectedFiles).size === expectedFiles.length,
    "deliverable paths must be distinct",
  );
  expectedFiles.forEach(relativeFile);
  const seeds = [];
  for (const relative of expectedFiles) {
    budget.remainingMs("deliverable-preparation");
    let current = root;
    for (const part of relative.split("/").slice(0, -1)) {
      current = path.join(current, part);
      within(root, current);
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      canonicalDirectory(current);
    }
    const target = path.join(root, relative);
    within(root, target);
    const fd = fs.openSync(
      target,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    try {
      const stat = fs.fstatSync(fd);
      requireValue(
        stat.isFile() && stat.nlink === 1 && stat.size === 0,
        "seed must be an empty unaliased regular file",
      );
      regularPath(root, relative);
      const named = fs.lstatSync(target);
      requireValue(
        named.dev === stat.dev && named.ino === stat.ino,
        "seed path changed identity during preparation",
      );
      canonicalDirectory(path.dirname(target));
      seeds.push(
        Object.freeze({
          path: relative,
          before: null,
          origin: "trusted-empty-deliverable-preparation",
          digest: EMPTY_DELIVERABLE_DIGEST,
          bytes: 0,
          requestedMode: 0o600,
          mode: stat.mode & 0o777,
          preparedAt: new Date().toISOString(),
        }),
      );
    } finally {
      fs.closeSync(fd);
    }
  }
  return Object.freeze(seeds);
}

export function within(root, file) {
  const relative = path.relative(root, file);
  requireValue(
    relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    "path escapes its declared root",
  );
}

export function regularPath(root, relative) {
  relativeFile(relative);
  const file = path.join(root, relative);
  within(root, file);
  let current = root;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    requireValue(
      !fs.lstatSync(current).isSymbolicLink(),
      "review/project paths must not traverse links",
    );
  }
  requireValue(
    fs.lstatSync(file).isFile(),
    "review/project artifact must be a regular file",
  );
  return file;
}

export function snapshotVerify01Workspace(directory, budget, stage) {
  const files = new Map();
  let total = 0;
  let dependencyBytes = 0;
  let dependencyFiles = 0;
  const dependencyHash = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  const visit = (current) => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      budget.remainingMs(stage);
      const full = path.join(current, entry.name);
      const relative = path.relative(directory, full).split(path.sep).join("/");
      if (entry.isDirectory()) visit(full);
      else {
        requireValue(
          entry.isFile() || entry.isSymbolicLink(),
          "task snapshot contains an unsupported filesystem object",
        );
        // Preserve link identities without following them into another root.
        const dependency = relative.split("/").includes("node_modules");
        if (dependency && entry.isSymbolicLink()) {
          // A dependency linked outside the isolated workspace cannot be
          // fingerprinted by this capture contract; never silently omit it.
          within(directory, fs.realpathSync(full));
        }
        let bytes = entry.isSymbolicLink()
          ? Buffer.from(fs.readlinkSync(full))
          : dependency
            ? null
            : readBytes(full);
        let digest, size;
        if (dependency && bytes === null) {
          const hash = createHash("sha256");
          const fd = fs.openSync(full, "r");
          size = 0;
          try {
            let count;
            while (
              (count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0
            ) {
              budget.remainingMs(stage);
              size += count;
              requireValue(
                dependencyBytes + size <= 16 * 1024 ** 3,
                "dependency fingerprint exceeds 16 GiB",
              );
              hash.update(buffer.subarray(0, count));
            }
          } finally {
            fs.closeSync(fd);
          }
          digest = `sha256:${hash.digest("hex")}`;
        } else {
          size = bytes.length;
          digest = evalDigest(bytes);
        }
        if (dependency) {
          dependencyBytes += size;
          dependencyFiles++;
          bytes = null;
        } else total += size;
        requireValue(
          total <= MAX_SNAPSHOT_BYTES &&
            files.size - dependencyFiles < 100000 &&
            dependencyFiles <= 1000000,
          "task snapshot exceeds its capture bound",
        );
        const value = {
          type: entry.isSymbolicLink() ? "link" : "file",
          mode: fs.lstatSync(full).mode & 0o777,
          bytes,
          size,
          digest,
          dependency,
        };
        files.set(relative, value);
        if (dependency)
          dependencyHash.update(
            JSON.stringify([relative, value.type, value.mode, size, digest]) +
              "\n",
          );
      }
    }
  };
  visit(directory);
  files.dependencyBoundary = {
    contract:
      "all node_modules files and link identities streamed with SHA-256; links never followed; dependency bodies omitted; every change rejected",
    files: dependencyFiles,
    bytes: dependencyBytes,
    digest: `sha256:${dependencyHash.digest("hex")}`,
  };
  return files;
}

export function diffVerify01Workspace(before, after) {
  const result = [];
  let total = 0;
  for (const file of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(file),
      next = after.get(file);
    if (
      old?.digest === next?.digest &&
      old?.type === next?.type &&
      old?.mode === next?.mode
    )
      continue;
    total += (old?.bytes?.length || 0) + (next?.bytes?.length || 0);
    requireValue(
      total <= MAX_DIFF_BYTES,
      "task diff exceeds 32 MiB; preserve workspace for independent inspection",
    );
    const describe = (value) =>
      value
        ? {
            type: value.type,
            mode: value.mode,
            digest: value.digest,
            bytes: value.size,
            dependency: value.dependency,
            bytesBase64: value.bytes?.toString("base64") ?? null,
          }
        : null;
    result.push({ path: file, before: describe(old), after: describe(next) });
  }
  return result;
}
