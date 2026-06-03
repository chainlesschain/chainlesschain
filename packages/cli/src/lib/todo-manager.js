/**
 * Session TODO Manager
 *
 * In-memory per-session TODO list. One instance per sessionId.
 * Inspired by open-agents todo_write tool.
 *
 * Contract:
 *  - Exactly one item may be in_progress at a time (validator enforces)
 *  - writeTodos replaces the full list (idempotent updates)
 *  - getTodos returns a deep-cloned array
 */

const VALID_STATUSES = Object.freeze([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

const _stores = new Map();

export function getTodoStore(sessionId) {
  const key = sessionId || "__default__";
  if (!_stores.has(key)) {
    _stores.set(key, { todos: [] });
  }
  return _stores.get(key);
}

export function validateTodos(todos) {
  if (!Array.isArray(todos)) {
    return { valid: false, error: "todos must be an array" };
  }
  const ids = new Set();
  let inProgressCount = 0;
  for (const todo of todos) {
    if (!todo || typeof todo !== "object") {
      return { valid: false, error: "each todo must be an object" };
    }
    if (typeof todo.id !== "string" || !todo.id) {
      return { valid: false, error: "todo.id must be a non-empty string" };
    }
    if (ids.has(todo.id)) {
      return { valid: false, error: `duplicate todo id: ${todo.id}` };
    }
    ids.add(todo.id);
    if (typeof todo.content !== "string" || !todo.content) {
      return { valid: false, error: `todo.content required for id=${todo.id}` };
    }
    if (!VALID_STATUSES.includes(todo.status)) {
      return {
        valid: false,
        error: `todo.status must be one of ${VALID_STATUSES.join("|")} (id=${todo.id})`,
      };
    }
    if (todo.status === "in_progress") inProgressCount += 1;
  }
  if (inProgressCount > 1) {
    return {
      valid: false,
      error: "only one todo may be in_progress at a time",
    };
  }
  return { valid: true };
}

export function writeTodos(sessionId, todos) {
  const check = validateTodos(todos);
  if (!check.valid) {
    return { success: false, error: check.error };
  }
  const store = getTodoStore(sessionId);
  store.todos = todos.map((t) => ({
    id: t.id,
    content: t.content,
    status: t.status,
  }));
  return {
    success: true,
    count: store.todos.length,
    summary: summarizeTodos(store.todos),
  };
}

export function getTodos(sessionId) {
  const store = getTodoStore(sessionId);
  return store.todos.map((t) => ({ ...t }));
}

export function clearTodos(sessionId) {
  const store = getTodoStore(sessionId);
  store.todos = [];
  return { success: true };
}

export function summarizeTodos(todos) {
  const counts = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
  for (const t of todos || []) {
    if (counts[t.status] !== undefined) counts[t.status] += 1;
  }
  return counts;
}

export function resetAllStores() {
  _stores.clear();
}

export const _deps = { _stores };

// ===== V2 Surface: Todo Manager governance overlay (CLI v0.133.0) =====
export const TODO_LIST_MATURITY_V2 = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const TODO_ITEM_LIFECYCLE_V2 = Object.freeze({
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _tlListTrans = new Map([
  [
    TODO_LIST_MATURITY_V2.DRAFT,
    new Set([TODO_LIST_MATURITY_V2.ACTIVE, TODO_LIST_MATURITY_V2.ARCHIVED]),
  ],
  [
    TODO_LIST_MATURITY_V2.ACTIVE,
    new Set([TODO_LIST_MATURITY_V2.PAUSED, TODO_LIST_MATURITY_V2.ARCHIVED]),
  ],
  [
    TODO_LIST_MATURITY_V2.PAUSED,
    new Set([TODO_LIST_MATURITY_V2.ACTIVE, TODO_LIST_MATURITY_V2.ARCHIVED]),
  ],
  [TODO_LIST_MATURITY_V2.ARCHIVED, new Set()],
]);
const _tlListTerminal = new Set([TODO_LIST_MATURITY_V2.ARCHIVED]);
const _tlItemTrans = new Map([
  [
    TODO_ITEM_LIFECYCLE_V2.PENDING,
    new Set([
      TODO_ITEM_LIFECYCLE_V2.IN_PROGRESS,
      TODO_ITEM_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    TODO_ITEM_LIFECYCLE_V2.IN_PROGRESS,
    new Set([
      TODO_ITEM_LIFECYCLE_V2.COMPLETED,
      TODO_ITEM_LIFECYCLE_V2.FAILED,
      TODO_ITEM_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [TODO_ITEM_LIFECYCLE_V2.COMPLETED, new Set()],
  [TODO_ITEM_LIFECYCLE_V2.FAILED, new Set()],
  [TODO_ITEM_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _tlLists = new Map();
const _tlItems = new Map();
let _tlMaxActivePerOwner = 10;
let _tlMaxPendingPerList = 40;
let _tlListIdleMs = 7 * 24 * 60 * 60 * 1000;
let _tlItemStuckMs = 24 * 60 * 60 * 1000;

function _tlPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveTodoListsPerOwnerV2(n) {
  _tlMaxActivePerOwner = _tlPos(n, "maxActiveTodoListsPerOwner");
}
export function getMaxActiveTodoListsPerOwnerV2() {
  return _tlMaxActivePerOwner;
}
export function setMaxPendingItemsPerTodoListV2(n) {
  _tlMaxPendingPerList = _tlPos(n, "maxPendingItemsPerTodoList");
}
export function getMaxPendingItemsPerTodoListV2() {
  return _tlMaxPendingPerList;
}
export function setTodoListIdleMsV2(n) {
  _tlListIdleMs = _tlPos(n, "todoListIdleMs");
}
export function getTodoListIdleMsV2() {
  return _tlListIdleMs;
}
export function setTodoItemStuckMsV2(n) {
  _tlItemStuckMs = _tlPos(n, "todoItemStuckMs");
}
export function getTodoItemStuckMsV2() {
  return _tlItemStuckMs;
}

export function _resetStateTodoManagerV2() {
  _tlLists.clear();
  _tlItems.clear();
  _tlMaxActivePerOwner = 10;
  _tlMaxPendingPerList = 40;
  _tlListIdleMs = 7 * 24 * 60 * 60 * 1000;
  _tlItemStuckMs = 24 * 60 * 60 * 1000;
}

export function registerTodoListV2({ id, owner, title, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_tlLists.has(id)) throw new Error(`todo list ${id} already registered`);
  const now = Date.now();
  const l = {
    id,
    owner,
    title: title || id,
    status: TODO_LIST_MATURITY_V2.DRAFT,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _tlLists.set(id, l);
  return { ...l, metadata: { ...l.metadata } };
}
function _tlCheckL(from, to) {
  const allowed = _tlListTrans.get(from);
  if (!allowed || !allowed.has(to))
    throw new Error(`invalid todo list transition ${from} → ${to}`);
}
function _tlCountActive(owner) {
  let n = 0;
  for (const l of _tlLists.values())
    if (l.owner === owner && l.status === TODO_LIST_MATURITY_V2.ACTIVE) n++;
  return n;
}

export function activateTodoListV2(id) {
  const l = _tlLists.get(id);
  if (!l) throw new Error(`todo list ${id} not found`);
  _tlCheckL(l.status, TODO_LIST_MATURITY_V2.ACTIVE);
  const recovery = l.status === TODO_LIST_MATURITY_V2.PAUSED;
  if (!recovery) {
    const a = _tlCountActive(l.owner);
    if (a >= _tlMaxActivePerOwner)
      throw new Error(
        `max active todo lists per owner (${_tlMaxActivePerOwner}) reached for ${l.owner}`,
      );
  }
  const now = Date.now();
  l.status = TODO_LIST_MATURITY_V2.ACTIVE;
  l.updatedAt = now;
  l.lastTouchedAt = now;
  if (!l.activatedAt) l.activatedAt = now;
  return { ...l, metadata: { ...l.metadata } };
}
export function pauseTodoListV2(id) {
  const l = _tlLists.get(id);
  if (!l) throw new Error(`todo list ${id} not found`);
  _tlCheckL(l.status, TODO_LIST_MATURITY_V2.PAUSED);
  l.status = TODO_LIST_MATURITY_V2.PAUSED;
  l.updatedAt = Date.now();
  return { ...l, metadata: { ...l.metadata } };
}
export function archiveTodoListV2(id) {
  const l = _tlLists.get(id);
  if (!l) throw new Error(`todo list ${id} not found`);
  _tlCheckL(l.status, TODO_LIST_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  l.status = TODO_LIST_MATURITY_V2.ARCHIVED;
  l.updatedAt = now;
  if (!l.archivedAt) l.archivedAt = now;
  return { ...l, metadata: { ...l.metadata } };
}
export function touchTodoListV2(id) {
  const l = _tlLists.get(id);
  if (!l) throw new Error(`todo list ${id} not found`);
  if (_tlListTerminal.has(l.status))
    throw new Error(`cannot touch terminal todo list ${id}`);
  const now = Date.now();
  l.lastTouchedAt = now;
  l.updatedAt = now;
  return { ...l, metadata: { ...l.metadata } };
}
export function getTodoListV2(id) {
  const l = _tlLists.get(id);
  if (!l) return null;
  return { ...l, metadata: { ...l.metadata } };
}
export function listTodoListsV2() {
  return [..._tlLists.values()].map((l) => ({
    ...l,
    metadata: { ...l.metadata },
  }));
}

function _tlCountPending(lid) {
  let n = 0;
  for (const it of _tlItems.values())
    if (
      it.listId === lid &&
      (it.status === TODO_ITEM_LIFECYCLE_V2.PENDING ||
        it.status === TODO_ITEM_LIFECYCLE_V2.IN_PROGRESS)
    )
      n++;
  return n;
}

export function createTodoItemV2({ id, listId, description, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!listId || typeof listId !== "string")
    throw new Error("listId is required");
  if (_tlItems.has(id)) throw new Error(`todo item ${id} already exists`);
  if (!_tlLists.has(listId)) throw new Error(`todo list ${listId} not found`);
  const pending = _tlCountPending(listId);
  if (pending >= _tlMaxPendingPerList)
    throw new Error(
      `max pending items per todo list (${_tlMaxPendingPerList}) reached for ${listId}`,
    );
  const now = Date.now();
  const it = {
    id,
    listId,
    description: description || "",
    status: TODO_ITEM_LIFECYCLE_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _tlItems.set(id, it);
  return { ...it, metadata: { ...it.metadata } };
}
function _tlCheckI(from, to) {
  const allowed = _tlItemTrans.get(from);
  if (!allowed || !allowed.has(to))
    throw new Error(`invalid todo item transition ${from} → ${to}`);
}
export function startTodoItemV2(id) {
  const it = _tlItems.get(id);
  if (!it) throw new Error(`todo item ${id} not found`);
  _tlCheckI(it.status, TODO_ITEM_LIFECYCLE_V2.IN_PROGRESS);
  const now = Date.now();
  it.status = TODO_ITEM_LIFECYCLE_V2.IN_PROGRESS;
  it.updatedAt = now;
  if (!it.startedAt) it.startedAt = now;
  return { ...it, metadata: { ...it.metadata } };
}
export function completeTodoItemV2(id) {
  const it = _tlItems.get(id);
  if (!it) throw new Error(`todo item ${id} not found`);
  _tlCheckI(it.status, TODO_ITEM_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  it.status = TODO_ITEM_LIFECYCLE_V2.COMPLETED;
  it.updatedAt = now;
  if (!it.settledAt) it.settledAt = now;
  return { ...it, metadata: { ...it.metadata } };
}
export function failTodoItemV2(id, reason) {
  const it = _tlItems.get(id);
  if (!it) throw new Error(`todo item ${id} not found`);
  _tlCheckI(it.status, TODO_ITEM_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  it.status = TODO_ITEM_LIFECYCLE_V2.FAILED;
  it.updatedAt = now;
  if (!it.settledAt) it.settledAt = now;
  if (reason) it.metadata.failReason = String(reason);
  return { ...it, metadata: { ...it.metadata } };
}
export function cancelTodoItemV2(id, reason) {
  const it = _tlItems.get(id);
  if (!it) throw new Error(`todo item ${id} not found`);
  _tlCheckI(it.status, TODO_ITEM_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  it.status = TODO_ITEM_LIFECYCLE_V2.CANCELLED;
  it.updatedAt = now;
  if (!it.settledAt) it.settledAt = now;
  if (reason) it.metadata.cancelReason = String(reason);
  return { ...it, metadata: { ...it.metadata } };
}
export function getTodoItemV2(id) {
  const it = _tlItems.get(id);
  if (!it) return null;
  return { ...it, metadata: { ...it.metadata } };
}
export function listTodoItemsV2() {
  return [..._tlItems.values()].map((it) => ({
    ...it,
    metadata: { ...it.metadata },
  }));
}

export function autoPauseIdleTodoListsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const l of _tlLists.values())
    if (
      l.status === TODO_LIST_MATURITY_V2.ACTIVE &&
      t - l.lastTouchedAt >= _tlListIdleMs
    ) {
      l.status = TODO_LIST_MATURITY_V2.PAUSED;
      l.updatedAt = t;
      flipped.push(l.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckTodoItemsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const it of _tlItems.values())
    if (
      it.status === TODO_ITEM_LIFECYCLE_V2.IN_PROGRESS &&
      it.startedAt != null &&
      t - it.startedAt >= _tlItemStuckMs
    ) {
      it.status = TODO_ITEM_LIFECYCLE_V2.FAILED;
      it.updatedAt = t;
      if (!it.settledAt) it.settledAt = t;
      it.metadata.failReason = "auto-fail-stuck";
      flipped.push(it.id);
    }
  return { flipped, count: flipped.length };
}

export function getTodoManagerStatsV2() {
  const listsByStatus = {};
  for (const s of Object.values(TODO_LIST_MATURITY_V2)) listsByStatus[s] = 0;
  for (const l of _tlLists.values()) listsByStatus[l.status]++;
  const itemsByStatus = {};
  for (const s of Object.values(TODO_ITEM_LIFECYCLE_V2)) itemsByStatus[s] = 0;
  for (const it of _tlItems.values()) itemsByStatus[it.status]++;
  return {
    totalListsV2: _tlLists.size,
    totalItemsV2: _tlItems.size,
    maxActiveTodoListsPerOwner: _tlMaxActivePerOwner,
    maxPendingItemsPerTodoList: _tlMaxPendingPerList,
    todoListIdleMs: _tlListIdleMs,
    todoItemStuckMs: _tlItemStuckMs,
    listsByStatus,
    itemsByStatus,
  };
}

// =====================================================================
// todo-manager V2 governance overlay (iter25)
// =====================================================================
export const TODOGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const TODOGOV_STEP_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  DOING: "doing",
  DONE: "done",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _todogovPTrans = new Map([
  [
    TODOGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      TODOGOV_PROFILE_MATURITY_V2.ACTIVE,
      TODOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    TODOGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      TODOGOV_PROFILE_MATURITY_V2.PAUSED,
      TODOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    TODOGOV_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      TODOGOV_PROFILE_MATURITY_V2.ACTIVE,
      TODOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [TODOGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _todogovPTerminal = new Set([TODOGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _todogovJTrans = new Map([
  [
    TODOGOV_STEP_LIFECYCLE_V2.QUEUED,
    new Set([
      TODOGOV_STEP_LIFECYCLE_V2.DOING,
      TODOGOV_STEP_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    TODOGOV_STEP_LIFECYCLE_V2.DOING,
    new Set([
      TODOGOV_STEP_LIFECYCLE_V2.DONE,
      TODOGOV_STEP_LIFECYCLE_V2.FAILED,
      TODOGOV_STEP_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [TODOGOV_STEP_LIFECYCLE_V2.DONE, new Set()],
  [TODOGOV_STEP_LIFECYCLE_V2.FAILED, new Set()],
  [TODOGOV_STEP_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _todogovPsV2 = new Map();
const _todogovJsV2 = new Map();
let _todogovMaxActive = 10,
  _todogovMaxPending = 30,
  _todogovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _todogovStuckMs = 60 * 1000;
function _todogovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _todogovCheckP(from, to) {
  const a = _todogovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid todogov profile transition ${from} → ${to}`);
}
function _todogovCheckJ(from, to) {
  const a = _todogovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid todogov step transition ${from} → ${to}`);
}
function _todogovCountActive(owner) {
  let c = 0;
  for (const p of _todogovPsV2.values())
    if (p.owner === owner && p.status === TODOGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _todogovCountPending(profileId) {
  let c = 0;
  for (const j of _todogovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === TODOGOV_STEP_LIFECYCLE_V2.QUEUED ||
        j.status === TODOGOV_STEP_LIFECYCLE_V2.DOING)
    )
      c++;
  return c;
}
export function setMaxActiveTodogovProfilesPerOwnerV2(n) {
  _todogovMaxActive = _todogovPos(n, "maxActiveTodogovProfilesPerOwner");
}
export function getMaxActiveTodogovProfilesPerOwnerV2() {
  return _todogovMaxActive;
}
export function setMaxPendingTodogovStepsPerProfileV2(n) {
  _todogovMaxPending = _todogovPos(n, "maxPendingTodogovStepsPerProfile");
}
export function getMaxPendingTodogovStepsPerProfileV2() {
  return _todogovMaxPending;
}
export function setTodogovProfileIdleMsV2(n) {
  _todogovIdleMs = _todogovPos(n, "todogovProfileIdleMs");
}
export function getTodogovProfileIdleMsV2() {
  return _todogovIdleMs;
}
export function setTodogovStepStuckMsV2(n) {
  _todogovStuckMs = _todogovPos(n, "todogovStepStuckMs");
}
export function getTodogovStepStuckMsV2() {
  return _todogovStuckMs;
}
export function _resetStateTodoManagerGovV2() {
  _todogovPsV2.clear();
  _todogovJsV2.clear();
  _todogovMaxActive = 10;
  _todogovMaxPending = 30;
  _todogovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _todogovStuckMs = 60 * 1000;
}
export function registerTodogovProfileV2({ id, owner, list, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_todogovPsV2.has(id))
    throw new Error(`todogov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    list: list || "default",
    status: TODOGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _todogovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateTodogovProfileV2(id) {
  const p = _todogovPsV2.get(id);
  if (!p) throw new Error(`todogov profile ${id} not found`);
  const isInitial = p.status === TODOGOV_PROFILE_MATURITY_V2.PENDING;
  _todogovCheckP(p.status, TODOGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _todogovCountActive(p.owner) >= _todogovMaxActive)
    throw new Error(`max active todogov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = TODOGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseTodogovProfileV2(id) {
  const p = _todogovPsV2.get(id);
  if (!p) throw new Error(`todogov profile ${id} not found`);
  _todogovCheckP(p.status, TODOGOV_PROFILE_MATURITY_V2.PAUSED);
  p.status = TODOGOV_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveTodogovProfileV2(id) {
  const p = _todogovPsV2.get(id);
  if (!p) throw new Error(`todogov profile ${id} not found`);
  _todogovCheckP(p.status, TODOGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = TODOGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchTodogovProfileV2(id) {
  const p = _todogovPsV2.get(id);
  if (!p) throw new Error(`todogov profile ${id} not found`);
  if (_todogovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal todogov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getTodogovProfileV2(id) {
  const p = _todogovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listTodogovProfilesV2() {
  return [..._todogovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createTodogovStepV2({ id, profileId, title, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_todogovJsV2.has(id))
    throw new Error(`todogov step ${id} already exists`);
  if (!_todogovPsV2.has(profileId))
    throw new Error(`todogov profile ${profileId} not found`);
  if (_todogovCountPending(profileId) >= _todogovMaxPending)
    throw new Error(
      `max pending todogov steps for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    title: title || "",
    status: TODOGOV_STEP_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _todogovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function doingTodogovStepV2(id) {
  const j = _todogovJsV2.get(id);
  if (!j) throw new Error(`todogov step ${id} not found`);
  _todogovCheckJ(j.status, TODOGOV_STEP_LIFECYCLE_V2.DOING);
  const now = Date.now();
  j.status = TODOGOV_STEP_LIFECYCLE_V2.DOING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeStepTodogovV2(id) {
  const j = _todogovJsV2.get(id);
  if (!j) throw new Error(`todogov step ${id} not found`);
  _todogovCheckJ(j.status, TODOGOV_STEP_LIFECYCLE_V2.DONE);
  const now = Date.now();
  j.status = TODOGOV_STEP_LIFECYCLE_V2.DONE;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failTodogovStepV2(id, reason) {
  const j = _todogovJsV2.get(id);
  if (!j) throw new Error(`todogov step ${id} not found`);
  _todogovCheckJ(j.status, TODOGOV_STEP_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = TODOGOV_STEP_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelTodogovStepV2(id, reason) {
  const j = _todogovJsV2.get(id);
  if (!j) throw new Error(`todogov step ${id} not found`);
  _todogovCheckJ(j.status, TODOGOV_STEP_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = TODOGOV_STEP_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getTodogovStepV2(id) {
  const j = _todogovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listTodogovStepsV2() {
  return [..._todogovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPauseIdleTodogovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _todogovPsV2.values())
    if (
      p.status === TODOGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _todogovIdleMs
    ) {
      p.status = TODOGOV_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckTodogovStepsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _todogovJsV2.values())
    if (
      j.status === TODOGOV_STEP_LIFECYCLE_V2.DOING &&
      j.startedAt != null &&
      t - j.startedAt >= _todogovStuckMs
    ) {
      j.status = TODOGOV_STEP_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getTodoManagerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(TODOGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _todogovPsV2.values()) profilesByStatus[p.status]++;
  const stepsByStatus = {};
  for (const v of Object.values(TODOGOV_STEP_LIFECYCLE_V2))
    stepsByStatus[v] = 0;
  for (const j of _todogovJsV2.values()) stepsByStatus[j.status]++;
  return {
    totalTodogovProfilesV2: _todogovPsV2.size,
    totalTodogovStepsV2: _todogovJsV2.size,
    maxActiveTodogovProfilesPerOwner: _todogovMaxActive,
    maxPendingTodogovStepsPerProfile: _todogovMaxPending,
    todogovProfileIdleMs: _todogovIdleMs,
    todogovStepStuckMs: _todogovStuckMs,
    profilesByStatus,
    stepsByStatus,
  };
}
