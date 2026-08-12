/**
 * Routines (gap-2026-07-11 P1#8) — the durable layer above `cc agenda`:
 * named, enable/disable-able agent tasks with four trigger kinds, a run
 * history, and per-run result/usage summaries.
 *
 *   trigger kinds:
 *     cron    — 5-field schedule, fired by the `cc routine run` driver
 *     once    — a single ISO/epoch time, fired by the driver then disabled
 *     webhook — fired externally via `cc routine trigger <id>` (that command
 *               IS the API/webhook entry point — wire any HTTP receiver or
 *               inbound channel to invoke it)
 *     github  — driver polls `gh api repos/<repo>/events` and fires when new
 *               events of the requested types appear (needs gh auth)
 *
 * Storage: ~/.chainlesschain/routines/
 *   routines.json         definitions (id → routine)
 *   runs.jsonl            append-only run history
 *   logs/<runId>.log      full agent output per run
 *
 * Execution is delegated to the injected `runAgent` (production: spawn
 * `cc agent -p <prompt> --output-format json` and parse the result envelope
 * for usage/cost). Everything here is dependency-injected and unit-testable.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { parseCron, nextCronTime } from "./agent-schedule-store.js";
import {
  readSecurityStore,
  writeSecurityStore,
} from "./durable-security-store.js";
import { withFileLock } from "./with-file-lock.js";

export const ROUTINE_TRIGGER_KINDS = Object.freeze([
  "cron",
  "once",
  "webhook",
  "github",
]);
export const ROUTINE_SCHEDULER_MIGRATION_SCHEMA_VERSION = 1;

export function routinesDir(homedir = os.homedir()) {
  return path.join(homedir, ".chainlesschain", "routines");
}

function shortId() {
  return `rt-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

function parseWhen(value) {
  if (value == null) return NaN;
  if (typeof value === "string" && value.trim() === "") return NaN;
  if (typeof value !== "string" && typeof value !== "number") return NaN;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return Date.parse(String(value));
}

function boundedDefinitionText(value, field, maximum) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`routine needs a ${field}`);
  if (Buffer.byteLength(text, "utf8") > maximum) {
    throw new Error(`routine ${field} exceeds ${maximum} UTF-8 bytes`);
  }
  return text;
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJsonValue(value[key])]),
    );
  }
  return value;
}

export function routineMigrationSourceSnapshot(routine) {
  const source = { ...routine };
  delete source.schedulerMigration;
  delete source.lastFiredAt;
  delete source.lastSeenGithubEventId;
  if (
    routine.schedulerMigration?.schemaVersion ===
      ROUTINE_SCHEDULER_MIGRATION_SCHEMA_VERSION &&
    routine.schedulerMigration.wasEnabled === true
  ) {
    source.enabled = true;
  }
  return stableJsonValue(source);
}

export function routineMigrationSourceDigest(routine) {
  return createHash("sha256")
    .update("chainlesschain.routine.scheduler-migration-source.v1\0", "utf8")
    .update(JSON.stringify(routineMigrationSourceSnapshot(routine)), "utf8")
    .digest("hex");
}

export function routineEffectiveSchedulerView(routine) {
  if (
    routine?.schedulerMigration?.schemaVersion ===
      ROUTINE_SCHEDULER_MIGRATION_SCHEMA_VERSION &&
    routine.schedulerMigration.state === "retired" &&
    routine.schedulerMigration.wasEnabled === true
  ) {
    return { ...routine, enabled: true };
  }
  return routine;
}

function routineMigrationField(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    const error = new Error(`routine scheduler migration ${field} is required`);
    error.code = "ROUTINE_SCHEDULER_MIGRATION_INVALID";
    throw error;
  }
  return value.trim();
}

export function normalizeRoutineDefinition(def = {}) {
  const name = boundedDefinitionText(def.name, "name", 512);
  const prompt = boundedDefinitionText(def.prompt, "prompt", 64 * 1024);
  const raw = def.trigger;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("routine trigger is required");
  }
  if (!ROUTINE_TRIGGER_KINDS.includes(raw.kind)) {
    throw new Error(
      `routine trigger kind must be one of: ${ROUTINE_TRIGGER_KINDS.join(", ")}`,
    );
  }
  let trigger;
  if (raw.kind === "cron") {
    const cron = String(raw.cron || "").trim();
    if (!parseCron(cron)) throw new Error(`invalid cron expression: ${cron}`);
    trigger = { kind: "cron", cron };
  } else if (raw.kind === "once") {
    const at = parseWhen(raw.at);
    if (!Number.isFinite(at) || !Number.isSafeInteger(at) || at < 0) {
      throw new Error(`invalid --at time: ${raw.at}`);
    }
    trigger = { kind: "once", at };
  } else if (raw.kind === "github") {
    const repo = String(raw.repo || "").trim();
    const parts = repo.split("/");
    if (
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo) ||
      parts.some((part) => part === "." || part === "..")
    ) {
      throw new Error("github trigger needs --repo <owner/name>");
    }
    const events = Array.isArray(raw.events)
      ? [...new Set(raw.events.map((value) => String(value || "").trim()))]
          .filter(Boolean)
          .sort()
      : [];
    if (
      events.length > 64 ||
      events.some(
        (event) =>
          event.length > 128 || !/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(event),
      )
    ) {
      throw new Error("github trigger events are invalid");
    }
    trigger = { kind: "github", repo, events };
  } else {
    trigger = { kind: "webhook" };
  }
  return { name, prompt, trigger };
}

export class RoutineStore {
  constructor({ dir = null, now = () => Date.now() } = {}) {
    this.dir = dir || routinesDir();
    this._now = typeof now === "function" ? now : () => now;
  }

  _routinesFile() {
    return path.join(this.dir, "routines.json");
  }
  _runsFile() {
    return path.join(this.dir, "runs.jsonl");
  }
  logFile(runId) {
    return path.join(this.dir, "logs", `${runId}.log`);
  }
  _ensureDir() {
    fs.mkdirSync(path.join(this.dir, "logs"), { recursive: true, mode: 0o700 });
  }

  _readRoutines() {
    return readSecurityStore(this._routinesFile(), "routine definitions");
  }
  _writeRoutines(map) {
    writeSecurityStore(this._routinesFile(), "routine definitions", map);
  }

  _withDefinitionLock(callback) {
    this._ensureDir();
    return withFileLock(
      this._routinesFile(),
      () => callback(this._readRoutines()),
      { failIfUnavailable: true },
    );
  }

  _resolveFromMap(map, id) {
    if (map[id]) return map[id];
    const matches = Object.values(map).filter(
      (routine) => routine.id.startsWith(id) || routine.name === id,
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(`routine "${id}" is ambiguous (${matches.length} match)`);
    }
    return null;
  }

  _createInMap(map, def) {
    const definition = normalizeRoutineDefinition(def);
    const routine = {
      id: shortId(),
      ...definition,
      enabled: true,
      createdAt: this._now(),
      lastFiredAt: null,
      lastSeenGithubEventId: null,
    };
    map[routine.id] = routine;
    return routine;
  }

  /**
   * @param {object} def { name, prompt, trigger: {kind, cron?, at?, repo?, events?} }
   */
  create(def = {}) {
    return this._withDefinitionLock((map) => {
      const routine = this._createInMap(map, def);
      this._writeRoutines(map);
      return routine;
    });
  }

  list() {
    return Object.values(this._readRoutines()).sort(
      (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    );
  }

  get(id) {
    const map = this._readRoutines();
    return this._resolveFromMap(map, id);
  }

  update(id, patch) {
    return this._withDefinitionLock((map) => {
      const routine = this._resolveFromMap(map, id);
      if (!routine) throw new Error(`routine not found: ${id}`);
      const next = { ...routine, ...patch, id: routine.id };
      map[routine.id] = next;
      this._writeRoutines(map);
      return next;
    });
  }

  updateDefinition(id, definition) {
    const normalized = normalizeRoutineDefinition(definition);
    return this.update(id, {
      ...normalized,
      lastSeenGithubEventId: null,
    });
  }

  setEnabled(id, enabled) {
    return this.update(id, { enabled: enabled === true });
  }

  prepareSchedulerMigration(
    id,
    { migrationId, sourceDigest, targetJobId } = {},
  ) {
    const migration = routineMigrationField(migrationId, "migrationId");
    const digest = routineMigrationField(sourceDigest, "sourceDigest");
    const target = routineMigrationField(targetJobId, "targetJobId");
    return this._withDefinitionLock((map) => {
      const routine = this._resolveFromMap(map, id);
      if (!routine) throw new Error(`routine not found: ${id}`);
      if (routine.enabled !== true) {
        const error = new Error(`routine is disabled: ${routine.id}`);
        error.code = "ROUTINE_SCHEDULER_DISABLED";
        throw error;
      }
      if (routineMigrationSourceDigest(routine) !== digest) {
        const error = new Error(
          `routine changed before migration: ${routine.id}`,
        );
        error.code = "ROUTINE_SCHEDULER_MIGRATION_SOURCE_CHANGED";
        throw error;
      }
      const prior = routine.schedulerMigration;
      if (prior) {
        if (
          prior.schemaVersion !== ROUTINE_SCHEDULER_MIGRATION_SCHEMA_VERSION ||
          prior.migrationId !== migration ||
          prior.sourceDigest !== digest ||
          prior.targetJobId !== target ||
          prior.state !== "prepared"
        ) {
          const error = new Error(
            `routine already belongs to another migration: ${routine.id}`,
          );
          error.code = "ROUTINE_SCHEDULER_MIGRATION_CONFLICT";
          throw error;
        }
        return routine;
      }
      routine.schedulerMigration = {
        schemaVersion: ROUTINE_SCHEDULER_MIGRATION_SCHEMA_VERSION,
        state: "prepared",
        migrationId: migration,
        sourceDigest: digest,
        targetJobId: target,
        wasEnabled: true,
        preparedAt: this._now(),
      };
      this._writeRoutines(map);
      return routine;
    });
  }

  retireForSchedulerMigration(
    id,
    { migrationId, sourceDigest, targetJobId, retirementToken } = {},
  ) {
    const migration = routineMigrationField(migrationId, "migrationId");
    const digest = routineMigrationField(sourceDigest, "sourceDigest");
    const target = routineMigrationField(targetJobId, "targetJobId");
    const token = routineMigrationField(retirementToken, "retirementToken");
    return this._withDefinitionLock((map) => {
      const routine = this._resolveFromMap(map, id);
      if (!routine) throw new Error(`routine not found: ${id}`);
      const prior = routine.schedulerMigration;
      if (
        prior?.schemaVersion !== ROUTINE_SCHEDULER_MIGRATION_SCHEMA_VERSION ||
        prior.migrationId !== migration ||
        prior.sourceDigest !== digest ||
        prior.targetJobId !== target ||
        !["prepared", "retired"].includes(prior.state)
      ) {
        const error = new Error(
          `routine migration changed before retirement: ${routine.id}`,
        );
        error.code = "ROUTINE_SCHEDULER_MIGRATION_CONFLICT";
        throw error;
      }
      if (prior.state === "retired") {
        if (prior.retirementToken !== token || routine.enabled !== false) {
          const error = new Error(
            `routine migration fence changed: ${routine.id}`,
          );
          error.code = "ROUTINE_SCHEDULER_MIGRATION_CONFLICT";
          throw error;
        }
        return routine;
      }
      if (routineMigrationSourceDigest(routine) !== digest) {
        const error = new Error(
          `routine changed before retirement: ${routine.id}`,
        );
        error.code = "ROUTINE_SCHEDULER_MIGRATION_SOURCE_CHANGED";
        throw error;
      }
      routine.enabled = false;
      routine.schedulerMigration = {
        ...prior,
        state: "retired",
        retirementToken: token,
        retiredAt: this._now(),
      };
      this._writeRoutines(map);
      return routine;
    });
  }

  restoreFromSchedulerMigration(
    id,
    { migrationId, targetJobId, retirementToken } = {},
  ) {
    const migration = routineMigrationField(migrationId, "migrationId");
    const target = routineMigrationField(targetJobId, "targetJobId");
    const token = routineMigrationField(retirementToken, "retirementToken");
    return this._withDefinitionLock((map) => {
      const routine = this._resolveFromMap(map, id);
      if (!routine) throw new Error(`routine not found: ${id}`);
      const current = routine.schedulerMigration;
      if (
        current?.schemaVersion !== ROUTINE_SCHEDULER_MIGRATION_SCHEMA_VERSION ||
        current.migrationId !== migration ||
        current.targetJobId !== target ||
        current.retirementToken !== token ||
        current.state !== "retired" ||
        routine.enabled !== false ||
        routineMigrationSourceDigest(routine) !== current.sourceDigest
      ) {
        const error = new Error(
          `routine migration fence changed before rollback: ${routine.id}`,
        );
        error.code = "ROUTINE_SCHEDULER_MIGRATION_CONFLICT";
        throw error;
      }
      routine.enabled = current.wasEnabled === true;
      delete routine.schedulerMigration;
      this._writeRoutines(map);
      return routine;
    });
  }

  schedulerMigrated() {
    return this.list()
      .filter(
        (routine) =>
          routine.schedulerMigration?.schemaVersion ===
            ROUTINE_SCHEDULER_MIGRATION_SCHEMA_VERSION &&
          routine.schedulerMigration.state === "retired",
      )
      .map(routineEffectiveSchedulerView);
  }

  remove(id) {
    return this._withDefinitionLock((map) => {
      const routine = this._resolveFromMap(map, id);
      if (!routine) throw new Error(`routine not found: ${id}`);
      delete map[routine.id];
      this._writeRoutines(map);
      return routine;
    });
  }

  createIfRevision(expectedRevision, revisionOfMap, definition) {
    return this._withDefinitionLock((map) => {
      if (revisionOfMap(map) !== expectedRevision) {
        const error = new Error("routine collection changed before create");
        error.code = "ROUTINE_REVISION_CONFLICT";
        throw error;
      }
      const routine = this._createInMap(map, definition);
      this._writeRoutines(map);
      return routine;
    });
  }

  readIfRevision(id, expectedRevision, revisionOfRoutine) {
    return this._withDefinitionLock((map) => {
      const routine = map[id];
      if (!routine) throw new Error(`routine not found: ${id}`);
      if (revisionOfRoutine(routine) !== expectedRevision) {
        const error = new Error(`routine changed before action: ${id}`);
        error.code = "ROUTINE_REVISION_CONFLICT";
        throw error;
      }
      return structuredClone(routine);
    });
  }

  mutateIfRevision(id, expectedRevision, revisionOfRoutine, mutation) {
    return this._withDefinitionLock((map) => {
      const routine = map[id];
      if (!routine) throw new Error(`routine not found: ${id}`);
      if (revisionOfRoutine(routine) !== expectedRevision) {
        const error = new Error(`routine changed before mutation: ${id}`);
        error.code = "ROUTINE_REVISION_CONFLICT";
        throw error;
      }
      const result = mutation(routine, map);
      this._writeRoutines(map);
      return result;
    });
  }

  /** Routines the driver should fire now (cron due / once reached). */
  due(nowMs = this._now()) {
    return this.list().filter((r) => {
      if (!r.enabled) return false;
      if (r.trigger.kind === "cron") {
        const from = r.lastFiredAt || r.createdAt || 0;
        const next = nextCronTime(r.trigger.cron, from);
        return next != null && next <= nowMs;
      }
      if (r.trigger.kind === "once") {
        return !r.lastFiredAt && r.trigger.at <= nowMs;
      }
      return false; // webhook/github fire through other paths
    });
  }

  /** GitHub-triggered routines the driver should poll. */
  githubRoutines({ schedulerMigration = false } = {}) {
    return this.list()
      .map((routine) =>
        schedulerMigration ? routineEffectiveSchedulerView(routine) : routine,
      )
      .filter((r) => r.enabled && r.trigger.kind === "github");
  }

  // ── run history ──────────────────────────────────────────────────────────

  _appendRun(record) {
    this._ensureDir();
    fs.appendFileSync(this._runsFile(), JSON.stringify(record) + "\n", "utf-8");
  }

  recordRunStart(routineId, meta = {}) {
    const runId =
      typeof meta.runId === "string" && meta.runId.trim()
        ? meta.runId.trim()
        : `run-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    if (
      runId.length > 512 ||
      [...runId].some((char) => char.codePointAt(0) < 32)
    ) {
      throw new Error("routine runId is invalid");
    }
    this._appendRun({
      type: "start",
      runId,
      routineId,
      trigger: meta.trigger || null,
      pid: meta.pid || null,
      schedulerOccurrenceId: meta.schedulerOccurrenceId || null,
      schedulerSnapshotDigest: meta.schedulerSnapshotDigest || null,
      startedAt: this._now(),
    });
    return runId;
  }

  recordRunEnd(runId, result = {}) {
    this._appendRun({
      type: "end",
      runId,
      endedAt: this._now(),
      status: result.status || (result.exitCode === 0 ? "ok" : "failed"),
      exitCode: result.exitCode ?? null,
      summary: String(result.summary || "").slice(0, 500),
      usage: result.usage || null,
      costUsd: Number.isFinite(result.costUsd) ? result.costUsd : null,
      durationMs: result.durationMs ?? null,
    });
  }

  recordRunAdjudication(
    runId,
    { decision, requestId, occurrenceId, snapshotDigest } = {},
  ) {
    if (!["confirmed_applied", "confirmed_not_applied"].includes(decision)) {
      throw new Error("routine adjudication decision is invalid");
    }
    const existing = this.getRun(runId);
    if (
      !existing ||
      existing.status !== "running" ||
      existing.schedulerOccurrenceId !== occurrenceId ||
      existing.schedulerSnapshotDigest !== snapshotDigest
    ) {
      if (
        existing?.adjudication?.requestId === requestId &&
        existing.adjudication.decision === decision
      ) {
        return existing;
      }
      const error = new Error("routine adjudication evidence does not match");
      error.code = "ROUTINE_ADJUDICATION_EVIDENCE_MISMATCH";
      throw error;
    }
    this._appendRun({
      type: "adjudication",
      runId,
      decision,
      requestId,
      adjudicatedAt: this._now(),
    });
    return this.getRun(runId);
  }

  /** Merged run rows (start+end), newest first. */
  listRuns({ routineId = null, limit = 20 } = {}) {
    let lines = [];
    try {
      lines = fs
        .readFileSync(this._runsFile(), "utf-8")
        .split("\n")
        .filter((l) => l.trim());
    } catch {
      return [];
    }
    const runs = new Map();
    for (const line of lines) {
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // per-row resilience
      }
      if (rec.type === "start") {
        runs.set(rec.runId, { ...rec, status: "running" });
      } else if (rec.type === "end") {
        const prev = runs.get(rec.runId) || { runId: rec.runId };
        runs.set(rec.runId, { ...prev, ...rec, type: undefined });
      } else if (rec.type === "adjudication") {
        const prev = runs.get(rec.runId) || { runId: rec.runId };
        runs.set(rec.runId, {
          ...prev,
          status:
            rec.decision === "confirmed_applied"
              ? "adjudicated_applied"
              : "adjudicated_not_applied",
          adjudication: {
            requestId: rec.requestId,
            decision: rec.decision,
            adjudicatedAt: rec.adjudicatedAt,
          },
          type: undefined,
        });
      }
    }
    return [...runs.values()]
      .filter((r) => !routineId || r.routineId === routineId)
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
      .slice(0, limit)
      .map(({ type: _t, ...rest }) => rest);
  }

  getRun(runId) {
    if (typeof runId !== "string" || runId.length === 0) return null;
    return (
      this.listRuns({ limit: Number.MAX_SAFE_INTEGER }).find(
        (run) => run.runId === runId,
      ) || null
    );
  }

  /** Per-routine aggregate for `cc routine list`: runs, ok/failed, cost. */
  summarize(routineId) {
    const runs = this.listRuns({ routineId, limit: 1000 });
    const done = runs.filter((r) => r.status && r.status !== "running");
    return {
      totalRuns: runs.length,
      ok: done.filter((r) => r.status === "ok").length,
      failed: done.filter((r) => r.status === "failed").length,
      running: runs.filter((r) => r.status === "running").length,
      costUsd: done.reduce(
        (sum, r) => sum + (Number.isFinite(r.costUsd) ? r.costUsd : 0),
        0,
      ),
      lastRun: runs[0] || null,
    };
  }
}

/**
 * Fire one routine: record history, run the agent, persist the log, update
 * lastFiredAt (and disable a fired `once`). `runAgent({prompt})` must resolve
 * `{ exitCode, output, usage?, costUsd?, pid? }`.
 */
export async function executeRoutine(store, routine, runAgent, meta = {}) {
  const requestedRunId =
    typeof meta.runId === "string" && meta.runId.trim()
      ? meta.runId.trim()
      : null;
  const existing = requestedRunId ? store.getRun(requestedRunId) : null;
  if (existing) {
    if (existing.routineId !== routine.id) {
      const error = new Error("routine runId is bound to another routine");
      error.code = "ROUTINE_RUN_ID_CONFLICT";
      error.retryable = false;
      throw error;
    }
    const authorizedRetry =
      existing.status === "adjudicated_not_applied" &&
      meta.adjudication?.decision === "confirmed_not_applied" &&
      existing.adjudication?.requestId === meta.adjudication.requestId;
    if (authorizedRetry) {
      // The append-only evidence remains intact. A second start record for the
      // deterministic run id begins the single scheduler-authorized retry.
    } else if (existing.status === "running") {
      const error = new Error(
        "routine run outcome is unknown; refusing duplicate execution",
      );
      error.code = "ROUTINE_RUN_OUTCOME_UNKNOWN";
      error.retryable = false;
      throw error;
    } else {
      const current = store.get(routine.id);
      if (current) {
        store.update(routine.id, {
          lastFiredAt: existing.startedAt,
          ...(current.trigger.kind === "once" ? { enabled: false } : {}),
        });
      }
      return {
        runId: existing.runId,
        status: existing.status,
        exitCode: existing.exitCode,
        usage: existing.usage || null,
        costUsd: Number.isFinite(existing.costUsd) ? existing.costUsd : null,
        durationMs: existing.durationMs ?? null,
        recovered: true,
      };
    }
  }

  const startedAt = store._now();
  const runId = store.recordRunStart(routine.id, {
    trigger: meta.trigger || routine.trigger.kind,
    ...(requestedRunId ? { runId: requestedRunId } : {}),
    schedulerOccurrenceId: meta.schedulerOccurrenceId || null,
    schedulerSnapshotDigest: meta.schedulerSnapshotDigest || null,
  });
  let result;
  try {
    result = await runAgent({ prompt: routine.prompt, routine, runId });
  } catch (err) {
    result = { exitCode: -1, output: `runner error: ${err.message}` };
  }
  const output = String(result.output || "");
  try {
    store._ensureDir();
    fs.writeFileSync(store.logFile(runId), output, "utf-8");
  } catch {
    /* log persistence is best-effort */
  }
  store.recordRunEnd(runId, {
    exitCode: result.exitCode,
    status: result.exitCode === 0 ? "ok" : "failed",
    summary: output.trim().split("\n").slice(-3).join(" ⏎ "),
    usage: result.usage || null,
    costUsd: result.costUsd,
    durationMs: store._now() - startedAt,
  });
  store.update(routine.id, {
    lastFiredAt: startedAt,
    ...(routine.trigger.kind === "once" || routine.schedulerMigration
      ? { enabled: false }
      : {}),
  });
  return {
    runId,
    status: result.exitCode === 0 ? "ok" : "failed",
    exitCode: result.exitCode,
    usage: result.usage || null,
    costUsd: Number.isFinite(result.costUsd) ? result.costUsd : null,
    durationMs: store._now() - startedAt,
  };
}

export async function fireRoutine(store, routine, runAgent, meta = {}) {
  const execution = await executeRoutine(store, routine, runAgent, meta);
  return execution.runId;
}

/**
 * Poll a github-triggered routine: fetch the repo's latest events via the
 * injected `fetchEvents(repo)` (production: `gh api repos/<repo>/events`),
 * fire when new events of the requested types appeared. Returns fired runIds.
 */
export async function pollGithubRoutine(
  store,
  routine,
  { fetchEvents, runAgent },
) {
  const events = (await fetchEvents(routine.trigger.repo)) || [];
  const wanted = Array.isArray(routine.trigger.events)
    ? routine.trigger.events
    : null;
  const fresh = events.filter((e) => {
    if (wanted && wanted.length > 0 && !wanted.includes(e.type)) return false;
    return (
      !routine.lastSeenGithubEventId ||
      String(e.id) > String(routine.lastSeenGithubEventId)
    );
  });
  const newestId = events.length ? String(events[0].id) : null;
  if (newestId) {
    store.update(routine.id, { lastSeenGithubEventId: newestId });
  }
  if (fresh.length === 0) return [];
  const runId = await fireRoutine(store, routine, runAgent, {
    trigger: `github:${fresh.map((e) => e.type).join(",")}`,
  });
  return [runId];
}
