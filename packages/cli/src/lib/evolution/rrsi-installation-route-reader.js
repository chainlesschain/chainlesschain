/** Open-only, immutable readback of caller-selected declarations, never authority. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  rrsiCanonical,
  rrsiDigest,
  rrsiEnvelope,
  rrsiExact,
  rrsiHash,
  rrsiId,
  snapshotRrsiData,
} from "./rrsi-data.js";
import {
  RRSI_INSTALLATION_ROUTE_HOLD_CODE,
  verifyRrsiInstallationRouteSnapshot,
} from "./rrsi-installation-route-contracts.js";
import { withEvolutionDirectoryFileIdentity } from "./evolution-file-identity.js";
import { readBoundedDescriptor } from "./bounded-descriptor-read.js";

export const RRSI_INSTALLATION_ROUTE_FILE_LIMITS = Object.freeze({
  "root.json": 16 * 1024,
  "routes.json": 256 * 1024,
  "highwater.json": 16 * 1024,
});
const NAMES = Object.keys(RRSI_INSTALLATION_ROUTE_FILE_LIMITS).sort();
const FILE_FIELDS = [
  "dev",
  "ino",
  "mode",
  "uid",
  "gid",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
];
const DIR_FIELDS = ["dev", "ino", "mode", "uid", "gid"];
const same = (left, right) => rrsiCanonical(left) === rrsiCanonical(right);
const canonicalPath = (value) =>
  process.platform === "win32" ? value.toLowerCase() : value;
const sha = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
// The shared identity helper opens directories only. Keep this adaptation local
// so a lstat/open FIFO race cannot block before its existing fstat checks.
const DIRECTORY_FS = Object.freeze({
  constants: fs.constants,
  realpathSync: fs.realpathSync,
  lstatSync: (...args) => fs.lstatSync(...args),
  fstatSync: (...args) => fs.fstatSync(...args),
  closeSync: (...args) => fs.closeSync(...args),
  openSync: (target, flags) =>
    fs.openSync(
      target,
      flags | (fs.constants.O_NONBLOCK || 0) | (fs.constants.O_DIRECTORY || 0),
    ),
});
function hold(message) {
  const error = new Error(message);
  error.code = RRSI_INSTALLATION_ROUTE_HOLD_CODE;
  throw error;
}
function guard(operation) {
  try {
    return operation();
  } catch (cause) {
    if (cause?.code === RRSI_INSTALLATION_ROUTE_HOLD_CODE) throw cause;
    const error = new Error("installation route snapshot read held", { cause });
    error.code = RRSI_INSTALLATION_ROUTE_HOLD_CODE;
    throw error;
  }
}
function fields(stat, names) {
  if (names.some((name) => typeof stat[name] !== "bigint"))
    hold("route snapshot requires full-precision stat fields");
  return Object.fromEntries(names.map((name) => [name, String(stat[name])]));
}
function ancestry(directory) {
  const chain = [];
  let target = directory;
  for (;;) {
    if (chain.length >= 64) hold("route directory ancestry exceeds limit");
    const stat = fs.lstatSync(target, { bigint: true });
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      canonicalPath(fs.realpathSync.native(target)) !== canonicalPath(target)
    )
      hold("route directory ancestry is not canonical and nonlinked");
    chain.push({ path: target, identity: fields(stat, DIR_FIELDS) });
    const parent = path.dirname(target);
    if (parent === target) break;
    target = parent;
  }
  return chain;
}
function inventory(directory) {
  const handle = fs.opendirSync(directory);
  const names = [];
  try {
    let entry;
    while ((entry = handle.readSync()) !== null) {
      names.push(entry.name);
      if (names.length > 3)
        hold("route snapshot has unknown directory entries");
    }
  } finally {
    handle.closeSync();
  }
  if (!same(names.sort(), NAMES))
    hold("route snapshot requires exactly root, routes and highwater files");
}
function file(directory, name, samePathHandle) {
  const target = path.join(directory, name);
  const maximum = RRSI_INSTALLATION_ROUTE_FILE_LIMITS[name];
  const before = fs.lstatSync(target, { bigint: true });
  const safe = (stat) => {
    fields(stat, FILE_FIELDS);
    return (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1n &&
      stat.size > 0n &&
      stat.size <= BigInt(maximum)
    );
  };
  if (
    !safe(before) ||
    canonicalPath(fs.realpathSync.native(target)) !== canonicalPath(target)
  )
    hold(`route ${name} is not a bounded single-link regular file`);
  const fd = fs.openSync(
    target,
    fs.constants.O_RDONLY |
      (fs.constants.O_NOFOLLOW || 0) |
      (fs.constants.O_NONBLOCK || 0),
  );
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!safe(opened) || !samePathHandle(before, opened))
      hold(`route ${name} changed while opening`);
    const bytes = readBoundedDescriptor(fs, fd, Number(before.size), maximum);
    const after = fs.lstatSync(target, { bigint: true });
    const closed = fs.fstatSync(fd, { bigint: true });
    if (
      !safe(after) ||
      !safe(closed) ||
      !samePathHandle(after, closed) ||
      !same(fields(before, FILE_FIELDS), fields(after, FILE_FIELDS)) ||
      !same(fields(opened, FILE_FIELDS), fields(closed, FILE_FIELDS))
    )
      hold(`route ${name} changed while reading`);
    return {
      name,
      identity: fields(after, FILE_FIELDS),
      bytesDigest: sha(bytes),
      bytes,
    };
  } finally {
    fs.closeSync(fd);
  }
}
function parse(bytes) {
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  const value = snapshotRrsiData(JSON.parse(text));
  if (text !== rrsiCanonical(value) && text !== `${rrsiCanonical(value)}\n`)
    hold(
      "route file must be exact canonical JSON with at most one final newline",
    );
  return value;
}
const project = (files) =>
  files.map(({ name, identity, bytesDigest }) => ({
    name,
    identity,
    bytesDigest,
  }));

/**
 * Context comes from the caller, so matching it does not authenticate an installer.
 * No writer, bootstrap, environment override, permission repair or recovery API.
 */
export function openRrsiInstallationRouteSnapshot(input) {
  return guard(() => {
    const selected = snapshotRrsiData(input);
    rrsiExact(
      selected,
      ["directory", "installationId", "tenantId", "rootRecordDigest"],
      "route snapshot selection",
    );
    if (
      typeof selected.directory !== "string" ||
      selected.directory.length > 1024 ||
      !path.isAbsolute(selected.directory) ||
      path.resolve(selected.directory) !== selected.directory
    )
      hold("route snapshot directory must be an absolute normalized path");
    rrsiId(selected.installationId, "selected installation ID");
    rrsiId(selected.tenantId, "selected tenant ID");
    rrsiDigest(selected.rootRecordDigest, "selected root record digest");
    function capture(expected = null) {
      const directories = ancestry(selected.directory);
      inventory(selected.directory);
      if (expected && !same(directories, expected.directories))
        hold("captured route directory identity changed");
      return withEvolutionDirectoryFileIdentity(
        DIRECTORY_FS,
        selected.directory,
        (samePathHandle) => {
          const files = NAMES.map((name) =>
            file(selected.directory, name, samePathHandle),
          );
          const physical = { directories, files: project(files) };
          if (expected && !same(physical, expected))
            hold("captured route file identity or bytes changed");
          const records = Object.fromEntries(
            files.map((entry) => [entry.name, parse(entry.bytes)]),
          );
          const root = records["root.json"];
          const checked = verifyRrsiInstallationRouteSnapshot({
            root,
            routes: records["routes.json"],
            highwater: records["highwater.json"],
          });
          if (
            checked.installationId !== selected.installationId ||
            checked.tenantId !== selected.tenantId ||
            checked.rootRecordDigest !== selected.rootRecordDigest
          )
            hold("route root differs from explicitly selected context");
          const rechecked = NAMES.map((name) =>
            file(selected.directory, name, samePathHandle),
          );
          inventory(selected.directory);
          if (
            !same(ancestry(selected.directory), directories) ||
            !same(project(rechecked), physical.files)
          )
            hold("route snapshot changed during final readback");
          const result = rrsiEnvelope(
            "chainlesschain.rrsi-installation-route-readback/v1",
            "readbackDigest",
            {
              snapshotCheck: checked,
              physicalSnapshotDigest: rrsiHash(
                "chainlesschain.rrsi-installation-route-physical-snapshot/v1",
                physical,
              ),
              readOnlyOpen: true,
              capturedSnapshotRechecked: true,
              ownerOnlyPermissionsVerified: false,
              atomicSnapshotVerified: false,
              installationBindingSignatureVerified: false,
              selectedContextOnly: true,
              rootAuthorityVerified: false,
              routingPinVerified: false,
              crossProcessRollbackProtectionVerified: false,
              tenantWideIndexAuthorityVerified: false,
              generationProvenanceVerified: false,
              grantsMutationOrPromotionAuthority: false,
              decision: "HOLD",
            },
          );
          return { physical, result };
        },
      );
    }
    const initial = capture();
    return Object.freeze({
      read(...args) {
        return guard(() => {
          if (args.length)
            hold("captured route reader takes no replacement context");
          return capture(initial.physical).result;
        });
      },
    });
  });
}
