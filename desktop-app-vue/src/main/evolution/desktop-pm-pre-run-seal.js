"use strict";

const { createHash } = require("node:crypto");
const { constants } = require("node:fs");
const {
  access,
  lstat,
  mkdtemp,
  open,
  realpath,
  rm,
} = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { types } = require("node:util");
const {
  digestDesktopPmDatabasePath,
} = require("./desktop-pm-read-only-outcome-reader");

const SEAL_SCHEMA = "chainlesschain.desktop-pm-database-pre-run-seal/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024 * 1024;

function directFunction(value, label) {
  if (typeof value !== "function" || types.isProxy(value))
    throw new TypeError(`${label} must be a direct function`);
  return value;
}

function capturedMethod(owner, name, label) {
  if (!owner || typeof owner !== "object" || types.isProxy(owner)) {
    throw new TypeError(`${label} owner is invalid`);
  }
  let current = owner;
  while (current && current !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) {
      if (
        !("value" in descriptor) ||
        typeof descriptor.value !== "function" ||
        types.isProxy(descriptor.value)
      ) {
        throw new TypeError(`${label} must be a direct function`);
      }
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current);
  }
  throw new TypeError(`${label} must be a direct function`);
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.includes(key) ||
        !descriptor ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      );
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

function hashCore(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function createDesktopPmPreRunSealValue(input = {}) {
  exact(
    input,
    ["databasePathDigest", "databaseSnapshotDigest", "databaseSnapshotBytes"],
    "Desktop PM pre-run seal input",
  );
  if (
    !Number.isSafeInteger(input.databaseSnapshotBytes) ||
    input.databaseSnapshotBytes < 1 ||
    input.databaseSnapshotBytes > MAX_SNAPSHOT_BYTES
  ) {
    throw new TypeError("databaseSnapshotBytes is outside its allowed range");
  }
  const core = Object.freeze({
    schema: SEAL_SCHEMA,
    databasePathDigest: digest(input.databasePathDigest, "databasePathDigest"),
    databaseSnapshotDigest: digest(
      input.databaseSnapshotDigest,
      "databaseSnapshotDigest",
    ),
    databaseSnapshotBytes: input.databaseSnapshotBytes,
    snapshotMethod: "database-manager-backup",
  });
  return Object.freeze({
    ...core,
    sealDigest: hashCore(SEAL_SCHEMA, core),
  });
}

async function hashSnapshot(snapshotPath, directory) {
  const [directoryPath, resolvedSnapshot, metadata] = await Promise.all([
    realpath(directory),
    realpath(snapshotPath),
    lstat(snapshotPath),
  ]);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    path.dirname(resolvedSnapshot) !== directoryPath ||
    !Number.isSafeInteger(metadata.size) ||
    metadata.size < 1 ||
    metadata.size > MAX_SNAPSHOT_BYTES
  ) {
    throw new Error("Desktop PM database backup artifact is invalid");
  }
  const handle = await open(resolvedSnapshot, "r");
  try {
    const hasher = createHash("sha256").update(
      "chainlesschain.desktop-pm-database-snapshot/v1\0",
    );
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    while (bytes < metadata.size) {
      const length = Math.min(buffer.byteLength, metadata.size - bytes);
      const read = await handle.read(buffer, 0, length, bytes);
      if (read.bytesRead < 1)
        throw new Error("Desktop PM database backup ended unexpectedly");
      hasher.update(buffer.subarray(0, read.bytesRead));
      bytes += read.bytesRead;
    }
    const after = await handle.stat();
    if (
      after.size !== metadata.size ||
      after.mtimeMs !== metadata.mtimeMs ||
      bytes !== metadata.size
    ) {
      throw new Error("Desktop PM database backup changed while sealing");
    }
    return Object.freeze({
      snapshotDigest: `sha256:${hasher.digest("hex")}`,
      snapshotBytes: bytes,
    });
  } finally {
    await handle.close();
  }
}

function managerPort(databaseProvider) {
  const manager = databaseProvider();
  if (!manager || typeof manager !== "object" || types.isProxy(manager))
    throw new TypeError("Desktop PM database manager is unavailable");
  return Object.freeze({
    manager,
    backup: capturedMethod(manager, "backup", "Desktop PM database backup"),
    getCurrentDatabasePath: capturedMethod(
      manager,
      "getCurrentDatabasePath",
      "Desktop PM database getCurrentDatabasePath",
    ),
  });
}

function pathDigest(port) {
  return digestDesktopPmDatabasePath(
    Reflect.apply(port.getCurrentDatabasePath, port.manager, []),
  );
}

function createDesktopPmPreRunSealCaptureFactory(databaseProvider) {
  directFunction(databaseProvider, "Desktop PM database provider");
  const identity = { manager: null, databasePathDigest: null };
  return async function captureDesktopPmPreRunSeal() {
    const before = managerPort(databaseProvider);
    const databasePathDigest = pathDigest(before);
    if (identity.manager === null) {
      identity.manager = before.manager;
      identity.databasePathDigest = databasePathDigest;
    } else if (
      identity.manager !== before.manager ||
      identity.databasePathDigest !== databasePathDigest
    ) {
      throw new Error("Desktop PM database identity changed between seals");
    }
    const directory = await mkdtemp(path.join(tmpdir(), "cc-pm-pre-run-seal-"));
    const snapshotPath = path.join(directory, "database.snapshot.db");
    try {
      await Reflect.apply(before.backup, before.manager, [snapshotPath]);
      await access(snapshotPath, constants.R_OK);
      const snapshot = await hashSnapshot(snapshotPath, directory);
      const after = managerPort(databaseProvider);
      if (
        after.manager !== before.manager ||
        pathDigest(after) !== databasePathDigest
      ) {
        throw new Error("Desktop PM database identity changed while sealing");
      }
      return createDesktopPmPreRunSealValue({
        databasePathDigest,
        databaseSnapshotDigest: snapshot.snapshotDigest,
        databaseSnapshotBytes: snapshot.snapshotBytes,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}

const captureDesktopPmPreRunSeal = createDesktopPmPreRunSealCaptureFactory(
  () => {
    const { getDatabase } = require("../database.js");
    return getDatabase();
  },
);

function verifyDesktopPmPreRunSealValue(value, expectedSealDigest) {
  exact(
    value,
    [
      "schema",
      "databasePathDigest",
      "databaseSnapshotDigest",
      "databaseSnapshotBytes",
      "snapshotMethod",
      "sealDigest",
    ],
    "Desktop PM pre-run seal",
  );
  if (
    value.schema !== SEAL_SCHEMA ||
    value.snapshotMethod !== "database-manager-backup" ||
    !Number.isSafeInteger(value.databaseSnapshotBytes) ||
    value.databaseSnapshotBytes < 1 ||
    value.databaseSnapshotBytes > MAX_SNAPSHOT_BYTES
  ) {
    throw new TypeError("Desktop PM pre-run seal is invalid");
  }
  const core = Object.freeze({
    schema: value.schema,
    databasePathDigest: digest(value.databasePathDigest, "databasePathDigest"),
    databaseSnapshotDigest: digest(
      value.databaseSnapshotDigest,
      "databaseSnapshotDigest",
    ),
    databaseSnapshotBytes: value.databaseSnapshotBytes,
    snapshotMethod: value.snapshotMethod,
  });
  const seal = Object.freeze({
    ...core,
    sealDigest: digest(value.sealDigest, "sealDigest"),
  });
  if (seal.sealDigest !== hashCore(SEAL_SCHEMA, core))
    throw new Error("Desktop PM pre-run seal digest mismatch");
  if (
    expectedSealDigest !== undefined &&
    seal.sealDigest !== digest(expectedSealDigest, "preRunSealDigest")
  ) {
    throw new Error("Desktop PM pre-run seal differs from signed manifest");
  }
  return seal;
}

async function verifyDesktopPmPreRunSeal(expectedSealDigest) {
  const seal = await captureDesktopPmPreRunSeal();
  return verifyDesktopPmPreRunSealValue(seal, expectedSealDigest);
}

module.exports = {
  SEAL_SCHEMA,
  captureDesktopPmPreRunSeal,
  createDesktopPmPreRunSealValue,
  createDesktopPmPreRunSealCaptureFactory,
  verifyDesktopPmPreRunSeal,
  verifyDesktopPmPreRunSealValue,
};
