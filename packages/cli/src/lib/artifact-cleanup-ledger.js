import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalJson } from "./scheduler-kernel/contract.js";
import { sameFileStatIdentity } from "./secure-file-identity.js";
import {
  ARTIFACT_DELETION_CLIENTS,
  settleArtifactDeletion,
} from "./artifact-deletion-ledger.js";
import { withFileLock } from "./with-file-lock.js";

export const ARTIFACT_CLEANUP_EVENT_SCHEMA =
  "cc-artifact-cleanup-settlement/v1";
export const ARTIFACT_CLEANUP_LEDGER_SCHEMA =
  "cc-artifact-cleanup-settlement-ledger/v1";
export const ARTIFACT_CLEANUP_RECEIPT_SCHEMA = "cc-artifact-cleanup-receipt/v1";

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/u;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const RAW_SHA256_RE = /^[a-f0-9]{64}$/u;
const MAX_LEDGER_BYTES = 32 * 1024 * 1024;
const MAX_LEDGER_EVENTS = 100_000;
const MAX_BATCH_ITEMS = 10_000;

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "artifactCleanupLedger"), "utf8")
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
    throw new TypeError("artifact cleanup stored file is invalid");
  }
  return normalized;
}

function normalizePreparedItem(input) {
  const value = exactObject(
    input,
    [
      "artifactId",
      "artifactSha256",
      "artifactSize",
      "recordDigest",
      "artifactSessionId",
      "storedFile",
      "immutable",
      "expiresAt",
      "deletionId",
    ],
    "artifact cleanup prepared item",
  );
  const artifactId = String(value.artifactId || "");
  const artifactSha256 = String(value.artifactSha256 || "");
  const artifactSize = Number(value.artifactSize);
  const recordDigest = optionalDigest(
    value.recordDigest,
    "artifact cleanup record digest",
  );
  const artifactSessionId = optionalId(
    value.artifactSessionId,
    "artifact cleanup session id",
  );
  const storedFile = safeStoredFile(value.storedFile);
  const expiresAt = String(value.expiresAt || "");
  const deletionId = String(value.deletionId || "");
  if (
    !ID_RE.test(artifactId) ||
    !SHA256_RE.test(artifactSha256) ||
    !Number.isSafeInteger(artifactSize) ||
    artifactSize < 0 ||
    typeof value.immutable !== "boolean" ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    !ID_RE.test(deletionId)
  ) {
    throw new TypeError("artifact cleanup prepared item is invalid");
  }
  return Object.freeze({
    artifactId,
    artifactSha256,
    artifactSize,
    recordDigest,
    artifactSessionId,
    storedFile,
    immutable: value.immutable,
    expiresAt,
    deletionId,
  });
}

function normalizeTerminalItem(input) {
  const value = exactObject(
    input,
    [
      "artifactId",
      "deletionId",
      "deletionEventDigest",
      "managedCopyDisposition",
    ],
    "artifact cleanup terminal item",
  );
  const artifactId = String(value.artifactId || "");
  const deletionId = String(value.deletionId || "");
  const deletionEventDigest = String(value.deletionEventDigest || "");
  const managedCopyDisposition = String(value.managedCopyDisposition || "");
  if (
    !ID_RE.test(artifactId) ||
    !ID_RE.test(deletionId) ||
    !SHA256_RE.test(deletionEventDigest) ||
    !["removed", "already-absent"].includes(managedCopyDisposition)
  ) {
    throw new TypeError("artifact cleanup terminal item is invalid");
  }
  return Object.freeze({
    artifactId,
    deletionId,
    deletionEventDigest,
    managedCopyDisposition,
  });
}

export function normalizeArtifactCleanupEvent(input, previous = null) {
  const value = exactObject(
    input,
    [
      "schema",
      "sequence",
      "previousEventDigest",
      "cleanupId",
      "phase",
      "preparedEventDigest",
      "client",
      "cutoffAt",
      "scopeDigest",
      "itemCount",
      "items",
      "indexGenerationBefore",
      "indexGenerationAfter",
      "occurredAt",
      "eventDigest",
    ],
    "artifact cleanup event",
  );
  const sequence = Number(value.sequence);
  const previousEventDigest = optionalDigest(
    value.previousEventDigest,
    "artifact cleanup predecessor digest",
  );
  const cleanupId = String(value.cleanupId || "");
  const phase = String(value.phase || "");
  const preparedEventDigest = optionalDigest(
    value.preparedEventDigest,
    "artifact cleanup prepared event digest",
  );
  const client = String(value.client || "");
  const cutoffAt = String(value.cutoffAt || "");
  const scopeDigest = String(value.scopeDigest || "");
  const itemCount = Number(value.itemCount);
  const indexGenerationBefore = String(value.indexGenerationBefore || "");
  const indexGenerationAfter = optionalDigest(
    value.indexGenerationAfter,
    "artifact cleanup terminal index generation",
  );
  const occurredAt = String(value.occurredAt || "");
  if (
    value.schema !== ARTIFACT_CLEANUP_EVENT_SCHEMA ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !ID_RE.test(cleanupId) ||
    !["prepared", "terminal"].includes(phase) ||
    !ARTIFACT_DELETION_CLIENTS.includes(client) ||
    !Number.isFinite(Date.parse(cutoffAt)) ||
    !SHA256_RE.test(scopeDigest) ||
    !Number.isSafeInteger(itemCount) ||
    itemCount < 0 ||
    itemCount > MAX_BATCH_ITEMS ||
    !Array.isArray(value.items) ||
    value.items.length !== itemCount ||
    !SHA256_RE.test(indexGenerationBefore) ||
    !Number.isFinite(Date.parse(occurredAt)) ||
    !SHA256_RE.test(String(value.eventDigest || ""))
  ) {
    throw new TypeError("artifact cleanup event is invalid");
  }
  const items = Object.freeze(
    value.items.map((item) =>
      phase === "prepared"
        ? normalizePreparedItem(item)
        : normalizeTerminalItem(item),
    ),
  );
  if (
    (phase === "prepared" &&
      (preparedEventDigest !== null || indexGenerationAfter !== null)) ||
    (phase === "terminal" && (!preparedEventDigest || !indexGenerationAfter))
  ) {
    throw new TypeError("artifact cleanup phase fields are invalid");
  }
  if (
    sequence !== (previous?.sequence || 0) + 1 ||
    previousEventDigest !== (previous?.eventDigest || null)
  ) {
    throw new Error("artifact cleanup event chain is invalid");
  }
  const material = {
    schema: value.schema,
    sequence,
    previousEventDigest,
    cleanupId,
    phase,
    preparedEventDigest,
    client,
    cutoffAt,
    scopeDigest,
    itemCount,
    items,
    indexGenerationBefore,
    indexGenerationAfter,
    occurredAt,
  };
  if (
    value.eventDigest !==
    digest("chainlesschain.artifact.cleanup-settlement-event.v1\0", material)
  ) {
    throw new Error("artifact cleanup event digest is invalid");
  }
  return Object.freeze({ ...material, eventDigest: value.eventDigest });
}

function validateBatchEvents(events) {
  const byId = new Map();
  for (const event of events) {
    const current = byId.get(event.cleanupId) || {
      prepared: null,
      terminal: null,
    };
    if (event.phase === "prepared") {
      if (current.prepared) {
        throw new Error("artifact cleanup id has duplicate preparations");
      }
      current.prepared = event;
    } else {
      if (current.terminal) {
        throw new Error("artifact cleanup id has duplicate terminals");
      }
      current.terminal = event;
    }
    byId.set(event.cleanupId, current);
  }
  for (const state of byId.values()) {
    if (!state.terminal) continue;
    const { prepared, terminal } = state;
    if (
      !prepared ||
      terminal.preparedEventDigest !== prepared.eventDigest ||
      terminal.client !== prepared.client ||
      terminal.cutoffAt !== prepared.cutoffAt ||
      terminal.scopeDigest !== prepared.scopeDigest ||
      terminal.itemCount !== prepared.itemCount ||
      terminal.indexGenerationBefore !== prepared.indexGenerationBefore
    ) {
      throw new Error("artifact cleanup terminal has no unique preparation");
    }
    for (let index = 0; index < prepared.items.length; index += 1) {
      const preparedItem = prepared.items[index];
      const terminalItem = terminal.items[index];
      if (
        terminalItem.artifactId !== preparedItem.artifactId ||
        terminalItem.deletionId !== preparedItem.deletionId
      ) {
        throw new Error("artifact cleanup terminal item order is invalid");
      }
    }
  }
  return byId;
}

function ledgerPath(store) {
  return path.join(path.resolve(store.dir), "cleanup-settlements.jsonl");
}

function readLedgerBytes(filePath, runtimeFs) {
  let before;
  try {
    before = runtimeFs.lstatSync(filePath, { bigint: true });
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
    throw new Error("artifact cleanup ledger identity is invalid");
  }
  let descriptor = null;
  try {
    descriptor = runtimeFs.openSync(
      filePath,
      runtimeFs.constants.O_RDONLY |
        Number(runtimeFs.constants.O_NOFOLLOW || 0),
    );
    const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      Number(opened.nlink) !== 1 ||
      !sameFileStatIdentity(before, opened)
    ) {
      throw new Error("artifact cleanup ledger handle is invalid");
    }
    const bytes = runtimeFs.readFileSync(descriptor);
    const after = runtimeFs.fstatSync(descriptor, { bigint: true });
    if (
      bytes.length > MAX_LEDGER_BYTES ||
      Number(after.size) !== bytes.length ||
      !sameFileStatIdentity(opened, after)
    ) {
      throw new Error("artifact cleanup ledger changed while reading");
    }
    return bytes;
  } finally {
    if (descriptor !== null) runtimeFs.closeSync(descriptor);
  }
}

function parseLedger(bytes) {
  if (bytes.length === 0) return [];
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("artifact cleanup ledger is not strict UTF-8");
  }
  if (!text.endsWith("\n")) {
    throw new Error("artifact cleanup ledger has a truncated tail");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.length > MAX_LEDGER_EVENTS) {
    throw new Error("artifact cleanup ledger exceeds its event limit");
  }
  const events = [];
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error("artifact cleanup ledger contains invalid JSON");
    }
    events.push(normalizeArtifactCleanupEvent(parsed, events.at(-1) || null));
  }
  validateBatchEvents(events);
  return events;
}

export function readArtifactCleanupLedger(store, options = {}) {
  if (!store?.dir) {
    throw new TypeError("artifact cleanup ledger requires an ArtifactStore");
  }
  const events = parseLedger(
    readLedgerBytes(ledgerPath(store), options.fs || fs),
  );
  return Object.freeze({
    schema: ARTIFACT_CLEANUP_LEDGER_SCHEMA,
    eventCount: events.length,
    preparedCount: events.filter((event) => event.phase === "prepared").length,
    terminalCount: events.filter((event) => event.phase === "terminal").length,
    pendingCount: [...validateBatchEvents(events).values()].filter(
      (state) => state.prepared && !state.terminal,
    ).length,
    headDigest: events.at(-1)?.eventDigest || null,
    events: Object.freeze(events),
  });
}

function normalizeRequest(input = {}) {
  const cleanupId = String(
    input.cleanupId || `cleanup_${randomUUID().replaceAll("-", "")}`,
  );
  const client = String(input.client || "cli");
  if (!ID_RE.test(cleanupId) || !ARTIFACT_DELETION_CLIENTS.includes(client)) {
    throw new TypeError("artifact cleanup request is invalid");
  }
  return Object.freeze({ cleanupId, client });
}

function indexGenerationDigest(entries) {
  return digest("chainlesschain.artifact.index-generation.v1\0", entries);
}

function cleanupDeletionId(cleanupId, entry) {
  return `cleanup_item_${createHash("sha256")
    .update("chainlesschain.artifact.cleanup-item.v1\0", "utf8")
    .update(cleanupId, "utf8")
    .update("\0", "utf8")
    .update(String(entry.id || ""), "utf8")
    .update("\0", "utf8")
    .update(String(entry.sha256 || ""), "utf8")
    .digest("hex")}`;
}

function preparedItem(cleanupId, entry) {
  const artifactId = String(entry?.id || "");
  const rawSha256 = String(entry?.sha256 || "");
  const artifactSize = Number(entry?.size);
  const expiresAt = String(entry?.expiresAt || "");
  if (
    !ID_RE.test(artifactId) ||
    !RAW_SHA256_RE.test(rawSha256) ||
    !Number.isSafeInteger(artifactSize) ||
    artifactSize < 0 ||
    !Number.isFinite(Date.parse(expiresAt))
  ) {
    throw new Error("artifact index row cannot authorize cleanup");
  }
  return normalizePreparedItem({
    artifactId,
    artifactSha256: `sha256:${rawSha256}`,
    artifactSize,
    recordDigest:
      entry.recordDigest == null
        ? null
        : optionalDigest(entry.recordDigest, "artifact cleanup record digest"),
    artifactSessionId:
      entry.sessionId == null
        ? null
        : optionalId(entry.sessionId, "artifact cleanup session id"),
    storedFile: safeStoredFile(entry.file),
    immutable: entry.immutable === true,
    expiresAt,
    deletionId: cleanupDeletionId(cleanupId, entry),
  });
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
      throw new Error("artifact cleanup ledger changed before append");
    }
    runtimeFs.writeFileSync(descriptor, `${JSON.stringify(event)}\n`, "utf8");
    runtimeFs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) runtimeFs.closeSync(descriptor);
  }
}

function eventFor(material, previous) {
  return normalizeArtifactCleanupEvent(
    {
      ...material,
      eventDigest: digest(
        "chainlesschain.artifact.cleanup-settlement-event.v1\0",
        material,
      ),
    },
    previous,
  );
}

function sameTerminalItems(left, right) {
  return (
    canonicalJson(left, "artifactCleanupTerminalItems") ===
    canonicalJson(right, "artifactCleanupTerminalItems")
  );
}

function managedPath(store, storedFile) {
  const filesRoot = path.resolve(store.dir, "files");
  const target = path.resolve(filesRoot, safeStoredFile(storedFile));
  if (
    target !== path.join(filesRoot, storedFile) ||
    !target.startsWith(`${filesRoot}${path.sep}`)
  ) {
    throw new Error(
      "artifact cleanup path escapes the managed files directory",
    );
  }
  return target;
}

function assertPreparedScopeAbsent(store, prepared, runtimeFs) {
  const currentEntries = store._readEntries();
  const selectedIds = new Set(prepared.items.map((item) => item.artifactId));
  if (currentEntries.some((entry) => selectedIds.has(String(entry.id)))) {
    throw new Error("artifact cleanup scope reappeared after settlement");
  }
  for (const item of prepared.items) {
    try {
      runtimeFs.lstatSync(managedPath(store, item.storedFile));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    throw new Error(
      "artifact cleanup managed path reappeared after settlement",
    );
  }
}

function prepareBatch(store, request, options, runtimeFs, filePath) {
  return store._withIndexLock(() =>
    (options.withFileLock || withFileLock)(
      filePath,
      () => {
        const ledgerBytes = readLedgerBytes(filePath, runtimeFs);
        const events = parseLedger(ledgerBytes);
        const batches = validateBatchEvents(events);
        const state = batches.get(request.cleanupId) || {
          prepared: null,
          terminal: null,
        };
        if (state.prepared) {
          if (state.prepared.client !== request.client) {
            throw new Error(
              "artifact cleanup id is already bound to other inputs",
            );
          }
          if (state.terminal) {
            assertPreparedScopeAbsent(store, state.prepared, runtimeFs);
          }
          return Object.freeze({
            prepared: state.prepared,
            terminal: state.terminal,
            preparedRecorded: false,
          });
        }

        const entries = store._readEntries();
        const cutoffAt = new Date(
          typeof options.now === "function" ? options.now() : Date.now(),
        ).toISOString();
        const cutoffMs = Date.parse(cutoffAt);
        const expired = entries.filter((entry) => {
          const expiresAt = Date.parse(entry.expiresAt || "");
          return Number.isFinite(expiresAt) && expiresAt <= cutoffMs;
        });
        if (expired.length > MAX_BATCH_ITEMS) {
          throw new Error("artifact cleanup batch exceeds its item limit");
        }
        const duplicateIds = new Set();
        const seenIds = new Set();
        for (const entry of entries) {
          const id = String(entry?.id || "");
          if (seenIds.has(id)) duplicateIds.add(id);
          seenIds.add(id);
        }
        if (expired.some((entry) => duplicateIds.has(String(entry.id)))) {
          throw new Error("artifact cleanup scope contains an ambiguous id");
        }
        const items = Object.freeze(
          expired.map((entry) => preparedItem(request.cleanupId, entry)),
        );
        const itemIds = new Set(items.map((item) => item.artifactId));
        for (const batch of batches.values()) {
          if (!batch.prepared || batch.terminal) continue;
          if (
            batch.prepared.items.some((item) => itemIds.has(item.artifactId))
          ) {
            throw new Error("artifact cleanup scope overlaps a pending batch");
          }
        }
        const scopeDigest = digest(
          "chainlesschain.artifact.cleanup-scope.v1\0",
          { cutoffAt, items },
        );
        const previous = events.at(-1) || null;
        const material = {
          schema: ARTIFACT_CLEANUP_EVENT_SCHEMA,
          sequence: (previous?.sequence || 0) + 1,
          previousEventDigest: previous?.eventDigest || null,
          cleanupId: request.cleanupId,
          phase: "prepared",
          preparedEventDigest: null,
          client: request.client,
          cutoffAt,
          scopeDigest,
          itemCount: items.length,
          items,
          indexGenerationBefore: indexGenerationDigest(entries),
          indexGenerationAfter: null,
          occurredAt: cutoffAt,
        };
        const prepared = eventFor(material, previous);
        appendEvent(filePath, prepared, ledgerBytes.length, runtimeFs);
        return Object.freeze({
          prepared,
          terminal: null,
          preparedRecorded: true,
        });
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
}

function appendTerminal(
  store,
  request,
  prepared,
  terminalItems,
  options,
  runtimeFs,
  filePath,
) {
  return store._withIndexLock(() =>
    (options.withFileLock || withFileLock)(
      filePath,
      () => {
        const ledgerBytes = readLedgerBytes(filePath, runtimeFs);
        const events = parseLedger(ledgerBytes);
        const state = validateBatchEvents(events).get(request.cleanupId);
        if (
          !state?.prepared ||
          state.prepared.eventDigest !== prepared.eventDigest
        ) {
          throw new Error(
            "artifact cleanup preparation changed before terminal",
          );
        }
        assertPreparedScopeAbsent(store, prepared, runtimeFs);
        if (state.terminal) {
          if (!sameTerminalItems(state.terminal.items, terminalItems)) {
            throw new Error("artifact cleanup terminal summary is ambiguous");
          }
          return Object.freeze({ terminal: state.terminal, recorded: false });
        }
        const currentEntries = store._readEntries();
        const previous = events.at(-1) || null;
        const terminal = eventFor(
          {
            schema: ARTIFACT_CLEANUP_EVENT_SCHEMA,
            sequence: (previous?.sequence || 0) + 1,
            previousEventDigest: previous?.eventDigest || null,
            cleanupId: request.cleanupId,
            phase: "terminal",
            preparedEventDigest: prepared.eventDigest,
            client: prepared.client,
            cutoffAt: prepared.cutoffAt,
            scopeDigest: prepared.scopeDigest,
            itemCount: prepared.itemCount,
            items: terminalItems,
            indexGenerationBefore: prepared.indexGenerationBefore,
            indexGenerationAfter: indexGenerationDigest(currentEntries),
            occurredAt: new Date(
              typeof options.now === "function" ? options.now() : Date.now(),
            ).toISOString(),
          },
          previous,
        );
        appendEvent(filePath, terminal, ledgerBytes.length, runtimeFs);
        return Object.freeze({ terminal, recorded: true });
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
}

function receipt(request, prepared, terminal, recorded, preparedRecorded) {
  const removedNow = terminal.items.filter(
    (item) => item.managedCopyDisposition === "removed",
  ).length;
  const alreadyAbsent = terminal.items.length - removedNow;
  return Object.freeze({
    schema: ARTIFACT_CLEANUP_RECEIPT_SCHEMA,
    cleanupId: request.cleanupId,
    client: request.client,
    cutoffAt: prepared.cutoffAt,
    scopeDigest: prepared.scopeDigest,
    selected: prepared.itemCount,
    removed: prepared.itemCount,
    removedNow,
    alreadyAbsent,
    settled: true,
    preparedRecorded,
    recorded,
    cleanup: terminal,
    items: terminal.items,
  });
}

export function settleArtifactCleanup(store, input = {}, options = {}) {
  if (
    !store?.dir ||
    typeof store._withIndexLock !== "function" ||
    typeof store._readEntries !== "function"
  ) {
    throw new TypeError("artifact cleanup requires an ArtifactStore");
  }
  const request = normalizeRequest(input);
  const runtimeFs = options.fs || fs;
  const filePath = ledgerPath(store);
  runtimeFs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    const batch = prepareBatch(store, request, options, runtimeFs, filePath);
    const settleDeletion =
      options.settleArtifactDeletion || settleArtifactDeletion;
    const terminalItems = [];
    for (let index = 0; index < batch.prepared.items.length; index += 1) {
      const item = batch.prepared.items[index];
      try {
        const deletion = settleDeletion(
          store,
          {
            deletionId: item.deletionId,
            artifactId: item.artifactId,
            reason: "expired",
            client: request.client,
          },
          options.deletionOptions || {},
        );
        if (!deletion?.found || !deletion?.settled || !deletion?.deletion) {
          throw new Error("artifact cleanup item has no deletion settlement");
        }
        const terminalItem = normalizeTerminalItem({
          artifactId: item.artifactId,
          deletionId: item.deletionId,
          deletionEventDigest: deletion.deletion.eventDigest,
          managedCopyDisposition: deletion.deletion.managedCopyDisposition,
        });
        terminalItems.push(terminalItem);
        if (typeof options.afterItem === "function") {
          options.afterItem(
            Object.freeze({
              cleanupId: request.cleanupId,
              index,
              selected: batch.prepared.itemCount,
              item: terminalItem,
            }),
          );
        }
      } catch (error) {
        error.cleanupId = request.cleanupId;
        error.cleanup = Object.freeze({
          selected: batch.prepared.itemCount,
          settled: terminalItems.length,
          pending: batch.prepared.itemCount - terminalItems.length,
          artifactId: item.artifactId,
          deletionId: item.deletionId,
        });
        throw error;
      }
    }
    let terminalResult;
    try {
      terminalResult = appendTerminal(
        store,
        request,
        batch.prepared,
        Object.freeze(terminalItems),
        options,
        runtimeFs,
        filePath,
      );
    } catch (error) {
      error.cleanupId = request.cleanupId;
      error.cleanup = Object.freeze({
        selected: batch.prepared.itemCount,
        settled: terminalItems.length,
        pending: batch.prepared.itemCount - terminalItems.length,
        artifactId: null,
        deletionId: null,
      });
      throw error;
    }
    return receipt(
      request,
      batch.prepared,
      terminalResult.terminal,
      terminalResult.recorded,
      batch.preparedRecorded,
    );
  } catch (error) {
    error.cleanupId = request.cleanupId;
    throw error;
  }
}
