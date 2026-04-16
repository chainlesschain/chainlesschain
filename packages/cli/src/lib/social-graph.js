/**
 * Social Graph — typed directed edges between DIDs, with a real-time
 * event stream for "graph changed" notifications.
 *
 * Scope (CLI-first MVP):
 *   - add/remove edges (follow / friend / like / mention / block)
 *   - neighbor queries (out/in, optional edge type filter)
 *   - graph snapshot (nodes + edges) for one-shot exports
 *   - EventEmitter-style subscribe/unsubscribe so any consumer
 *     (CLI `watch`, future WebSocket route, Desktop renderer) can
 *     render graph changes live instead of polling
 *
 * What this module is NOT:
 *   - A centrality / community-detection engine. That lives in the
 *     desktop `social-graph.js` and operates on snapshots produced
 *     here. Keeping the CLI lib thin makes the event stream easy to
 *     reason about and test.
 *
 * Persistence: optional. When a `db` handle is passed into
 * `ensureGraphTables(db)` and mutation helpers, edges survive
 * process restarts; otherwise the graph is in-memory only.
 */

import { EventEmitter } from "events";

/* ── Edge types ────────────────────────────────────────────── */

export const EDGE_TYPES = Object.freeze([
  "follow",
  "friend",
  "like",
  "mention",
  "block",
]);

function _validateEdgeType(edgeType) {
  if (!EDGE_TYPES.includes(edgeType)) {
    throw new Error(
      `Invalid edge type "${edgeType}"; expected one of ${EDGE_TYPES.join(", ")}`,
    );
  }
}

/* ── In-memory state ──────────────────────────────────────── */

// Adjacency: Map<sourceDid, Map<`${targetDid}|${type}`, edge>>
const _outgoing = new Map();
// Reverse adjacency: Map<targetDid, Map<`${sourceDid}|${type}`, edge>>
const _incoming = new Map();
// Node metadata: Map<did, { did, firstSeen, lastSeen, edgeCount }>
const _nodes = new Map();

// Shared EventEmitter. Bumped to a high max so many CLI `watch`
// processes or downstream WS clients don't trip the listener warning.
const _bus = new EventEmitter();
_bus.setMaxListeners(0);

/* ── Schema ───────────────────────────────────────────────── */

export function ensureGraphTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_graph_edges (
      source_did TEXT NOT NULL,
      target_did TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (source_did, target_did, edge_type)
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_graph_source
      ON social_graph_edges (source_did, edge_type);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_social_graph_target
      ON social_graph_edges (target_did, edge_type);
  `);
}

/* ── Helpers ──────────────────────────────────────────────── */

function _edgeKey(targetDid, edgeType) {
  return `${targetDid}|${edgeType}`;
}

function _touchNode(did, now) {
  let node = _nodes.get(did);
  if (!node) {
    node = { did, firstSeen: now, lastSeen: now, edgeCount: 0 };
    _nodes.set(did, node);
    _bus.emit("node:added", { did, at: now });
  } else {
    node.lastSeen = now;
  }
  return node;
}

function _incEdgeCount(did, delta) {
  const node = _nodes.get(did);
  if (!node) return;
  node.edgeCount = Math.max(0, node.edgeCount + delta);
  if (node.edgeCount === 0 && delta < 0) {
    _nodes.delete(did);
    _bus.emit("node:removed", { did });
  }
}

/* ── Mutations ────────────────────────────────────────────── */

/**
 * Add or update a directed edge. Idempotent — same (source, target,
 * type) triple gets its weight/metadata updated and emits `edge:updated`
 * instead of `edge:added`.
 *
 * @returns {{edge: object, created: boolean}}
 */
export function addEdge(db, sourceDid, targetDid, edgeType, opts = {}) {
  if (!sourceDid || !targetDid) {
    throw new Error("sourceDid and targetDid are required");
  }
  if (sourceDid === targetDid) {
    throw new Error("Self-edges are not allowed");
  }
  _validateEdgeType(edgeType);
  const weight = Number.isFinite(opts.weight) ? opts.weight : 1.0;
  const metadata = opts.metadata ?? null;
  const now = opts.timestamp || new Date().toISOString();

  _touchNode(sourceDid, now);
  _touchNode(targetDid, now);

  const outBucket = _outgoing.get(sourceDid) || new Map();
  const inBucket = _incoming.get(targetDid) || new Map();
  const outKey = _edgeKey(targetDid, edgeType);
  const inKey = _edgeKey(sourceDid, edgeType);

  const existing = outBucket.get(outKey);
  const created = !existing;
  const edge = {
    sourceDid,
    targetDid,
    edgeType,
    weight,
    metadata,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
  outBucket.set(outKey, edge);
  inBucket.set(inKey, edge);
  _outgoing.set(sourceDid, outBucket);
  _incoming.set(targetDid, inBucket);

  if (created) {
    _incEdgeCount(sourceDid, 1);
    _incEdgeCount(targetDid, 1);
  }

  if (db) {
    const stmt = db.prepare(`
      INSERT INTO social_graph_edges (source_did, target_did, edge_type, weight, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_did, target_did, edge_type) DO UPDATE SET
        weight = excluded.weight,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      sourceDid,
      targetDid,
      edgeType,
      weight,
      metadata ? JSON.stringify(metadata) : null,
      edge.createdAt,
      edge.updatedAt,
    );
  }

  _bus.emit(created ? "edge:added" : "edge:updated", { ...edge });
  _bus.emit("change", {
    kind: created ? "edge:added" : "edge:updated",
    edge: { ...edge },
  });

  return { edge: { ...edge }, created };
}

/**
 * Remove an edge. Returns { removed: boolean, edge? }.
 */
export function removeEdge(db, sourceDid, targetDid, edgeType) {
  _validateEdgeType(edgeType);
  const outBucket = _outgoing.get(sourceDid);
  const inBucket = _incoming.get(targetDid);
  if (!outBucket || !inBucket) return { removed: false };

  const outKey = _edgeKey(targetDid, edgeType);
  const edge = outBucket.get(outKey);
  if (!edge) return { removed: false };

  outBucket.delete(outKey);
  inBucket.delete(_edgeKey(sourceDid, edgeType));
  if (outBucket.size === 0) _outgoing.delete(sourceDid);
  if (inBucket.size === 0) _incoming.delete(targetDid);

  _incEdgeCount(sourceDid, -1);
  _incEdgeCount(targetDid, -1);

  if (db) {
    db.prepare(
      `DELETE FROM social_graph_edges
        WHERE source_did = ? AND target_did = ? AND edge_type = ?`,
    ).run(sourceDid, targetDid, edgeType);
  }

  const payload = { ...edge };
  _bus.emit("edge:removed", payload);
  _bus.emit("change", { kind: "edge:removed", edge: payload });

  return { removed: true, edge: payload };
}

/* ── Queries ──────────────────────────────────────────────── */

export function getNode(did) {
  const node = _nodes.get(did);
  return node ? { ...node } : null;
}

/**
 * List outgoing edges from `did`. Optionally filter by `edgeType`.
 */
export function getOutgoing(did, edgeType) {
  const bucket = _outgoing.get(did);
  if (!bucket) return [];
  const out = [];
  for (const edge of bucket.values()) {
    if (edgeType && edge.edgeType !== edgeType) continue;
    out.push({ ...edge });
  }
  return out;
}

/**
 * List incoming edges to `did`. Optionally filter by `edgeType`.
 */
export function getIncoming(did, edgeType) {
  const bucket = _incoming.get(did);
  if (!bucket) return [];
  const out = [];
  for (const edge of bucket.values()) {
    if (edgeType && edge.edgeType !== edgeType) continue;
    out.push({ ...edge });
  }
  return out;
}

/**
 * Union of outgoing + incoming neighbors (returns unique DIDs).
 * Direction filter: "out" | "in" | "both" (default "both").
 */
export function getNeighbors(did, opts = {}) {
  const { direction = "both", edgeType } = opts;
  const result = new Set();
  if (direction === "out" || direction === "both") {
    for (const e of getOutgoing(did, edgeType)) result.add(e.targetDid);
  }
  if (direction === "in" || direction === "both") {
    for (const e of getIncoming(did, edgeType)) result.add(e.sourceDid);
  }
  return [...result];
}

/**
 * Snapshot of the entire graph. Callers should treat this as a
 * point-in-time view; subsequent mutations do not propagate into
 * an already-returned snapshot.
 */
export function getGraphSnapshot(opts = {}) {
  const { edgeType } = opts;
  const nodes = [..._nodes.values()].map((n) => ({ ...n }));
  const edges = [];
  for (const bucket of _outgoing.values()) {
    for (const edge of bucket.values()) {
      if (edgeType && edge.edgeType !== edgeType) continue;
      edges.push({ ...edge });
    }
  }
  return {
    nodes,
    edges,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      types: _countByType(edges),
      generatedAt: new Date().toISOString(),
    },
  };
}

function _countByType(edges) {
  const out = {};
  for (const e of edges) out[e.edgeType] = (out[e.edgeType] || 0) + 1;
  return out;
}

/* ── Persistence ──────────────────────────────────────────── */

/**
 * Load edges from SQLite into memory. Safe to call repeatedly;
 * existing in-memory edges are replaced.
 */
export function loadFromDb(db) {
  if (!db) return 0;
  _outgoing.clear();
  _incoming.clear();
  _nodes.clear();
  const rows = db
    .prepare(
      `SELECT source_did, target_did, edge_type, weight, metadata, created_at, updated_at
         FROM social_graph_edges`,
    )
    .all();
  for (const row of rows) {
    const metadata = row.metadata ? JSON.parse(row.metadata) : null;
    // Hydrate without re-emitting events (bulk load).
    _hydrateEdge({
      sourceDid: row.source_did,
      targetDid: row.target_did,
      edgeType: row.edge_type,
      weight: row.weight,
      metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
  return rows.length;
}

function _hydrateEdge(edge) {
  _touchNode(edge.sourceDid, edge.createdAt);
  _touchNode(edge.targetDid, edge.createdAt);
  const outBucket = _outgoing.get(edge.sourceDid) || new Map();
  const inBucket = _incoming.get(edge.targetDid) || new Map();
  outBucket.set(_edgeKey(edge.targetDid, edge.edgeType), edge);
  inBucket.set(_edgeKey(edge.sourceDid, edge.edgeType), edge);
  _outgoing.set(edge.sourceDid, outBucket);
  _incoming.set(edge.targetDid, inBucket);
  _incEdgeCount(edge.sourceDid, 1);
  _incEdgeCount(edge.targetDid, 1);
}

/* ── Subscription ─────────────────────────────────────────── */

/**
 * Subscribe to graph events. Returns an unsubscribe function.
 *
 * Events emitted:
 *   - "edge:added"    → { sourceDid, targetDid, edgeType, weight, ... }
 *   - "edge:updated"  → (same shape; fired when addEdge upserts)
 *   - "edge:removed"  → { sourceDid, targetDid, edgeType, ... }
 *   - "node:added"    → { did, at }
 *   - "node:removed"  → { did }
 *   - "change"        → { kind, edge }  (union wrapper for NDJSON tails)
 */
export function subscribe(listener, opts = {}) {
  const { events } = opts;
  const names =
    Array.isArray(events) && events.length > 0
      ? events
      : [
          "edge:added",
          "edge:updated",
          "edge:removed",
          "node:added",
          "node:removed",
        ];
  const wrapped = {};
  for (const name of names) {
    wrapped[name] = (payload) => listener({ type: name, payload });
    _bus.on(name, wrapped[name]);
  }
  return function unsubscribe() {
    for (const name of Object.keys(wrapped)) {
      _bus.removeListener(name, wrapped[name]);
    }
  };
}

/**
 * Raw EventEmitter access — mainly for tests and the `change` union
 * event that `subscribe` doesn't forward by default.
 */
export function getEventBus() {
  return _bus;
}

/* ── Reset (for testing) ─────────────────────────────────── */

export function _resetState() {
  _outgoing.clear();
  _incoming.clear();
  _nodes.clear();
  _bus.removeAllListeners();
}
