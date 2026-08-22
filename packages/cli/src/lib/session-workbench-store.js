/**
 * Durable, CLI-owned Sessions Workbench grouping authority.
 *
 * IDE windows only render this state through `cc session projection`. Every
 * mutation is an exact revision CAS under the shared cross-process file lock,
 * so two IDE windows cannot silently overwrite each other's group changes.
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import { getHomeDir } from "./paths.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";
import { projectionRevision } from "./session-projection.js";

export const SESSION_WORKBENCH_STATE_SCHEMA =
  "chainlesschain.session-workbench-state/v1";
export const MAX_SESSION_GROUPS = 128;
export const MAX_SESSION_GROUP_NAME_CHARS = 80;
export const MAX_SESSION_GROUP_MEMBERSHIPS = 4096;

function statePath() {
  return path.join(getHomeDir(), "session-workbench.json");
}

function stateError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function cleanText(value, label, maxChars) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxChars || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw stateError(
      "SESSION_GROUP_INVALID_ARGUMENT",
      `${label} must be 1-${maxChars} characters without control characters`,
    );
  }
  return text;
}

function cleanGroupId(value) {
  const id = cleanText(value, "group id", 128);
  if (!/^group-[a-zA-Z0-9_-]+$/u.test(id)) {
    throw stateError(
      "SESSION_GROUP_INVALID_ARGUMENT",
      "group id has an unsupported format",
    );
  }
  return id;
}

function cleanSessionId(value) {
  const id = cleanText(value, "canonical session id", 512);
  if (!/^[a-z_]+:[^\s]+$/u.test(id)) {
    throw stateError(
      "SESSION_GROUP_INVALID_ARGUMENT",
      "session id must be a canonical kind-prefixed projection id",
    );
  }
  return id;
}

function emptyState() {
  return {
    schema: SESSION_WORKBENCH_STATE_SCHEMA,
    generation: 0,
    groups: [],
    memberships: {},
  };
}

function groupSort(left, right) {
  return (
    left.order - right.order ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

function normalizeState(raw) {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Object.keys(raw).length === 0
  ) {
    return emptyState();
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    raw.schema !== SESSION_WORKBENCH_STATE_SCHEMA ||
    !Number.isSafeInteger(raw.generation) ||
    raw.generation < 0 ||
    !Array.isArray(raw.groups) ||
    !raw.memberships ||
    typeof raw.memberships !== "object" ||
    Array.isArray(raw.memberships)
  ) {
    throw stateError(
      "SESSION_GROUP_STORE_CORRUPT",
      "session workbench state is malformed",
    );
  }
  if (raw.groups.length > MAX_SESSION_GROUPS) {
    throw stateError(
      "SESSION_GROUP_STORE_CORRUPT",
      "session workbench state exceeds the group limit",
    );
  }
  const ids = new Set();
  const names = new Set();
  const groups = raw.groups.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw stateError(
        "SESSION_GROUP_STORE_CORRUPT",
        "session group entry is malformed",
      );
    }
    const id = cleanGroupId(entry.id);
    const name = cleanText(
      entry.name,
      "group name",
      MAX_SESSION_GROUP_NAME_CHARS,
    );
    const order = Number(entry.order);
    if (!Number.isSafeInteger(order) || order < 0 || order > 100_000) {
      throw stateError(
        "SESSION_GROUP_STORE_CORRUPT",
        "session group order is malformed",
      );
    }
    if (ids.has(id) || names.has(name.toLowerCase())) {
      throw stateError(
        "SESSION_GROUP_STORE_CORRUPT",
        "session group ids and names must be unique",
      );
    }
    ids.add(id);
    names.add(name.toLowerCase());
    return { id, name, order };
  });
  const membershipEntries = Object.entries(raw.memberships);
  if (membershipEntries.length > MAX_SESSION_GROUP_MEMBERSHIPS) {
    throw stateError(
      "SESSION_GROUP_STORE_CORRUPT",
      "session workbench state exceeds the membership limit",
    );
  }
  const memberships = {};
  for (const [rawSessionId, rawGroupId] of membershipEntries) {
    const sessionId = cleanSessionId(rawSessionId);
    const groupId = cleanGroupId(rawGroupId);
    if (!ids.has(groupId)) {
      throw stateError(
        "SESSION_GROUP_STORE_CORRUPT",
        `session membership references missing group ${groupId}`,
      );
    }
    memberships[sessionId] = groupId;
  }
  return {
    schema: SESSION_WORKBENCH_STATE_SCHEMA,
    generation: raw.generation,
    groups: groups.sort(groupSort),
    memberships: Object.fromEntries(
      Object.entries(memberships).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

function revisionFor(state) {
  return projectionRevision({
    schema: state.schema,
    generation: state.generation,
    groups: state.groups,
    memberships: state.memberships,
  });
}

function publicProjection(state) {
  const normalized = normalizeState(state);
  return {
    authority: "cli",
    connected: true,
    revision: revisionFor(normalized),
    generation: normalized.generation,
    items: normalized.groups.map((group) => ({ ...group })),
    assignments: Object.entries(normalized.memberships).map(
      ([sessionId, groupId]) => ({ sessionId, groupId }),
    ),
  };
}

function requireRevision(state, expectedRevision) {
  const currentRevision = revisionFor(state);
  if (
    typeof expectedRevision !== "string" ||
    !expectedRevision ||
    expectedRevision !== currentRevision
  ) {
    throw stateError(
      "SESSION_GROUP_STALE",
      "session group revision changed; refresh before retrying",
      { expectedRevision: expectedRevision || null, currentRevision },
    );
  }
}

function reindex(groups) {
  return [...groups]
    .sort(groupSort)
    .map((group, order) => ({ ...group, order }));
}

export class SessionWorkbenchStore {
  constructor({ filePath = statePath(), uuid = randomUUID, lockOptions } = {}) {
    this.filePath = filePath;
    this.uuid = uuid;
    this.lockOptions = lockOptions;
  }

  projection() {
    return publicProjection(
      normalizeState(readSecurityStore(this.filePath, "session workbench")),
    );
  }

  _mutate(expectedRevision, mutator) {
    return mutateSecurityStore(
      this.filePath,
      "session workbench",
      (draft) => {
        const current = normalizeState(draft);
        requireRevision(current, expectedRevision);
        const next = normalizeState(mutator(structuredClone(current)));
        next.generation = current.generation + 1;
        for (const key of Object.keys(draft)) delete draft[key];
        Object.assign(draft, next);
        return publicProjection(next);
      },
      this.lockOptions,
    );
  }

  createGroup({ name, order = null, expectedRevision } = {}) {
    const normalizedName = cleanText(
      name,
      "group name",
      MAX_SESSION_GROUP_NAME_CHARS,
    );
    return this._mutate(expectedRevision, (state) => {
      if (state.groups.length >= MAX_SESSION_GROUPS) {
        throw stateError(
          "SESSION_GROUP_LIMIT",
          `session groups are limited to ${MAX_SESSION_GROUPS}`,
        );
      }
      if (
        state.groups.some(
          (group) => group.name.toLowerCase() === normalizedName.toLowerCase(),
        )
      ) {
        throw stateError(
          "SESSION_GROUP_CONFLICT",
          "session group name already exists",
        );
      }
      const requestedOrder =
        order == null ? state.groups.length : Number(order);
      if (
        !Number.isSafeInteger(requestedOrder) ||
        requestedOrder < 0 ||
        requestedOrder > state.groups.length
      ) {
        throw stateError(
          "SESSION_GROUP_INVALID_ARGUMENT",
          "group order must be within the current group list",
        );
      }
      state.groups = state.groups.map((group) =>
        group.order >= requestedOrder
          ? { ...group, order: group.order + 1 }
          : group,
      );
      state.groups.push({
        id: `group-${this.uuid().replaceAll("-", "")}`,
        name: normalizedName,
        order: requestedOrder,
      });
      state.groups = reindex(state.groups);
      return state;
    });
  }

  renameGroup({ groupId, name, expectedRevision } = {}) {
    const id = cleanGroupId(groupId);
    const normalizedName = cleanText(
      name,
      "group name",
      MAX_SESSION_GROUP_NAME_CHARS,
    );
    return this._mutate(expectedRevision, (state) => {
      const group = state.groups.find((entry) => entry.id === id);
      if (!group) {
        throw stateError(
          "SESSION_GROUP_NOT_FOUND",
          `session group ${id} not found`,
        );
      }
      if (
        state.groups.some(
          (entry) =>
            entry.id !== id &&
            entry.name.toLowerCase() === normalizedName.toLowerCase(),
        )
      ) {
        throw stateError(
          "SESSION_GROUP_CONFLICT",
          "session group name already exists",
        );
      }
      group.name = normalizedName;
      return state;
    });
  }

  deleteGroup({ groupId, expectedRevision } = {}) {
    const id = cleanGroupId(groupId);
    return this._mutate(expectedRevision, (state) => {
      if (!state.groups.some((entry) => entry.id === id)) {
        throw stateError(
          "SESSION_GROUP_NOT_FOUND",
          `session group ${id} not found`,
        );
      }
      state.groups = reindex(state.groups.filter((entry) => entry.id !== id));
      state.memberships = Object.fromEntries(
        Object.entries(state.memberships).filter(
          ([, groupId]) => groupId !== id,
        ),
      );
      return state;
    });
  }

  setGroupOrder({ groupId, order, expectedRevision } = {}) {
    const id = cleanGroupId(groupId);
    const requestedOrder = Number(order);
    return this._mutate(expectedRevision, (state) => {
      const current = state.groups.find((entry) => entry.id === id);
      if (!current) {
        throw stateError(
          "SESSION_GROUP_NOT_FOUND",
          `session group ${id} not found`,
        );
      }
      if (
        !Number.isSafeInteger(requestedOrder) ||
        requestedOrder < 0 ||
        requestedOrder >= state.groups.length
      ) {
        throw stateError(
          "SESSION_GROUP_INVALID_ARGUMENT",
          "group order must identify an existing position",
        );
      }
      const without = state.groups.filter((entry) => entry.id !== id);
      without.splice(requestedOrder, 0, current);
      state.groups = without.map((entry, index) => ({
        ...entry,
        order: index,
      }));
      return state;
    });
  }

  moveSessions({ groupId = null, sessionIds, expectedRevision } = {}) {
    const target =
      groupId == null || groupId === "" || groupId === "ungrouped"
        ? null
        : cleanGroupId(groupId);
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      throw stateError(
        "SESSION_GROUP_INVALID_ARGUMENT",
        "at least one canonical session id is required",
      );
    }
    const ids = [...new Set(sessionIds.map(cleanSessionId))];
    if (ids.length > 256) {
      throw stateError(
        "SESSION_GROUP_INVALID_ARGUMENT",
        "one batch move is limited to 256 sessions",
      );
    }
    return this._mutate(expectedRevision, (state) => {
      if (target && !state.groups.some((entry) => entry.id === target)) {
        throw stateError(
          "SESSION_GROUP_NOT_FOUND",
          `session group ${target} not found`,
        );
      }
      const nextCount = new Set([
        ...Object.keys(state.memberships),
        ...(target ? ids : []),
      ]).size;
      if (nextCount > MAX_SESSION_GROUP_MEMBERSHIPS) {
        throw stateError(
          "SESSION_GROUP_LIMIT",
          `session memberships are limited to ${MAX_SESSION_GROUP_MEMBERSHIPS}`,
        );
      }
      for (const sessionId of ids) {
        if (target) state.memberships[sessionId] = target;
        else delete state.memberships[sessionId];
      }
      return state;
    });
  }
}

export function disconnectedSessionGroups(reasonText) {
  return {
    authority: "cli",
    connected: false,
    revision: null,
    generation: 0,
    reason: String(reasonText || "session group store unavailable").slice(
      0,
      240,
    ),
    items: [],
    assignments: [],
  };
}
