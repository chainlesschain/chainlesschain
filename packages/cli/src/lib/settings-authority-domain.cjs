"use strict";

/**
 * Explicit, cooperative Linux persistence for settings-authority records.
 * This module is not wired into permission admission or the official settings
 * writer. Callers must provide the complete trusted set of rollbackable config
 * and admitted writable roots. There is no default path or implicit enrollment.
 *
 * The existing private directory and its ancestors must already be durably
 * provisioned. Pinning does not prove a preceding mkdir was persisted in its
 * parent. All child
 * I/O uses that dirfd; exported launch data retains its identity and namespace.
 * Ordinary replacement, missing witnesses and unfinished writes fail closed.
 * This is not protection against a hostile same-UID owner deleting/rolling back
 * the whole external domain, or raw settings ABA between observations. Other
 * platforms are refused until equivalent directory durability is implemented.
 */
const fsDefault = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { TextDecoder, types } = require("node:util");
const records = require("./settings-authority-record.cjs");

const DOMAIN_SCHEMA = "chainlesschain.settings-authority-domain/v1";
const TRANSACTION_SCHEMA = "chainlesschain.settings-authority-transaction/v1";
const NAMESPACE = "namespace.json";
const LEDGER = "ledger.json";
const GUARD = "guard.json";
const MAX_BYTES = records.LIMITS.recordBytes;
const DIRECTORY_FIELDS = ["dev", "ino", "mode", "uid"];
const FILE_FIELDS = [
  "dev",
  "ino",
  "mode",
  "uid",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
];
const domains = new WeakMap();
let lockHelper;

function failure(code, cause = null) {
  const error = new Error(
    "Persistent settings authority is unavailable",
    cause ? { cause } : undefined,
  );
  error.name = "SettingsAuthorityDomainError";
  error.code = code;
  return error;
}

function refuse(code, cause) {
  throw failure(code, cause);
}

function sameFields(left, right, fields) {
  return fields.every(
    (field) =>
      left[field] !== undefined &&
      right[field] !== undefined &&
      String(left[field]) === String(right[field]),
  );
}

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function canonicalData(value) {
  if (Array.isArray(value)) return value.map(canonicalData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalData(value[key])]),
  );
}

function sameData(left, right) {
  return (
    JSON.stringify(canonicalData(left)) === JSON.stringify(canonicalData(right))
  );
}

// Launch descriptors are data, never capability callbacks or coercible objects.
function plainCopy(value, depth = 0) {
  if (depth > 12) refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string" && Buffer.byteLength(value) <= 4096)
    return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (!value || typeof value !== "object" || types.isProxy(value))
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (
    array
      ? proto !== Array.prototype
      : proto !== Object.prototype && proto !== null
  )
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > 1024 || keys.some((key) => typeof key !== "string"))
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  const result = array ? [] : {};
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = descriptors[key];
    if (
      !Object.hasOwn(descriptor, "value") ||
      !descriptor.enumerable ||
      key === "__proto__" ||
      (array && !/^(0|[1-9][0-9]*)$/.test(key))
    )
      refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
    result[key] = plainCopy(descriptor.value, depth + 1);
  }
  if (
    array &&
    (result.length !== value.length || keys.length !== value.length + 1)
  )
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  return result;
}

function shape(value, expected) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
}

function absolute(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    !path.isAbsolute(value) ||
    Buffer.byteLength(value) > 4096
  )
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  return path.resolve(value);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function statOrAbsent(fs, file) {
  try {
    return fs.lstatSync(file, { bigint: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  }
}

function privateStat(stat, directory) {
  if (
    !stat ||
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n) ||
    stat.uid !== BigInt(process.getuid()) ||
    (stat.mode & 0o077n) !== 0n
  )
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_UNSAFE");
}

function directoryIdentity(stat) {
  return Object.fromEntries(
    DIRECTORY_FIELDS.map((field) => [field, String(stat[field])]),
  );
}

function rootBinding(fs, root) {
  const logicalPath = absolute(root);
  let parent = logicalPath;
  const remaining = [];
  let stat;
  while (!(stat = statOrAbsent(fs, parent))) {
    const next = path.dirname(parent);
    if (next === parent) refuse("CC_SETTINGS_AUTHORITY_DOMAIN_UNSAFE");
    remaining.unshift(path.basename(parent));
    parent = next;
  }
  if (
    !stat.isDirectory() &&
    !(stat.isSymbolicLink() && fs.statSync(parent).isDirectory())
  )
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_UNSAFE");
  const physicalParent = fs.realpathSync(parent);
  const fd = fs.openSync(
    physicalParent,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    const held = fs.fstatSync(fd, { bigint: true });
    if (!held.isDirectory()) refuse("CC_SETTINGS_AUTHORITY_DOMAIN_UNSAFE");
    return {
      logicalPath,
      physicalPath: path.join(physicalParent, ...remaining),
      parentPath: physicalParent,
      identity: { dev: String(held.dev), ino: String(held.ino) },
    };
  } finally {
    fs.closeSync(fd);
  }
}

function openDirectory({ directory, forbiddenRoots, _fs = fsDefault }) {
  if (process.platform !== "linux")
    refuse("CC_SETTINGS_AUTHORITY_PLATFORM_UNSUPPORTED");
  const fs = _fs;
  const requested = absolute(directory);
  const inputs = plainCopy(forbiddenRoots);
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 64)
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  const roots = inputs.map((root) => rootBinding(fs, root));
  const entry = fs.lstatSync(requested, { bigint: true });
  privateStat(entry, true);
  const canonicalPath = fs.realpathSync(requested);
  // Use an explicitly provisioned real directory, including its ancestors.
  if (canonicalPath !== requested)
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_UNSAFE");
  if (
    roots.some(
      (root) =>
        inside(root.physicalPath, canonicalPath) ||
        inside(canonicalPath, root.physicalPath),
    )
  )
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP");
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      canonicalPath,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
    const held = fs.fstatSync(descriptor, { bigint: true });
    privateStat(held, true);
    if (!sameFields(entry, held, DIRECTORY_FIELDS))
      refuse("CC_SETTINGS_AUTHORITY_DOMAIN_CHANGED");
    const state = {
      fs,
      descriptor,
      canonicalPath,
      root: `/proc/self/fd/${descriptor}`,
      identity: directoryIdentity(held),
      forbiddenRoots: roots,
      namespace: null,
      busy: false,
      closed: false,
      intern: new Map(),
      lastLocalRevision: null,
    };
    if (
      !sameFields(
        fs.statSync(state.root, { bigint: true }),
        held,
        DIRECTORY_FIELDS,
      )
    )
      refuse("CC_SETTINGS_AUTHORITY_DOMAIN_CHANGED");
    verifyDirectory(state);
    return state;
  } catch (cause) {
    if (descriptor !== null) fs.closeSync(descriptor);
    throw cause;
  }
}

function verifyDirectory(state) {
  if (state.closed) refuse("CC_SETTINGS_AUTHORITY_DOMAIN_CLOSED");
  const { fs } = state;
  const held = fs.fstatSync(state.descriptor, { bigint: true });
  const entry = fs.lstatSync(state.canonicalPath, { bigint: true });
  privateStat(held, true);
  privateStat(entry, true);
  if (
    !sameFields(state.identity, held, DIRECTORY_FIELDS) ||
    !sameFields(held, entry, DIRECTORY_FIELDS) ||
    fs.realpathSync(state.canonicalPath) !== state.canonicalPath
  )
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_CHANGED");
  for (const root of state.forbiddenRoots) {
    const current = rootBinding(fs, root.logicalPath);
    if (!sameData(current, root))
      refuse("CC_SETTINGS_AUTHORITY_DOMAIN_CHANGED");
  }
}

function child(state, name) {
  return path.posix.join(state.root, name);
}

function readJson(state, name, { absent = false } = {}) {
  const { fs } = state;
  const file = child(state, name);
  const entry = statOrAbsent(fs, file);
  if (!entry) {
    if (absent) return null;
    refuse("CC_SETTINGS_AUTHORITY_WITNESS_MISSING");
  }
  privateStat(entry, false);
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    privateStat(before, false);
    if (
      !sameFields(entry, before, FILE_FIELDS) ||
      before.size > BigInt(MAX_BYTES)
    )
      refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    for (;;) {
      const count = fs.readSync(
        fd,
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!count) break;
      length += count;
      if (length === buffer.length)
        refuse("CC_SETTINGS_AUTHORITY_DOMAIN_CHANGED");
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const published = fs.lstatSync(file, { bigint: true });
    if (
      !sameFields(before, after, FILE_FIELDS) ||
      !sameFields(after, published, FILE_FIELDS) ||
      BigInt(length) !== after.size
    )
      refuse("CC_SETTINGS_AUTHORITY_DOMAIN_CHANGED");
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(buffer.subarray(0, length));
    return JSON.parse(text);
  } finally {
    fs.closeSync(fd);
  }
}

function validateNamespace(value) {
  const data = plainCopy(value);
  shape(data, [
    "schema",
    "platform",
    "domainId",
    "epoch",
    "directory",
    "identity",
    "forbiddenRoots",
  ]);
  if (
    data.schema !== DOMAIN_SCHEMA ||
    data.platform !== "linux" ||
    !/^[0-9a-f-]{36}$/.test(data.domainId) ||
    !/^[0-9a-f-]{36}$/.test(data.epoch) ||
    absolute(data.directory) !== data.directory
  )
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  shape(data.identity, DIRECTORY_FIELDS);
  if (
    DIRECTORY_FIELDS.some(
      (field) =>
        typeof data.identity[field] !== "string" ||
        !/^(0|[1-9][0-9]{0,39})$/.test(data.identity[field]),
    )
  )
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  if (
    !Array.isArray(data.forbiddenRoots) ||
    !data.forbiddenRoots.length ||
    data.forbiddenRoots.length > 64
  )
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  for (const root of data.forbiddenRoots) {
    shape(root, ["logicalPath", "physicalPath", "parentPath", "identity"]);
    for (const key of ["logicalPath", "physicalPath", "parentPath"])
      if (absolute(root[key]) !== root[key])
        refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
    shape(root.identity, ["dev", "ino"]);
    if (
      [root.identity.dev, root.identity.ino].some(
        (item) =>
          typeof item !== "string" || !/^(0|[1-9][0-9]{0,39})$/.test(item),
      )
    )
      refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  }
  return freeze(data);
}

function verifyNamespace(state) {
  verifyDirectory(state);
  const observed = validateNamespace(readJson(state, NAMESPACE));
  if (!sameData(observed, state.namespace))
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_CHANGED");
}

function authorityLedger(state) {
  const ledger = records.validateLedger({ record: readJson(state, LEDGER) });
  if (ledger.epoch !== state.namespace.epoch || ledger.platform !== "posix")
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_CHANGED");
  for (const head of ledger.physicalHeads)
    if (inside(state.canonicalPath, head.physicalPath))
      refuse("CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP");
  return ledger;
}

function guardAbsent(state) {
  // Any guard entry blocks: invalid JSON, link, permissions and I/O errors are
  // not positive evidence of absence and must never become a fresh baseline.
  if (statOrAbsent(state.fs, child(state, GUARD)))
    refuse("CC_SETTINGS_AUTHORITY_NOT_READY");
}

function handleFor(state) {
  const handle = Object.freeze({});
  domains.set(handle, state);
  return handle;
}

function stateFor(handle) {
  const state = domains.get(handle);
  if (!state) refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  if (state.closed) refuse("CC_SETTINGS_AUTHORITY_DOMAIN_CLOSED");
  return state;
}

function pinSettingsAuthorityDomain(options) {
  const state = openDirectory(options);
  try {
    state.namespace = validateNamespace(readJson(state, NAMESPACE));
    if (
      state.namespace.directory !== state.canonicalPath ||
      !sameData(state.namespace.identity, state.identity) ||
      !sameData(state.namespace.forbiddenRoots, state.forbiddenRoots)
    )
      refuse("CC_SETTINGS_AUTHORITY_DOMAIN_CHANGED");
    verifyNamespace(state);
    // Pinning may inspect a pending domain for explicit recovery. It grants no
    // ready snapshot; readSettingsAuthority still rejects guard/prepared.
    return handleFor(state);
  } catch (cause) {
    state.fs.closeSync(state.descriptor);
    throw cause;
  }
}

function exportSettingsAuthorityDomain(handle) {
  const state = stateFor(handle);
  verifyNamespace(state);
  return state.namespace;
}

function reopenSettingsAuthorityDomain({ descriptor, _fs = fsDefault }) {
  const expected = validateNamespace(descriptor);
  const handle = pinSettingsAuthorityDomain({
    directory: expected.directory,
    forbiddenRoots: expected.forbiddenRoots.map((root) => root.logicalPath),
    _fs,
  });
  if (!sameData(exportSettingsAuthorityDomain(handle), expected)) {
    closeSettingsAuthorityDomain(handle);
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_CHANGED");
  }
  return handle;
}

function closeSettingsAuthorityDomain(handle) {
  const state = stateFor(handle);
  if (state.busy) refuse("CC_SETTINGS_AUTHORITY_REENTRY");
  state.closed = true;
  state.intern.clear();
  state.fs.closeSync(state.descriptor);
}

function locked(state, callback) {
  if (state.busy) refuse("CC_SETTINGS_AUTHORITY_REENTRY");
  state.busy = true;
  try {
    verifyDirectory(state);
    lockHelper ??= require("./with-file-lock.js").withFileLock;
    return lockHelper(
      child(state, LEDGER),
      () => {
        verifyDirectory(state);
        return callback();
      },
      { failIfUnavailable: true, _fs: state.fs, timeoutMs: 5000 },
    );
  } finally {
    state.busy = false;
  }
}

function atomicJson(state, name, value) {
  const { fs } = state;
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (bytes.length > MAX_BYTES) refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  const target = child(state, name);
  const previous = statOrAbsent(fs, target);
  if (previous) privateStat(previous, false);
  const temporary = child(state, `.${name}.${process.pid}.${randomUUID()}.tmp`);
  let fd = null;
  let renamed = false;
  try {
    fd = fs.openSync(
      temporary,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporary, target);
    renamed = true;
    fs.fsyncSync(state.descriptor);
    verifyDirectory(state);
  } catch (cause) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* preserve failure */
      }
    }
    if (!renamed) {
      try {
        fs.unlinkSync(temporary);
      } catch {
        /* orphan is not authority */
      }
    }
    const error = failure("CC_SETTINGS_AUTHORITY_PERSIST_FAILED", cause);
    error.authorityCommitState = renamed ? "unknown" : "not-committed";
    throw error;
  }
}

function removeGuard(state) {
  state.fs.unlinkSync(child(state, GUARD));
  state.fs.fsyncSync(state.descriptor);
  verifyNamespace(state);
}

function transactionWitness(pending) {
  const witness = {
    schema: TRANSACTION_SCHEMA,
    guard: pending.guard,
    prepared: pending.prepared,
  };
  // Reject an overlarge transaction before publishing a guard/revoking locally.
  if (Buffer.byteLength(JSON.stringify(witness)) + 1 > MAX_BYTES)
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  return witness;
}

function readTransaction(state) {
  const value = readJson(state, GUARD);
  shape(value, ["schema", "guard", "prepared"]);
  if (value.schema !== TRANSACTION_SCHEMA)
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  const prepared = records.validateLedger({ record: value.prepared });
  const guard = records.validateGuard({ guard: value.guard, prepared });
  if (guard.epoch !== state.namespace.epoch || guard.platform !== "posix")
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_CHANGED");
  return { prepared, guard };
}

function initializeSettingsAuthorityDomain({
  directory,
  forbiddenRoots,
  contexts,
  observeContexts,
  _fs = fsDefault,
}) {
  const state = openDirectory({ directory, forbiddenRoots, _fs });
  try {
    locked(state, () => {
      if (
        [NAMESPACE, LEDGER, GUARD].some((name) =>
          statOrAbsent(state.fs, child(state, name)),
        )
      )
        refuse("CC_SETTINGS_AUTHORITY_ALREADY_INITIALIZED");
      state.namespace = validateNamespace({
        schema: DOMAIN_SCHEMA,
        platform: "linux",
        domainId: randomUUID(),
        epoch: randomUUID(),
        directory: state.canonicalPath,
        identity: state.identity,
        forbiddenRoots: state.forbiddenRoots,
      });
      const ledger = records.createInitialLedger({
        epoch: state.namespace.epoch,
        contexts,
      });
      for (const head of ledger.physicalHeads)
        if (inside(state.canonicalPath, head.physicalPath))
          refuse("CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP");
      observeReady(ledger, observeContexts);
      // A surviving namespace forbids repeating generation-zero enrollment if
      // initial ledger publication fails or is subsequently removed.
      atomicJson(state, NAMESPACE, state.namespace);
      atomicJson(state, LEDGER, ledger);
      verifyNamespace(state);
      observeReady(ledger, observeContexts);
    });
    return handleFor(state);
  } catch (cause) {
    state.fs.closeSync(state.descriptor);
    throw cause;
  }
}

function synchronous(callback, argument) {
  if (
    typeof callback !== "function" ||
    callback.constructor?.name === "AsyncFunction"
  )
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  const result = callback(argument);
  if (result && typeof result.then === "function")
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
  return result;
}

function requireSynchronous(callback) {
  if (
    typeof callback !== "function" ||
    callback.constructor?.name === "AsyncFunction"
  )
    refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
}

function observeReady(ledger, observeContexts) {
  const contexts = synchronous(observeContexts, ledger.contexts);
  if (!Array.isArray(contexts) || contexts.length !== ledger.contexts.length)
    refuse("CC_SETTINGS_AUTHORITY_BINDING_CHANGED");
  for (let i = 0; i < contexts.length; i++) {
    if (contexts[i]?.contextId !== ledger.contexts[i].contextId)
      refuse("CC_SETTINGS_AUTHORITY_BINDING_CHANGED");
    records.assertContextMatches({ ledger, manifest: contexts[i] });
  }
  return contexts;
}

function readSettingsAuthority(
  handle,
  { observeContexts, localRevision = null } = {},
) {
  const state = stateFor(handle);
  const beforeLocal = localRevision ? synchronous(localRevision) : null;
  verifyNamespace(state);
  guardAbsent(state);
  const before = authorityLedger(state);
  if (before.phase !== "ready") refuse("CC_SETTINGS_AUTHORITY_NOT_READY");
  observeReady(before, observeContexts);
  const after = authorityLedger(state);
  if (
    records.recordDigest({ record: before }) !==
    records.recordDigest({ record: after })
  )
    refuse("CC_SETTINGS_AUTHORITY_CHANGED");
  guardAbsent(state);
  verifyNamespace(state);
  if (localRevision && synchronous(localRevision) !== beforeLocal)
    refuse("CC_SETTINGS_AUTHORITY_CHANGED");
  const key = `${before.epoch}:${before.generation}:${records.recordDigest({ record: before })}`;
  let snapshot = state.intern.get(key);
  if (state.lastLocalRevision !== beforeLocal) snapshot = null;
  if (!snapshot) {
    snapshot = freeze({
      domainId: state.namespace.domainId,
      epoch: before.epoch,
      generation: before.generation,
      digest: records.recordDigest({ record: before }),
      state: "ready",
    });
    // One current tuple is enough for reference comparisons. Old permits keep
    // their own snapshot; every subsequent call rereads the durable authority.
    state.intern.clear();
    state.intern.set(key, snapshot);
    state.lastLocalRevision = beforeLocal;
  }
  return Object.freeze({ ledger: before, contexts: before.contexts, snapshot });
}

function transitionSettingsAuthority(
  handle,
  {
    intent,
    observeContexts,
    replace,
    revokeLocal,
    transactionId = randomUUID(),
  } = {},
) {
  const state = stateFor(handle);
  // Snapshot caller data before any callback. These are trusted host APIs, but
  // mutable intents must not turn an already-validated no-op into a mutation.
  intent = plainCopy(intent);
  requireSynchronous(observeContexts);
  requireSynchronous(revokeLocal);
  if (intent.kind === "write") requireSynchronous(replace);
  let settingsCommitState = "not-committed";
  let guarded = false;
  let ready = false;
  let cleanupComplete = false;
  try {
    return locked(state, () => {
      const perform = () => {
        const current = readSettingsAuthority(handle, { observeContexts });
        if (
          intent.kind === "register" &&
          current.ledger.contexts.some(
            (context) => context.contextId === intent.manifest?.contextId,
          )
        ) {
          shape(intent, ["kind", "manifest"]);
          records.assertContextMatches({
            ledger: current.ledger,
            manifest: intent.manifest,
          });
          return {
            changed: false,
            snapshot: current.snapshot,
            commitState: "not-committed",
          };
        }
        const pending = records.prepareTransition({
          ledger: current.ledger,
          transactionId,
          intent,
        });
        if (
          pending.prepared.transition.intent.kind === "register" &&
          pending.prepared.transition.intent.manifest.sources.some((source) =>
            inside(state.canonicalPath, source.physicalPath),
          )
        )
          refuse("CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP");
        const target =
          intent.kind === "write"
            ? current.ledger.physicalHeads.find(
                (head) => head.physicalPath === intent.physicalPath,
              )
            : null;
        if (
          target &&
          ["exists", "byteLength", "digest"].every(
            (key) => target[key] === intent.after[key],
          )
        )
          return {
            changed: false,
            snapshot: current.snapshot,
            commitState: "not-committed",
          };
        const witness = transactionWitness(pending);
        synchronous(revokeLocal);
        atomicJson(state, GUARD, witness);
        guarded = true;
        atomicJson(state, LEDGER, pending.prepared);
        if (pending.prepared.transition.intent.kind === "write") {
          try {
            synchronous(replace, pending.prepared.transition.intent);
            settingsCommitState = "committed";
          } catch (cause) {
            settingsCommitState = [
              "not-committed",
              "committed",
              "unknown",
            ].includes(cause?.commitState)
              ? cause.commitState
              : "unknown";
            throw cause;
          }
        }
        const expected =
          pending.prepared.transition.intent.kind === "register"
            ? [
                ...pending.prepared.contexts,
                pending.prepared.transition.intent.manifest,
              ]
            : pending.prepared.contexts;
        const contexts = synchronous(observeContexts, expected);
        const settled = records.settleTransition({
          ...pending,
          contexts,
          outcome: "after",
        });
        if (
          settled.physicalHeads.some((head) =>
            inside(state.canonicalPath, head.physicalPath),
          )
        )
          refuse("CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP");
        atomicJson(state, LEDGER, settled);
        ready = true;
        removeGuard(state);
        cleanupComplete = true;
        return {
          changed: true,
          generation: settled.generation,
          commitState: settingsCommitState,
          authorityState: "ready",
        };
      };
      if (intent.kind !== "write") return perform();
      const admission = readSettingsAuthority(handle, { observeContexts });
      records.prepareTransition({
        ledger: admission.ledger,
        transactionId,
        intent,
      });
      // Fixed authority -> source lock order. The core refuses writes without
      // an existing direct parent, so no source mkdir happens before the guard.
      const physicalPath = absolute(intent.physicalPath);
      if (physicalPath !== intent.physicalPath)
        refuse("CC_SETTINGS_AUTHORITY_DOMAIN_INVALID");
      return lockHelper(physicalPath, perform, {
        failIfUnavailable: true,
        _fs: state.fs,
        timeoutMs: 5000,
      });
    });
  } catch (cause) {
    const error = failure("CC_SETTINGS_AUTHORITY_TRANSITION_FAILED", cause);
    error.commitState = settingsCommitState;
    let guardPresent = guarded;
    try {
      guardPresent ||= Boolean(statOrAbsent(state.fs, child(state, GUARD)));
    } catch {
      guardPresent = true;
    }
    error.authorityState = cleanupComplete
      ? "ready"
      : ready
        ? "ready-cleanup-unconfirmed"
        : guardPresent
          ? "blocked"
          : "unchanged";
    throw error;
  }
}

function recoverSettingsAuthority(
  handle,
  { transactionId, observeContexts, outcome } = {},
) {
  const state = stateFor(handle);
  return locked(state, () => {
    verifyNamespace(state);
    const { prepared, guard } = readTransaction(state);
    if (guard.transactionId !== transactionId)
      refuse("CC_SETTINGS_AUTHORITY_TRANSACTION_MISMATCH");
    const initial = authorityLedger(state);
    if (initial.phase === "prepared") {
      if (
        records.recordDigest({ record: initial }) !==
        records.recordDigest({ record: prepared })
      )
        refuse("CC_SETTINGS_AUTHORITY_TRANSACTION_MISMATCH");
    } else if (
      initial.generation !== guard.generation &&
      records.recordDigest({ record: initial }) !== guard.beforeDigest
    )
      refuse("CC_SETTINGS_AUTHORITY_TRANSACTION_MISMATCH");
    const perform = () => {
      const ledger = authorityLedger(state);
      const expected =
        prepared.transition.intent.kind === "register" && outcome === "after"
          ? [...prepared.contexts, prepared.transition.intent.manifest]
          : prepared.contexts;
      const contexts = synchronous(observeContexts, expected);
      const settled = records.settleTransition({
        prepared,
        guard,
        contexts,
        outcome,
      });
      if (
        settled.physicalHeads.some((head) =>
          inside(state.canonicalPath, head.physicalPath),
        )
      )
        refuse("CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP");
      if (ledger.phase === "ready" && ledger.generation === guard.generation) {
        // The guard retains the bounded before record, so cleanup can prove the
        // exact derived ready tuple instead of treating generation alone as proof.
        if (
          records.recordDigest({ record: ledger }) !==
          records.recordDigest({ record: settled })
        )
          refuse("CC_SETTINGS_AUTHORITY_TRANSACTION_MISMATCH");
      } else if (ledger.phase === "ready") {
        if (records.recordDigest({ record: ledger }) !== guard.beforeDigest)
          refuse("CC_SETTINGS_AUTHORITY_TRANSACTION_MISMATCH");
      } else if (
        records.recordDigest({ record: ledger }) !==
        records.recordDigest({ record: prepared })
      )
        refuse("CC_SETTINGS_AUTHORITY_TRANSACTION_MISMATCH");
      // Both guard-only recovery and verified-old recovery consume g + 1.
      atomicJson(state, LEDGER, settled);
      removeGuard(state);
      return {
        generation: settled.generation,
        authorityState: "ready",
        outcome,
      };
    };
    if (guard.intent.kind !== "write") return perform();
    return lockHelper(guard.intent.physicalPath, perform, {
      failIfUnavailable: true,
      _fs: state.fs,
      timeoutMs: 5000,
    });
  });
}

module.exports = {
  DOMAIN_SCHEMA,
  initializeSettingsAuthorityDomain,
  pinSettingsAuthorityDomain,
  exportSettingsAuthorityDomain,
  reopenSettingsAuthorityDomain,
  closeSettingsAuthorityDomain,
  readSettingsAuthority,
  transitionSettingsAuthority,
  recoverSettingsAuthority,
};
