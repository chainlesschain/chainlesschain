import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";

export const BROWSER_QUARANTINED_DOWNLOAD_EXECUTOR_DESCRIPTOR_SCHEMA =
  "chainlesschain.browser-quarantined-download-executor-descriptor/v1";
export const BROWSER_DOWNLOAD_NETWORK_RESPONSE_SCHEMA =
  "chainlesschain.browser-download-network-response/v1";
export const BROWSER_DOWNLOAD_QUARANTINE_COMMIT_ACK_SCHEMA =
  "chainlesschain.browser-download-quarantine-commit-ack/v1";
export const BROWSER_DOWNLOAD_SCAN_ACK_SCHEMA =
  "chainlesschain.browser-download-scan-ack/v1";
export const BROWSER_DOWNLOAD_COMPLETION_ACK_SCHEMA =
  "chainlesschain.browser-download-completion-ack/v1";

const EXECUTION_SCHEMA = "chainlesschain.browser-download-action-execution/v1";
const ARTIFACT_SCHEMA = "chainlesschain.browser-download-artifact/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const ARTIFACT_REF = /^quarantine:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const CONTENT_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const MAX_BYTES = 100 * 1024 * 1024;
const executors = new WeakSet();

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !("value" in descriptor);
    })
  )
    throw new TypeError(`${label} has an invalid shape`);
}

function ownFunction(owner, name, label) {
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (
    !descriptor?.enumerable ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "function" ||
    types.isProxy(descriptor.value)
  )
    throw new TypeError(`${label} is invalid`);
  return descriptor.value;
}

function normalizeUrl(value, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > 16 * 1024)
    throw new TypeError(`${label} is invalid`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.href.length > 16 * 1024
  )
    throw new TypeError(`${label} is invalid`);
  return parsed.href;
}

function normalizeOrigins(value, destinationUrl, label) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    value.length < 1 ||
    value.length > 16
  )
    throw new TypeError(`${label} is invalid`);
  const origins = value.map((entry) => {
    if (typeof entry !== "string" || entry.length > 2048)
      throw new TypeError(`${label} is invalid`);
    let parsed;
    try {
      parsed = new URL(entry);
    } catch {
      throw new TypeError(`${label} is invalid`);
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      entry !== parsed.origin
    )
      throw new TypeError(`${label} is invalid`);
    return parsed.origin;
  });
  const normalized = [...new Set(origins)].sort();
  if (
    normalized.length !== origins.length ||
    !normalized.includes(new URL(destinationUrl).origin)
  )
    throw new TypeError(`${label} is invalid`);
  return Object.freeze(normalized);
}

function normalizeContentTypes(value) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    value.length < 1 ||
    value.length > 16 ||
    value.some(
      (entry) => typeof entry !== "string" || !CONTENT_TYPE.test(entry),
    )
  )
    throw new TypeError("download execution content types are invalid");
  const normalized = [...new Set(value)].sort();
  if (normalized.length !== value.length)
    throw new TypeError("download execution content types are invalid");
  return Object.freeze(normalized);
}

function normalizeDescriptor(value) {
  exact(
    value,
    [
      "schema",
      "executorId",
      "tenantId",
      "handlerArtifactDigest",
      "networkMode",
      "custodyMode",
      "scannerMode",
    ],
    "quarantined download executor descriptor",
  );
  if (
    value.schema !== BROWSER_QUARANTINED_DOWNLOAD_EXECUTOR_DESCRIPTOR_SCHEMA ||
    !ID.test(value.executorId) ||
    !ID.test(value.tenantId) ||
    !DIGEST.test(value.handlerArtifactDigest) ||
    value.networkMode !== "policy-egress" ||
    value.custodyMode !== "exclusive-stream-fsync" ||
    value.scannerMode !== "independent-malware-scan"
  )
    throw new TypeError("quarantined download executor descriptor is invalid");
  return Object.freeze({ ...value });
}

function normalizeExecution(value) {
  exact(
    value,
    [
      "schema",
      "actionReceiptDigest",
      "requestDigest",
      "targetId",
      "operation",
      "destinationUrl",
      "allowedRedirectOrigins",
      "allowedContentTypes",
      "maxBytes",
      "deadlineAt",
    ],
    "quarantined download execution request",
  );
  const destinationUrl = normalizeUrl(
    value.destinationUrl,
    "download execution destination",
  );
  const allowedRedirectOrigins = normalizeOrigins(
    value.allowedRedirectOrigins,
    destinationUrl,
    "download execution redirect origins",
  );
  const allowedContentTypes = normalizeContentTypes(value.allowedContentTypes);
  if (
    value.schema !== EXECUTION_SCHEMA ||
    !DIGEST.test(value.actionReceiptDigest) ||
    !DIGEST.test(value.requestDigest) ||
    typeof value.targetId !== "string" ||
    value.targetId.length < 1 ||
    value.targetId.length > 512 ||
    value.operation !== "download-url" ||
    !Number.isSafeInteger(value.maxBytes) ||
    value.maxBytes < 1 ||
    value.maxBytes > MAX_BYTES ||
    !Number.isFinite(Date.parse(value.deadlineAt))
  )
    throw new TypeError("quarantined download execution request is invalid");
  return Object.freeze({
    ...value,
    destinationUrl,
    allowedRedirectOrigins,
    allowedContentTypes,
  });
}

function normalizeNetworkResponse(value, execution) {
  exact(
    value,
    [
      "schema",
      "statusCode",
      "finalUrl",
      "redirectOrigins",
      "contentType",
      "contentLength",
      "networkReceiptDigest",
      "body",
    ],
    "download network response",
  );
  const finalUrl = normalizeUrl(value.finalUrl, "download response final URL");
  const redirectOrigins = normalizeOrigins(
    value.redirectOrigins,
    execution.destinationUrl,
    "download response redirect origins",
  );
  const finalOrigin = new URL(finalUrl).origin;
  if (
    value.schema !== BROWSER_DOWNLOAD_NETWORK_RESPONSE_SCHEMA ||
    value.statusCode !== 200 ||
    typeof value.contentType !== "string" ||
    !CONTENT_TYPE.test(value.contentType) ||
    !execution.allowedContentTypes.includes(value.contentType) ||
    (value.contentLength !== null &&
      (!Number.isSafeInteger(value.contentLength) ||
        value.contentLength < 0 ||
        value.contentLength > execution.maxBytes)) ||
    redirectOrigins.some(
      (origin) => !execution.allowedRedirectOrigins.includes(origin),
    ) ||
    !redirectOrigins.includes(finalOrigin) ||
    !DIGEST.test(value.networkReceiptDigest) ||
    !value.body ||
    (typeof value.body !== "object" && typeof value.body !== "function") ||
    types.isProxy(value.body) ||
    typeof value.body[Symbol.asyncIterator] !== "function"
  )
    throw new TypeError("download network response is invalid");
  return Object.freeze({
    ...value,
    finalUrl,
    redirectOrigins,
  });
}

function normalizeQuarantineSession(value) {
  if (!value || typeof value !== "object" || types.isProxy(value))
    throw new TypeError("download quarantine session is invalid");
  exact(
    value,
    ["writeChunk", "commitArtifact", "discardArtifact"],
    "download quarantine session",
  );
  return Object.freeze({
    writeChunk: ownFunction(
      value,
      "writeChunk",
      "download quarantine write port",
    ),
    commitArtifact: ownFunction(
      value,
      "commitArtifact",
      "download quarantine commit port",
    ),
    discardArtifact: ownFunction(
      value,
      "discardArtifact",
      "download quarantine discard port",
    ),
  });
}

function normalizeQuarantineAck(value, streamed) {
  exact(
    value,
    [
      "schema",
      "artifactRef",
      "artifactDigest",
      "sizeBytes",
      "contentType",
      "quarantineReceiptDigest",
      "authenticated",
      "durable",
      "readbackVerified",
    ],
    "download quarantine commit acknowledgement",
  );
  if (
    value.schema !== BROWSER_DOWNLOAD_QUARANTINE_COMMIT_ACK_SCHEMA ||
    !ARTIFACT_REF.test(value.artifactRef) ||
    value.artifactDigest !== streamed.artifactDigest ||
    value.sizeBytes !== streamed.sizeBytes ||
    value.contentType !== streamed.contentType ||
    !DIGEST.test(value.quarantineReceiptDigest) ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true
  )
    throw new Error("download quarantine commit acknowledgement is invalid");
  return Object.freeze({ ...value });
}

function normalizeScanAck(value, quarantine) {
  exact(
    value,
    [
      "schema",
      "artifactRef",
      "artifactDigest",
      "sizeBytes",
      "contentType",
      "verdict",
      "scanEvidenceDigest",
      "authenticated",
      "independent",
    ],
    "download scan acknowledgement",
  );
  if (
    value.schema !== BROWSER_DOWNLOAD_SCAN_ACK_SCHEMA ||
    value.artifactRef !== quarantine.artifactRef ||
    value.artifactDigest !== quarantine.artifactDigest ||
    value.sizeBytes !== quarantine.sizeBytes ||
    value.contentType !== quarantine.contentType ||
    !["clean", "rejected"].includes(value.verdict) ||
    !DIGEST.test(value.scanEvidenceDigest) ||
    value.authenticated !== true ||
    value.independent !== true
  )
    throw new Error("download scan acknowledgement is invalid");
  return Object.freeze({ ...value });
}

function normalizeCompletionAck(value, quarantine, scan) {
  exact(
    value,
    [
      "schema",
      "artifactRef",
      "artifactDigest",
      "scanEvidenceDigest",
      "completionReceiptDigest",
      "authenticated",
      "durable",
      "readbackVerified",
    ],
    "download completion acknowledgement",
  );
  if (
    value.schema !== BROWSER_DOWNLOAD_COMPLETION_ACK_SCHEMA ||
    value.artifactRef !== quarantine.artifactRef ||
    value.artifactDigest !== quarantine.artifactDigest ||
    value.scanEvidenceDigest !== scan.scanEvidenceDigest ||
    !DIGEST.test(value.completionReceiptDigest) ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true
  )
    throw new Error("download completion acknowledgement is invalid");
  return Object.freeze({ ...value });
}

function deadlineGuard(execution, signal, now) {
  const current = now();
  if (signal?.aborted === true)
    throw new Error("download execution was cancelled");
  if (!Number.isFinite(current) || current >= Date.parse(execution.deadlineAt))
    throw new Error("download execution deadline exceeded");
  return current;
}

export function createBrowserQuarantinedDownloadExecutor({
  descriptor,
  openNetworkResponse,
  openQuarantine,
  scanArtifact,
  completeArtifact,
  now = Date.now,
} = {}) {
  const normalizedDescriptor = normalizeDescriptor(descriptor);
  for (const [name, port] of Object.entries({
    openNetworkResponse,
    openQuarantine,
    scanArtifact,
    completeArtifact,
    now,
  })) {
    if (typeof port !== "function" || types.isProxy(port))
      throw new TypeError(`quarantined download ${name} port is invalid`);
  }
  const executeDownload = async (input, { signal } = {}) => {
    const execution = normalizeExecution(input);
    deadlineGuard(execution, signal, now);
    let session = null;
    try {
      const network = normalizeNetworkResponse(
        await Reflect.apply(openNetworkResponse, undefined, [
          execution,
          Object.freeze({ signal }),
        ]),
        execution,
      );
      deadlineGuard(execution, signal, now);
      const artifactId = randomUUID();
      session = normalizeQuarantineSession(
        await Reflect.apply(openQuarantine, undefined, [
          Object.freeze({
            artifactId,
            tenantId: normalizedDescriptor.tenantId,
            maxBytes: execution.maxBytes,
            contentType: network.contentType,
            networkReceiptDigest: network.networkReceiptDigest,
          }),
        ]),
      );
      const hash = createHash("sha256");
      let sizeBytes = 0;
      for await (const value of network.body) {
        deadlineGuard(execution, signal, now);
        if (
          !(value instanceof Uint8Array) ||
          types.isProxy(value) ||
          value.byteLength < 1
        )
          throw new TypeError("download response chunk is invalid");
        if (value.byteLength > execution.maxBytes - sizeBytes)
          throw new Error("download response exceeds its byte budget");
        const chunk = Buffer.from(value);
        sizeBytes += chunk.byteLength;
        hash.update(chunk);
        await Reflect.apply(session.writeChunk, undefined, [chunk]);
      }
      if (
        sizeBytes < 1 ||
        (network.contentLength !== null && network.contentLength !== sizeBytes)
      )
        throw new Error("download response length is invalid");
      deadlineGuard(execution, signal, now);
      const streamed = Object.freeze({
        artifactDigest: `sha256:${hash.digest("hex")}`,
        sizeBytes,
        contentType: network.contentType,
      });
      const quarantine = normalizeQuarantineAck(
        await Reflect.apply(session.commitArtifact, undefined, [streamed]),
        streamed,
      );
      deadlineGuard(execution, signal, now);
      const scan = normalizeScanAck(
        await Reflect.apply(scanArtifact, undefined, [
          Object.freeze({
            artifactRef: quarantine.artifactRef,
            artifactDigest: quarantine.artifactDigest,
            sizeBytes: quarantine.sizeBytes,
            contentType: quarantine.contentType,
            quarantineReceiptDigest: quarantine.quarantineReceiptDigest,
          }),
          Object.freeze({ signal }),
        ]),
        quarantine,
      );
      if (scan.verdict !== "clean")
        throw new Error("download artifact was rejected by malware scanning");
      const completedAtMs = deadlineGuard(execution, signal, now);
      const completedAt = new Date(completedAtMs).toISOString();
      const completion = normalizeCompletionAck(
        await Reflect.apply(completeArtifact, undefined, [
          Object.freeze({
            artifactRef: quarantine.artifactRef,
            artifactDigest: quarantine.artifactDigest,
            sizeBytes: quarantine.sizeBytes,
            contentType: quarantine.contentType,
            networkReceiptDigest: network.networkReceiptDigest,
            quarantineReceiptDigest: quarantine.quarantineReceiptDigest,
            scanEvidenceDigest: scan.scanEvidenceDigest,
            completedAt,
          }),
        ]),
        quarantine,
        scan,
      );
      deadlineGuard(execution, signal, now);
      return Object.freeze({
        schema: ARTIFACT_SCHEMA,
        artifactRef: quarantine.artifactRef,
        artifactDigest: quarantine.artifactDigest,
        sizeBytes: quarantine.sizeBytes,
        contentType: quarantine.contentType,
        finalUrl: network.finalUrl,
        redirectOrigins: network.redirectOrigins,
        quarantined: true,
        scanVerdict: "clean",
        scanEvidenceDigest: scan.scanEvidenceDigest,
        quarantineReceiptDigest: quarantine.quarantineReceiptDigest,
        completionReceiptDigest: completion.completionReceiptDigest,
        completedAt,
      });
    } catch (error) {
      if (session) {
        try {
          await Reflect.apply(session.discardArtifact, undefined, [
            Object.freeze({ reason: "download-execution-failed" }),
          ]);
        } catch {
          throw new Error("download quarantine cleanup failed", {
            cause: error,
          });
        }
      }
      throw error;
    }
  };
  executors.add(executeDownload);
  return executeDownload;
}

export function isBrowserQuarantinedDownloadExecutor(value) {
  return executors.has(value);
}
