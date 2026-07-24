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
    source_scope TEXT NOT NULL DEFAULT '',
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
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_events_source ON events(source_adapter, source_scope, source_original_id)
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
    source_scope TEXT NOT NULL DEFAULT '',
    source_original_id TEXT,
    source TEXT NOT NULL,
    extra TEXT,
    ingested_at INTEGER NOT NULL,
    confidence REAL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_persons_subtype ON persons(subtype)`,
  `CREATE INDEX IF NOT EXISTS idx_persons_adapter ON persons(source_adapter)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_persons_source ON persons(source_adapter, source_scope, source_original_id)
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
    source_scope TEXT NOT NULL DEFAULT '',
    source_original_id TEXT,
    source TEXT NOT NULL,
    extra TEXT,
    ingested_at INTEGER NOT NULL,
    confidence REAL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_places_name ON places(name)`,
  `CREATE INDEX IF NOT EXISTS idx_places_category ON places(category)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_places_source ON places(source_adapter, source_scope, source_original_id)
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
    source_scope TEXT NOT NULL DEFAULT '',
    source_original_id TEXT,
    source TEXT NOT NULL,
    extra TEXT,
    ingested_at INTEGER NOT NULL,
    confidence REAL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_items_subtype ON items(subtype)`,
  `CREATE INDEX IF NOT EXISTS idx_items_merchant ON items(merchant)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_items_source ON items(source_adapter, source_scope, source_original_id)
    WHERE source_original_id IS NOT NULL`,

  // ── topics ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_topic TEXT,
    derived_from_events TEXT,
    source_adapter TEXT NOT NULL,
    source_scope TEXT NOT NULL DEFAULT '',
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
  // Verbatim adapter payload, primary key (adapter, scope, originalId). Lets us
  // re-derive UnifiedSchema rows without re-syncing if normalization logic
  // changes (e.g. parser upgrade).
  `CREATE TABLE IF NOT EXISTS raw_events (
    adapter TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT '',
    original_id TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (adapter, scope, original_id)
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

// Phase 16 DDL — FTS5 full-text index over events for the Vault Browser UI.
//
// Uses FTS5 in **external-content** mode (content='events', content_rowid='rowid')
// so the events table remains the single source of truth — events_fts only
// stores the inverted index, kept in sync by 3 triggers.
//
// Tokenizer is `trigram` (SQLite ≥3.34) which gives substring matching for
// CJK (中文) — unicode61 (the FTS5 default) splits only on whitespace and
// is unusable for Chinese. Trigram min query length is 3 chars (1-2 char
// queries match nothing); the UI surfaces a hint.
//
// If FTS5 or the trigram tokenizer is unavailable in the local SQLite build
// (rare with bs3mc which bundles SQLCipher 4 / SQLite 3.42+, but possible
// in custom builds), the probe sets `_meta.fts_mode = 'like'` and the
// migration skips the virtual table + triggers. vault.searchEvents falls
// back to LIKE-mode (slower, no ranking, ASCII-only correct).
//
// Backfill runs inline inside the migration transaction; on multi-100k-row
// vaults this can take ~5-15 seconds (one-time cost on upgrade).
function _hasFts5Trigram(db) {
  // Probe by trying to create a temp virtual table. We can't rely on
  // pragma_compile_options because (a) some bs3mc builds don't surface
  // ENABLE_FTS5 there, and (b) trigram is a tokenizer registration, not
  // a compile option. The CREATE is the ground truth.
  try {
    db.exec(
      "CREATE VIRTUAL TABLE temp._fts_probe USING fts5(x, tokenize='trigram')",
    );
    db.exec("DROP TABLE temp._fts_probe");
    return true;
  } catch (_err) {
    return false;
  }
}

const PHASE_16_FTS_DDL = {
  // External-content FTS5: no row data copy, just the inverted index.
  // Columns mirror what's worth searching in events:
  //   content_text  — the JSON payload, searched as-is (JSON braces tokenize
  //                   harmlessly with trigram; query "{key" never matches
  //                   anything users type)
  //   extra_text    — extra JSON tail (also worth searching: order numbers,
  //                   merchant names, message bodies live here for many
  //                   adapters)
  //   subtype/actor/place — short flat strings, indexed for keyword filter
  createVirtualTable: `
    CREATE VIRTUAL TABLE events_fts USING fts5(
      subtype, content_text, actor, place, extra_text,
      content='events',
      content_rowid='rowid',
      tokenize='trigram'
    )
  `,
  // After INSERT — index the new row.
  triggerAi: `
    CREATE TRIGGER events_ai AFTER INSERT ON events BEGIN
      INSERT INTO events_fts(rowid, subtype, content_text, actor, place, extra_text)
      VALUES (new.rowid, new.subtype, new.content, new.actor, new.place, new.extra);
    END
  `,
  // After DELETE — remove from index. external-content delete uses the
  // sentinel ('delete', rowid, ...all-cols) pattern.
  triggerAd: `
    CREATE TRIGGER events_ad AFTER DELETE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, subtype, content_text, actor, place, extra_text)
      VALUES('delete', old.rowid, old.subtype, old.content, old.actor, old.place, old.extra);
    END
  `,
  // After UPDATE — delete-then-insert (FTS5 external-content idiom).
  triggerAu: `
    CREATE TRIGGER events_au AFTER UPDATE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, subtype, content_text, actor, place, extra_text)
      VALUES('delete', old.rowid, old.subtype, old.content, old.actor, old.place, old.extra);
      INSERT INTO events_fts(rowid, subtype, content_text, actor, place, extra_text)
      VALUES (new.rowid, new.subtype, new.content, new.actor, new.place, new.extra);
    END
  `,
  // One-shot backfill of all existing rows.
  backfill: `
    INSERT INTO events_fts(rowid, subtype, content_text, actor, place, extra_text)
    SELECT rowid, subtype, content, actor, place, extra FROM events
  `,
};

const MIGRATIONS = [
  {
    version: 1,
    description:
      "Initial UnifiedSchema tables + sync_watermarks + audit_log + raw_events",
    up(db) {
      for (const sql of INITIAL_DDL) db.exec(sql);
    },
  },
  {
    version: 2,
    description:
      "Phase 8 EntityResolver — merge_groups + merge_members + resolve_decisions + resolve_queue + review_queue",
    up(db) {
      for (const sql of PHASE_8_DDL) db.exec(sql);
    },
  },
  {
    version: 3,
    description:
      "Phase 16 Vault Browser — events_fts FTS5 (trigram) virtual table + 3 sync triggers + backfill; LIKE fallback when FTS5 unavailable",
    up(db) {
      const supported = _hasFts5Trigram(db);
      // Record the mode in _meta so the runtime can pick the right query path
      // without re-probing every open. Set BEFORE creating tables so partial
      // failures still leave a queryable mode marker.
      const now = Date.now();
      db.prepare(
        `INSERT INTO _meta (key, value, updated_at) VALUES ('fts_mode', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(supported ? "fts5" : "like", now);
      if (!supported) return;

      db.exec(PHASE_16_FTS_DDL.createVirtualTable);
      db.exec(PHASE_16_FTS_DDL.triggerAi);
      db.exec(PHASE_16_FTS_DDL.triggerAd);
      db.exec(PHASE_16_FTS_DDL.triggerAu);
      db.exec(PHASE_16_FTS_DDL.backfill);
    },
  },
  {
    version: 4,
    description:
      "Recreate uniq_{events,persons,places,items}_source as partial indices " +
      "(WHERE source_original_id IS NOT NULL) to match putEvent/putPerson/etc " +
      "UPSERT ON CONFLICT WHERE clauses. Older vaults (pre commit 44c4188a8) " +
      "may have full unique indices created via CREATE UNIQUE INDEX IF NOT " +
      "EXISTS without the WHERE clause; the IF-NOT-EXISTS hides the schema " +
      "drift forever, manifesting only as runtime SQLite error '2nd ON CONFLICT " +
      "clause does not match any PRIMARY KEY or UNIQUE constraint'. Symptom on " +
      "Android: adapter.sync fails silently, vault events table stays at 1 row " +
      "while raw_events accumulates 1000+. Idempotent on already-correct vaults.",
    up(db) {
      const tables = ["events", "persons", "places", "items"];
      for (const t of tables) {
        db.exec(`DROP INDEX IF EXISTS uniq_${t}_source`);
        db.exec(
          `CREATE UNIQUE INDEX uniq_${t}_source ON ${t}(source_adapter, source_original_id) ` +
            `WHERE source_original_id IS NOT NULL`,
        );
      }
    },
  },
  {
    version: 5,
    description:
      "Scope raw archives and normalized source dedup by account so identical " +
      "business IDs from different accounts cannot overwrite each other.",
    up(db) {
      const entityTables = ["events", "persons", "places", "items", "topics"];
      for (const table of entityTables) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all();
        if (!columns.some((column) => column.name === "source_scope")) {
          db.exec(
            `ALTER TABLE ${table} ADD COLUMN source_scope TEXT NOT NULL DEFAULT ''`,
          );
        }
      }

      for (const table of ["events", "persons", "places", "items"]) {
        db.exec(`DROP INDEX IF EXISTS uniq_${table}_source`);
        db.exec(
          `CREATE UNIQUE INDEX uniq_${table}_source ` +
            `ON ${table}(source_adapter, source_scope, source_original_id) ` +
            `WHERE source_original_id IS NOT NULL`,
        );
      }

      const rawColumns = db.prepare("PRAGMA table_info(raw_events)").all();
      if (!rawColumns.some((column) => column.name === "scope")) {
        db.exec("ALTER TABLE raw_events RENAME TO raw_events_pre_scope");
        db.exec(`
          CREATE TABLE raw_events (
            adapter TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT '',
            original_id TEXT NOT NULL,
            captured_at INTEGER NOT NULL,
            payload TEXT NOT NULL,
            PRIMARY KEY (adapter, scope, original_id)
          )
        `);
        db.exec(`
          INSERT INTO raw_events (adapter, scope, original_id, captured_at, payload)
          SELECT adapter, '', original_id, captured_at, payload
          FROM raw_events_pre_scope
        `);
        db.exec("DROP TABLE raw_events_pre_scope");
      }
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_raw_captured ON raw_events(captured_at)",
      );
    },
  },
  {
    version: 6,
    description:
      "Persist adaptive page budgets for bounded collectors so an incomplete " +
      "scan can continue deeper after process restart without advancing its " +
      "durable source watermark.",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_scan_state (
          adapter        TEXT NOT NULL,
          scope          TEXT NOT NULL DEFAULT '',
          page_budget    INTEGER NOT NULL CHECK (page_budget > 0),
          deferred_count INTEGER NOT NULL DEFAULT 0 CHECK (deferred_count >= 0),
          updated_at     INTEGER NOT NULL,
          PRIMARY KEY (adapter, scope)
        )
      `);
    },
  },
  {
    version: 7,
    description:
      "Persist per-adapter sync rate-limit windows so process restarts cannot " +
      "bypass declared per-minute, per-day, or minimum-interval limits.",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_rate_limit_state (
          adapter                  TEXT NOT NULL,
          scope                    TEXT NOT NULL DEFAULT '',
          minute_window_started_at INTEGER NOT NULL,
          minute_count             INTEGER NOT NULL DEFAULT 0
                                     CHECK (minute_count >= 0),
          day_window_started_at    INTEGER NOT NULL,
          day_count                INTEGER NOT NULL DEFAULT 0
                                     CHECK (day_count >= 0),
          last_acquired_at         INTEGER,
          updated_at               INTEGER NOT NULL,
          PRIMARY KEY (adapter, scope)
        )
      `);
    },
  },
  {
    version: 8,
    description:
      "Persist source-request rate-limit windows separately from sync trigger " +
      "limits so paginated collectors cannot burst or bypass quotas after a " +
      "process restart.",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS source_request_rate_limit_state (
          adapter                  TEXT NOT NULL,
          scope                    TEXT NOT NULL DEFAULT '',
          minute_window_started_at INTEGER NOT NULL,
          minute_count             INTEGER NOT NULL DEFAULT 0
                                     CHECK (minute_count >= 0),
          day_window_started_at    INTEGER NOT NULL,
          day_count                INTEGER NOT NULL DEFAULT 0
                                     CHECK (day_count >= 0),
          last_acquired_at         INTEGER,
          updated_at               INTEGER NOT NULL,
          PRIMARY KEY (adapter, scope)
        )
      `);
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

  const row = db
    .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
    .get();
  const current = row ? parseInt(row.value, 10) : 0;

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;

    const runMigration = db.transaction(() => {
      m.up(db);
      const now = Date.now();
      db.prepare(
        `INSERT INTO _meta (key, value, updated_at) VALUES ('schema_version', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(String(m.version), now);
    });

    runMigration();
  }

  return { previous: current, current: TARGET_VERSION };
}

function getSchemaVersion(db) {
  try {
    const row = db
      .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
      .get();
    return row ? parseInt(row.value, 10) : 0;
  } catch (_err) {
    return 0;
  }
}

/**
 * Returns 'fts5' or 'like' depending on what migration 3 recorded.
 * Pre-migration-3 vaults return 'like' as the safe default.
 */
function getFtsMode(db) {
  try {
    const row = db
      .prepare("SELECT value FROM _meta WHERE key = 'fts_mode'")
      .get();
    return row && (row.value === "fts5" || row.value === "like")
      ? row.value
      : "like";
  } catch (_err) {
    return "like";
  }
}

module.exports = {
  MIGRATIONS,
  TARGET_VERSION,
  applyMigrations,
  getSchemaVersion,
  getFtsMode,
  // Exported for tests + driver capability checks at vault open time.
  _hasFts5Trigram,
};
