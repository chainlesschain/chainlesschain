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
import { getHomeDir } from "./paths.js";

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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function newId(prefix) {
  // Date.now/random are fine here (plain CLI lib, not a resumable workflow).
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}

function nowIso() {
  return new Date().toISOString();
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
  const keyResults = (input.keyResults || []).map((kr) => normalizeKr(kr));
  const goal = {
    id,
    title: String(input.title || objective).trim(),
    objective,
    keyResults,
    status: GOAL_STATUS.ACTIVE,
    progress: derivedProgress(keyResults) ?? 0,
    linkedSessions: [],
    notes: [],
    drift: { lastProgressAt: null, flags: [] },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  ensureDir(root);
  fs.writeFileSync(goalFile(root, id), JSON.stringify(goal, null, 2), "utf-8");
  return goal;
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
  const root = opts.root || defaultRoot();
  const file = goalFile(root, id);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function saveGoal(goal, opts = {}) {
  const root = opts.root || defaultRoot();
  ensureDir(root);
  goal.updatedAt = nowIso();
  fs.writeFileSync(
    goalFile(root, goal.id),
    JSON.stringify(goal, null, 2),
    "utf-8",
  );
  return goal;
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
  const goal = getGoal(id, opts);
  if (!goal) throw new Error(`no such goal: ${id}`);
  fn(goal);
  return saveGoal(goal, opts);
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

/** Delete a goal. Returns true if it existed. */
export function deleteGoal(id, opts = {}) {
  const root = opts.root || defaultRoot();
  const file = goalFile(root, id);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
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
