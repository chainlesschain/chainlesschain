/**
 * goal-store — cross-session persistent goals / OKRs for `cc goal`.
 *
 * Unlike a session (short-lived context) or a checkpoint (file state), a goal
 * is a long-lived objective the agent should advance toward across many
 * sessions. This is the standalone store + ops; wiring the goal into the agent
 * loop (so each turn is measured against it) lives in goal-context.js.
 *
 * On-disk layout (under <home>/goals, overridable via opts.root for tests):
 *   <root>/<id>.json        one goal per file
 *
 * Distinct from:
 *   - cc session   (short-term conversation context)
 *   - cc memory    (durable facts, not objectives)
 *   - cc planmode  (a single run's plan, not a cross-session objective)
 *   - cc workflow  (execution orchestration, not intent)
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getHomeDir } from "./paths.js";
import { withFileLock } from "./with-file-lock.js";
import {
  createGoalRecord,
  validateGoalRecord,
  upgradeLegacyGoal,
  goalError,
} from "@chainlesschain/session-core/goal-contract";

/** Valid goal lifecycle states. `active` goals are the ones injected. */
export const GOAL_STATUS = Object.freeze({
  ACTIVE: "active",
  PAUSED: "paused",
  DONE: "done",
  ABANDONED: "abandoned",
});

const STATUS_VALUES = new Set(Object.values(GOAL_STATUS));

function defaultRoot() {
  return path.join(getHomeDir(), "goals");
}

/** Store identity is path-bound metadata, not filesystem authorization. */
export function goalFileStoreId(root = defaultRoot()) {
  const resolved = path.resolve(root);
  const canonical =
    process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return `cli-goals-${createHash("sha256").update(canonical).digest("hex")}`;
}

function fileRecord(value, root) {
  const record = upgradeLegacyGoal(value, goalFileStoreId(root));
  if (record.storeId !== goalFileStoreId(root))
    throw goalError("GOAL_STORE_MISMATCH");
  // Files are the legacy standalone CLI store. Project authority lives in the
  // host database and must not be acquired by copying a record into this dir.
  if (record.ownerRef !== null || record.projectRef !== null)
    throw goalError("GOAL_PROJECT_STORE_REQUIRED");
  return record;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Write a goal file atomically: a crash mid-write must not truncate/corrupt an
 * existing goal (an unparseable goal file is silently dropped by getGoal's catch
 * → the user loses that goal). Temp sibling + rename (atomic within a
 * filesystem). Temp names end in `.tmp` (never `.json`), so a hard-crash
 * leftover is ignored by listGoals.
 */
function atomicWriteFileSync(filePath, data) {
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.writeFileSync(tmp, data, "utf-8");
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* best-effort temp cleanup */
    }
    throw err;
  }
}

function newId(prefix) {
  // Date.now/random are fine here (plain CLI lib, not a resumable workflow).
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * A goal id must be a single safe path segment. Goal ids are generated as
 * `goal-<ts>-<rand>`, but ids also arrive from CLI args (`cc goal show/rm <id>`,
 * `cc agent --goal <id>`), so an id like `../../etc/x` would otherwise let
 * goalFile() read/delete/write a .json file outside the goals dir. Reject any
 * separator or `..` (matches FileUploadService.isUnsafeSegment).
 */
function isUnsafeGoalId(id) {
  return (
    id == null ||
    id === "" ||
    typeof id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(id) ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("..")
  );
}

function goalFile(root, id) {
  return path.join(root, `${id}.json`);
}

/** Clamp a value to a 0–100 integer percentage, or null when not a number. */
function clampPct(v) {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

/**
 * Derive a 0–100 progress from completed key results. Returns null when there
 * are no key results (caller may keep a manually-set progress instead).
 */
function derivedProgress(keyResults) {
  if (!Array.isArray(keyResults) || keyResults.length === 0) return null;
  const done = keyResults.filter((k) => k.done).length;
  return Math.round((done / keyResults.length) * 100);
}

/**
 * Create a goal.
 * @param {object} input { objective, title, keyResults?: string[]|object[] }
 * @param {object} [opts] { root }
 * @returns {object} the persisted goal
 */
export function createGoal(input = {}, opts = {}) {
  const root = opts.root || defaultRoot();
  const objective = String(input.objective || "").trim();
  if (!objective) {
    throw new Error("createGoal requires an objective");
  }
  const id = input.id || newId("goal");
  // Generated ids are always safe, but `input.id` is caller-supplied — guard it
  // like every other op (getGoal/saveGoal/deleteGoal) so a crafted id such as
  // `../../etc/x` can't make atomicWriteFileSync write a .json OUTSIDE the
  // goals dir. createGoal was the one mutation missing this check.
  if (isUnsafeGoalId(id)) {
    throw new Error(`非法 goal id: ${String(id).slice(0, 60)}`);
  }
  const keyResults = (input.keyResults || []).map((kr) => normalizeKr(kr));
  const goal = {
    ...createGoalRecord({
      id,
      storeId: goalFileStoreId(root),
      title: String(input.title || objective).trim(),
      objective,
      keyResults,
      createdAt: nowIso(),
    }),
    progress: derivedProgress(keyResults) ?? 0,
  };
  ensureDir(root);
  const file = goalFile(root, id);
  return withFileLock(
    file,
    () => {
      if (fs.existsSync(file)) {
        throw new Error(`goal already exists: ${id}`);
      }
      atomicWriteFileSync(file, JSON.stringify(goal, null, 2));
      return goal;
    },
    { failIfUnavailable: true },
  );
}

function normalizeKr(kr) {
  if (typeof kr === "string") {
    return {
      id: newId("kr"),
      text: kr.trim(),
      target: null,
      current: 0,
      done: false,
    };
  }
  return {
    id: kr.id || newId("kr"),
    text: String(kr.text || "").trim(),
    target: kr.target == null ? null : Number(kr.target),
    current: Number(kr.current) || 0,
    done: !!kr.done,
  };
}

/** Load a goal by id, or null. */
export function getGoal(id, opts = {}) {
  if (isUnsafeGoalId(id)) return null; // traversal id → treat as not found
  const root = opts.root || defaultRoot();
  const file = goalFile(root, id);
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (value?.id !== id) return null;
    if (Object.hasOwn(value, "schema") || Object.hasOwn(value, "schemaVersion"))
      fileRecord(value, root);
    return value;
  } catch {
    return null;
  }
}

function saveGoal(goal, opts = {}, before = null) {
  if (isUnsafeGoalId(goal && goal.id)) {
    throw new Error(`非法 goal id: ${String(goal && goal.id).slice(0, 60)}`);
  }
  const root = opts.root || defaultRoot();
  ensureDir(root);
  const previous = before || fileRecord(goal, root);
  const migrated = goal.schema ? goal : { ...fileRecord(goal, root) };
  if (previous.completion !== null && migrated.status === "done")
    throw goalError("GOAL_TERMINAL_REVISION_DENIED");
  const controls = ["status", "objective", "keyResults"];
  const changedControl = controls.some(
    (key) => JSON.stringify(previous[key]) !== JSON.stringify(migrated[key]),
  );
  const saved = fileRecord(
    {
      ...migrated,
      revision: previous.revision + 1,
      controlGeneration: previous.controlGeneration + (changedControl ? 1 : 0),
      completion: null,
      updatedAt: nowIso(),
    },
    root,
  );
  atomicWriteFileSync(goalFile(root, goal.id), JSON.stringify(saved, null, 2));
  return saved;
}

/** List goals, newest first. Optionally filter by status. */
export function listGoals(opts = {}) {
  const root = opts.root || defaultRoot();
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".json")) continue;
    const g = getGoal(name.slice(0, -5), { root });
    if (!g) continue;
    if (opts.status && g.status !== opts.status) continue;
    out.push(g);
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Mutate a goal via `fn(goal)`; throws if not found. */
function mutate(id, fn, opts = {}) {
  // Serialize the read-modify-write across processes (cc+cc, or cc+desktop
  // sharing the goals dir) so concurrent goal edits don't lose an update.
  // Durable goal state never proceeds without exclusion after bounded retry.
  // Guard before deriving the lock path: an unsafe id would otherwise place the
  // lock file at a traversal path (`<root>/../../x.json.lock`) before getGoal
  // even runs. getGoal/saveGoal also guard, but keep the lock inside the dir.
  if (isUnsafeGoalId(id)) throw new Error(`no such goal: ${id}`);
  const root = opts.root || defaultRoot();
  return withFileLock(
    goalFile(root, id),
    () => {
      const goal = getGoal(id, opts);
      if (!goal) throw new Error(`no such goal: ${id}`);
      let before;
      try {
        before = fileRecord(goal, root);
      } catch (error) {
        // Older CLI records had unbounded notes/strings. Preserve their full
        // history and existing controls if the bounded contract cannot accept
        // them. This fallback is never available to a versioned record.
        if (
          Object.hasOwn(goal, "schema") ||
          Object.hasOwn(goal, "schemaVersion") ||
          ![
            "GOAL_INVALID_ARRAY",
            "GOAL_INVALID_TEXT",
            "GOAL_INVALID_JSON",
          ].includes(error.code)
        )
          throw error;
        const revision = goal.revision ?? 1;
        const generation = goal.controlGeneration ?? 0;
        if (
          !Number.isSafeInteger(revision) ||
          revision < 1 ||
          !Number.isSafeInteger(generation) ||
          generation < 0 ||
          !Number.isSafeInteger(revision + 1) ||
          !Number.isSafeInteger(generation + 1)
        )
          throw goalError("GOAL_INVALID_REVISION");
        if (
          opts.expectedRevision !== undefined &&
          opts.expectedRevision !== revision
        )
          throw goalError("GOAL_REVISION_CONFLICT");
        const controls = JSON.stringify([
          goal.status,
          goal.objective,
          goal.keyResults,
        ]);
        fn(goal);
        goal.revision = revision + 1;
        goal.controlGeneration =
          generation +
          (controls !==
          JSON.stringify([goal.status, goal.objective, goal.keyResults])
            ? 1
            : 0);
        goal.updatedAt = nowIso();
        atomicWriteFileSync(goalFile(root, id), JSON.stringify(goal, null, 2));
        return goal;
      }
      if (
        opts.expectedRevision !== undefined &&
        (!Number.isSafeInteger(opts.expectedRevision) ||
          opts.expectedRevision !== before.revision)
      )
        throw goalError("GOAL_REVISION_CONFLICT");
      fn(goal);
      return saveGoal(goal, opts, before);
    },
    { failIfUnavailable: true },
  );
}

/** Add a key result to a goal. */
export function addKeyResult(id, text, krOpts = {}, opts = {}) {
  return mutate(
    id,
    (g) => {
      g.keyResults.push(normalizeKr({ text, target: krOpts.target }));
      const dp = derivedProgress(g.keyResults);
      if (dp != null) g.progress = dp;
    },
    opts,
  );
}

/** Update a key result (current value and/or done flag). */
export function setKeyResult(id, krId, patch = {}, opts = {}) {
  return mutate(
    id,
    (g) => {
      const kr = g.keyResults.find((k) => k.id === krId);
      if (!kr) throw new Error(`no such key result: ${krId}`);
      if (patch.current != null) kr.current = Number(patch.current);
      if (patch.done != null) kr.done = !!patch.done;
      if (
        kr.target != null &&
        patch.current != null &&
        Number(patch.current) >= kr.target
      ) {
        kr.done = true;
      }
      const dp = derivedProgress(g.keyResults);
      if (dp != null) g.progress = dp;
      g.drift.lastProgressAt = nowIso();
    },
    opts,
  );
}

/**
 * Record progress: set an explicit percentage and/or append a note.
 * @param {object} input { pct?, note?, by? }
 */
export function recordProgress(id, input = {}, opts = {}) {
  return mutate(
    id,
    (g) => {
      const pct = clampPct(input.pct);
      if (pct != null) g.progress = pct;
      if (input.note) {
        g.notes.push({
          at: nowIso(),
          text: String(input.note),
          by: input.by === "agent" ? "agent" : "user",
        });
      }
      g.drift.lastProgressAt = nowIso();
    },
    opts,
  );
}

/** Attach a session id to a goal (idempotent). */
export function linkSession(id, sessionId, opts = {}) {
  if (!sessionId) throw new Error("linkSession requires a sessionId");
  return mutate(
    id,
    (g) => {
      if (!g.linkedSessions.includes(sessionId)) {
        g.linkedSessions.push(sessionId);
      }
    },
    opts,
  );
}

/** Detach a session id from a goal. */
export function unlinkSession(id, sessionId, opts = {}) {
  return mutate(
    id,
    (g) => {
      g.linkedSessions = g.linkedSessions.filter((s) => s !== sessionId);
    },
    opts,
  );
}

/** Set a goal's status (active/paused/done/abandoned). */
export function setStatus(id, status, opts = {}) {
  if (!STATUS_VALUES.has(status)) {
    throw new Error(
      `invalid status "${status}" — expected one of: ${[...STATUS_VALUES].join(", ")}`,
    );
  }
  return mutate(
    id,
    (g) => {
      g.status = status;
      if (status === GOAL_STATUS.DONE && g.progress < 100) g.progress = 100;
    },
    opts,
  );
}

/**
 * Append drift flags to a goal's `drift.flags` list. Each flag is normalized to
 * `{ at, kind, detail }`. Used by the run-end assessment (cc goal Phase 2) to
 * record "no progress this run" / concern signals. Capped at 20 (newest kept).
 * @param {string} id
 * @param {Array<string|object>} flags
 */
export function addDriftFlags(id, flags, opts = {}) {
  const list = (Array.isArray(flags) ? flags : [flags]).filter(Boolean);
  if (list.length === 0) return getGoal(id, opts);
  return mutate(
    id,
    (g) => {
      for (const f of list) {
        const flag =
          typeof f === "string"
            ? { at: nowIso(), kind: "concern", detail: f }
            : {
                at: nowIso(),
                kind: f.kind || "concern",
                detail: f.detail || "",
              };
        g.drift.flags.push(flag);
      }
      // Keep only the most recent 20 to bound the file size.
      if (g.drift.flags.length > 20) {
        g.drift.flags = g.drift.flags.slice(-20);
      }
    },
    opts,
  );
}

/** Delete a goal. Returns true if it existed. */
export function deleteGoal(id, opts = {}) {
  if (isUnsafeGoalId(id)) return false; // traversal id → nothing to delete
  const root = opts.root || defaultRoot();
  const file = goalFile(root, id);
  if (!fs.existsSync(file)) return false;
  return withFileLock(
    file,
    () => {
      if (!fs.existsSync(file)) return false;
      if (opts.expectedRevision !== undefined) {
        const current = getGoal(id, { root });
        if (
          !current ||
          !Number.isSafeInteger(opts.expectedRevision) ||
          opts.expectedRevision !== (current.revision ?? 1)
        )
          throw goalError("GOAL_REVISION_CONFLICT");
      }
      fs.rmSync(file);
      return true;
    },
    { failIfUnavailable: true },
  );
}

/**
 * Resolve the goal that should be bound to the current run, in priority order:
 *   1. explicit id (--goal <id>)
 *   2. an active goal linked to the current session
 *   3. when exactly one active goal exists, that one
 *   4. null
 *
 * Only `active` goals are ever auto-resolved (steps 2–3); an explicit id is
 * honored regardless of status so a user can re-inspect a paused goal.
 *
 * @param {object} [sel] { explicitId, sessionId }
 * @param {object} [opts] { root }
 */
export function resolveActiveGoal(sel = {}, opts = {}) {
  if (sel.explicitId) {
    return getGoal(sel.explicitId, opts);
  }
  const active = listGoals({ ...opts, status: GOAL_STATUS.ACTIVE });
  if (active.length === 0) return null;
  if (sel.sessionId) {
    const linked = active.find((g) => g.linkedSessions.includes(sel.sessionId));
    if (linked) return linked;
  }
  if (active.length === 1) return active[0];
  // Ambiguous (multiple active, none linked) — caller must pick explicitly.
  return null;
}

/** Injectable repository adapter using the same files/strict locks as cc goal.
 * Reading a legacy file upgrades the returned view only; it never rewrites the
 * file, binds an owner or enables scheduling. */
export function createGoalFileAdapter(opts = {}) {
  const root = opts.root || defaultRoot();
  const storeId = goalFileStoreId(root);
  function read(id) {
    if (isUnsafeGoalId(id)) throw goalError("GOAL_INVALID_ID");
    const file = goalFile(root, id);
    if (!fs.existsSync(file)) return null;
    let value;
    try {
      value = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      throw goalError("GOAL_RECORD_CORRUPT");
    }
    const record = fileRecord(value, root);
    if (record.id !== id) throw goalError("GOAL_RECORD_CORRUPT");
    return record;
  }
  return Object.freeze({
    storeId,
    get: read,
    create(value) {
      const record = fileRecord(value, root);
      if (isUnsafeGoalId(record.id)) throw goalError("GOAL_INVALID_ID");
      if (
        record.revision !== 1 ||
        record.controlGeneration !== 0 ||
        record.status !== "active"
      )
        throw goalError("GOAL_INVALID_INITIAL_STATE");
      ensureDir(root);
      return withFileLock(
        goalFile(root, record.id),
        () => {
          if (fs.existsSync(goalFile(root, record.id)))
            throw goalError("GOAL_ALREADY_EXISTS");
          atomicWriteFileSync(
            goalFile(root, record.id),
            JSON.stringify(record, null, 2),
          );
          return record;
        },
        { failIfUnavailable: true },
      );
    },
    compareAndSwap(id, expectedRevision, transform) {
      if (isUnsafeGoalId(id)) throw goalError("GOAL_INVALID_ID");
      if (
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 1 ||
        typeof transform !== "function"
      )
        throw goalError("GOAL_INVALID_REVISION");
      if (!fs.existsSync(goalFile(root, id)))
        throw goalError("GOAL_NOT_FOUND_OR_DENIED");
      return withFileLock(
        goalFile(root, id),
        () => {
          const current = read(id);
          if (current === null) throw goalError("GOAL_NOT_FOUND_OR_DENIED");
          if (current.revision !== expectedRevision)
            throw goalError("GOAL_REVISION_CONFLICT");
          const next = fileRecord(validateGoalRecord(transform(current)), root);
          if (
            next.id !== id ||
            next.revision !== current.revision + 1 ||
            next.controlGeneration < current.controlGeneration
          )
            throw goalError("GOAL_INVALID_REPLACEMENT");
          atomicWriteFileSync(
            goalFile(root, id),
            JSON.stringify(next, null, 2),
          );
          return next;
        },
        { failIfUnavailable: true },
      );
    },
    list({ status } = {}) {
      if (status !== undefined && !STATUS_VALUES.has(status))
        throw goalError("GOAL_INVALID_STATUS");
      if (!fs.existsSync(root)) return [];
      return fs
        .readdirSync(root)
        .filter((name) => name.endsWith(".json"))
        .map((name) => read(name.slice(0, -5)))
        .filter(
          (record) =>
            record !== null &&
            (status === undefined || record.status === status),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  });
}
