/**
 * Cross-process ownership and durable journal for one scoped plugin name.
 *
 * A fixed lock directory is published with one same-volume rename. The owner
 * record carries an unguessable token, while every journal replacement is
 * revision/digest chained and fsynced before publication. A crashed owner is
 * never reclaimed by an ordinary mutation: an explicit recovery first proves
 * the recorded local PID dead (or requires an operator force for a remote/
 * unverifiable owner), then claims a second O_EXCL recovery marker.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const PLUGIN_TRANSACTION_JOURNAL_SCHEMA =
  "cc-plugin-lifecycle-transaction/v1";
export const PLUGIN_TRANSACTION_LOCK_DIRNAME = ".plugin-transaction-lock";
export const PLUGIN_TRANSACTION_OWNER_FILENAME = "owner.json";
export const PLUGIN_TRANSACTION_JOURNAL_FILENAME = "journal.json";

const TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SCOPE_PATTERN = /^(user|project|local)$/;

export const _deps = {
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  renameSync: fs.renameSync,
  linkSync: fs.linkSync,
  rmSync: fs.rmSync,
  lstatSync: fs.lstatSync,
  openSync: fs.openSync,
  closeSync: fs.closeSync,
  fsyncSync: fs.fsyncSync,
  randomToken: () => crypto.randomBytes(16).toString("hex"),
  now: () => Date.now(),
  hostname: () => os.hostname(),
  pid: () => process.pid,
  isProcessAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code === "EPERM";
    }
  },
};

export function acquirePluginTransactionLock({
  name,
  scope,
  nameDir,
  operation,
  contextDigest,
}) {
  const identity = normalizeIdentity({
    name,
    scope,
    nameDir,
    operation,
    contextDigest,
  });
  ensureSafeNameDirectory(identity.nameDir);
  const token = _deps.randomToken();
  if (!TOKEN_PATTERN.test(token)) {
    throw transactionError(
      "PLUGIN_TRANSACTION_TOKEN_INVALID",
      "plugin transaction owner token is invalid",
    );
  }
  const owner = {
    pid: _deps.pid(),
    startedAt: _deps.now(),
    hostname: cleanString(_deps.hostname(), 255),
    token,
  };
  validateOwner(owner);
  const initial = buildJournal({
    identity,
    owner,
    revision: 0,
    previousJournalDigest: null,
    phase: "acquired",
    transaction: null,
  });
  const lockDir = path.join(identity.nameDir, PLUGIN_TRANSACTION_LOCK_DIRNAME);
  const candidate = `${lockDir}.acquire-${token}`;
  try {
    _deps.mkdirSync(candidate, { mode: 0o700 });
    writeNewDurableJson(
      path.join(candidate, PLUGIN_TRANSACTION_OWNER_FILENAME),
      owner,
    );
    writeNewDurableJson(
      path.join(candidate, PLUGIN_TRANSACTION_JOURNAL_FILENAME),
      initial,
    );
    fsyncDirectory(candidate);
    _deps.renameSync(candidate, lockDir);
    fsyncDirectory(identity.nameDir);
  } catch (error) {
    try {
      _deps.rmSync(candidate, { recursive: true, force: true });
    } catch {
      // A uniquely-tokened acquisition directory cannot own the fixed lock.
    }
    if (_deps.existsSync(lockDir)) {
      const incumbent = safeReadOwner(lockDir);
      const locked = transactionError(
        "PLUGIN_TRANSACTION_LOCKED",
        `plugin lifecycle is already owned${incumbent?.pid ? ` by PID ${incumbent.pid}` : ""}`,
        error,
      );
      if (incumbent?.pid) locked.ownerPid = incumbent.pid;
      throw locked;
    }
    throw error;
  }
  return createHandle({ identity, owner, journal: initial, lockDir });
}

export function assertPluginTransactionLock(
  handle,
  { name, scope, nameDir, contextDigest } = {},
) {
  if (!handle || handle.kind !== "plugin-transaction-lock") {
    throw transactionError(
      "PLUGIN_TRANSACTION_LOCK_REQUIRED",
      "plugin lifecycle mutation requires an owned transaction lock",
    );
  }
  const expected = normalizeIdentity({
    name: name ?? handle.name,
    scope: scope ?? handle.scope,
    nameDir: nameDir ?? handle.nameDir,
    operation: handle.operation,
    contextDigest: contextDigest ?? handle.contextDigest,
  });
  if (
    handle.name !== expected.name ||
    handle.scope !== expected.scope ||
    handle.contextDigest !== expected.contextDigest ||
    path.resolve(handle.nameDir) !== expected.nameDir
  ) {
    throw transactionError(
      "PLUGIN_TRANSACTION_LOCK_SCOPE_MISMATCH",
      "plugin transaction lock does not match the requested name/scope",
    );
  }
  assertCurrentAuthority(handle);
  return handle;
}

export function updatePluginTransactionJournal(
  handle,
  { phase, transaction = undefined },
) {
  assertPluginTransactionLock(handle);
  const current = readAndValidateJournal(handle.lockDir, handle.owner);
  if (
    current.revision !== handle.journal.revision ||
    current.journalDigest !== handle.journal.journalDigest
  ) {
    throw transactionError(
      "PLUGIN_TRANSACTION_JOURNAL_STALE",
      "plugin transaction journal changed after this owner last observed it",
    );
  }
  const next = buildJournal({
    identity: handle,
    owner: handle.owner,
    revision: current.revision + 1,
    previousJournalDigest: current.journalDigest,
    phase,
    transaction:
      transaction === undefined ? current.transaction : cloneJson(transaction),
  });
  replaceDurableJson(
    path.join(handle.lockDir, PLUGIN_TRANSACTION_JOURNAL_FILENAME),
    next,
    handle.owner.token,
  );
  handle.journal = next;
  return cloneJson(next);
}

export function inspectPluginTransactionLock({
  name,
  scope,
  nameDir,
  contextDigest,
}) {
  const identity = normalizeIdentity({
    name,
    scope,
    nameDir,
    operation: "inspect",
    contextDigest,
  });
  const lockDir = path.join(identity.nameDir, PLUGIN_TRANSACTION_LOCK_DIRNAME);
  if (!_deps.existsSync(lockDir)) return null;
  const owner = readAndValidateOwner(lockDir);
  const journal = readAndValidateJournal(lockDir, owner);
  if (
    journal.name !== identity.name ||
    journal.scope !== identity.scope ||
    journal.contextDigest !== identity.contextDigest
  ) {
    throw transactionError(
      "PLUGIN_TRANSACTION_LOCK_SCOPE_MISMATCH",
      "plugin transaction journal does not match the requested name/scope/context",
    );
  }
  return {
    ...createHandle({
      identity: { ...identity, operation: journal.operation },
      owner,
      journal,
      lockDir,
    }),
    ownerAlive: ownerLiveness(owner),
  };
}

export function claimPluginTransactionRecovery({
  name,
  scope,
  nameDir,
  contextDigest,
  force = false,
}) {
  const inspected = inspectPluginTransactionLock({
    name,
    scope,
    nameDir,
    contextDigest,
  });
  if (!inspected) {
    throw transactionError(
      "PLUGIN_TRANSACTION_NOT_FOUND",
      "no retained plugin transaction lock exists",
    );
  }
  if (inspected.ownerAlive === true && !force) {
    throw transactionError(
      "PLUGIN_TRANSACTION_OWNER_LIVE",
      `plugin transaction owner PID ${inspected.owner.pid} is still live`,
    );
  }
  if (inspected.ownerAlive === null && !force) {
    throw transactionError(
      "PLUGIN_TRANSACTION_OWNER_UNVERIFIABLE",
      "plugin transaction owner belongs to another host; explicit force is required",
    );
  }
  const claimPath = path.join(inspected.lockDir, ".recovery-claim.json");
  acquireRecoveryClaim(claimPath, inspected, force);
  try {
    const owner = readAndValidateOwner(inspected.lockDir);
    const journal = readAndValidateJournal(inspected.lockDir, owner);
    if (
      !sameOwner(owner, inspected.owner) ||
      journal.journalDigest !== inspected.journal.journalDigest
    ) {
      throw transactionError(
        "PLUGIN_TRANSACTION_RECOVERY_STALE",
        "plugin transaction authority changed while recovery was being claimed",
      );
    }
    inspected.recoveryClaim = readRecoveryClaim(claimPath);
    inspected.journal = journal;
    return inspected;
  } catch (error) {
    releaseRecoveryClaim(claimPath, inspected.recoveryClaim);
    throw error;
  }
}

export function releasePluginTransactionLock(handle) {
  assertPluginTransactionLock(handle);
  if (handle.recoveryClaim) {
    const claim = readRecoveryClaim(
      path.join(handle.lockDir, ".recovery-claim.json"),
    );
    if (!sameRecoveryClaim(claim, handle.recoveryClaim)) {
      throw transactionError(
        "PLUGIN_TRANSACTION_RECOVERY_OWNERSHIP_LOST",
        "plugin transaction recovery claim changed before release",
      );
    }
  }
  const current = readAndValidateJournal(handle.lockDir, handle.owner);
  if (
    current.revision !== handle.journal.revision ||
    current.journalDigest !== handle.journal.journalDigest
  ) {
    throw transactionError(
      "PLUGIN_TRANSACTION_JOURNAL_STALE",
      "plugin transaction journal changed before lock release",
    );
  }
  const releasedDir = `${handle.lockDir}.release-${handle.owner.token}`;
  _deps.renameSync(handle.lockDir, releasedDir);
  fsyncDirectory(handle.nameDir);
  let cleanupPending = false;
  try {
    _deps.rmSync(releasedDir, { recursive: true, force: true });
  } catch {
    cleanupPending = true;
  }
  handle.released = true;
  return {
    released: true,
    ...(cleanupPending
      ? { cleanupPending: true, cleanupPath: releasedDir }
      : {}),
  };
}

function acquireRecoveryClaim(claimPath, inspected, force) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const claim = {
      pid: _deps.pid(),
      startedAt: _deps.now(),
      hostname: cleanString(_deps.hostname(), 255),
      token: _deps.randomToken(),
      observedOwnerToken: inspected.owner.token,
      observedJournalDigest: inspected.journal.journalDigest,
    };
    validateOwner(claim);
    try {
      writeNewDurableJson(claimPath, claim);
      fsyncDirectory(path.dirname(claimPath));
      inspected.recoveryClaim = claim;
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const incumbent = readRecoveryClaim(claimPath);
      const liveness = ownerLiveness(incumbent);
      if (liveness === true || (liveness === null && !force)) {
        throw transactionError(
          "PLUGIN_TRANSACTION_RECOVERY_LOCKED",
          "another process owns plugin transaction recovery",
          error,
        );
      }
      const stalePath = `${claimPath}.reclaim-${claim.token}`;
      try {
        _deps.renameSync(claimPath, stalePath);
      } catch (reclaimError) {
        if (reclaimError?.code === "ENOENT") continue;
        throw reclaimError;
      }
      const moved = readRecoveryClaim(stalePath);
      if (!sameRecoveryClaim(moved, incumbent)) {
        restoreMovedRecoveryClaim(stalePath, claimPath);
        throw transactionError(
          "PLUGIN_TRANSACTION_RECOVERY_STALE",
          "plugin transaction recovery owner changed while a stale claim was being fenced",
        );
      }
      const movedLiveness = ownerLiveness(moved);
      if (movedLiveness === true || (movedLiveness === null && !force)) {
        restoreMovedRecoveryClaim(stalePath, claimPath);
        throw transactionError(
          "PLUGIN_TRANSACTION_RECOVERY_LOCKED",
          "another process owns plugin transaction recovery",
        );
      }
      _deps.rmSync(stalePath, { force: true });
      fsyncDirectory(path.dirname(claimPath));
    }
  }
  throw transactionError(
    "PLUGIN_TRANSACTION_RECOVERY_LOCKED",
    "could not claim plugin transaction recovery",
  );
}

function restoreMovedRecoveryClaim(stalePath, claimPath) {
  try {
    // linkSync is exclusive when the destination exists. Keeping the moved
    // inode until the fixed path is republished prevents a check-then-rename
    // race from overwriting a third recovery owner on POSIX.
    _deps.linkSync(stalePath, claimPath);
    _deps.rmSync(stalePath, { force: true });
    fsyncDirectory(path.dirname(claimPath));
  } catch (error) {
    throw transactionError(
      "PLUGIN_TRANSACTION_RECOVERY_OWNERSHIP_LOST",
      "could not restore a recovery claim that changed during stale-owner fencing",
      error,
    );
  }
}

function releaseRecoveryClaim(claimPath, expected) {
  if (!expected) return false;
  let actual;
  try {
    actual = readRecoveryClaim(claimPath);
  } catch {
    return false;
  }
  if (!sameRecoveryClaim(actual, expected)) return false;
  _deps.rmSync(claimPath, { force: true });
  return true;
}

function createHandle({ identity, owner, journal, lockDir }) {
  return {
    kind: "plugin-transaction-lock",
    name: identity.name,
    scope: identity.scope,
    contextDigest: identity.contextDigest,
    nameDir: identity.nameDir,
    operation: identity.operation,
    lockDir,
    owner: cloneJson(owner),
    journal: cloneJson(journal),
    released: false,
  };
}

function normalizeIdentity({ name, scope, nameDir, operation, contextDigest }) {
  const normalizedName = cleanString(name, 256);
  const normalizedScope = cleanString(scope, 32);
  const normalizedOperation = cleanString(operation, 64);
  if (!normalizedName || !SCOPE_PATTERN.test(normalizedScope)) {
    throw transactionError(
      "PLUGIN_TRANSACTION_IDENTITY_INVALID",
      "plugin transaction name/scope is invalid",
    );
  }
  if (!normalizedOperation) {
    throw transactionError(
      "PLUGIN_TRANSACTION_OPERATION_INVALID",
      "plugin transaction operation is required",
    );
  }
  const rawNameDir = String(nameDir || "").trim();
  if (!rawNameDir) {
    throw transactionError(
      "PLUGIN_TRANSACTION_PATH_INVALID",
      "plugin transaction name directory is required",
    );
  }
  const resolvedNameDir = path.resolve(rawNameDir);
  if (
    !path.isAbsolute(resolvedNameDir) ||
    resolvedNameDir === path.parse(resolvedNameDir).root
  ) {
    throw transactionError(
      "PLUGIN_TRANSACTION_PATH_INVALID",
      "plugin transaction name directory is unsafe",
    );
  }
  const normalizedContextDigest =
    cleanString(contextDigest, 64) ||
    crypto
      .createHash("sha256")
      .update(`${normalizedScope}\0${resolvedNameDir}`)
      .digest("hex");
  if (!DIGEST_PATTERN.test(normalizedContextDigest)) {
    throw transactionError(
      "PLUGIN_TRANSACTION_CONTEXT_INVALID",
      "plugin transaction context digest is invalid",
    );
  }
  return {
    name: normalizedName,
    scope: normalizedScope,
    nameDir: resolvedNameDir,
    operation: normalizedOperation,
    contextDigest: normalizedContextDigest,
  };
}

function ensureSafeNameDirectory(nameDir) {
  _deps.mkdirSync(nameDir, { recursive: true, mode: 0o700 });
  const stat = _deps.lstatSync(nameDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw transactionError(
      "PLUGIN_TRANSACTION_PATH_UNSAFE",
      "plugin transaction name directory must be a real directory",
    );
  }
}

function assertCurrentAuthority(handle) {
  if (handle.released) {
    throw transactionError(
      "PLUGIN_TRANSACTION_LOCK_RELEASED",
      "plugin transaction lock has already been released",
    );
  }
  const owner = readAndValidateOwner(handle.lockDir);
  if (!sameOwner(owner, handle.owner)) {
    throw transactionError(
      "PLUGIN_TRANSACTION_LOCK_OWNERSHIP_LOST",
      "plugin transaction lock owner changed",
    );
  }
  const claimPath = path.join(handle.lockDir, ".recovery-claim.json");
  if (handle.recoveryClaim) {
    const claim = readRecoveryClaim(claimPath);
    if (!sameRecoveryClaim(claim, handle.recoveryClaim)) {
      throw transactionError(
        "PLUGIN_TRANSACTION_RECOVERY_OWNERSHIP_LOST",
        "plugin transaction recovery claim changed",
      );
    }
  } else if (_deps.existsSync(claimPath)) {
    // An explicit recovery claim fences even the original owner. This is what
    // makes --force-owner an override rather than a second concurrent writer.
    readRecoveryClaim(claimPath);
    throw transactionError(
      "PLUGIN_TRANSACTION_RECOVERY_IN_PROGRESS",
      "plugin transaction recovery has fenced the original owner",
    );
  }
}

function readAndValidateOwner(lockDir) {
  let value;
  try {
    assertSafeLockDirectory(lockDir);
    value = JSON.parse(
      readSafeAuthorityFile(
        path.join(lockDir, PLUGIN_TRANSACTION_OWNER_FILENAME),
        16 * 1024,
      ),
    );
  } catch (error) {
    throw transactionError(
      "PLUGIN_TRANSACTION_OWNER_CORRUPT",
      "plugin transaction owner metadata is unavailable or corrupt",
      error,
    );
  }
  validateOwner(value);
  return value;
}

function safeReadOwner(lockDir) {
  try {
    return readAndValidateOwner(lockDir);
  } catch {
    return null;
  }
}

function validateOwner(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    !Number.isFinite(value.startedAt) ||
    !TOKEN_PATTERN.test(value.token) ||
    typeof value.hostname !== "string" ||
    !value.hostname
  ) {
    throw transactionError(
      "PLUGIN_TRANSACTION_OWNER_CORRUPT",
      "plugin transaction owner metadata has an invalid shape",
    );
  }
}

function readAndValidateJournal(lockDir, owner) {
  let journal;
  try {
    assertSafeLockDirectory(lockDir);
    journal = JSON.parse(
      readSafeAuthorityFile(
        path.join(lockDir, PLUGIN_TRANSACTION_JOURNAL_FILENAME),
        256 * 1024,
      ),
    );
  } catch (error) {
    throw transactionError(
      "PLUGIN_TRANSACTION_JOURNAL_CORRUPT",
      "plugin transaction journal is unavailable or corrupt",
      error,
    );
  }
  const digest = journal?.journalDigest;
  const authority = { ...journal };
  delete authority.journalDigest;
  if (
    journal?.schemaVersion !== PLUGIN_TRANSACTION_JOURNAL_SCHEMA ||
    !DIGEST_PATTERN.test(journal.contextDigest || "") ||
    !Number.isSafeInteger(journal.revision) ||
    journal.revision < 0 ||
    !sameOwner(journal.owner, owner) ||
    !DIGEST_PATTERN.test(digest || "") ||
    sha256Canonical(authority) !== digest ||
    (journal.revision === 0
      ? journal.previousJournalDigest !== null
      : !DIGEST_PATTERN.test(journal.previousJournalDigest || ""))
  ) {
    throw transactionError(
      "PLUGIN_TRANSACTION_JOURNAL_CORRUPT",
      "plugin transaction journal authority or digest is invalid",
    );
  }
  return journal;
}

function buildJournal({
  identity,
  owner,
  revision,
  previousJournalDigest,
  phase,
  transaction,
}) {
  const authority = {
    schemaVersion: PLUGIN_TRANSACTION_JOURNAL_SCHEMA,
    revision,
    previousJournalDigest,
    name: identity.name,
    scope: identity.scope,
    contextDigest: identity.contextDigest,
    operation: identity.operation,
    owner: cloneJson(owner),
    phase: cleanString(phase, 64),
    transaction: transaction == null ? null : cloneJson(transaction),
    updatedAt: new Date(_deps.now()).toISOString(),
  };
  if (!authority.phase) {
    throw transactionError(
      "PLUGIN_TRANSACTION_PHASE_INVALID",
      "plugin transaction phase is required",
    );
  }
  return { ...authority, journalDigest: sha256Canonical(authority) };
}

function readRecoveryClaim(claimPath) {
  let claim;
  try {
    claim = JSON.parse(readSafeAuthorityFile(claimPath, 32 * 1024));
  } catch (error) {
    throw transactionError(
      "PLUGIN_TRANSACTION_RECOVERY_OWNER_CORRUPT",
      "plugin transaction recovery owner metadata is corrupt",
      error,
    );
  }
  validateOwner(claim);
  if (
    !TOKEN_PATTERN.test(claim.observedOwnerToken || "") ||
    !DIGEST_PATTERN.test(claim.observedJournalDigest || "")
  ) {
    throw transactionError(
      "PLUGIN_TRANSACTION_RECOVERY_OWNER_CORRUPT",
      "plugin transaction recovery observation is invalid",
    );
  }
  return claim;
}

function assertSafeLockDirectory(lockDir) {
  const stat = _deps.lstatSync(lockDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw transactionError(
      "PLUGIN_TRANSACTION_PATH_UNSAFE",
      "plugin transaction lock path is not a real directory",
    );
  }
}

function readSafeAuthorityFile(file, maxBytes) {
  const stat = _deps.lstatSync(file);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink > 1 ||
    stat.size <= 0 ||
    stat.size > maxBytes
  ) {
    throw transactionError(
      "PLUGIN_TRANSACTION_AUTHORITY_UNSAFE",
      `plugin transaction authority file is unsafe: ${path.basename(file)}`,
    );
  }
  return _deps.readFileSync(file, "utf8");
}

function ownerLiveness(owner) {
  if (owner.hostname !== cleanString(_deps.hostname(), 255)) return null;
  return _deps.isProcessAlive(owner.pid);
}

function sameOwner(left, right) {
  return Boolean(
    left &&
    right &&
    left.pid === right.pid &&
    left.startedAt === right.startedAt &&
    left.hostname === right.hostname &&
    left.token === right.token,
  );
}

function sameRecoveryClaim(left, right) {
  return Boolean(
    sameOwner(left, right) &&
    left.observedOwnerToken === right.observedOwnerToken &&
    left.observedJournalDigest === right.observedJournalDigest,
  );
}

function writeNewDurableJson(file, value) {
  let descriptor = null;
  try {
    descriptor = _deps.openSync(file, "wx", 0o600);
    _deps.writeFileSync(descriptor, `${canonicalJson(value)}\n`, "utf8");
    _deps.fsyncSync(descriptor);
  } finally {
    if (descriptor != null) _deps.closeSync(descriptor);
  }
}

function replaceDurableJson(file, value, token) {
  const attemptToken = _deps.randomToken();
  if (!TOKEN_PATTERN.test(attemptToken)) {
    throw transactionError(
      "PLUGIN_TRANSACTION_TOKEN_INVALID",
      "plugin transaction journal token is invalid",
    );
  }
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${token}.${value.revision}.${attemptToken}.tmp`,
  );
  try {
    writeNewDurableJson(temporary, value);
    _deps.renameSync(temporary, file);
    fsyncDirectory(path.dirname(file));
  } finally {
    try {
      _deps.rmSync(temporary, { force: true });
    } catch {
      // A failed temp cleanup cannot alter the authoritative journal path.
    }
  }
}

function fsyncDirectory(directory) {
  let descriptor = null;
  try {
    descriptor = _deps.openSync(directory, "r");
    _deps.fsyncSync(descriptor);
    return true;
  } catch (error) {
    if (
      process.platform === "win32" &&
      ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code)
    ) {
      return false;
    }
    throw error;
  } finally {
    if (descriptor != null) _deps.closeSync(descriptor);
  }
}

function transactionError(code, message, cause = null) {
  const error = cause ? new Error(message, { cause }) : new Error(message);
  error.code = code;
  return error;
}

function cleanString(value, max) {
  return String(value ?? "")
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, max);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sha256Canonical(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}
