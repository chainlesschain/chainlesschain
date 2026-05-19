/**
 * LocalVault schema migrations.
 *
 * Each migration is a `{ version, up(db) }` record. Applied in order, idempotent.
 * The current version is recorded in the `_meta` table so re-opening a vault
 * runs only the missing migrations.
 *
 * Design notes:
 *   - Each UnifiedSchema entity type gets its own table. Cross-entity references
 *     (Event.actor → Person.id, Event.topics → Topic.id[]) are *string IDs*,
 *     not FKs — adapters often produce entities out of order (event refs a
 *     person we'll insert next batch), so FKs would force two-pass ingest.
 *   - JSON columns (participants, items, topics, identifiers, content, extra)
 *     keep the schemaless tail intact. SQLite's json_extract enables indexed
 *     queries on common fields without a rigid schema upgrade per adapter.
 *   - source.adapter + source.originalId are extracted to indexed virtual
 *     columns for fast (adapter, originalId) dedup lookups during sync.
 *   - WAL mode is set at vault open, not here, so it survives re-opens.
 */

"use strict";

const INITIAL_DDL = [
  // ── _meta: schema version + vault-level state ───────────────────────────
  `CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  // ── events ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    subtype TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    duration_ms INTEGER,
    actor TEXT,
    participants TEXT,
    place TEXT,
    items TEXT,
    topics TEXT,
    content TEXT NOT NULL,
    source_adapter TEXT NOT NULL,
    source_original_id TEXT,
    source TEXT NOT NULL,
    extra TEXT,
    ingested_at INTEGER NOT NULL,
    confidence REAL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_subtype ON events(subtype)`,
  `CREATE INDEX IF NOT EXISTS idx_events_occurred ON events(occurred_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor)`,
  `CREATE INDEX IF NOT EXISTS idx_events_place ON events(place)`,
  `CREATE INDEX IF NOT EXISTS idx_events_adapter ON events(source_adapter)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_events_source ON events(source_adapter, source_original_id)
    WHERE source_original_id IS NOT NULL`,

  // ── persons ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    subtype TEXT NOT NULL,
    names TEXT NOT NULL,
    identifiers TEXT,
    relation TEXT,
    notes TEXT,
    source_adapter TEXT NOT NULL,
    source_original_id TEXT,
    source TEXT NOT NULL,
    extra TEXT,
    ingested_at INTEGER NOT NULL,
    confidence REAL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_persons_subtype ON persons(subtype)`,
  `CREATE INDEX IF NOT EXISTS idx_persons_adapter ON persons(source_adapter)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_persons_source ON persons(source_adapter, source_original_id)
    WHERE source_original_id IS NOT NULL`,

  // ── places ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    coordinates_lat REAL,
    coordinates_lng REAL,
    address TEXT,
    category TEXT,
    aliases TEXT NOT NULL,
    source_adapter TEXT NOT NULL,
    source_original_id TEXT,
    source TEXT NOT NULL,
    extra TEXT,
    ingested_at INTEGER NOT NULL,
    confidence REAL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_places_name ON places(name)`,
  `CREATE INDEX IF NOT EXISTS idx_places_category ON places(category)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_places_source ON places(source_adapter, source_original_id)
    WHERE source_original_id IS NOT NULL`,

  // ── items ───────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    subtype TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    price_value REAL,
    price_currency TEXT,
    merchant TEXT,
    external_url TEXT,
    thumbnail_local_path TEXT,
    source_adapter TEXT NOT NULL,
    source_original_id TEXT,
    source TEXT NOT NULL,
    extra TEXT,
    ingested_at INTEGER NOT NULL,
    confidence REAL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_items_subtype ON items(subtype)`,
  `CREATE INDEX IF NOT EXISTS idx_items_merchant ON items(merchant)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_items_source ON items(source_adapter, source_original_id)
    WHERE source_original_id IS NOT NULL`,

  // ── topics ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_topic TEXT,
    derived_from_events TEXT,
    source_adapter TEXT NOT NULL,
    source_original_id TEXT,
    source TEXT NOT NULL,
    extra TEXT,
    ingested_at INTEGER NOT NULL,
    confidence REAL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_topics_name ON topics(name)`,
  `CREATE INDEX IF NOT EXISTS idx_topics_parent ON topics(parent_topic)`,

  // ── sync_watermarks ─────────────────────────────────────────────────────
  // Per-adapter (and optional scope) progress markers so re-syncs are incremental.
  // Examples of scope:
  //   email-imap: "<accountId>:INBOX"
  //   wechat:     "<talker-wxid>"
  //   alipay:     "" (single global)
  `CREATE TABLE IF NOT EXISTS sync_watermarks (
    adapter TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT '',
    watermark TEXT,
    last_synced_at INTEGER,
    last_status TEXT,
    last_error TEXT,
    PRIMARY KEY (adapter, scope)
  )`,

  // ── audit_log ───────────────────────────────────────────────────────────
  // Every read of personal data + every adapter sync + every key rotation
  // gets a row here. UI surfaces this for the "data lineage" view promised
  // in the architecture doc §11.1.
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    details TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)`,

  // ── raw_events ──────────────────────────────────────────────────────────
  // Verbatim adapter payload, primary key (adapter, originalId). Lets us
  // re-derive UnifiedSchema rows without re-syncing if normalization logic
  // changes (e.g. parser upgrade).
  `CREATE TABLE IF NOT EXISTS raw_events (
    adapter TEXT NOT NULL,
    original_id TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (adapter, original_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_raw_captured ON raw_events(captured_at)`,
];

// Phase 8 DDL — EntityResolver tables (5 new tables).
// Per docs/design/Personal_Data_Hub_EntityResolver.md §5.1.
const PHASE_8_DDL = [
  // mergeGroups: identifies clusters of Person rows that are the "same"
  // real-world entity. Multiple Person ids in the same group_id ↔ same
  // person. primary_id is the canonical (oldest) row for display.
  `CREATE TABLE IF NOT EXISTS merge_groups (
    id              TEXT PRIMARY KEY,
    primary_id      TEXT NOT NULL,
    member_count    INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    last_updated    INTEGER NOT NULL,
    reviewed_by_user INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS merge_members (
    group_id        TEXT NOT NULL,
    person_id       TEXT NOT NULL,
    joined_at       INTEGER NOT NULL,
    joined_by       TEXT NOT NULL,
    PRIMARY KEY (group_id, person_id),
    FOREIGN KEY (group_id) REFERENCES merge_groups(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_merge_members_person ON merge_members(person_id)`,

  // resolve_decisions: every yes/no verdict the pipeline (or user) has
  // emitted for a pair. Lexicographic ordering on the two ids prevents
  // both (A,B) and (B,A) ever existing.
  `CREATE TABLE IF NOT EXISTS resolve_decisions (
    a_person_id     TEXT NOT NULL,
    b_person_id     TEXT NOT NULL,
    verdict         TEXT NOT NULL,
    confidence      REAL NOT NULL,
    decided_at      INTEGER NOT NULL,
    decided_by      TEXT NOT NULL,
    reason          TEXT,
    PRIMARY KEY (a_person_id, b_person_id)
  )`,

  // resolve_queue: backlog of Person rows pending pipeline processing.
  // Adapter ingest hook enqueues; async worker drains.
  `CREATE TABLE IF NOT EXISTS resolve_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id       TEXT NOT NULL,
    enqueued_at     INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_resolve_queue_status ON resolve_queue(status, enqueued_at)`,

  // review_queue: pairs the pipeline can't decide; user reviews via UI.
  `CREATE TABLE IF NOT EXISTS review_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    a_person_id     TEXT NOT NULL,
    b_person_id     TEXT NOT NULL,
    embed_sim       REAL,
    llm_verdict     TEXT,
    llm_reason      TEXT,
    llm_confidence  REAL,
    enqueued_at     INTEGER NOT NULL,
    reviewed_at     INTEGER,
    user_decision   TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_review_queue_pending ON review_queue(reviewed_at, enqueued_at)`,
];

const MIGRATIONS = [
  {
    version: 1,
    description: "Initial UnifiedSchema tables + sync_watermarks + audit_log + raw_events",
    up(db) {
      for (const sql of INITIAL_DDL) db.exec(sql);
    },
  },
  {
    version: 2,
    description: "Phase 8 EntityResolver — merge_groups + merge_members + resolve_decisions + resolve_queue + review_queue",
    up(db) {
      for (const sql of PHASE_8_DDL) db.exec(sql);
    },
  },
];

const TARGET_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Apply all pending migrations. Reads the current version from `_meta`,
 * runs each subsequent migration in a transaction, then updates `_meta`.
 * Idempotent — calling on an up-to-date vault is a no-op.
 *
 * Throws if a migration fails (caller should treat as fatal — partial vault
 * state is recoverable from raw_events but is the user's call to make).
 */
function applyMigrations(db) {
  // Bootstrap _meta in its own statement — every subsequent migration assumes
  // it exists. Idempotent: CREATE TABLE IF NOT EXISTS.
  db.exec(`CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  const row = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get();
  const current = row ? parseInt(row.value, 10) : 0;

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;

    const runMigration = db.transaction(() => {
      m.up(db);
      const now = Date.now();
      db.prepare(
        `INSERT INTO _meta (key, value, updated_at) VALUES ('schema_version', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(String(m.version), now);
    });

    runMigration();
  }

  return { previous: current, current: TARGET_VERSION };
}

function getSchemaVersion(db) {
  try {
    const row = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get();
    return row ? parseInt(row.value, 10) : 0;
  } catch (_err) {
    return 0;
  }
}

module.exports = {
  MIGRATIONS,
  TARGET_VERSION,
  applyMigrations,
  getSchemaVersion,
};
