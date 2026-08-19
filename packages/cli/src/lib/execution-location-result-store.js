import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { getHomeDir } from "./paths.js";
import { ensurePrivateDirectory, ensurePrivateFile } from "./secure-fs.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "./secure-file-identity.js";
import { withFileLock } from "./with-file-lock.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";
import {
  MAX_EXECUTION_LOCATION_RESULT_BUNDLE_BYTES,
  normalizeExecutionLocationResultBundle,
} from "./execution-location-result.js";

export const EXECUTION_LOCATION_RESULT_STORE_RECEIPT_SCHEMA =
  "chainlesschain.execution-location-result-store-receipt/v1";

const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const STORE_ID_RE = /^result-sha256-[a-f0-9]{64}$/u;

export const _executionLocationResultStoreFaultHooks = Object.seal({
  afterFilePublish: null,
});

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "executionLocationResultStore"), "utf8")
    .digest("hex")}`;
}

function bytesDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError(`${label} has an invalid schema`);
  }
  return value;
}

function canonicalBundleBytes(bundleInput) {
  const bundle = normalizeExecutionLocationResultBundle(bundleInput);
  const bytes = Buffer.from(
    canonicalJson(bundle, "executionLocationResultStoreBundle"),
    "utf8",
  );
  if (
    bytes.length <= 0 ||
    bytes.length > MAX_EXECUTION_LOCATION_RESULT_BUNDLE_BYTES
  ) {
    throw new Error("canonical execution-location result bundle is oversized");
  }
  return Object.freeze({ bundle, bytes });
}

function createReceipt(bundle, bytes) {
  const material = {
    schema: EXECUTION_LOCATION_RESULT_STORE_RECEIPT_SCHEMA,
    storeId: `result-${bundle.bundleDigest.replace(":", "-")}`,
    sessionId: bundle.session.sessionId,
    resultId: bundle.resultId,
    handoffId: bundle.session.handoffId,
    bundleDigest: bundle.bundleDigest,
    canonicalBytesDigest: bytesDigest(bytes),
    byteLength: bytes.length,
    format: "canonical-json",
    retention: "explicit-delete-local-not-worm",
  };
  return Object.freeze({
    ...material,
    receiptDigest: digest(
      "chainlesschain.execution-location.result-store-receipt.v1\0",
      material,
    ),
  });
}

export function normalizeExecutionLocationResultStoreReceipt(input) {
  const value = exactObject(
    input,
    [
      "schema",
      "storeId",
      "sessionId",
      "resultId",
      "handoffId",
      "bundleDigest",
      "canonicalBytesDigest",
      "byteLength",
      "format",
      "retention",
      "receiptDigest",
    ],
    "execution-location result store receipt",
  );
  if (
    value.schema !== EXECUTION_LOCATION_RESULT_STORE_RECEIPT_SCHEMA ||
    !STORE_ID_RE.test(String(value.storeId || "")) ||
    !SHA256_RE.test(String(value.handoffId || "")) ||
    !SHA256_RE.test(String(value.bundleDigest || "")) ||
    !SHA256_RE.test(String(value.canonicalBytesDigest || "")) ||
    !SHA256_RE.test(String(value.receiptDigest || "")) ||
    value.storeId !== `result-${value.bundleDigest.replace(":", "-")}` ||
    !Number.isSafeInteger(Number(value.byteLength)) ||
    Number(value.byteLength) <= 0 ||
    Number(value.byteLength) > MAX_EXECUTION_LOCATION_RESULT_BUNDLE_BYTES ||
    value.format !== "canonical-json" ||
    value.retention !== "explicit-delete-local-not-worm"
  ) {
    throw new TypeError("execution-location result store receipt is invalid");
  }
  const material = {
    schema: value.schema,
    storeId: value.storeId,
    sessionId: String(value.sessionId || ""),
    resultId: String(value.resultId || ""),
    handoffId: value.handoffId,
    bundleDigest: value.bundleDigest,
    canonicalBytesDigest: value.canonicalBytesDigest,
    byteLength: Number(value.byteLength),
    format: value.format,
    retention: value.retention,
  };
  if (
    material.sessionId.length === 0 ||
    material.sessionId.length > 256 ||
    material.resultId.length === 0 ||
    material.resultId.length > 128 ||
    value.receiptDigest !==
      digest(
        "chainlesschain.execution-location.result-store-receipt.v1\0",
        material,
      )
  ) {
    throw new TypeError("execution-location result store receipt is invalid");
  }
  return Object.freeze({ ...material, receiptDigest: value.receiptDigest });
}

export function executionLocationResultStoreDir() {
  return path.join(getHomeDir(), "execution-location-results");
}

function resultPath(receipt, dir) {
  return path.join(dir, `${receipt.storeId}.json`);
}

function syncDirectory(directory, runtimeFs, platform) {
  if (platform === "win32") return;
  const descriptor = runtimeFs.openSync(directory, "r");
  try {
    runtimeFs.fsyncSync(descriptor);
  } finally {
    runtimeFs.closeSync(descriptor);
  }
}

function readStoredBytes(receipt, dir, options = {}) {
  const runtimeFs = options.fs || fs;
  const filePath = resultPath(receipt, dir);
  return (options.withTrustedFileParentSync || withTrustedFileParentSync)(
    runtimeFs,
    filePath,
    ({ canonicalPath, parentDevice }) => {
      const before = runtimeFs.lstatSync(canonicalPath, { bigint: true });
      if (
        before.isSymbolicLink() ||
        !before.isFile() ||
        Number(before.nlink) !== 1 ||
        Number(before.size) !== receipt.byteLength
      ) {
        throw new Error("stored execution-location result identity is invalid");
      }
      let descriptor = null;
      try {
        descriptor = runtimeFs.openSync(
          canonicalPath,
          runtimeFs.constants.O_RDONLY |
            Number(runtimeFs.constants.O_NOFOLLOW || 0),
        );
        const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (
          !opened.isFile() ||
          Number(opened.nlink) !== 1 ||
          !(options.samePathHandleFileIdentity || samePathHandleFileIdentity)(
            before,
            opened,
            parentDevice,
            options.runtime,
          )
        ) {
          throw new Error(
            "stored execution-location result changed while opening",
          );
        }
        const bytes = runtimeFs.readFileSync(descriptor);
        const after = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (
          bytes.length !== receipt.byteLength ||
          !(options.sameFileStatIdentity || sameFileStatIdentity)(opened, after)
        ) {
          throw new Error(
            "stored execution-location result changed while reading",
          );
        }
        return bytes;
      } finally {
        if (descriptor !== null) runtimeFs.closeSync(descriptor);
      }
    },
  );
}

export function readStoredExecutionLocationResultBundle(
  receiptInput,
  options = {},
) {
  const receipt = normalizeExecutionLocationResultStoreReceipt(receiptInput);
  const dir = path.resolve(options.dir || executionLocationResultStoreDir());
  (options.ensurePrivateDirectory || ensurePrivateDirectory)(dir);
  (options.ensurePrivateFile || ensurePrivateFile)(resultPath(receipt, dir));
  const bytes = readStoredBytes(receipt, dir, options);
  if (bytesDigest(bytes) !== receipt.canonicalBytesDigest) {
    throw new Error("stored execution-location result byte digest mismatch");
  }
  let parsed;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new Error("stored execution-location result JSON is invalid");
  }
  const canonical = canonicalBundleBytes(parsed);
  if (
    canonical.bundle.bundleDigest !== receipt.bundleDigest ||
    canonical.bundle.resultId !== receipt.resultId ||
    canonical.bundle.session.sessionId !== receipt.sessionId ||
    canonical.bundle.session.handoffId !== receipt.handoffId ||
    !canonical.bytes.equals(bytes)
  ) {
    throw new Error("stored execution-location result receipt mismatch");
  }
  return canonical.bundle;
}

export function storeExecutionLocationResultBundle(bundleInput, options = {}) {
  const canonical = canonicalBundleBytes(bundleInput);
  const receipt = createReceipt(canonical.bundle, canonical.bytes);
  const dir = path.resolve(options.dir || executionLocationResultStoreDir());
  const runtimeFs = options.fs || fs;
  (options.ensurePrivateDirectory || ensurePrivateDirectory)(dir);
  const filePath = resultPath(receipt, dir);
  return (options.withFileLock || withFileLock)(
    filePath,
    () => {
      if (runtimeFs.existsSync(filePath)) {
        readStoredExecutionLocationResultBundle(receipt, { ...options, dir });
        return Object.freeze({ receipt, stored: false });
      }
      const temporaryPath = path.join(
        dir,
        `.${receipt.storeId}.${process.pid}.${randomUUID()}.tmp`,
      );
      let descriptor = null;
      let published = false;
      try {
        descriptor = runtimeFs.openSync(temporaryPath, "wx", 0o600);
        runtimeFs.writeFileSync(descriptor, canonical.bytes);
        runtimeFs.fsyncSync(descriptor);
        runtimeFs.closeSync(descriptor);
        descriptor = null;
        runtimeFs.linkSync(temporaryPath, filePath);
        published = true;
        runtimeFs.unlinkSync(temporaryPath);
        (options.ensurePrivateFile || ensurePrivateFile)(filePath);
        syncDirectory(dir, runtimeFs, options.platform || process.platform);
        if (
          typeof _executionLocationResultStoreFaultHooks.afterFilePublish ===
          "function"
        ) {
          _executionLocationResultStoreFaultHooks.afterFilePublish({
            filePath,
            receipt,
          });
        }
      } catch (error) {
        if (descriptor !== null) {
          try {
            runtimeFs.closeSync(descriptor);
          } catch {
            // Preserve the original publication error.
          }
        }
        try {
          runtimeFs.unlinkSync(temporaryPath);
        } catch {
          // Best-effort staging cleanup.
        }
        if (!published && error?.code === "EEXIST") {
          readStoredExecutionLocationResultBundle(receipt, { ...options, dir });
          return Object.freeze({ receipt, stored: false });
        }
        throw error;
      }
      readStoredExecutionLocationResultBundle(receipt, { ...options, dir });
      return Object.freeze({ receipt, stored: true });
    },
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
    },
  );
}
