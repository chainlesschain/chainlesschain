import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalJson } from "./scheduler-kernel/contract.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "./secure-file-identity.js";
import { withFileLock } from "./with-file-lock.js";

export const ARTIFACT_DELETION_EVENT_SCHEMA =
  "cc-artifact-deletion-settlement/v1";
export const ARTIFACT_DELETION_LEDGER_SCHEMA =
  "cc-artifact-deletion-settlement-ledger/v1";
export const ARTIFACT_DELETION_RECEIPT_SCHEMA =
  "cc-artifact-deletion-receipt/v1";

export const ARTIFACT_DELETION_CLIENTS = Object.freeze([
  "cli",
  "vscode",
  "jetbrains",
  "websocket",
  "system",
]);
export const ARTIFACT_DELETION_REASONS = Object.freeze(["explicit", "expired"]);

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/u;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const MAX_LEDGER_BYTES = 16 * 1024 * 1024;
const MAX_LEDGER_EVENTS = 100_000;

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "artifactDeletionLedger"), "utf8")
    .digest("hex")}`;
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

function optionalDigest(value, label) {
  if (value === null) return null;
  const normalized = String(value || "");
  if (!SHA256_RE.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function optionalId(value, label) {
  if (value === null) return null;
  const normalized = String(value || "");
  if (!ID_RE.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function safeStoredFile(value) {
  const normalized = String(value || "");
  if (
    !normalized ||
    normalized !== path.basename(normalized) ||
    normalized.includes("..") ||
    normalized.includes("/") ||
    normalized.includes("\\")
  ) {
    throw new TypeError("artifact deletion stored file is invalid");
  }
  return normalized;
}

export function normalizeArtifactDeletionEvent(input, previous = null) {
  const value = exactObject(
    input,
    [
      "schema",
      "sequence",
      "previousEventDigest",
      "deletionId",
      "phase",
      "preparedEventDigest",
      "artifactId",
      "artifactSha256",
      "artifactSize",
      "recordDigest",
      "artifactSessionId",
      "storedFile",
      "immutable",
      "reason",
      "client",
      "indexGenerationBefore",
      "indexGenerationAfter",
      "managedCopyDisposition",
      "occurredAt",
      "eventDigest",
    ],
    "artifact deletion event",
  );
  const sequence = Number(value.sequence);
  const previousEventDigest = optionalDigest(
    value.previousEventDigest,
    "artifact deletion predecessor digest",
  );
  const deletionId = String(value.deletionId || "");
  const phase = String(value.phase || "");
  const preparedEventDigest = optionalDigest(
    value.preparedEventDigest,
    "artifact deletion prepared event digest",
  );
  const artifactId = String(value.artifactId || "");
  const artifactSha256 = String(value.artifactSha256 || "");
  const artifactSize = Number(value.artifactSize);
  const recordDigest = optionalDigest(
    value.recordDigest,
    "artifact deletion record digest",
  );
  const artifactSessionId = optionalId(
    value.artifactSessionId,
    "artifact deletion session id",
  );
  const storedFile = safeStoredFile(value.storedFile);
  const reason = String(value.reason || "");
  const client = String(value.client || "");
  const indexGenerationBefore = String(value.indexGenerationBefore || "");
  const indexGenerationAfter = optionalDigest(
    value.indexGenerationAfter,
    "artifact deletion terminal index generation",
  );
  const managedCopyDisposition = String(value.managedCopyDisposition || "");
  const occurredAt = String(value.occurredAt || "");
  if (
    value.schema !== ARTIFACT_DELETION_EVENT_SCHEMA ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !ID_RE.test(deletionId) ||
    !["prepared", "terminal"].includes(phase) ||
    !ID_RE.test(artifactId) ||
    !SHA256_RE.test(artifactSha256) ||
    !Number.isSafeInteger(artifactSize) ||
    artifactSize < 0 ||
    typeof value.immutable !== "boolean" ||
    !ARTIFACT_DELETION_REASONS.includes(reason) ||
    !ARTIFACT_DELETION_CLIENTS.includes(client) ||
    !SHA256_RE.test(indexGenerationBefore) ||
    !Number.isFinite(Date.parse(occurredAt)) ||
    !SHA256_RE.test(String(value.eventDigest || ""))
  ) {
    throw new TypeError("artifact deletion event is invalid");
  }
  if (
    (phase === "prepared" &&
      (preparedEventDigest !== null ||
        indexGenerationAfter !== null ||
        managedCopyDisposition !== "pending")) ||
    (phase === "terminal" &&
      (!preparedEventDigest ||
        !indexGenerationAfter ||
        !["removed", "already-absent"].includes(managedCopyDisposition)))
  ) {
    throw new TypeError("artifact deletion phase fields are invalid");
  }
  if (
    sequence !== (previous?.sequence || 0) + 1 ||
    previousEventDigest !== (previous?.eventDigest || null)
  ) {
    throw new Error("artifact deletion event chain is invalid");
  }
  const material = {
    schema: value.schema,
    sequence,
    previousEventDigest,
    deletionId,
    phase,
    preparedEventDigest,
    artifactId,
    artifactSha256,
    artifactSize,
    recordDigest,
    artifactSessionId,
    storedFile,
    immutable: value.immutable,
    reason,
    client,
    indexGenerationBefore,
    indexGenerationAfter,
    managedCopyDisposition,
    occurredAt,
  };
  if (
    value.eventDigest !==
    digest("chainlesschain.artifact.deletion-settlement-event.v1\0", material)
  ) {
    throw new Error("artifact deletion event digest is invalid");
  }
  return Object.freeze({ ...material, eventDigest: value.eventDigest });
}

function ledgerPath(store) {
  return path.join(path.resolve(store.dir), "deletion-settlements.jsonl");
}

function readLedgerBytes(filePath, runtimeFs, runtime = undefined) {
  return withTrustedFileParentSync(
    runtimeFs,
    filePath,
    ({ canonicalPath, parentDevice }) => {
      let before;
      try {
        before = runtimeFs.lstatSync(canonicalPath, { bigint: true });
      } catch (error) {
        if (error?.code === "ENOENT") return Buffer.alloc(0);
        throw error;
      }
      if (
        before.isSymbolicLink() ||
        !before.isFile() ||
        Number(before.nlink) !== 1 ||
        Number(before.size) > MAX_LEDGER_BYTES
      ) {
        throw new Error("artifact deletion ledger identity is invalid");
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
          !samePathHandleFileIdentity(before, opened, parentDevice, runtime)
        ) {
          throw new Error("artifact deletion ledger handle is invalid");
        }
        const bytes = runtimeFs.readFileSync(descriptor);
        const after = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (
          bytes.length > MAX_LEDGER_BYTES ||
          Number(after.size) !== bytes.length ||
          !sameFileStatIdentity(opened, after)
        ) {
          throw new Error("artifact deletion ledger changed while reading");
        }
        return bytes;
      } finally {
        if (descriptor !== null) runtimeFs.closeSync(descriptor);
      }
    },
    { runtime },
  );
}

function parseLedger(bytes) {
  if (bytes.length === 0) return [];
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("artifact deletion ledger is not strict UTF-8");
  }
  if (!text.endsWith("\n")) {
    throw new Error("artifact deletion ledger has a truncated tail");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.length > MAX_LEDGER_EVENTS) {
    throw new Error("artifact deletion ledger exceeds its event limit");
  }
  const events = [];
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error("artifact deletion ledger contains invalid JSON");
    }
    events.push(normalizeArtifactDeletionEvent(parsed, events.at(-1) || null));
  }
  return events;
}

export function readArtifactDeletionLedger(store, options = {}) {
  if (!store?.dir) {
    throw new TypeError("artifact deletion ledger requires an ArtifactStore");
  }
  const events = parseLedger(
    readLedgerBytes(ledgerPath(store), options.fs || fs, options.runtime),
  );
  return Object.freeze({
    schema: ARTIFACT_DELETION_LEDGER_SCHEMA,
    eventCount: events.length,
    preparedCount: events.filter((event) => event.phase === "prepared").length,
    terminalCount: events.filter((event) => event.phase === "terminal").length,
    headDigest: events.at(-1)?.eventDigest || null,
    events: Object.freeze(events),
  });
}

function normalizeRequest(input = {}) {
  const deletionId = String(
    input.deletionId || `delete_${randomUUID().replaceAll("-", "")}`,
  );
  const artifactId = String(input.artifactId || "");
  const reason = String(input.reason || "explicit");
  const client = String(input.client || "cli");
  if (
    !ID_RE.test(deletionId) ||
    !ID_RE.test(artifactId) ||
    !ARTIFACT_DELETION_REASONS.includes(reason) ||
    !ARTIFACT_DELETION_CLIENTS.includes(client)
  ) {
    throw new TypeError("artifact deletion request is invalid");
  }
  return Object.freeze({ deletionId, artifactId, reason, client });
}

function indexGenerationDigest(entries) {
  return digest("chainlesschain.artifact.index-generation.v1\0", entries);
}

function preparedArtifact(entry) {
  const artifactId = String(entry?.id || "");
  const sha256 = String(entry?.sha256 || "");
  const size = Number(entry?.size);
  if (
    !ID_RE.test(artifactId) ||
    !/^[a-f0-9]{64}$/u.test(sha256) ||
    !Number.isSafeInteger(size) ||
    size < 0
  ) {
    throw new Error("artifact index row cannot authorize deletion");
  }
  return Object.freeze({
    artifactId,
    artifactSha256: `sha256:${sha256}`,
    artifactSize: size,
    recordDigest:
      entry.recordDigest == null
        ? null
        : optionalDigest(entry.recordDigest, "artifact record digest"),
    artifactSessionId:
      entry.sessionId == null
        ? null
        : optionalId(entry.sessionId, "artifact session id"),
    storedFile: safeStoredFile(entry.file),
    immutable: entry.immutable === true,
  });
}

function samePreparedArtifact(entry, prepared) {
  try {
    const current = preparedArtifact(entry);
    return [
      "artifactId",
      "artifactSha256",
      "artifactSize",
      "recordDigest",
      "artifactSessionId",
      "storedFile",
      "immutable",
    ].every((field) => current[field] === prepared[field]);
  } catch {
    return false;
  }
}

function sameDeletionAuthority(terminal, prepared) {
  return [
    "artifactId",
    "artifactSha256",
    "artifactSize",
    "recordDigest",
    "artifactSessionId",
    "storedFile",
    "immutable",
    "reason",
    "client",
    "indexGenerationBefore",
  ].every((field) => terminal[field] === prepared[field]);
}

function appendEvent(filePath, event, expectedSize, runtimeFs) {
  let descriptor = null;
  try {
    descriptor = runtimeFs.openSync(
      filePath,
      runtimeFs.constants.O_WRONLY |
        runtimeFs.constants.O_APPEND |
        runtimeFs.constants.O_CREAT |
        Number(runtimeFs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      Number(opened.nlink) !== 1 ||
      Number(opened.size) !== expectedSize
    ) {
      throw new Error("artifact deletion ledger changed before append");
    }
    runtimeFs.writeFileSync(descriptor, `${JSON.stringify(event)}\n`, "utf8");
    runtimeFs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) runtimeFs.closeSync(descriptor);
  }
}

function eventFor(material, previous) {
  const candidate = {
    ...material,
    eventDigest: digest(
      "chainlesschain.artifact.deletion-settlement-event.v1\0",
      material,
    ),
  };
  return normalizeArtifactDeletionEvent(candidate, previous);
}

function assertRequestBinding(event, request) {
  if (
    event.artifactId !== request.artifactId ||
    event.reason !== request.reason ||
    event.client !== request.client
  ) {
    throw new Error("artifact deletion id is already bound to other inputs");
  }
}

function managedPath(store, storedFile) {
  const filesRoot = path.resolve(store.dir, "files");
  const target = path.resolve(filesRoot, safeStoredFile(storedFile));
  if (
    target !== path.join(filesRoot, storedFile) ||
    !target.startsWith(`${filesRoot}${path.sep}`)
  ) {
    throw new Error(
      "artifact deletion path escapes the managed files directory",
    );
  }
  return target;
}

function removeManagedCopy(store, prepared, runtimeFs) {
  const target = managedPath(store, prepared.storedFile);
  try {
    runtimeFs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return "already-absent";
    throw error;
  }
  if (prepared.immutable) {
    try {
      runtimeFs.chmodSync(target, 0o600);
    } catch {
      // rm may still succeed on filesystems without chmod support.
    }
  }
  runtimeFs.rmSync(target, { force: true });
  try {
    runtimeFs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return "removed";
    throw error;
  }
  throw new Error("artifact managed copy remains after deletion");
}

function assertManagedCopyAbsent(store, prepared, runtimeFs) {
  const target = managedPath(store, prepared.storedFile);
  try {
    runtimeFs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error("artifact managed copy reappeared after settlement");
}

function receipt(request, terminal, recorded) {
  return Object.freeze({
    schema: ARTIFACT_DELETION_RECEIPT_SCHEMA,
    deletionId: request.deletionId,
    artifactId: request.artifactId,
    found: true,
    settled: true,
    recorded,
    deletion: terminal,
  });
}

export function settleArtifactDeletion(store, input = {}, options = {}) {
  if (
    !store?.dir ||
    typeof store._withIndexLock !== "function" ||
    typeof store._readEntries !== "function" ||
    typeof store._rewriteUnlocked !== "function"
  ) {
    throw new TypeError("artifact deletion requires an ArtifactStore");
  }
  const request = normalizeRequest(input);
  const runtimeFs = options.fs || fs;
  const filePath = ledgerPath(store);
  runtimeFs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    return store._withIndexLock(() =>
      (options.withFileLock || withFileLock)(
        filePath,
        () => {
          let ledgerBytes = readLedgerBytes(
            filePath,
            runtimeFs,
            options.runtime,
          );
          const events = parseLedger(ledgerBytes);
          const requestEvents = events.filter(
            (event) => event.deletionId === request.deletionId,
          );
          if (requestEvents.length > 2) {
            throw new Error(
              "artifact deletion id has too many settlement events",
            );
          }
          const preparedEvents = requestEvents.filter(
            (event) => event.phase === "prepared",
          );
          const terminalEvents = requestEvents.filter(
            (event) => event.phase === "terminal",
          );
          if (preparedEvents.length > 1 || terminalEvents.length > 1) {
            throw new Error("artifact deletion settlement is ambiguous");
          }
          let prepared = preparedEvents[0] || null;
          const terminal = terminalEvents[0] || null;
          if (terminal) {
            if (
              !prepared ||
              terminal.preparedEventDigest !== prepared.eventDigest ||
              !sameDeletionAuthority(terminal, prepared)
            ) {
              throw new Error(
                "artifact deletion terminal has no unique preparation",
              );
            }
            assertRequestBinding(prepared, request);
            const currentMatches = store
              ._readEntries()
              .filter((entry) => entry.id === request.artifactId);
            if (currentMatches.length !== 0) {
              throw new Error("artifact reappeared after deletion settlement");
            }
            assertManagedCopyAbsent(store, prepared, runtimeFs);
            return receipt(request, terminal, false);
          }

          let entries = store._readEntries();
          const matches = entries.filter(
            (entry) => entry.id === request.artifactId,
          );
          if (!prepared) {
            if (matches.length === 0) {
              return Object.freeze({
                schema: ARTIFACT_DELETION_RECEIPT_SCHEMA,
                deletionId: request.deletionId,
                artifactId: request.artifactId,
                found: false,
                settled: false,
                recorded: false,
                deletion: null,
              });
            }
            if (matches.length > 1) {
              throw new Error("artifact id is ambiguous for deletion");
            }
            const artifact = preparedArtifact(matches[0]);
            const previous = events.at(-1) || null;
            const material = {
              schema: ARTIFACT_DELETION_EVENT_SCHEMA,
              sequence: (previous?.sequence || 0) + 1,
              previousEventDigest: previous?.eventDigest || null,
              deletionId: request.deletionId,
              phase: "prepared",
              preparedEventDigest: null,
              ...artifact,
              reason: request.reason,
              client: request.client,
              indexGenerationBefore: indexGenerationDigest(entries),
              indexGenerationAfter: null,
              managedCopyDisposition: "pending",
              occurredAt: new Date(
                typeof options.now === "function" ? options.now() : Date.now(),
              ).toISOString(),
            };
            prepared = eventFor(material, previous);
            appendEvent(filePath, prepared, ledgerBytes.length, runtimeFs);
            ledgerBytes = Buffer.concat([
              ledgerBytes,
              Buffer.from(`${JSON.stringify(prepared)}\n`, "utf8"),
            ]);
          } else {
            assertRequestBinding(prepared, request);
            if (matches.length > 1) {
              throw new Error(
                "artifact id is ambiguous during deletion recovery",
              );
            }
            if (
              matches.length === 1 &&
              !samePreparedArtifact(matches[0], prepared)
            ) {
              throw new Error("artifact changed after deletion preparation");
            }
          }

          if (matches.length === 1) {
            store._rewriteUnlocked(
              entries.filter((entry) => entry.id !== request.artifactId),
            );
            entries = entries.filter(
              (entry) => entry.id !== request.artifactId,
            );
          }
          const disposition = removeManagedCopy(store, prepared, runtimeFs);
          const previous = parseLedger(ledgerBytes).at(-1) || null;
          const terminalMaterial = {
            schema: ARTIFACT_DELETION_EVENT_SCHEMA,
            sequence: (previous?.sequence || 0) + 1,
            previousEventDigest: previous?.eventDigest || null,
            deletionId: request.deletionId,
            phase: "terminal",
            preparedEventDigest: prepared.eventDigest,
            artifactId: prepared.artifactId,
            artifactSha256: prepared.artifactSha256,
            artifactSize: prepared.artifactSize,
            recordDigest: prepared.recordDigest,
            artifactSessionId: prepared.artifactSessionId,
            storedFile: prepared.storedFile,
            immutable: prepared.immutable,
            reason: prepared.reason,
            client: prepared.client,
            indexGenerationBefore: prepared.indexGenerationBefore,
            indexGenerationAfter: indexGenerationDigest(entries),
            managedCopyDisposition: disposition,
            occurredAt: new Date(
              typeof options.now === "function" ? options.now() : Date.now(),
            ).toISOString(),
          };
          const settled = eventFor(terminalMaterial, previous);
          appendEvent(filePath, settled, ledgerBytes.length, runtimeFs);
          return receipt(request, settled, true);
        },
        {
          failIfUnavailable: true,
          timeoutMs: 30_000,
          retryMs: 1,
          maxRetryMs: 8,
          retryJitterMs: 4,
        },
      ),
    );
  } catch (error) {
    error.deletionId = request.deletionId;
    throw error;
  }
}
