"use strict";

const MAX_SERIALIZED_BYTES = 4 * 1024 * 1024;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;

function registryError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "DesktopGraphRunRegistryError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function identifier(value, field) {
  const text = String(value || "").trim();
  if (!IDENTIFIER.test(text)) {
    throw registryError(
      "CC_DESKTOP_GRAPH_BINDING_INVALID",
      `${field} is not a valid Desktop Graph binding identifier`,
    );
  }
  return text;
}

function serialized(value, field) {
  const text = JSON.stringify(value ?? null);
  if (Buffer.byteLength(text, "utf8") > MAX_SERIALIZED_BYTES) {
    throw registryError(
      "CC_DESKTOP_GRAPH_BINDING_TOO_LARGE",
      `${field} exceeds the Desktop Graph binding byte limit`,
    );
  }
  return text;
}

function parsed(value, field) {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw registryError(
      "CC_DESKTOP_GRAPH_BINDING_CORRUPT",
      `${field} is not valid JSON`,
      { cause },
    );
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class MemoryDesktopGraphRunStore {
  constructor() {
    this.records = new Map();
  }
}

class DesktopGraphRunRegistry {
  constructor({ database = null, store = null, now = Date.now } = {}) {
    this.database = database;
    this.store = store || new MemoryDesktopGraphRunStore();
    this.now = now;
    if (this.database) this._ensureSchema();
  }

  _ensureSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS desktop_graph_run_bindings (
        surface TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        graph_run_id TEXT NOT NULL UNIQUE,
        authority_mode TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL,
        metadata TEXT NOT NULL,
        last_projection TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (surface, entity_id)
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_graph_run_bindings_status
        ON desktop_graph_run_bindings(surface, lifecycle_status, updated_at);
    `);
  }

  _normalize(binding) {
    const authorityMode = String(binding.authorityMode || "").trim();
    if (!["canonical", "shadow"].includes(authorityMode)) {
      throw registryError(
        "CC_DESKTOP_GRAPH_BINDING_INVALID",
        "authorityMode must be canonical or shadow",
      );
    }
    return {
      surface: identifier(binding.surface, "surface"),
      entityId: identifier(binding.entityId, "entityId"),
      graphRunId: identifier(binding.graphRunId, "graphRunId"),
      authorityMode,
      lifecycleStatus: String(binding.lifecycleStatus || "running").slice(
        0,
        64,
      ),
      metadata: clone(binding.metadata || {}),
      lastProjection: clone(binding.lastProjection || null),
    };
  }

  record(binding) {
    const value = this._normalize(binding);
    const now = this.now();
    if (this.database) {
      this.database
        .prepare(
          `INSERT INTO desktop_graph_run_bindings (
             surface, entity_id, graph_run_id, authority_mode,
             lifecycle_status, metadata, last_projection, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(surface, entity_id) DO UPDATE SET
             graph_run_id = excluded.graph_run_id,
             authority_mode = excluded.authority_mode,
             lifecycle_status = excluded.lifecycle_status,
             metadata = excluded.metadata,
             last_projection = excluded.last_projection,
             updated_at = excluded.updated_at`,
        )
        .run(
          value.surface,
          value.entityId,
          value.graphRunId,
          value.authorityMode,
          value.lifecycleStatus,
          serialized(value.metadata, "metadata"),
          serialized(value.lastProjection, "lastProjection"),
          now,
          now,
        );
    } else {
      const key = `${value.surface}\0${value.entityId}`;
      const previous = this.store.records.get(key);
      this.store.records.set(key, {
        ...value,
        createdAt: previous?.createdAt || now,
        updatedAt: now,
      });
    }
    return this.get(value.surface, value.entityId);
  }

  updateProjection(surface, entityId, projection) {
    const current = this.get(surface, entityId);
    if (!current) {
      throw registryError(
        "CC_DESKTOP_GRAPH_BINDING_NOT_FOUND",
        "Desktop Graph binding was not found",
      );
    }
    return this.record({
      ...current,
      lifecycleStatus: projection?.status || current.lifecycleStatus,
      lastProjection: projection,
    });
  }

  get(surface, entityId) {
    const safeSurface = identifier(surface, "surface");
    const safeEntityId = identifier(entityId, "entityId");
    if (this.database) {
      const row = this.database
        .prepare(
          `SELECT * FROM desktop_graph_run_bindings
           WHERE surface = ? AND entity_id = ?`,
        )
        .get(safeSurface, safeEntityId);
      return row ? this._fromRow(row) : null;
    }
    return clone(
      this.store.records.get(`${safeSurface}\0${safeEntityId}`) || null,
    );
  }

  list(surface) {
    const safeSurface = identifier(surface, "surface");
    if (this.database) {
      return this.database
        .prepare(
          `SELECT * FROM desktop_graph_run_bindings
           WHERE surface = ? ORDER BY updated_at DESC, entity_id ASC`,
        )
        .all(safeSurface)
        .map((row) => this._fromRow(row));
    }
    return [...this.store.records.values()]
      .filter((record) => record.surface === safeSurface)
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt ||
          left.entityId.localeCompare(right.entityId),
      )
      .map(clone);
  }

  delete(surface, entityId) {
    const safeSurface = identifier(surface, "surface");
    const safeEntityId = identifier(entityId, "entityId");
    if (this.database) {
      return (
        this.database
          .prepare(
            `DELETE FROM desktop_graph_run_bindings
             WHERE surface = ? AND entity_id = ?`,
          )
          .run(safeSurface, safeEntityId).changes > 0
      );
    }
    return this.store.records.delete(`${safeSurface}\0${safeEntityId}`);
  }

  _fromRow(row) {
    return {
      surface: row.surface,
      entityId: row.entity_id,
      graphRunId: row.graph_run_id,
      authorityMode: row.authority_mode,
      lifecycleStatus: row.lifecycle_status,
      metadata: parsed(row.metadata, "metadata"),
      lastProjection: parsed(row.last_projection, "lastProjection"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = {
  DesktopGraphRunRegistry,
  MemoryDesktopGraphRunStore,
  registryError,
};
