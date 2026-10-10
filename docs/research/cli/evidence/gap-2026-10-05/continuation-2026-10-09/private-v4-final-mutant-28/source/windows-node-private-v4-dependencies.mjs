import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const MAX_FILES = 100000;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const fail = (message) => {
  throw Error("Private v4 dependencies: " + message);
};
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
function segments(value) {
  if (typeof value !== "string" || value.length > 4096 || !value)
    fail("bounded relative path required");
  const parts = value.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[\\<>:"|?*]/u.test(part) ||
        [...part].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        /[ .]$/u.test(part) ||
        /^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(
          part,
        ),
    )
  )
    fail("unsafe relative path");
  return parts;
}
function authorizedRoots(workspaceRoots) {
  if (!Array.isArray(workspaceRoots)) fail("trusted workspace roots required");
  const roots = new Set();
  for (const root of workspaceRoots) {
    const parts = segments(root);
    if (parts.length !== 2 || parts[0] !== "packages")
      fail("invalid trusted workspace root");
    roots.add(root);
  }
  return roots;
}
function validateRow(row, roots) {
  if (!row || typeof row !== "object" || Array.isArray(row))
    fail("file descriptor required");
  const parts = segments(row.path);
  let offset = 0;
  if (parts[0] !== "node_modules") {
    if (
      parts[0] !== "packages" ||
      !roots.has(parts.slice(0, 2).join("/")) ||
      parts[2] !== "node_modules"
    )
      fail("path outside authorized dependency namespaces");
    offset = 2;
  }
  const packagePart = parts[offset + 1];
  const scoped = packagePart?.startsWith("@");
  if (
    !packagePart ||
    packagePart.startsWith(".") ||
    (scoped && packagePart.length === 1) ||
    parts.length < offset + (scoped ? 4 : 3) ||
    (scoped && parts[offset + 2].startsWith("."))
  )
    fail("package file path required");
  if (
    !Number.isSafeInteger(row.bytes) ||
    row.bytes < 0 ||
    row.bytes > MAX_FILE_BYTES ||
    !/^sha256:[a-f0-9]{64}$/u.test(row.digest)
  )
    fail("bounded size and SHA256 required");
  return Object.freeze({
    path: row.path,
    bytes: row.bytes,
    digest: row.digest,
  });
}

// workspaceRoots comes from the independently pinned source closure, never
// from fields in this dependency manifest.
export function verifyPrivateV4DependencyManifest(
  manifest,
  { workspaceRoots } = {},
) {
  const roots = authorizedRoots(workspaceRoots);
  if (
    !manifest ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length ||
    manifest.files.length > MAX_FILES
  )
    fail("nonempty bounded file manifest required");
  const files = manifest.files.map((row) => validateRow(row, roots));
  const names = new Set();
  let totalBytes = 0;
  for (const row of files) {
    const name = row.path.toLowerCase();
    if (names.has(name)) fail("duplicate or case-aliased file path");
    names.add(name);
    totalBytes += row.bytes;
    if (totalBytes > MAX_TOTAL_BYTES) fail("total bytes exceed bound");
  }
  for (const name of names) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++)
      if (names.has(parts.slice(0, i).join("/")))
        fail("file path collides with directory");
  }
  return Object.freeze({
    files: Object.freeze(files),
    fileCount: files.length,
    totalBytes,
  });
}

const sameStat = (before, after) =>
  ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs", "nlink"].every(
    (key) => before[key] === after[key],
  );
const pathKey = (value) =>
  process.platform === "win32" ? value.toLowerCase() : value;

// This reads host-retained artifacts or staged capsule bytes. It does not grant
// admission, and it does not modify the shared nonempty evidence capture helper.
export function readPrivateV4DependencyFile(
  treeRoot,
  row,
  { workspaceRoots } = {},
) {
  validateRow(row, authorizedRoots(workspaceRoots));
  if (typeof treeRoot !== "string" || !path.isAbsolute(treeRoot))
    fail("absolute artifact tree required");
  const root = path.resolve(treeRoot);
  const target = path.resolve(root, ...row.path.split("/"));
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  )
    fail("file escaped artifact tree");
  const guarded = [];
  let current = root;
  for (const part of [null, ...row.path.split("/").slice(0, -1)]) {
    if (part !== null) current = path.join(current, part);
    const stat = fs.lstatSync(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink())
      fail("plain parent directory required");
    guarded.push([current, stat]);
  }
  if (pathKey(fs.realpathSync(root)) !== pathKey(root))
    fail("artifact tree has an aliased ancestor");
  const before = fs.lstatSync(target, { bigint: true });
  const regular = (stat) =>
    stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n;
  if (!regular(before) || before.size !== BigInt(row.bytes))
    fail("plain file with exact size required");
  if (pathKey(fs.realpathSync(target)) !== pathKey(target))
    fail("file path has an aliased ancestor");
  let descriptor;
  try {
    descriptor = fs.openSync(
      target,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!regular(opened) || !sameStat(before, opened))
      fail("file changed before open");
    const buffer = Buffer.alloc(row.bytes + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = fs.readSync(
        descriptor,
        buffer,
        count,
        buffer.length - count,
        count,
      );
      if (!read) break;
      count += read;
    }
    const bytes = buffer.subarray(0, count);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const final = fs.lstatSync(target, { bigint: true });
    if (!sameStat(before, after) || !sameStat(before, final))
      fail("file changed during read");
    for (const [directory, stat] of guarded)
      if (!sameStat(stat, fs.lstatSync(directory, { bigint: true })))
        fail("parent directory changed during read");
    if (count !== row.bytes || hash(bytes) !== row.digest)
      fail("file bytes differ from pinned descriptor");
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
