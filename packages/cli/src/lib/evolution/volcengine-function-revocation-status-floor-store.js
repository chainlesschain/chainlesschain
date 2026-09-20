import { createHash } from "node:crypto";
import path from "node:path";
import { types } from "node:util";

import { createEvolutionLedgerFileManifestHeadBackend } from "./evolution-ledger-file-manifest-head-store.js";

export const VOLCENGINE_FUNCTION_REVOCATION_STATUS_FLOOR_STORE_SCHEMA =
  "chainlesschain.volcengine-function-revocation-status-floor-store/v1";
export const VOLCENGINE_FUNCTION_REVOCATION_STATUS_FLOOR_MODE =
  "cross-process-exclusive-file-fsync";
export const VOLCENGINE_FUNCTION_REVOCATION_STATUS_SNAPSHOT_SCHEMA =
  "chainlesschain.volcengine-function-revocation-status-snapshot/v1";
export const VOLCENGINE_FUNCTION_REVOCATION_STATUS_ACK_SCHEMA =
  "chainlesschain.volcengine-function-revocation-status-ack/v1";

const STATE_SCHEMA =
  "chainlesschain.volcengine-function-revocation-status-floor-state/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[^\p{Cc}]{1,512}$/u;
const stores = new WeakMap();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;
}

function exactData(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !Object.hasOwn(descriptor, "value");
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function ownData(owner, name, label) {
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    throw new TypeError(`${label} must be plain data`);
  }
  return descriptor.value;
}

function normalizeDirectory(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(
      "Volcengine function revocation status floor directory is invalid",
    );
  }
  return path.resolve(value);
}

export function digestVolcengineFunctionRevocationStatusFloorRoot(value) {
  return digest(
    "chainlesschain.volcengine-function-revocation-status-floor-root/v1",
    normalizeDirectory(value),
  );
}

function normalizeDescriptor(value) {
  exactData(
    value,
    [
      "schema",
      "storeId",
      "tenantId",
      "handlerArtifactDigest",
      "revocationAuthorityId",
      "trustRootDigest",
      "stateRootDigest",
      "mode",
    ],
    "Volcengine function revocation status floor store descriptor",
  );
  const descriptor = Object.freeze({
    schema: ownData(
      value,
      "schema",
      "Volcengine function revocation status floor store schema",
    ),
    storeId: ownData(
      value,
      "storeId",
      "Volcengine function revocation status floor store identifier",
    ),
    tenantId: ownData(
      value,
      "tenantId",
      "Volcengine function revocation status floor store tenant",
    ),
    handlerArtifactDigest: ownData(
      value,
      "handlerArtifactDigest",
      "Volcengine function revocation status floor store artifact digest",
    ),
    revocationAuthorityId: ownData(
      value,
      "revocationAuthorityId",
      "Volcengine function revocation status floor store authority",
    ),
    trustRootDigest: ownData(
      value,
      "trustRootDigest",
      "Volcengine function revocation status floor store trust root",
    ),
    stateRootDigest: ownData(
      value,
      "stateRootDigest",
      "Volcengine function revocation status floor state root",
    ),
    mode: ownData(
      value,
      "mode",
      "Volcengine function revocation status floor store mode",
    ),
  });
  if (
    descriptor.schema !==
      VOLCENGINE_FUNCTION_REVOCATION_STATUS_FLOOR_STORE_SCHEMA ||
    !ID.test(descriptor.storeId) ||
    !ID.test(descriptor.tenantId) ||
    !DIGEST.test(descriptor.handlerArtifactDigest) ||
    !ID.test(descriptor.revocationAuthorityId) ||
    !DIGEST.test(descriptor.trustRootDigest) ||
    !DIGEST.test(descriptor.stateRootDigest) ||
    descriptor.mode !== VOLCENGINE_FUNCTION_REVOCATION_STATUS_FLOOR_MODE
  ) {
    throw new TypeError(
      "Volcengine function revocation status floor store descriptor is invalid",
    );
  }
  return descriptor;
}

export function digestVolcengineFunctionRevocationStatusFloorStoreDescriptor(
  value,
) {
  return digest(
    VOLCENGINE_FUNCTION_REVOCATION_STATUS_FLOOR_STORE_SCHEMA,
    normalizeDescriptor(value),
  );
}

function normalizeSnapshot(value, descriptor) {
  exactData(
    value,
    [
      "schema",
      "storeId",
      "tenantId",
      "handlerArtifactDigest",
      "revocationAuthorityId",
      "trustRootDigest",
      "revision",
      "snapshotDigest",
      "issuedAt",
      "nextUpdate",
    ],
    "Volcengine function revocation status snapshot",
  );
  const snapshot = Object.freeze({
    schema: ownData(
      value,
      "schema",
      "Volcengine function revocation status snapshot schema",
    ),
    storeId: ownData(
      value,
      "storeId",
      "Volcengine function revocation status snapshot store",
    ),
    tenantId: ownData(
      value,
      "tenantId",
      "Volcengine function revocation status snapshot tenant",
    ),
    handlerArtifactDigest: ownData(
      value,
      "handlerArtifactDigest",
      "Volcengine function revocation status snapshot artifact digest",
    ),
    revocationAuthorityId: ownData(
      value,
      "revocationAuthorityId",
      "Volcengine function revocation status snapshot authority",
    ),
    trustRootDigest: ownData(
      value,
      "trustRootDigest",
      "Volcengine function revocation status snapshot trust root",
    ),
    revision: ownData(
      value,
      "revision",
      "Volcengine function revocation status snapshot revision",
    ),
    snapshotDigest: ownData(
      value,
      "snapshotDigest",
      "Volcengine function revocation status snapshot digest",
    ),
    issuedAt: ownData(
      value,
      "issuedAt",
      "Volcengine function revocation status snapshot issue time",
    ),
    nextUpdate: ownData(
      value,
      "nextUpdate",
      "Volcengine function revocation status snapshot next update",
    ),
  });
  const issuedAtMs = Date.parse(snapshot.issuedAt);
  const nextUpdateMs = Date.parse(snapshot.nextUpdate);
  if (
    snapshot.schema !== VOLCENGINE_FUNCTION_REVOCATION_STATUS_SNAPSHOT_SCHEMA ||
    snapshot.storeId !== descriptor.storeId ||
    snapshot.tenantId !== descriptor.tenantId ||
    snapshot.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    snapshot.revocationAuthorityId !== descriptor.revocationAuthorityId ||
    snapshot.trustRootDigest !== descriptor.trustRootDigest ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 1 ||
    !DIGEST.test(snapshot.snapshotDigest) ||
    !Number.isFinite(issuedAtMs) ||
    new Date(issuedAtMs).toISOString() !== snapshot.issuedAt ||
    !Number.isFinite(nextUpdateMs) ||
    new Date(nextUpdateMs).toISOString() !== snapshot.nextUpdate ||
    nextUpdateMs <= issuedAtMs
  ) {
    throw new TypeError(
      "Volcengine function revocation status snapshot is invalid",
    );
  }
  return snapshot;
}

function normalizeState(value, descriptorDigest) {
  if (value === null) return null;
  exactData(
    value,
    [
      "schema",
      "descriptorDigest",
      "revision",
      "snapshotDigest",
      "issuedAt",
      "nextUpdate",
      "headDigest",
    ],
    "Volcengine function revocation status floor state",
  );
  const core = Object.freeze({
    schema: ownData(
      value,
      "schema",
      "Volcengine function revocation status floor state schema",
    ),
    descriptorDigest: ownData(
      value,
      "descriptorDigest",
      "Volcengine function revocation status floor descriptor digest",
    ),
    revision: ownData(
      value,
      "revision",
      "Volcengine function revocation status floor revision",
    ),
    snapshotDigest: ownData(
      value,
      "snapshotDigest",
      "Volcengine function revocation status floor snapshot digest",
    ),
    issuedAt: ownData(
      value,
      "issuedAt",
      "Volcengine function revocation status floor issue time",
    ),
    nextUpdate: ownData(
      value,
      "nextUpdate",
      "Volcengine function revocation status floor next update",
    ),
  });
  const headDigest = ownData(
    value,
    "headDigest",
    "Volcengine function revocation status floor head digest",
  );
  const issuedAtMs = Date.parse(core.issuedAt);
  const nextUpdateMs = Date.parse(core.nextUpdate);
  if (
    core.schema !== STATE_SCHEMA ||
    core.descriptorDigest !== descriptorDigest ||
    !Number.isSafeInteger(core.revision) ||
    core.revision < 1 ||
    !DIGEST.test(core.snapshotDigest) ||
    !Number.isFinite(issuedAtMs) ||
    new Date(issuedAtMs).toISOString() !== core.issuedAt ||
    !Number.isFinite(nextUpdateMs) ||
    new Date(nextUpdateMs).toISOString() !== core.nextUpdate ||
    nextUpdateMs <= issuedAtMs ||
    headDigest !== digest(STATE_SCHEMA, core)
  ) {
    throw new Error(
      "Volcengine function revocation status floor state is invalid",
    );
  }
  return Object.freeze({ ...core, headDigest });
}

function rollbackError(received, floor) {
  const error = new Error(
    `Volcengine function revocation signer status rollback rejected: received ${received}, floor ${floor}`,
  );
  error.code = "CC_VOLCENGINE_FUNCTION_REVOCATION_STATUS_ROLLBACK";
  return error;
}

export function createVolcengineFunctionRevocationStatusFloorStore(options) {
  exactData(
    options,
    ["descriptor", "directoryPath"],
    "Volcengine function revocation status floor store",
  );
  const descriptor = normalizeDescriptor(
    ownData(
      options,
      "descriptor",
      "Volcengine function revocation status floor store descriptor",
    ),
  );
  const directoryPath = normalizeDirectory(
    ownData(
      options,
      "directoryPath",
      "Volcengine function revocation status floor directory",
    ),
  );
  if (
    descriptor.stateRootDigest !==
    digestVolcengineFunctionRevocationStatusFloorRoot(directoryPath)
  ) {
    throw new TypeError(
      "Volcengine function revocation status floor state root does not match descriptor",
    );
  }
  const descriptorDigest = digest(
    VOLCENGINE_FUNCTION_REVOCATION_STATUS_FLOOR_STORE_SCHEMA,
    descriptor,
  );
  const backend = createEvolutionLedgerFileManifestHeadBackend({
    directoryPath,
  });
  const store = Object.freeze({});
  stores.set(store, { backend, descriptor, descriptorDigest });
  return store;
}

export function inspectVolcengineFunctionRevocationStatusFloorStore(value) {
  const captured = stores.get(value);
  if (!captured) {
    throw new TypeError(
      "A branded Volcengine function revocation status floor store is required",
    );
  }
  return Object.freeze({
    descriptor: captured.descriptor,
    descriptorDigest: captured.descriptorDigest,
  });
}

export function captureVolcengineFunctionRevocationStatusFloorStore(value) {
  const captured = stores.get(value);
  if (!captured) {
    throw new TypeError(
      "A branded Volcengine function revocation status floor store is required",
    );
  }
  const read = () =>
    normalizeState(captured.backend.load(), captured.descriptorDigest);
  return Object.freeze({
    descriptor: captured.descriptor,
    descriptorDigest: captured.descriptorDigest,
    readFloor: read,
    acceptSnapshot(input) {
      const snapshot = normalizeSnapshot(input, captured.descriptor);
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const current = read();
        if (current && snapshot.revision < current.revision) {
          throw rollbackError(snapshot.revision, current.revision);
        }
        if (current && snapshot.revision === current.revision) {
          if (snapshot.snapshotDigest !== current.snapshotDigest) {
            throw new Error(
              "Volcengine function revocation signer status conflicts at the current revision",
            );
          }
          return Object.freeze({
            schema: VOLCENGINE_FUNCTION_REVOCATION_STATUS_ACK_SCHEMA,
            storeId: captured.descriptor.storeId,
            revision: current.revision,
            snapshotDigest: current.snapshotDigest,
            headDigest: current.headDigest,
            durable: true,
            readbackVerified: true,
          });
        }
        if (
          current &&
          Date.parse(snapshot.issuedAt) <= Date.parse(current.issuedAt)
        ) {
          throw new Error(
            "Volcengine function revocation signer status issue time did not advance",
          );
        }
        const core = Object.freeze({
          schema: STATE_SCHEMA,
          descriptorDigest: captured.descriptorDigest,
          revision: snapshot.revision,
          snapshotDigest: snapshot.snapshotDigest,
          issuedAt: snapshot.issuedAt,
          nextUpdate: snapshot.nextUpdate,
        });
        const next = Object.freeze({
          ...core,
          headDigest: digest(STATE_SCHEMA, core),
        });
        const result = captured.backend.compareAndSet({
          expectedHeadDigest: current?.headDigest ?? null,
          nextHead: next,
        });
        if (!result.committed) continue;
        const confirmed = normalizeState(
          result.head,
          captured.descriptorDigest,
        );
        if (
          confirmed.revision !== snapshot.revision ||
          confirmed.snapshotDigest !== snapshot.snapshotDigest
        ) {
          throw new Error(
            "Volcengine function revocation status floor durable readback differs",
          );
        }
        return Object.freeze({
          schema: VOLCENGINE_FUNCTION_REVOCATION_STATUS_ACK_SCHEMA,
          storeId: captured.descriptor.storeId,
          revision: confirmed.revision,
          snapshotDigest: confirmed.snapshotDigest,
          headDigest: confirmed.headDigest,
          durable: true,
          readbackVerified: true,
        });
      }
      throw new Error(
        "Volcengine function revocation status floor contention did not settle",
      );
    },
  });
}
