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
