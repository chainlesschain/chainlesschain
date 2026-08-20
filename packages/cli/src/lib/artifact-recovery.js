import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalJson } from "./scheduler-kernel/contract.js";
import {
  readArtifactCleanupLedger,
  settleArtifactCleanup,
} from "./artifact-cleanup-ledger.js";
import {
  readArtifactDeletionLedger,
  settleArtifactDeletion,
} from "./artifact-deletion-ledger.js";
import { withFileLock } from "./with-file-lock.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "./secure-file-identity.js";

export const ARTIFACT_RECOVERY_PLAN_SCHEMA = "cc-artifact-recovery-plan/v1";
export const ARTIFACT_ORPHAN_GC_EVENT_SCHEMA =
  "cc-artifact-orphan-gc-settlement/v1";
export const ARTIFACT_ORPHAN_GC_LEDGER_SCHEMA =
  "cc-artifact-orphan-gc-settlement-ledger/v1";

export const ARTIFACT_RECOVERY_DECISIONS = Object.freeze([
  "retry",
  "delete-orphan",
  "defer",
]);

export const DEFAULT_ARTIFACT_RECOVERY_TIMEOUT_MS = 15 * 60 * 1000;
export const MAX_ARTIFACT_RECOVERY_FILES = 10_000;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/u;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const MAX_LEDGER_BYTES = 16 * 1024 * 1024;
const MAX_LEDGER_EVENTS = 100_000;
const MAX_ORPHAN_BYTES = 100 * 1024 * 1024;

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "artifactRecovery"), "utf8")
    .digest("hex")}`;
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
    throw new Error("artifact recovery stored file is invalid");
  }
  return normalized;
}

function nowMs(options) {
  const value = typeof options.now === "function" ? options.now() : Date.now();
  if (!Number.isFinite(value))
    throw new Error("artifact recovery clock is invalid");
  return value;
}

function timeoutMs(options) {
  const value = Number(
    options.timeoutMs ?? DEFAULT_ARTIFACT_RECOVERY_TIMEOUT_MS,
  );
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("artifact recovery timeout is invalid");
  }
  return value;
}

function eventAgeMs(event, observedAt) {
  const occurredAt = Date.parse(event?.occurredAt || "");
  return Number.isFinite(occurredAt) ? Math.max(0, observedAt - occurredAt) : 0;
}

function stableItemId(kind, authority) {
  return `recovery_${createHash("sha256")
    .update("chainlesschain.artifact.recovery-item.v1\0", "utf8")
    .update(kind, "utf8")
    .update("\0", "utf8")
    .update(canonicalJson(authority, "artifactRecoveryItem"), "utf8")
    .digest("hex")}`;
}

function fileIdentity(stat) {
  return Object.freeze({
    size: Number(stat.size),
    mtimeMs: Math.trunc(Number(stat.mtimeMs)),
    ctimeMs: Math.trunc(Number(stat.ctimeMs)),
    mode: Number(stat.mode),
    nlink: Number(stat.nlink),
    dev: String(stat.dev),
    ino: String(stat.ino),
  });
}

function sameFileIdentity(left, right) {
  return ["size", "mtimeMs", "ctimeMs", "mode", "nlink", "dev", "ino"].every(
    (field) => String(left?.[field]) === String(right?.[field]),
  );
}

function inspectRegularFile(filePath, runtimeFs) {
  let descriptor = null;
  try {
    descriptor = runtimeFs.openSync(
      filePath,
      runtimeFs.constants.O_RDONLY |
        Number(runtimeFs.constants.O_NOFOLLOW || 0),
    );
    const before = runtimeFs.fstatSync(descriptor);
    if (!before.isFile() || Number(before.nlink) !== 1) {
      return Object.freeze({ safe: false, reason: "unsafe-file-identity" });
    }
    if (Number(before.size) > MAX_ORPHAN_BYTES) {
      return Object.freeze({ safe: false, reason: "orphan-size-limit" });
    }
    const body = runtimeFs.readFileSync(descriptor);
    const after = runtimeFs.fstatSync(descriptor);
    const beforeIdentity = fileIdentity(before);
    const afterIdentity = fileIdentity(after);
    if (
      !sameFileIdentity(beforeIdentity, afterIdentity) ||
      body.length !== Number(before.size)
    ) {
      return Object.freeze({ safe: false, reason: "file-identity-drift" });
    }
    return Object.freeze({
      safe: true,
      identity: beforeIdentity,
      contentDigest: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    });
  } catch (error) {
    return Object.freeze({
      safe: false,
      reason:
        error?.code === "ENOENT" ? "file-disappeared" : "file-read-failed",
    });
  } finally {
    if (descriptor !== null) runtimeFs.closeSync(descriptor);
  }
}

function pendingById(events, idField) {
  const states = new Map();
  for (const event of events) {
    const id = event[idField];
    const state = states.get(id) || { prepared: null, terminal: null };
    if (event.phase === "prepared") state.prepared = event;
    if (event.phase === "terminal") state.terminal = event;
    states.set(id, state);
  }
  return [...states.values()].filter(
    (state) => state.prepared && !state.terminal,
  );
}

function recoveryItem(kind, authority, details) {
  return Object.freeze({
    itemId: stableItemId(kind, authority),
    kind,
    ...details,
    authority: Object.freeze(authority),
  });
}

function inventoryManagedCopies(store, entries, runtimeFs) {
  const filesDir = path.resolve(store.dir, "files");
  runtimeFs.mkdirSync(filesDir, { recursive: true, mode: 0o700 });
  const dirEntries = runtimeFs.readdirSync(filesDir, { withFileTypes: true });
  if (dirEntries.length > MAX_ARTIFACT_RECOVERY_FILES) {
    throw new Error("artifact recovery file inventory exceeds its limit");
  }
  const referenced = new Map();
  const items = [];
  for (const entry of entries) {
    let storedFile;
    try {
      storedFile = safeStoredFile(entry?.file);
    } catch {
      const authority = {
        artifactId: String(entry?.id || ""),
        recordDigest: entry?.recordDigest || null,
      };
      items.push(
        recoveryItem("invalid-index-row", authority, {
          severity: "critical",
          timedOut: true,
          recommendedDecision: "defer",
          automaticallyExecutable: false,
          requiresApproval: true,
        }),
      );
      continue;
    }
    const refs = referenced.get(storedFile) || [];
    refs.push(entry);
    referenced.set(storedFile, refs);
  }

  const present = new Set();
  for (const dirEntry of dirEntries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    let storedFile;
    try {
      storedFile = safeStoredFile(dirEntry.name);
    } catch {
      const authority = {
        nameDigest: digest(
          "chainlesschain.artifact.unsafe-name.v1\0",
          dirEntry.name,
        ),
      };
      items.push(
        recoveryItem("unsafe-managed-entry", authority, {
          severity: "critical",
          timedOut: true,
          recommendedDecision: "defer",
          automaticallyExecutable: false,
          requiresApproval: true,
        }),
      );
      continue;
    }
    present.add(storedFile);
    const refs = referenced.get(storedFile) || [];
    if (refs.length > 0) continue;
    const inspected = inspectRegularFile(
      path.join(filesDir, storedFile),
      runtimeFs,
    );
    const authority = {
      storedFile,
      identity: inspected.safe ? inspected.identity : null,
      contentDigest: inspected.safe ? inspected.contentDigest : null,
      inspectionFailure: inspected.safe ? null : inspected.reason,
    };
    items.push(
      recoveryItem(
        inspected.safe ? "orphan-managed-copy" : "unsafe-orphan-managed-copy",
        authority,
        {
          severity: inspected.safe ? "warning" : "critical",
          timedOut: true,
          recommendedDecision: inspected.safe ? "delete-orphan" : "defer",
          automaticallyExecutable: false,
          requiresApproval: true,
          size: inspected.safe ? inspected.identity.size : null,
        },
      ),
    );
  }

  for (const [storedFile, refs] of referenced) {
    if (present.has(storedFile)) continue;
    for (const entry of refs) {
      const authority = {
        artifactId: String(entry.id || ""),
        artifactSha256: /^[a-f0-9]{64}$/u.test(String(entry.sha256 || ""))
          ? `sha256:${entry.sha256}`
          : null,
        recordDigest: entry.recordDigest || null,
        artifactSessionId: entry.sessionId || null,
        storedFile,
      };
      items.push(
        recoveryItem("missing-managed-copy", authority, {
          severity: "critical",
          timedOut: true,
          recommendedDecision: "defer",
          automaticallyExecutable: false,
          requiresApproval: true,
        }),
      );
    }
  }
  return items;
}

export function buildArtifactRecoveryPlan(store, options = {}) {
  if (!store?.dir || typeof store._withIndexLock !== "function") {
    throw new TypeError("artifact recovery requires an ArtifactStore");
  }
  const runtimeFs = options.fs || fs;
  const observedAtMs = nowMs(options);
  const pendingTimeoutMs = timeoutMs(options);
  // The verified ledger readers require a canonical parent even when no
  // ledger has been created yet. Establish only the managed directories;
  // startup reconciliation remains read-only with respect to artifacts.
  store._ensureDirs();
  const cleanupLedger = (
    options.readArtifactCleanupLedger || readArtifactCleanupLedger
  )(store, options.cleanupOptions || {});
  const deletionLedger = (
    options.readArtifactDeletionLedger || readArtifactDeletionLedger
  )(store, options.deletionOptions || {});
  const orphanGcLedger = (
    options.readArtifactOrphanGcLedger || readArtifactOrphanGcLedger
  )(store, options.orphanGcOptions || {});
  const pendingCleanups = pendingById(cleanupLedger.events, "cleanupId");
  const pendingManagedFiles = new Set(
    pendingCleanups.flatMap((state) =>
      state.prepared.items.map((item) => item.storedFile),
    ),
  );
  const cleanupDeletionIds = new Set(
    pendingCleanups.flatMap((state) =>
      state.prepared.items.map((item) => item.deletionId),
    ),
  );
  const items = [];
  for (const state of pendingCleanups) {
    const prepared = state.prepared;
    const ageMs = eventAgeMs(prepared, observedAtMs);
    const authority = {
      cleanupId: prepared.cleanupId,
      client: prepared.client,
      preparedEventDigest: prepared.eventDigest,
      scopeDigest: prepared.scopeDigest,
      itemCount: prepared.itemCount,
    };
    items.push(
      recoveryItem("pending-cleanup", authority, {
        severity: ageMs >= pendingTimeoutMs ? "critical" : "warning",
        timedOut: ageMs >= pendingTimeoutMs,
        ageMs,
        recommendedDecision: "retry",
        automaticallyExecutable: false,
        requiresApproval: true,
      }),
    );
  }
  for (const state of pendingById(deletionLedger.events, "deletionId")) {
    const prepared = state.prepared;
    pendingManagedFiles.add(prepared.storedFile);
    if (cleanupDeletionIds.has(prepared.deletionId)) continue;
    const ageMs = eventAgeMs(prepared, observedAtMs);
    const authority = {
      deletionId: prepared.deletionId,
      artifactId: prepared.artifactId,
      client: prepared.client,
      reason: prepared.reason,
      preparedEventDigest: prepared.eventDigest,
      artifactSessionId: prepared.artifactSessionId,
      recordDigest: prepared.recordDigest,
    };
    items.push(
      recoveryItem("pending-deletion", authority, {
        severity: ageMs >= pendingTimeoutMs ? "critical" : "warning",
        timedOut: ageMs >= pendingTimeoutMs,
        ageMs,
        recommendedDecision: "retry",
        automaticallyExecutable: false,
        requiresApproval: true,
      }),
    );
  }

  const pendingOrphanFiles = new Set();
  for (const state of pendingById(orphanGcLedger.events, "adjudicationId")) {
    const prepared = state.prepared;
    pendingOrphanFiles.add(prepared.storedFile);
    const ageMs = eventAgeMs(prepared, observedAtMs);
    const authority = {
      adjudicationId: prepared.adjudicationId,
      preparedEventDigest: prepared.eventDigest,
      originalPlanDigest: prepared.planDigest,
      originalItemId: prepared.itemId,
      storedFile: prepared.storedFile,
      identity: prepared.identity,
      contentDigest: prepared.contentDigest,
    };
    items.push(
      recoveryItem("pending-orphan-gc", authority, {
        severity: ageMs >= pendingTimeoutMs ? "critical" : "warning",
        timedOut: ageMs >= pendingTimeoutMs,
        ageMs,
        recommendedDecision: "retry",
        automaticallyExecutable: false,
        requiresApproval: true,
      }),
    );
  }

  const inventory = store._withIndexLock(() => {
    const entries = store._readEntries();
    return {
      indexGenerationDigest: digest(
        "chainlesschain.artifact.index-generation.v1\0",
        entries,
      ),
      items: inventoryManagedCopies(store, entries, runtimeFs),
    };
  });
  items.push(
    ...inventory.items.filter(
      (item) =>
        item.kind !== "orphan-managed-copy" ||
        (!pendingOrphanFiles.has(item.authority.storedFile) &&
          !pendingManagedFiles.has(item.authority.storedFile)),
    ),
  );
  items.sort((left, right) => left.itemId.localeCompare(right.itemId));
  const material = {
    schema: ARTIFACT_RECOVERY_PLAN_SCHEMA,
    policy: {
      timeoutMs: pendingTimeoutMs,
      unattendedMutationAllowed: false,
    },
    indexGenerationDigest: inventory.indexGenerationDigest,
    cleanupLedgerHeadDigest: cleanupLedger.headDigest,
    deletionLedgerHeadDigest: deletionLedger.headDigest,
    orphanGcLedgerHeadDigest: orphanGcLedger.headDigest,
    summary: {
      itemCount: items.length,
      criticalCount: items.filter((item) => item.severity === "critical")
        .length,
      warningCount: items.filter((item) => item.severity === "warning").length,
      timedOutCount: items.filter((item) => item.timedOut).length,
      pendingCleanupCount: items.filter(
        (item) => item.kind === "pending-cleanup",
      ).length,
      pendingDeletionCount: items.filter(
        (item) => item.kind === "pending-deletion",
      ).length,
      pendingOrphanGcCount: items.filter(
        (item) => item.kind === "pending-orphan-gc",
      ).length,
      orphanCount: items.filter((item) => item.kind.includes("orphan")).length,
      missingCount: items.filter((item) => item.kind === "missing-managed-copy")
        .length,
    },
    items,
  };
  const digestMaterial = {
    ...material,
    items: material.items.map((item) => {
      const stable = { ...item };
      delete stable.ageMs;
      return stable;
    }),
  };
  return Object.freeze({
    ...material,
    observedAt: new Date(observedAtMs).toISOString(),
    planDigest: digest(
      "chainlesschain.artifact.recovery-plan.v1\0",
      digestMaterial,
    ),
  });
}

function gcLedgerPath(store) {
  return path.join(path.resolve(store.dir), "orphan-gc-settlements.jsonl");
}

function normalizeGcEvent(input, previous = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("artifact orphan GC event is invalid");
  }
  const expected = [
    "schema",
    "sequence",
    "previousEventDigest",
    "adjudicationId",
    "phase",
    "preparedEventDigest",
    "planDigest",
    "itemId",
    "storedFile",
    "identity",
    "contentDigest",
    "decision",
    "outcome",
    "occurredAt",
    "eventDigest",
  ].sort();
  const actual = Object.keys(input).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error("artifact orphan GC event schema is invalid");
  }
  if (
    input.schema !== ARTIFACT_ORPHAN_GC_EVENT_SCHEMA ||
    !Number.isSafeInteger(Number(input.sequence)) ||
    Number(input.sequence) !== Number(previous?.sequence || 0) + 1 ||
    input.previousEventDigest !== (previous?.eventDigest || null) ||
    !ID_RE.test(String(input.adjudicationId || "")) ||
    !["prepared", "terminal"].includes(input.phase) ||
    !SHA256_RE.test(String(input.planDigest || "")) ||
    !ID_RE.test(String(input.itemId || "")) ||
    input.decision !== "delete-orphan" ||
    !["pending", "deleted", "already-absent"].includes(input.outcome) ||
    !SHA256_RE.test(String(input.contentDigest || "")) ||
    !Number.isFinite(Date.parse(input.occurredAt || ""))
  ) {
    throw new Error("artifact orphan GC event is invalid");
  }
  safeStoredFile(input.storedFile);
  if (
    (input.phase === "prepared" &&
      (input.preparedEventDigest !== null || input.outcome !== "pending")) ||
    (input.phase === "terminal" &&
      (!SHA256_RE.test(String(input.preparedEventDigest || "")) ||
        input.outcome === "pending"))
  ) {
    throw new Error("artifact orphan GC phase is invalid");
  }
  const material = { ...input };
  delete material.eventDigest;
  if (
    input.eventDigest !==
    digest("chainlesschain.artifact.orphan-gc-event.v1\0", material)
  ) {
    throw new Error("artifact orphan GC event digest is invalid");
  }
  return Object.freeze({ ...input, sequence: Number(input.sequence) });
}

function readGcLedgerUnlocked(store, runtimeFs, runtime = undefined) {
  const filePath = gcLedgerPath(store);
  const bytes = withTrustedFileParentSync(
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
        throw new Error("artifact orphan GC ledger identity is invalid");
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
          throw new Error("artifact orphan GC ledger handle is invalid");
        }
        const content = runtimeFs.readFileSync(descriptor);
        const after = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (
          content.length > MAX_LEDGER_BYTES ||
          Number(after.size) !== content.length ||
          !sameFileStatIdentity(opened, after)
        ) {
          throw new Error("artifact orphan GC ledger changed while reading");
        }
        return content;
      } finally {
        if (descriptor !== null) runtimeFs.closeSync(descriptor);
      }
    },
    { runtime },
  );
  if (bytes.length > 0 && bytes.at(-1) !== 0x0a) {
    throw new Error("artifact orphan GC ledger has a truncated tail");
  }
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("artifact orphan GC ledger is not strict UTF-8");
  }
  const lines = decoded.split("\n").filter(Boolean);
  if (lines.length > MAX_LEDGER_EVENTS) {
    throw new Error("artifact orphan GC ledger exceeds its event limit");
  }
  const events = [];
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error("artifact orphan GC ledger contains invalid JSON");
    }
    events.push(normalizeGcEvent(parsed, events.at(-1) || null));
  }
  return { bytes, events };
}

function gcEvent(material, previous) {
  return normalizeGcEvent(
    {
      ...material,
      eventDigest: digest(
        "chainlesschain.artifact.orphan-gc-event.v1\0",
        material,
      ),
    },
    previous,
  );
}

function appendGcEvent(filePath, event, expectedSize, runtimeFs) {
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
    const stat = runtimeFs.fstatSync(descriptor);
    if (
      !stat.isFile() ||
      Number(stat.nlink) !== 1 ||
      Number(stat.size) !== expectedSize
    ) {
      throw new Error("artifact orphan GC ledger changed before append");
    }
    runtimeFs.writeFileSync(descriptor, `${JSON.stringify(event)}\n`, "utf8");
    runtimeFs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) runtimeFs.closeSync(descriptor);
  }
}

export function readArtifactOrphanGcLedger(store, options = {}) {
  if (!store?.dir)
    throw new TypeError("artifact orphan GC requires an ArtifactStore");
  const events = readGcLedgerUnlocked(
    store,
    options.fs || fs,
    options.runtime,
  ).events;
  const pending = pendingById(events, "adjudicationId");
  return Object.freeze({
    schema: ARTIFACT_ORPHAN_GC_LEDGER_SCHEMA,
    eventCount: events.length,
    preparedCount: events.filter((event) => event.phase === "prepared").length,
    terminalCount: events.filter((event) => event.phase === "terminal").length,
    pendingCount: pending.length,
    headDigest: events.at(-1)?.eventDigest || null,
    events: Object.freeze(events),
  });
}

function settleOrphanGc(store, request, options) {
  const runtimeFs = options.fs || fs;
  const filePath = gcLedgerPath(store);
  runtimeFs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  return store._withIndexLock(() =>
    (options.withFileLock || withFileLock)(
      filePath,
      () => {
        let { bytes, events } = readGcLedgerUnlocked(
          store,
          runtimeFs,
          options.runtime,
        );
        const requestEvents = events.filter(
          (event) => event.adjudicationId === request.adjudicationId,
        );
        if (requestEvents.length > 2)
          throw new Error("artifact orphan GC settlement is ambiguous");
        let prepared =
          requestEvents.find((event) => event.phase === "prepared") || null;
        const terminal =
          requestEvents.find((event) => event.phase === "terminal") || null;
        if (prepared) {
          if (
            prepared.itemId !== request.itemId ||
            prepared.planDigest !== request.planDigest
          ) {
            throw new Error(
              "artifact orphan GC adjudication id is already bound",
            );
          }
          if (terminal)
            return Object.freeze({
              schema: "cc-artifact-recovery-adjudication/v1",
              adjudicationId: request.adjudicationId,
              itemId: request.itemId,
              planDigest: request.planDigest,
              decision: "delete-orphan",
              settled: true,
              recorded: false,
              mutationPerformed: true,
              gc: terminal,
            });
        } else {
          const item = request.item;
          if (!item || item.kind !== "orphan-managed-copy") {
            throw new Error(
              "artifact recovery item cannot authorize orphan deletion",
            );
          }
          const currentEntries = store._readEntries();
          if (
            currentEntries.some(
              (entry) => String(entry.file || "") === item.authority.storedFile,
            )
          ) {
            throw new Error(
              "orphan managed copy became referenced before preparation",
            );
          }
          const current = inspectRegularFile(
            path.join(
              path.resolve(store.dir, "files"),
              safeStoredFile(item.authority.storedFile),
            ),
            runtimeFs,
          );
          if (
            !current.safe ||
            !sameFileIdentity(current.identity, item.authority.identity) ||
            current.contentDigest !== item.authority.contentDigest
          ) {
            throw new Error("orphan managed copy changed before preparation");
          }
          const previous = events.at(-1) || null;
          const material = {
            schema: ARTIFACT_ORPHAN_GC_EVENT_SCHEMA,
            sequence: (previous?.sequence || 0) + 1,
            previousEventDigest: previous?.eventDigest || null,
            adjudicationId: request.adjudicationId,
            phase: "prepared",
            preparedEventDigest: null,
            planDigest: request.planDigest,
            itemId: request.itemId,
            storedFile: item.authority.storedFile,
            identity: item.authority.identity,
            contentDigest: item.authority.contentDigest,
            decision: "delete-orphan",
            outcome: "pending",
            occurredAt: new Date(request.observedAtMs).toISOString(),
          };
          prepared = gcEvent(material, previous);
          appendGcEvent(filePath, prepared, bytes.length, runtimeFs);
          bytes = Buffer.concat([
            bytes,
            Buffer.from(`${JSON.stringify(prepared)}\n`, "utf8"),
          ]);
          events = [...events, prepared];
        }

        const currentEntries = store._readEntries();
        if (
          currentEntries.some(
            (entry) => String(entry.file || "") === prepared.storedFile,
          )
        ) {
          throw new Error(
            "orphan managed copy became referenced before deletion",
          );
        }
        const target = path.join(
          path.resolve(store.dir, "files"),
          safeStoredFile(prepared.storedFile),
        );
        let outcome = "already-absent";
        try {
          const inspected = inspectRegularFile(target, runtimeFs);
          if (!inspected.safe) {
            if (inspected.reason !== "file-disappeared") {
              throw new Error(
                `orphan managed copy is unsafe: ${inspected.reason}`,
              );
            }
          } else {
            if (
              !sameFileIdentity(inspected.identity, prepared.identity) ||
              inspected.contentDigest !== prepared.contentDigest
            ) {
              throw new Error("orphan managed copy changed after preparation");
            }
            runtimeFs.rmSync(target, { force: true });
            outcome = "deleted";
          }
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        if (typeof options.afterDelete === "function")
          options.afterDelete({ prepared, outcome });
        if (runtimeFs.existsSync(target))
          throw new Error("orphan managed copy remains after deletion");
        const previous = events.at(-1) || null;
        const terminalMaterial = {
          schema: ARTIFACT_ORPHAN_GC_EVENT_SCHEMA,
          sequence: (previous?.sequence || 0) + 1,
          previousEventDigest: previous?.eventDigest || null,
          adjudicationId: prepared.adjudicationId,
          phase: "terminal",
          preparedEventDigest: prepared.eventDigest,
          planDigest: prepared.planDigest,
          itemId: prepared.itemId,
          storedFile: prepared.storedFile,
          identity: prepared.identity,
          contentDigest: prepared.contentDigest,
          decision: prepared.decision,
          outcome,
          occurredAt: new Date(nowMs(options)).toISOString(),
        };
        const settled = gcEvent(terminalMaterial, previous);
        appendGcEvent(filePath, settled, bytes.length, runtimeFs);
        return Object.freeze({
          schema: "cc-artifact-recovery-adjudication/v1",
          adjudicationId: request.adjudicationId,
          itemId: request.itemId,
          planDigest: request.planDigest,
          decision: "delete-orphan",
          settled: true,
          recorded: true,
          mutationPerformed: true,
          gc: settled,
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

export function adjudicateArtifactRecovery(store, input = {}, options = {}) {
  if (!store?.dir)
    throw new TypeError("artifact recovery requires an ArtifactStore");
  const itemId = String(input.itemId || "");
  const planDigest = String(input.planDigest || "");
  const decision = String(input.decision || "");
  const adjudicationId = String(
    input.adjudicationId ||
      `artifact_adjudication_${randomUUID().replaceAll("-", "")}`,
  );
  if (
    !ID_RE.test(itemId) ||
    !ID_RE.test(adjudicationId) ||
    !SHA256_RE.test(planDigest) ||
    !ARTIFACT_RECOVERY_DECISIONS.includes(decision)
  ) {
    throw new TypeError("artifact recovery adjudication request is invalid");
  }
  const observedAtMs = nowMs(options);
  if (decision === "delete-orphan") {
    const ledger = readArtifactOrphanGcLedger(
      store,
      options.orphanGcOptions || {},
    );
    const existing = ledger.events.filter(
      (event) => event.adjudicationId === adjudicationId,
    );
    if (existing.length > 0) {
      return settleOrphanGc(
        store,
        { itemId, planDigest, adjudicationId, observedAtMs, item: null },
        options,
      );
    }
    const plan = buildArtifactRecoveryPlan(store, {
      ...options,
      now: () => observedAtMs,
    });
    if (plan.planDigest !== planDigest)
      throw new Error("artifact recovery plan changed before adjudication");
    const item = plan.items.find((candidate) => candidate.itemId === itemId);
    return settleOrphanGc(
      store,
      { itemId, planDigest, adjudicationId, observedAtMs, item },
      options,
    );
  }
  const plan = buildArtifactRecoveryPlan(store, {
    ...options,
    now: () => observedAtMs,
  });
  if (plan.planDigest !== planDigest)
    throw new Error("artifact recovery plan changed before adjudication");
  const item = plan.items.find((candidate) => candidate.itemId === itemId);
  if (!item) throw new Error("artifact recovery item is no longer pending");
  if (decision === "defer") {
    return Object.freeze({
      schema: "cc-artifact-recovery-adjudication/v1",
      adjudicationId,
      itemId,
      planDigest,
      decision,
      settled: false,
      mutationPerformed: false,
    });
  }
  if (item.kind === "pending-cleanup") {
    const result = (options.settleArtifactCleanup || settleArtifactCleanup)(
      store,
      { cleanupId: item.authority.cleanupId, client: item.authority.client },
      options.cleanupOptions || {},
    );
    return Object.freeze({
      schema: "cc-artifact-recovery-adjudication/v1",
      adjudicationId,
      itemId,
      planDigest,
      decision,
      settled: result.settled === true,
      mutationPerformed: true,
      result,
    });
  }
  if (item.kind === "pending-deletion") {
    const result = (options.settleArtifactDeletion || settleArtifactDeletion)(
      store,
      {
        deletionId: item.authority.deletionId,
        artifactId: item.authority.artifactId,
        client: item.authority.client,
        reason: item.authority.reason,
      },
      options.deletionOptions || {},
    );
    return Object.freeze({
      schema: "cc-artifact-recovery-adjudication/v1",
      adjudicationId,
      itemId,
      planDigest,
      decision,
      settled: result.settled === true,
      mutationPerformed: true,
      result,
    });
  }
  if (item.kind === "pending-orphan-gc") {
    return settleOrphanGc(
      store,
      {
        itemId: item.authority.originalItemId,
        planDigest: item.authority.originalPlanDigest,
        adjudicationId: item.authority.adjudicationId,
        observedAtMs,
        item: null,
      },
      options,
    );
  }
  throw new Error("artifact recovery item does not support retry");
}
