import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

export const SKILL_DEPENDENCY_LOCK_SCHEMA =
  "chainlesschain.skill-dependency-lock/v2";
export const SKILL_RUNTIME_MANIFEST_SCHEMA =
  "chainlesschain.skill-runtime-manifest/v1";
export const SKILL_TARGET_MATRIX_SCHEMA =
  "chainlesschain.skill-target-matrix/v1";

export const SKILL_EXECUTION_MANIFEST_INVALID_CODE =
  "CC_SKILL_EXECUTION_MANIFEST_INVALID";

const LEGACY_DEPENDENCY_LOCK_DOMAIN = "chainlesschain.skill-dependency-lock/v1";
const LEGACY_MUTATION_REQUEST_INVALID_CODE =
  "CC_SKILL_MUTATION_REQUEST_INVALID";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const RUNTIME_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const MAX_CANONICAL_DEPTH = 20;
const MAX_CANONICAL_NODES = 4096;
const MAX_CANONICAL_BYTES = 1024 * 1024;
const MAX_ARRAY_ENTRIES = 2048;
const MAX_OBJECT_FIELDS = 2048;
const MAX_KEY_CHARS = 256;
const MAX_STRING_CHARS = 16_384;
const MAX_RUNTIME_ENTRIES = 64;
const MAX_TARGET_CELLS = 64;

const DEPENDENCY_LOCK_INPUT_KEYS = new Set(["lock", "tenantId"]);
const DEPENDENCY_LOCK_KEYS = new Set([
  "schema",
  "tenantId",
  "lock",
  "lockDigest",
  "dependencyLockDigest",
]);
const RUNTIME_MANIFEST_INPUT_KEYS = new Set(["runtimes", "tenantId"]);
const RUNTIME_MANIFEST_KEYS = new Set([
  "schema",
  "tenantId",
  "runtimes",
  "runtimeManifestDigest",
]);
const RUNTIME_ENTRY_KEYS = new Set(["descriptor", "runtimeId"]);
const TARGET_MATRIX_INPUT_KEYS = new Set([
  "cells",
  "dependencyLock",
  "runtimeManifest",
  "tenantId",
]);
const TARGET_MATRIX_KEYS = new Set([
  "schema",
  "tenantId",
  "dependencyLockDigest",
  "runtimeManifestDigest",
  "cells",
  "targetRuntimes",
  "targetMatrixRoot",
]);
const TARGET_MATRIX_VERIFY_CONTEXT_KEYS = new Set([
  "dependencyLock",
  "expectedEnvironmentBindings",
  "expectedTargetMatrixRoot",
  "runtimeManifest",
]);
const TARGET_CELL_KEYS = new Set([
  "cellId",
  "runtimeId",
  "targetEnvironmentRef",
  "environmentDigest",
]);

export class SkillExecutionManifestError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "SkillExecutionManifestError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

function manifestError(
  message,
  details = {},
  code = SKILL_EXECUTION_MANIFEST_INVALID_CODE,
) {
  return new SkillExecutionManifestError(code, message, details);
}

function rejectProxy(
  value,
  label,
  code = SKILL_EXECUTION_MANIFEST_INVALID_CODE,
) {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    utilTypes.isProxy(value)
  ) {
    throw manifestError(`${label} must not be a Proxy`, {}, code);
  }
}

function isPlainRecord(value) {
  rejectProxy(value, "record");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactRecord(
  value,
  expectedKeys,
  label,
  code = SKILL_EXECUTION_MANIFEST_INVALID_CODE,
) {
  rejectProxy(value, label, code);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw manifestError(`${label} must be a plain object`, {}, code);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw manifestError(`${label} must be a plain object`, {}, code);
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.size ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    throw manifestError(
      `${label} must contain exactly the supported fields`,
      {},
      code,
    );
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw manifestError(
        `${label}.${String(key)} must be an enumerable own data property`,
        {},
        code,
      );
    }
  }
}

function ownData(value, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw manifestError(
      `${label}.${key} must be an enumerable own data property`,
    );
  }
  return descriptor.value;
}

function addCanonicalBytes(
  state,
  fragment,
  label,
  code = SKILL_EXECUTION_MANIFEST_INVALID_CODE,
) {
  const byteLength = Buffer.byteLength(fragment, "utf8");
  if (state.bytes > MAX_CANONICAL_BYTES - byteLength) {
    throw manifestError(`${label} exceeds the canonical byte budget`, {}, code);
  }
  state.bytes += byteLength;
}

function updateCanonicalHash(hash, value, state, label, code) {
  const update = (fragment) => {
    addCanonicalBytes(state, fragment, label, code);
    hash.update(fragment, "utf8");
  };
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      throw manifestError(`${label} must be canonical JSON`, {}, code);
    }
    update(serialized);
    return;
  }
  rejectProxy(value, label, code);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw manifestError(`${label} must use a standard array`, {}, code);
    }
    update("[");
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) update(",");
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw manifestError(
          `${label}[${index}] must be an enumerable own data property`,
          {},
          code,
        );
      }
      updateCanonicalHash(hash, descriptor.value, state, label, code);
    }
    update("]");
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw manifestError(`${label} must use plain objects`, {}, code);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw manifestError(`${label} has unsafe keys`, {}, code);
  }
  keys.sort();
  update("{");
  for (let index = 0; index < keys.length; index += 1) {
    if (index > 0) update(",");
    const key = keys[index];
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw manifestError(
        `${label}.${key} must be an enumerable own data property`,
        {},
        code,
      );
    }
    update(JSON.stringify(key));
    update(":");
    updateCanonicalHash(hash, descriptor.value, state, label, code);
  }
  update("}");
}

function domainDigest(
  domain,
  value,
  label,
  code = SKILL_EXECUTION_MANIFEST_INVALID_CODE,
) {
  const hash = createHash("sha256").update(domain, "utf8").update("\0", "utf8");
  updateCanonicalHash(hash, value, { bytes: 0 }, label, code);
  return `sha256:${hash.digest("hex")}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function normalizeBoundedString(
  value,
  label,
  maximum = MAX_STRING_CHARS,
  code = SKILL_EXECUTION_MANIFEST_INVALID_CODE,
) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    [...value].some((character) => {
      const point = character.codePointAt(0);
      return point < 0x20 || point === 0x7f;
    })
  ) {
    throw manifestError(
      `${label} must be a non-empty bounded string without control characters`,
      {},
      code,
    );
  }
  return value;
}

function normalizeIdentifier(value, label) {
  const normalized = normalizeBoundedString(value, label, 256);
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw manifestError(`${label} must be a canonical identifier`);
  }
  return normalized;
}

function normalizeRuntimeId(value, label) {
  const normalized = normalizeBoundedString(value, label, 128);
  if (!RUNTIME_ID_PATTERN.test(normalized)) {
    throw manifestError(`${label} must be a lowercase namespaced identifier`);
  }
  return normalized;
}

function normalizeDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw manifestError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function normalizeCanonicalJson(
  value,
  label,
  depth = 0,
  state = { nodes: 0, bytes: 0, ancestors: new WeakSet() },
  code = SKILL_EXECUTION_MANIFEST_INVALID_CODE,
) {
  rejectProxy(value, label, code);
  state.nodes += 1;
  if (depth > MAX_CANONICAL_DEPTH || state.nodes > MAX_CANONICAL_NODES) {
    throw manifestError(
      `${label} exceeds the canonical JSON structure budget`,
      {},
      code,
    );
  }
  if (value === null || typeof value === "boolean") {
    addCanonicalBytes(state, JSON.stringify(value), label, code);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
      throw manifestError(
        `${label} numbers must be non-negative safe integers`,
        {},
        code,
      );
    }
    addCanonicalBytes(state, JSON.stringify(value), label, code);
    return value;
  }
  if (typeof value === "string") {
    const normalized = normalizeBoundedString(
      value,
      label,
      MAX_STRING_CHARS,
      code,
    );
    addCanonicalBytes(state, JSON.stringify(normalized), label, code);
    return normalized;
  }
  if (!value || typeof value !== "object") {
    throw manifestError(`${label} must be canonical JSON`, {}, code);
  }
  if (state.ancestors.has(value)) {
    throw manifestError(
      code === LEGACY_MUTATION_REQUEST_INVALID_CODE
        ? `${label} exceeds the canonical JSON structure budget`
        : `${label} must not contain cycles`,
      {},
      code,
    );
  }
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw manifestError(`${label} must use a standard array`, {}, code);
      }
      const ownKeys = Reflect.ownKeys(value);
      if (
        value.length > MAX_ARRAY_ENTRIES ||
        ownKeys.length !== value.length + 1 ||
        ownKeys.some(
          (key) =>
            typeof key !== "string" ||
            (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
        )
      ) {
        throw manifestError(
          code === LEGACY_MUTATION_REQUEST_INVALID_CODE
            ? `${label} must be a dense bounded array`
            : `${label} must be a dense bounded standard array`,
          {},
          code,
        );
      }
      addCanonicalBytes(state, "[", label, code);
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) addCanonicalBytes(state, ",", label, code);
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw manifestError(
            `${label}[${index}] must be an enumerable own data property`,
            {},
            code,
          );
        }
        const normalizedEntry = normalizeCanonicalJson(
          descriptor.value,
          `${label}[${index}]`,
          depth + 1,
          state,
          code,
        );
        Object.defineProperty(output, String(index), {
          value: normalizedEntry,
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
      addCanonicalBytes(state, "]", label, code);
      return output;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw manifestError(`${label} must use plain objects`, {}, code);
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length > MAX_OBJECT_FIELDS ||
      keys.some(
        (key) =>
          typeof key !== "string" ||
          key.length < 1 ||
          key.length > MAX_KEY_CHARS,
      )
    ) {
      throw manifestError(`${label} has unsafe keys`, {}, code);
    }
    const output = Object.create(null);
    keys.sort();
    addCanonicalBytes(state, "{", label, code);
    for (let index = 0; index < keys.length; index += 1) {
      if (index > 0) addCanonicalBytes(state, ",", label, code);
      const key = keys[index];
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw manifestError(
          `${label}.${key} must be an enumerable own data property`,
          {},
          code,
        );
      }
      addCanonicalBytes(state, JSON.stringify(key), label, code);
      addCanonicalBytes(state, ":", label, code);
      Object.defineProperty(output, key, {
        value: normalizeCanonicalJson(
          descriptor.value,
          `${label}.${key}`,
          depth + 1,
          state,
          code,
        ),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    addCanonicalBytes(state, "}", label, code);
    return output;
  } finally {
    state.ancestors.delete(value);
  }
}

function normalizeCanonicalObject(
  value,
  label,
  code = SKILL_EXECUTION_MANIFEST_INVALID_CODE,
  state = { nodes: 0, bytes: 0, ancestors: new WeakSet() },
) {
  const normalized = normalizeCanonicalJson(value, label, 0, state, code);
  if (!isPlainRecord(normalized)) {
    throw manifestError(`${label} must be an object`, {}, code);
  }
  return normalized;
}

/**
 * Legacy v1 dependency-lock digest retained for the current mutation schemas.
 * New tenant-scoped flows must use buildSkillDependencyLock instead.
 */
export function digestSkillMutationDependencyLock(value) {
  const normalized = normalizeCanonicalObject(
    value,
    "dependencyLock",
    LEGACY_MUTATION_REQUEST_INVALID_CODE,
  );
  return domainDigest(
    LEGACY_DEPENDENCY_LOCK_DOMAIN,
    normalized,
    "dependencyLock",
    LEGACY_MUTATION_REQUEST_INVALID_CODE,
  );
}

export function buildSkillDependencyLock(input) {
  assertExactRecord(input, DEPENDENCY_LOCK_INPUT_KEYS, "dependency lock input");
  const tenantId = normalizeIdentifier(
    ownData(input, "tenantId", "dependency lock input"),
    "dependency lock tenantId",
  );
  const lock = normalizeCanonicalObject(
    ownData(input, "lock", "dependency lock input"),
    "dependency lock value",
  );
  const core = {
    schema: SKILL_DEPENDENCY_LOCK_SCHEMA,
    tenantId,
    lock,
    lockDigest: digestSkillMutationDependencyLock(lock),
  };
  const dependencyLockDigest = domainDigest(
    SKILL_DEPENDENCY_LOCK_SCHEMA,
    core,
    "tenant-bound dependency lock",
  );
  return deepFreeze({ ...core, dependencyLockDigest });
}

export function verifySkillDependencyLock(value) {
  assertExactRecord(value, DEPENDENCY_LOCK_KEYS, "dependency lock");
  if (
    ownData(value, "schema", "dependency lock") !== SKILL_DEPENDENCY_LOCK_SCHEMA
  ) {
    throw manifestError("dependency lock schema is invalid");
  }
  const normalized = buildSkillDependencyLock({
    tenantId: ownData(value, "tenantId", "dependency lock"),
    lock: ownData(value, "lock", "dependency lock"),
  });
  if (
    ownData(value, "lockDigest", "dependency lock") !== normalized.lockDigest ||
    ownData(value, "dependencyLockDigest", "dependency lock") !==
      normalized.dependencyLockDigest
  ) {
    throw manifestError("dependency lock digest verification failed");
  }
  return normalized;
}

export function digestSkillDependencyLock(input) {
  return buildSkillDependencyLock(input).dependencyLockDigest;
}

function normalizeRuntimeEntries(value) {
  rejectProxy(value, "runtime manifest runtimes");
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw manifestError("runtime manifest runtimes must be a standard array");
  }
  if (value.length < 1 || value.length > MAX_RUNTIME_ENTRIES) {
    throw manifestError(
      `runtime manifest must contain from 1 to ${MAX_RUNTIME_ENTRIES} runtimes`,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== value.length + 1 ||
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
    )
  ) {
    throw manifestError("runtime manifest runtimes must be dense");
  }
  const entries = [];
  const descriptorBudget = {
    nodes: 0,
    bytes: 0,
    ancestors: new WeakSet(),
  };
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw manifestError(
        `runtime manifest runtimes[${index}] must be an enumerable own data property`,
      );
    }
    const entry = descriptor.value;
    assertExactRecord(
      entry,
      RUNTIME_ENTRY_KEYS,
      `runtime manifest runtimes[${index}]`,
    );
    entries.push({
      runtimeId: normalizeRuntimeId(
        ownData(entry, "runtimeId", `runtime manifest runtimes[${index}]`),
        `runtime manifest runtimes[${index}].runtimeId`,
      ),
      descriptor: normalizeCanonicalObject(
        ownData(entry, "descriptor", `runtime manifest runtimes[${index}]`),
        `runtime manifest runtimes[${index}].descriptor`,
        SKILL_EXECUTION_MANIFEST_INVALID_CODE,
        descriptorBudget,
      ),
    });
  }
  if (
    new Set(entries.map((entry) => entry.runtimeId)).size !== entries.length
  ) {
    throw manifestError("runtime manifest runtimeId values must be unique");
  }
  entries.sort((left, right) =>
    left.runtimeId < right.runtimeId
      ? -1
      : left.runtimeId > right.runtimeId
        ? 1
        : 0,
  );
  return entries;
}

export function buildSkillRuntimeManifest(input) {
  assertExactRecord(
    input,
    RUNTIME_MANIFEST_INPUT_KEYS,
    "runtime manifest input",
  );
  const core = {
    schema: SKILL_RUNTIME_MANIFEST_SCHEMA,
    tenantId: normalizeIdentifier(
      ownData(input, "tenantId", "runtime manifest input"),
      "runtime manifest tenantId",
    ),
    runtimes: normalizeRuntimeEntries(
      ownData(input, "runtimes", "runtime manifest input"),
    ),
  };
  const runtimeManifestDigest = domainDigest(
    SKILL_RUNTIME_MANIFEST_SCHEMA,
    core,
    "runtime manifest",
  );
  return deepFreeze({ ...core, runtimeManifestDigest });
}

export function verifySkillRuntimeManifest(value) {
  assertExactRecord(value, RUNTIME_MANIFEST_KEYS, "runtime manifest");
  if (
    ownData(value, "schema", "runtime manifest") !==
    SKILL_RUNTIME_MANIFEST_SCHEMA
  ) {
    throw manifestError("runtime manifest schema is invalid");
  }
  const normalized = buildSkillRuntimeManifest({
    tenantId: ownData(value, "tenantId", "runtime manifest"),
    runtimes: ownData(value, "runtimes", "runtime manifest"),
  });
  if (
    ownData(value, "runtimeManifestDigest", "runtime manifest") !==
    normalized.runtimeManifestDigest
  ) {
    throw manifestError("runtime manifest digest verification failed");
  }
  return normalized;
}

export function digestSkillRuntimeManifest(input) {
  return buildSkillRuntimeManifest(input).runtimeManifestDigest;
}

function normalizeTargetCells(
  value,
  runtimeIds,
  label = "target matrix cells",
) {
  rejectProxy(value, label);
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw manifestError(`${label} must be a standard array`);
  }
  if (value.length < 1 || value.length > MAX_TARGET_CELLS) {
    throw manifestError(
      `${label} must contain from 1 to ${MAX_TARGET_CELLS} cells`,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== value.length + 1 ||
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
    )
  ) {
    throw manifestError(`${label} must be dense`);
  }
  const cells = [];
  const cellIds = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw manifestError(
        `${label}[${index}] must be an enumerable own data property`,
      );
    }
    const cell = descriptor.value;
    assertExactRecord(cell, TARGET_CELL_KEYS, `${label}[${index}]`);
    const normalized = {
      cellId: normalizeRuntimeId(
        ownData(cell, "cellId", `${label}[${index}]`),
        `${label}[${index}].cellId`,
      ),
      runtimeId: normalizeRuntimeId(
        ownData(cell, "runtimeId", `${label}[${index}]`),
        `${label}[${index}].runtimeId`,
      ),
      targetEnvironmentRef: normalizeIdentifier(
        ownData(cell, "targetEnvironmentRef", `${label}[${index}]`),
        `${label}[${index}].targetEnvironmentRef`,
      ),
      environmentDigest: normalizeDigest(
        ownData(cell, "environmentDigest", `${label}[${index}]`),
        `${label}[${index}].environmentDigest`,
      ),
    };
    if (!runtimeIds.has(normalized.runtimeId)) {
      throw manifestError(
        `${label} runtime is absent from the runtime manifest: ${normalized.runtimeId}`,
      );
    }
    if (cellIds.has(normalized.cellId)) {
      throw manifestError(`${label} cellId values must be unique`);
    }
    cellIds.add(normalized.cellId);
    cells.push(normalized);
  }
  cells.sort((left, right) =>
    left.cellId < right.cellId ? -1 : left.cellId > right.cellId ? 1 : 0,
  );
  return cells;
}

function deriveTargetRuntimes(cells) {
  const runtimeIds = new Set();
  for (const cell of cells) runtimeIds.add(cell.runtimeId);
  const targetRuntimes = [...runtimeIds];
  targetRuntimes.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return targetRuntimes;
}

function equalStringArrays(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function equalTargetCells(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    for (const key of TARGET_CELL_KEYS) {
      if (left[index][key] !== right[index][key]) return false;
    }
  }
  return true;
}

function normalizeTargetRuntimes(value) {
  rejectProxy(value, "target matrix targetRuntimes");
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw manifestError(
      "target matrix targetRuntimes must be a standard array",
    );
  }
  if (value.length < 1 || value.length > MAX_TARGET_CELLS) {
    throw manifestError(
      `target matrix targetRuntimes must contain from 1 to ${MAX_TARGET_CELLS} entries`,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== value.length + 1 ||
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
    )
  ) {
    throw manifestError("target matrix targetRuntimes must be dense");
  }
  const runtimes = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw manifestError(
        `target matrix targetRuntimes[${index}] must be an enumerable own data property`,
      );
    }
    runtimes.push(
      normalizeRuntimeId(
        descriptor.value,
        `target matrix targetRuntimes[${index}]`,
      ),
    );
  }
  if (new Set(runtimes).size !== runtimes.length) {
    throw manifestError("target matrix targetRuntimes must be unique");
  }
  return runtimes;
}

export function buildSkillTargetMatrix(input) {
  assertExactRecord(input, TARGET_MATRIX_INPUT_KEYS, "target matrix input");
  const tenantId = normalizeIdentifier(
    ownData(input, "tenantId", "target matrix input"),
    "target matrix tenantId",
  );
  const dependencyLock = verifySkillDependencyLock(
    ownData(input, "dependencyLock", "target matrix input"),
  );
  const runtimeManifest = verifySkillRuntimeManifest(
    ownData(input, "runtimeManifest", "target matrix input"),
  );
  if (
    dependencyLock.tenantId !== tenantId ||
    runtimeManifest.tenantId !== tenantId
  ) {
    throw manifestError(
      "target matrix, dependency lock, and runtime manifest must belong to the same tenant",
    );
  }
  const runtimeIds = new Set();
  for (const entry of runtimeManifest.runtimes) {
    runtimeIds.add(entry.runtimeId);
  }
  const cells = normalizeTargetCells(
    ownData(input, "cells", "target matrix input"),
    runtimeIds,
  );
  const core = {
    schema: SKILL_TARGET_MATRIX_SCHEMA,
    tenantId,
    dependencyLockDigest: dependencyLock.dependencyLockDigest,
    runtimeManifestDigest: runtimeManifest.runtimeManifestDigest,
    cells,
    targetRuntimes: deriveTargetRuntimes(cells),
  };
  const targetMatrixRoot = domainDigest(
    SKILL_TARGET_MATRIX_SCHEMA,
    core,
    "target matrix",
  );
  return deepFreeze({ ...core, targetMatrixRoot });
}

export function verifySkillTargetMatrix(value, context) {
  assertExactRecord(value, TARGET_MATRIX_KEYS, "target matrix");
  assertExactRecord(
    context,
    TARGET_MATRIX_VERIFY_CONTEXT_KEYS,
    "target matrix verification context",
  );
  if (
    ownData(value, "schema", "target matrix") !== SKILL_TARGET_MATRIX_SCHEMA
  ) {
    throw manifestError("target matrix schema is invalid");
  }
  const runtimeManifest = verifySkillRuntimeManifest(
    ownData(context, "runtimeManifest", "target matrix verification context"),
  );
  const dependencyLock = verifySkillDependencyLock(
    ownData(context, "dependencyLock", "target matrix verification context"),
  );
  const expectedTargetMatrixRoot = normalizeDigest(
    ownData(
      context,
      "expectedTargetMatrixRoot",
      "target matrix verification context",
    ),
    "target matrix verification context.expectedTargetMatrixRoot",
  );
  const runtimeIds = new Set();
  for (const entry of runtimeManifest.runtimes) {
    runtimeIds.add(entry.runtimeId);
  }
  const expectedEnvironmentBindings = normalizeTargetCells(
    ownData(
      context,
      "expectedEnvironmentBindings",
      "target matrix verification context",
    ),
    runtimeIds,
    "target matrix verification context.expectedEnvironmentBindings",
  );
  const targetRuntimes = normalizeTargetRuntimes(
    ownData(value, "targetRuntimes", "target matrix"),
  );
  const normalized = buildSkillTargetMatrix({
    tenantId: ownData(value, "tenantId", "target matrix"),
    dependencyLock,
    runtimeManifest,
    cells: ownData(value, "cells", "target matrix"),
  });
  if (
    ownData(value, "dependencyLockDigest", "target matrix") !==
      normalized.dependencyLockDigest ||
    ownData(value, "runtimeManifestDigest", "target matrix") !==
      normalized.runtimeManifestDigest
  ) {
    throw manifestError(
      "target matrix dependency or runtime manifest binding is invalid",
    );
  }
  if (!equalStringArrays(targetRuntimes, normalized.targetRuntimes)) {
    throw manifestError("target matrix targetRuntimes are not canonical");
  }
  if (
    ownData(value, "targetMatrixRoot", "target matrix") !==
    normalized.targetMatrixRoot
  ) {
    throw manifestError("target matrix digest verification failed");
  }
  if (!equalTargetCells(expectedEnvironmentBindings, normalized.cells)) {
    throw manifestError(
      "target matrix environment bindings differ from trusted expectations",
    );
  }
  if (normalized.targetMatrixRoot !== expectedTargetMatrixRoot) {
    throw manifestError("target matrix root differs from trusted expectation");
  }
  return normalized;
}

export function digestSkillTargetMatrix(input) {
  return buildSkillTargetMatrix(input).targetMatrixRoot;
}
