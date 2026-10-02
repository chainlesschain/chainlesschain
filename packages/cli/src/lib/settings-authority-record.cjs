"use strict";

/**
 * Pure records for the cooperative settings-authority protocol. This module
 * performs no I/O, enrollment, locking, recovery, or permission admission.
 * Callers must publish guard -> prepared -> settings -> ready durably, then
 * remove the guard. Construction of a record is not evidence of persistence.
 *
 * A write changes one physical source, including every registered alias.
 * Parent materialization is deliberately unsupported: a changed parent binding
 * cannot be accepted merely because the resulting content has the right hash.
 */
const path = require("node:path");
const { createHash } = require("node:crypto");
const { types } = require("node:util");

const LEDGER_SCHEMA = "chainlesschain.settings-authority/v1";
const GUARD_SCHEMA = "chainlesschain.settings-authority-guard/v1";
const LIMITS = Object.freeze({
  contexts: 64,
  sourcesPerContext: 64,
  sources: 1024,
  discoveryPaths: 64,
  pathBytes: 4096,
  recordBytes: 4 * 1024 * 1024,
  sourceBytes: 1024 * 1024,
});
const SOURCE_KEYS = [
  "logicalPath",
  "physicalPath",
  "nearestExistingParent",
  "remainingPath",
  "parentIdentity",
  "exists",
  "byteLength",
  "digest",
  "fileIdentity",
];
const FILE_FIELDS = [
  "dev",
  "ino",
  "mode",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
];

function fail(code = "CC_SETTINGS_AUTHORITY_RECORD_INVALID") {
  const error = new Error(
    "Settings authority record is invalid or inconsistent",
  );
  error.name = "SettingsAuthorityRecordError";
  error.code = code;
  throw error;
}

// Reject accessors/Proxy/toJSON before any property read. Never invoke caller
// code during validation; limits apply before recursive copying/stringifying.
function copyData(value) {
  let nodes = 0;
  let stringBytes = 0;
  const ancestors = new Set();
  function visit(input, depth) {
    if (++nodes > 100000 || depth > 24) fail();
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "string") {
      stringBytes += Buffer.byteLength(input);
      if (stringBytes > LIMITS.recordBytes) fail();
      return input;
    }
    if (typeof input === "number") {
      if (!Number.isSafeInteger(input)) fail();
      return input;
    }
    if (!input || typeof input !== "object" || types.isProxy(input)) fail();
    if (ancestors.has(input)) fail();
    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    if (
      array
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      fail();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) fail();
    if (array && input.length > 4096) fail();
    const output = array ? [] : {};
    ancestors.add(input);
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = descriptors[key];
      if (
        !Object.hasOwn(descriptor, "value") ||
        !descriptor.enumerable ||
        key === "__proto__"
      )
        fail();
      if (
        array &&
        (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= input.length)
      )
        fail();
      Object.defineProperty(output, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    ancestors.delete(input);
    if (
      array &&
      (output.length !== input.length || keys.length !== input.length + 1)
    )
      fail();
    return output;
  }
  const result = visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.recordBytes) fail();
  return result;
}

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function shape(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail();
}

function list(value, max, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail();
}

function identifier(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  )
    fail();
}

function generation(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
}

function hash(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail();
}

function platformName(value) {
  if (value === "win32") return value;
  if (
    ["posix", "linux", "darwin", "freebsd", "openbsd", "aix", "sunos"].includes(
      value,
    )
  )
    return "posix";
  fail();
}

function normalizedPath(value, platform, absolute = true) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    Buffer.byteLength(value) > LIMITS.pathBytes
  )
    fail();
  const api = platform === "win32" ? path.win32 : path.posix;
  if (absolute) {
    if (!api.isAbsolute(value)) fail();
    if (
      platform === "win32" &&
      !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/])/i.test(value)
    )
      fail();
  } else if (
    api.isAbsolute(value) ||
    (platform === "win32" && /^[a-z]:/i.test(value))
  )
    fail();
  let result = api.normalize(value);
  if (platform === "win32") {
    if (result.startsWith("\\\\?\\") || result.startsWith("\\\\.\\")) fail();
    const segments = result
      .replace(/^[a-z]:/i, "")
      .split("\\")
      .filter(Boolean);
    if (
      segments.some(
        (segment) => /[.: ]$/.test(segment) || segment.includes(":"),
      )
    )
      fail();
    result = result.toLowerCase();
  }
  if (
    !absolute &&
    (result === "." || result === ".." || result.startsWith(`..${api.sep}`))
  )
    fail();
  return result;
}

function identity(value, fields) {
  shape(value, fields);
  for (const field of fields) {
    const signed = field === "mtimeNs" || field === "ctimeNs";
    if (
      typeof value[field] !== "string" ||
      value[field].length > 40 ||
      !(signed ? /^(?:0|-?[1-9][0-9]*)$/ : /^(?:0|[1-9][0-9]*)$/).test(
        value[field],
      )
    )
      fail();
  }
}

function content(value) {
  if (
    typeof value.exists !== "boolean" ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 0 ||
    value.byteLength > LIMITS.sourceBytes
  )
    fail();
  if (value.exists) hash(value.digest);
  else if (value.byteLength !== 0 || value.digest !== null) fail();
}

function validateSource(value, platform) {
  shape(value, SOURCE_KEYS);
  for (const key of ["logicalPath", "physicalPath", "nearestExistingParent"])
    if (normalizedPath(value[key], platform) !== value[key]) fail();
  if (
    normalizedPath(value.remainingPath, platform, false) !== value.remainingPath
  )
    fail();
  const api = platform === "win32" ? path.win32 : path.posix;
  if (
    api.join(value.nearestExistingParent, value.remainingPath) !==
    value.physicalPath
  )
    fail();
  identity(value.parentIdentity, ["dev", "ino"]);
  content(value);
  if (value.exists) {
    identity(value.fileIdentity, FILE_FIELDS);
    if (
      value.fileIdentity.nlink !== "1" ||
      BigInt(value.fileIdentity.size) !== BigInt(value.byteLength) ||
      (BigInt(value.fileIdentity.mode) & 0o170000n) !== 0o100000n ||
      api.dirname(value.physicalPath) !== value.nearestExistingParent
    )
      fail();
  } else if (value.fileIdentity !== null) fail();
}

function validateManifest(manifest, platform) {
  shape(manifest, ["contextId", "discovery", "sources"]);
  identifier(manifest.contextId);
  list(manifest.discovery, LIMITS.discoveryPaths, 1);
  for (const item of manifest.discovery)
    if (normalizedPath(item, platform) !== item) fail();
  list(manifest.sources, LIMITS.sourcesPerContext, 1);
  for (const source of manifest.sources) validateSource(source, platform);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

function equal(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function headOf(source) {
  const head = { ...source };
  delete head.logicalPath;
  return head;
}

function inverseHeads(contexts, platform) {
  list(contexts, LIMITS.contexts);
  const ids = new Set();
  const logical = new Map();
  const heads = new Map();
  const inodes = new Map();
  let sourceCount = 0;
  for (const manifest of contexts) {
    validateManifest(manifest, platform);
    if (ids.has(manifest.contextId)) fail();
    ids.add(manifest.contextId);
    sourceCount += manifest.sources.length;
    if (sourceCount > LIMITS.sources) fail();
    for (const source of manifest.sources) {
      const previous = logical.get(source.logicalPath);
      if (previous && !equal(previous, source))
        fail("CC_SETTINGS_AUTHORITY_BINDING_CHANGED");
      logical.set(source.logicalPath, source);
      const head = headOf(source);
      const known = heads.get(source.physicalPath);
      if (known && !equal(known, head))
        fail("CC_SETTINGS_AUTHORITY_BINDING_CHANGED");
      heads.set(source.physicalPath, head);
      if (source.exists) {
        const inode = `${source.fileIdentity.dev}:${source.fileIdentity.ino}`;
        const previousPath = inodes.get(inode);
        // A final-component alias that canonical parent resolution missed must
        // not create a second head. Reject it instead of inventing equivalence.
        if (previousPath && previousPath !== source.physicalPath)
          fail("CC_SETTINGS_AUTHORITY_BINDING_CHANGED");
        inodes.set(inode, source.physicalPath);
      }
    }
  }
  return [...heads.values()].sort((a, b) =>
    a.physicalPath < b.physicalPath
      ? -1
      : a.physicalPath > b.physicalPath
        ? 1
        : 0,
  );
}

function readyRecord({ platform, epoch, generation: revision, contexts }) {
  return {
    schema: LEDGER_SCHEMA,
    platform,
    epoch,
    generation: revision,
    phase: "ready",
    transactionId: null,
    transition: null,
    contexts,
    physicalHeads: inverseHeads(contexts, platform),
  };
}

function validateIntent(intent, platform) {
  if (intent?.kind === "register") {
    shape(intent, ["kind", "manifest"]);
    validateManifest(intent.manifest, platform);
  } else if (intent?.kind === "write") {
    shape(intent, ["kind", "physicalPath", "after"]);
    if (normalizedPath(intent.physicalPath, platform) !== intent.physicalPath)
      fail();
    shape(intent.after, ["exists", "byteLength", "digest"]);
    content(intent.after);
  } else fail();
}

function checkIntentAgainstBefore(before, intent) {
  if (intent.kind === "write") {
    const target = before.physicalHeads.find(
      (head) => head.physicalPath === intent.physicalPath,
    );
    if (!target) fail("CC_SETTINGS_AUTHORITY_SOURCE_UNREGISTERED");
    const api = before.platform === "win32" ? path.win32 : path.posix;
    if (api.dirname(target.physicalPath) !== target.nearestExistingParent)
      fail("CC_SETTINGS_AUTHORITY_PARENT_MATERIALIZATION_UNSUPPORTED");
  } else {
    if (
      before.contexts.some(
        (context) => context.contextId === intent.manifest.contextId,
      )
    )
      fail("CC_SETTINGS_AUTHORITY_CONTEXT_EXISTS");
    // Combining with all existing contexts verifies every logical and inverse
    // physical binding before an alias or a new project may be enrolled.
    inverseHeads([...before.contexts, intent.manifest], before.platform);
  }
}

function beforeOf(prepared) {
  return readyRecord({
    platform: prepared.platform,
    epoch: prepared.epoch,
    generation: prepared.transition.fromGeneration,
    contexts: prepared.contexts,
  });
}

function validateLedgerData(record) {
  shape(record, [
    "schema",
    "platform",
    "epoch",
    "generation",
    "phase",
    "transactionId",
    "transition",
    "contexts",
    "physicalHeads",
  ]);
  if (
    record.schema !== LEDGER_SCHEMA ||
    !["posix", "win32"].includes(record.platform)
  )
    fail();
  identifier(record.epoch);
  generation(record.generation);
  if (
    !equal(inverseHeads(record.contexts, record.platform), record.physicalHeads)
  )
    fail("CC_SETTINGS_AUTHORITY_BINDING_CHANGED");
  if (record.phase === "ready") {
    if (record.transactionId !== null || record.transition !== null) fail();
  } else if (record.phase === "prepared") {
    identifier(record.transactionId);
    shape(record.transition, ["fromGeneration", "beforeDigest", "intent"]);
    generation(record.transition.fromGeneration);
    if (
      record.generation <= 0 ||
      record.transition.fromGeneration !== record.generation - 1
    )
      fail();
    hash(record.transition.beforeDigest);
    validateIntent(record.transition.intent, record.platform);
    const before = beforeOf(record);
    if (digest(before) !== record.transition.beforeDigest)
      fail("CC_SETTINGS_AUTHORITY_TRANSACTION_MISMATCH");
    checkIntentAgainstBefore(before, record.transition.intent);
  } else fail();
  return record;
}

function validateLedger({ record }) {
  return freeze(validateLedgerData(copyData(record)));
}

function requireReady(record) {
  if (record.phase !== "ready") fail("CC_SETTINGS_AUTHORITY_NOT_READY");
}

function createManifest({
  contextId,
  discovery,
  sources,
  platform = process.platform,
}) {
  const normalizedPlatform = platformName(platform);
  // Observer settings may be a large nested object. Deliberately select only
  // data descriptors of the binding fields, without reading/invoking settings.
  if (!Array.isArray(sources) || types.isProxy(sources)) fail();
  const selected = [];
  if (sources.length > LIMITS.sourcesPerContext) fail();
  for (let index = 0; index < sources.length; index++) {
    const itemDescriptor = Object.getOwnPropertyDescriptor(
      sources,
      String(index),
    );
    if (!itemDescriptor || !Object.hasOwn(itemDescriptor, "value")) fail();
    const source = itemDescriptor.value;
    if (!source || typeof source !== "object" || types.isProxy(source)) fail();
    const data = {};
    for (const key of SOURCE_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
      data[key] = descriptor.value;
    }
    selected.push(data);
  }
  const manifest = copyData({ contextId, discovery, sources: selected });
  list(manifest.discovery, LIMITS.discoveryPaths, 1);
  manifest.discovery = manifest.discovery.map((item) =>
    normalizedPath(item, normalizedPlatform),
  );
  for (const source of manifest.sources) {
    for (const key of ["logicalPath", "physicalPath", "nearestExistingParent"])
      source[key] = normalizedPath(source[key], normalizedPlatform);
    source.remainingPath = normalizedPath(
      source.remainingPath,
      normalizedPlatform,
      false,
    );
  }
  validateManifest(manifest, normalizedPlatform);
  inverseHeads([manifest], normalizedPlatform);
  return freeze(manifest);
}

function createInitialLedger({
  epoch,
  platform = process.platform,
  contexts = [],
}) {
  const data = copyData({ epoch, contexts });
  return validateLedger({
    record: readyRecord({
      platform: platformName(platform),
      epoch: data.epoch,
      generation: 0,
      contexts: data.contexts,
    }),
  });
}

function recordDigest({ record }) {
  return digest(validateLedger({ record }));
}

function assertContextMatches({ ledger, manifest }) {
  const current = validateLedger({ record: ledger });
  requireReady(current);
  const observed = copyData(manifest);
  validateManifest(observed, current.platform);
  const known = current.contexts.find(
    (context) => context.contextId === observed.contextId,
  );
  if (!known) fail("CC_SETTINGS_AUTHORITY_CONTEXT_UNREGISTERED");
  if (!equal(known, observed)) fail("CC_SETTINGS_AUTHORITY_BINDING_CHANGED");
  return true;
}

function guardOf(prepared) {
  return {
    schema: GUARD_SCHEMA,
    platform: prepared.platform,
    epoch: prepared.epoch,
    generation: prepared.generation,
    transactionId: prepared.transactionId,
    beforeDigest: prepared.transition.beforeDigest,
    intent: prepared.transition.intent,
  };
}

function validateGuard({ guard, prepared = null }) {
  const data = copyData(guard);
  shape(data, [
    "schema",
    "platform",
    "epoch",
    "generation",
    "transactionId",
    "beforeDigest",
    "intent",
  ]);
  if (
    data.schema !== GUARD_SCHEMA ||
    !["posix", "win32"].includes(data.platform)
  )
    fail();
  identifier(data.epoch);
  identifier(data.transactionId);
  generation(data.generation);
  if (!data.generation) fail();
  hash(data.beforeDigest);
  validateIntent(data.intent, data.platform);
  if (prepared !== null) {
    const record = validateLedger({ record: prepared });
    if (record.phase !== "prepared" || !equal(data, guardOf(record)))
      fail("CC_SETTINGS_AUTHORITY_TRANSACTION_MISMATCH");
  }
  return freeze(data);
}

function prepareTransition({ ledger, transactionId, intent }) {
  const before = validateLedger({ record: ledger });
  requireReady(before);
  identifier(transactionId);
  if (before.generation === Number.MAX_SAFE_INTEGER)
    fail("CC_SETTINGS_AUTHORITY_GENERATION_EXHAUSTED");
  const plan = copyData(intent);
  validateIntent(plan, before.platform);
  checkIntentAgainstBefore(before, plan);
  const prepared = validateLedger({
    record: {
      ...before,
      phase: "prepared",
      generation: before.generation + 1,
      transactionId,
      transition: {
        fromGeneration: before.generation,
        beforeDigest: digest(before),
        intent: plan,
      },
    },
  });
  return freeze({
    prepared,
    guard: validateGuard({ guard: guardOf(prepared), prepared }),
  });
}

function registerContext({ ledger, manifest, transactionId }) {
  return prepareTransition({
    ledger,
    transactionId,
    intent: { kind: "register", manifest },
  });
}

function sameBinding(left, right) {
  return [
    "logicalPath",
    "physicalPath",
    "nearestExistingParent",
    "remainingPath",
    "parentIdentity",
  ].every((key) => equal(left[key], right[key]));
}

function settleTransition({ prepared, guard, contexts, outcome }) {
  const pending = validateLedger({ record: prepared });
  if (pending.phase !== "prepared") fail("CC_SETTINGS_AUTHORITY_NOT_PREPARED");
  validateGuard({ guard, prepared: pending });
  if (!["before", "after"].includes(outcome)) fail();
  const observed = copyData(contexts);
  inverseHeads(observed, pending.platform);
  const intent = pending.transition.intent;
  const expectedContexts =
    intent.kind === "register" && outcome === "after"
      ? [...pending.contexts, intent.manifest]
      : pending.contexts;
  if (observed.length !== expectedContexts.length)
    fail("CC_SETTINGS_AUTHORITY_BINDING_CHANGED");
  for (let i = 0; i < expectedContexts.length; i++) {
    const old = expectedContexts[i];
    const next = observed[i];
    if (
      old.contextId !== next.contextId ||
      !equal(old.discovery, next.discovery) ||
      old.sources.length !== next.sources.length
    )
      fail("CC_SETTINGS_AUTHORITY_BINDING_CHANGED");
    for (let j = 0; j < old.sources.length; j++) {
      const prior = old.sources[j];
      const source = next.sources[j];
      if (
        intent.kind !== "write" ||
        prior.physicalPath !== intent.physicalPath
      ) {
        if (!equal(prior, source))
          fail("CC_SETTINGS_AUTHORITY_BINDING_CHANGED");
        continue;
      }
      if (!sameBinding(prior, source))
        fail("CC_SETTINGS_AUTHORITY_BINDING_CHANGED");
      const wanted = outcome === "after" ? intent.after : prior;
      if (
        !["exists", "byteLength", "digest"].every(
          (key) => source[key] === wanted[key],
        )
      )
        fail("CC_SETTINGS_AUTHORITY_CONTENT_MISMATCH");
    }
  }
  // Both completion and verified-old recovery consume the prepared generation.
  // Never retain a pending transaction in a ready record or decrement revision.
  return validateLedger({
    record: readyRecord({
      platform: pending.platform,
      epoch: pending.epoch,
      generation: pending.generation,
      contexts: observed,
    }),
  });
}

module.exports = {
  LEDGER_SCHEMA,
  GUARD_SCHEMA,
  LIMITS,
  createManifest,
  createInitialLedger,
  validateLedger,
  validateGuard,
  recordDigest,
  assertContextMatches,
  prepareTransition,
  registerContext,
  settleTransition,
};
