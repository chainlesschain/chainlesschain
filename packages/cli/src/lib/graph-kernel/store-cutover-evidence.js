import { createHash } from "node:crypto";

export const GRAPH_STORE_CUTOVER_EVIDENCE_SCHEMA =
  "chainlesschain.graph-store-cutover-evidence/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;
const STORE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;

function normalizePlatform(value) {
  const platform = String(value || "")
    .trim()
    .toLowerCase();
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return platform;
}

function evidenceError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "GraphStoreCutoverEvidenceError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

export function graphStoreEvidenceDigest(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex")}`;
}

export function assertExactCommitSha(expectedCommit, actualCommit) {
  const actual = String(actualCommit || "")
    .trim()
    .toLowerCase();
  const expected = String(expectedCommit || "")
    .trim()
    .toLowerCase();
  if (!COMMIT.test(actual) || (expected && !COMMIT.test(expected))) {
    throw evidenceError(
      "CC_GRAPH_STORE_EVIDENCE_INVALID",
      "expected and actual commit SHAs must be exact hexadecimal identities",
    );
  }
  if (expected && expected !== actual) {
    throw evidenceError(
      "CC_GRAPH_STORE_EVIDENCE_SHA_MISMATCH",
      `expected commit ${expected} does not match checked-out HEAD ${actual}`,
      { expectedCommit: expected, actualCommit: actual },
    );
  }
  return actual;
}

function exactDigest(value, field) {
  const output = String(value || "");
  if (!DIGEST.test(output)) {
    throw evidenceError(
      "CC_GRAPH_STORE_EVIDENCE_INVALID",
      `${field} must be a sha256 digest`,
      { field },
    );
  }
  return output;
}

function normalizeStore(value) {
  const surface = String(value?.surface || "").trim();
  const entryId = String(value?.entryId || "").trim();
  const store = String(value?.store || "").trim();
  if (!STORE.test(surface) || !STORE.test(entryId) || !STORE.test(store)) {
    throw evidenceError(
      "CC_GRAPH_STORE_EVIDENCE_INVALID",
      "store evidence has an invalid surface, entry, or store identifier",
    );
  }
  if (value?.recovered !== true || Number(value?.rpoLossCount) !== 0) {
    throw evidenceError(
      "CC_GRAPH_STORE_EVIDENCE_RPO_FAILED",
      `store evidence does not prove RPO=0 recovery: ${store}`,
      { store },
    );
  }
  return Object.freeze({
    surface,
    entryId,
    store,
    cutpointDigest: exactDigest(value.cutpointDigest, "cutpointDigest"),
    recoveryReceiptDigest: exactDigest(
      value.recoveryReceiptDigest,
      "recoveryReceiptDigest",
    ),
    rollbackDrillDigest: exactDigest(
      value.rollbackDrillDigest,
      "rollbackDrillDigest",
    ),
    rpoLossCount: 0,
    recovered: true,
  });
}

export function createGraphStoreCutoverEvidence({
  source,
  commitSha,
  platform,
  stores,
  sourceReceipts,
}) {
  const record = normalizeGraphStoreCutoverEvidence(
    {
      schema: GRAPH_STORE_CUTOVER_EVIDENCE_SCHEMA,
      status: "passed",
      source,
      commitSha,
      platform,
      stores,
      sourceReceipts,
    },
    { requireEvidenceDigest: false },
  );
  const unsigned = { ...record };
  delete unsigned.evidenceDigest;
  return Object.freeze({
    ...unsigned,
    evidenceDigest: graphStoreEvidenceDigest(unsigned),
  });
}

export function normalizeGraphStoreCutoverEvidence(
  value,
  { requireEvidenceDigest = true } = {},
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema !== GRAPH_STORE_CUTOVER_EVIDENCE_SCHEMA ||
    value.status !== "passed"
  ) {
    throw evidenceError(
      "CC_GRAPH_STORE_EVIDENCE_INVALID",
      "store cutover evidence schema or status is invalid",
    );
  }
  const source = String(value.source || "").trim();
  const commitSha = String(value.commitSha || "")
    .trim()
    .toLowerCase();
  const platform = normalizePlatform(value.platform);
  if (!STORE.test(source) || !COMMIT.test(commitSha) || !platform) {
    throw evidenceError(
      "CC_GRAPH_STORE_EVIDENCE_INVALID",
      "store evidence source, commit SHA, or platform is invalid",
    );
  }
  if (!Array.isArray(value.stores) || value.stores.length === 0) {
    throw evidenceError(
      "CC_GRAPH_STORE_EVIDENCE_INVALID",
      "store evidence must contain at least one real store receipt",
    );
  }
  const stores = value.stores
    .map(normalizeStore)
    .sort(
      (left, right) =>
        left.surface.localeCompare(right.surface) ||
        left.entryId.localeCompare(right.entryId) ||
        left.store.localeCompare(right.store),
    );
  if (
    new Set(
      stores.map(
        (entry) => `${entry.surface}\0${entry.entryId}\0${entry.store}`,
      ),
    ).size !== stores.length
  ) {
    throw evidenceError(
      "CC_GRAPH_STORE_EVIDENCE_DUPLICATE",
      "store evidence contains a duplicate store receipt",
    );
  }
  const sourceReceipts = Object.fromEntries(
    Object.entries(value.sourceReceipts || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, receipt]) => [name, exactDigest(receipt, name)]),
  );
  if (Object.keys(sourceReceipts).length === 0) {
    throw evidenceError(
      "CC_GRAPH_STORE_EVIDENCE_INVALID",
      "store evidence must bind its source journey receipts",
    );
  }
  const normalized = {
    schema: GRAPH_STORE_CUTOVER_EVIDENCE_SCHEMA,
    status: "passed",
    source,
    commitSha,
    platform,
    stores,
    sourceReceipts,
  };
  if (requireEvidenceDigest) {
    const evidenceDigest = exactDigest(value.evidenceDigest, "evidenceDigest");
    if (evidenceDigest !== graphStoreEvidenceDigest(normalized)) {
      throw evidenceError(
        "CC_GRAPH_STORE_EVIDENCE_TAMPERED",
        "store cutover evidence digest does not match its contents",
      );
    }
    normalized.evidenceDigest = evidenceDigest;
  }
  return Object.freeze(normalized);
}

export function graphStoreCutoverCoverage(manifest, evidenceRecords = []) {
  const records = evidenceRecords.map((record) =>
    normalizeGraphStoreCutoverEvidence(record),
  );
  const commits = new Set(records.map((record) => record.commitSha));
  if (commits.size > 1) {
    throw evidenceError(
      "CC_GRAPH_STORE_EVIDENCE_SHA_MISMATCH",
      "store evidence records must bind one exact commit SHA",
    );
  }
  const availableStores = new Map();
  for (const record of records) {
    for (const store of record.stores) {
      const key = `${store.surface}\0${store.entryId}\0${store.store}`;
      const receipts = availableStores.get(key) || [];
      receipts.push({
        platform: record.platform,
        evidenceDigest: record.evidenceDigest,
        ...store,
      });
      availableStores.set(key, receipts);
    }
  }
  const requiredPlatforms = [
    ...(manifest.cutoverPolicy?.requiredPlatforms || []),
  ]
    .map(normalizePlatform)
    .sort();
  if (requiredPlatforms.length === 0) {
    throw evidenceError(
      "CC_GRAPH_STORE_EVIDENCE_INVALID",
      "runtime manifest must declare required cutover platforms",
    );
  }
  const entries = manifest.surfaces.flatMap((surface) =>
    surface.entries
      .filter((entry) => entry.cutoverStrategy === "migrate")
      .map((entry) => {
        const stores = [...entry.storeDispositions.migrate].sort();
        const keyFor = (store) =>
          `${surface.originSurface}\0${entry.id}\0${store}`;
        const coveredStores = stores.filter((store) =>
          availableStores.has(keyFor(store)),
        );
        const missingStores = stores.filter(
          (store) => !availableStores.has(keyFor(store)),
        );
        const platformCoverage = stores.map((store) => {
          const coveredPlatforms = [
            ...new Set(
              (availableStores.get(keyFor(store)) || []).map(
                (receipt) => receipt.platform,
              ),
            ),
          ].sort();
          const missingPlatforms = requiredPlatforms.filter(
            (platform) => !coveredPlatforms.includes(platform),
          );
          return Object.freeze({
            store,
            coveredPlatforms: Object.freeze(coveredPlatforms),
            missingPlatforms: Object.freeze(missingPlatforms),
            complete: missingPlatforms.length === 0,
          });
        });
        const incompletePlatformStores = platformCoverage.filter(
          (store) => !store.complete,
        );
        return Object.freeze({
          surface: surface.originSurface,
          entryId: entry.id,
          stores: Object.freeze(stores),
          coveredStores: Object.freeze(coveredStores),
          missingStores: Object.freeze(missingStores),
          platformCoverage: Object.freeze(platformCoverage),
          incompletePlatformStores: Object.freeze(incompletePlatformStores),
          complete:
            missingStores.length === 0 && incompletePlatformStores.length === 0,
        });
      }),
  );
  const storeSlotCount = entries.reduce(
    (count, entry) => count + entry.stores.length,
    0,
  );
  const coveredStoreSlotCount = entries.reduce(
    (count, entry) => count + entry.coveredStores.length,
    0,
  );
  const completeStoreSlotCount = entries.reduce(
    (count, entry) =>
      count + entry.platformCoverage.filter((store) => store.complete).length,
    0,
  );
  const platformStoreSlotCount = storeSlotCount * requiredPlatforms.length;
  const coveredPlatformStoreSlotCount = entries.reduce(
    (count, entry) =>
      count +
      entry.platformCoverage.reduce(
        (storeCount, store) =>
          storeCount +
          store.coveredPlatforms.filter((platform) =>
            requiredPlatforms.includes(platform),
          ).length,
        0,
      ),
    0,
  );
  return Object.freeze({
    schema: "chainlesschain.graph-store-cutover-coverage/v1",
    commitSha: [...commits][0] || null,
    requiredPlatforms: Object.freeze(requiredPlatforms),
    evidenceRecordCount: records.length,
    migratableEntryCount: entries.length,
    completeEntryCount: entries.filter((entry) => entry.complete).length,
    storeSlotCount,
    coveredStoreSlotCount,
    missingStoreSlotCount: storeSlotCount - coveredStoreSlotCount,
    completeStoreSlotCount,
    incompletePlatformStoreSlotCount: storeSlotCount - completeStoreSlotCount,
    platformStoreSlotCount,
    coveredPlatformStoreSlotCount,
    missingPlatformStoreSlotCount:
      platformStoreSlotCount - coveredPlatformStoreSlotCount,
    entries: Object.freeze(entries),
  });
}
