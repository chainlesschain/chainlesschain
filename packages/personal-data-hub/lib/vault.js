/**
 * LocalVault — SQLCipher-encrypted Personal Data Hub storage.
 *
 * Mirrors §7 (Security model) + §4.2 (Hub core tables) of
 * docs/design/Personal_Data_Hub_Architecture.md.
 *
 * Design choices:
 *   - SQLCipher (via better-sqlite3-multiple-ciphers) with AES-256.
 *   - Master key sourced from a pluggable KeyProvider (see key-providers.js).
 *     The vault never sees plaintext storage of the key beyond the in-memory
 *     PRAGMA-key application during open().
 *   - Per-entity tables (not one big JSON blob) so KG ingest + RAG queries
 *     stay fast and SQL-shaped.
 *   - JSON columns for schemaless tails (extra, identifiers, content, etc.).
 *   - All entity writes go through schema validators first — invalid rows
 *     are rejected (don't pollute the vault).
 *   - putBatch is transactional: all-or-nothing per batch. Adapter-level
 *     partial-batch tolerance happens in batch.partitionBatch() before this.
 *   - Key rotation walks the file with PRAGMA rekey; the caller is
 *     responsible for arranging atomic rotation across processes (close
 *     other handles first).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { validate } = require("./schemas");
const { applyMigrations, getSchemaVersion, getFtsMode } = require("./migrations");
const { isValidKeyHex } = require("./key-providers");
const { getCategory, PREFIX_RULES } = require("./categories");

// FTS5 trigram tokenizer requires queries of >= 3 chars to produce any
// trigrams at all (single 2-char input gives zero index keys → empty result).
// Surface this to the caller so the UI can show a hint instead of a confusing
// "no results" state.
const FTS5_MIN_QUERY_LEN = 3;

/**
 * Translate a user-typed FTS5 query into a safe-to-bind string. FTS5 has its
 * own query syntax — bare operators like `OR`, `AND`, `NOT`, `(`, `:`, `*`,
 * double-quotes have meaning. For the browser keyword box we want literal
 * substring search, so wrap the whole input in double quotes (FTS5 phrase
 * mode) after escaping any embedded double quotes.
 */
function _quoteFtsQuery(q) {
  return '"' + String(q).replace(/"/g, '""') + '"';
}

/**
 * Build a (sql, params) fragment matching events for the given category.
 * Uses categories.js PREFIX_RULES as the single source of truth so a new
 * adapter prefix only needs to be added in one place.
 *
 * Returns `{ sql: "(...)", params: { catN: ... } }` or
 * `{ sql: "0=1", params: {} }` when no rule matches (unknown category).
 */
function _categoryToWhere(category, paramPrefix = "cat") {
  if (typeof category !== "string" || category.length === 0) {
    return { sql: null, params: {} };
  }
  const matched = PREFIX_RULES.filter((rule) => rule[1] === category);
  // "other" is a synthetic bucket — nothing in PREFIX_RULES maps to it; an
  // event's category is "other" iff its adapter matches no prefix. Translate
  // that to a NOT-IN-any-prefix condition.
  if (category === "other") {
    const exclude = [];
    const params = {};
    let i = 0;
    for (const [rule] of PREFIX_RULES) {
      const key = `${paramPrefix}${i}`;
      if (rule.endsWith("*")) {
        params[key] = rule.slice(0, -1) + "%";
        exclude.push(`source_adapter NOT LIKE @${key}`);
      } else {
        params[key] = rule;
        exclude.push(`source_adapter != @${key}`);
      }
      i++;
    }
    return { sql: "(" + exclude.join(" AND ") + ")", params };
  }
  if (matched.length === 0) {
    return { sql: "0=1", params: {} };
  }
  const conds = [];
  const params = {};
  let i = 0;
  for (const [rule] of matched) {
    const key = `${paramPrefix}${i}`;
    if (rule.endsWith("*")) {
      params[key] = rule.slice(0, -1) + "%";
      conds.push(`source_adapter LIKE @${key}`);
    } else {
      params[key] = rule;
      conds.push(`source_adapter = @${key}`);
    }
    i++;
  }
  return { sql: "(" + conds.join(" OR ") + ")", params };
}

// Default SQLCipher cipher (matches WCDB / mainstream SQLCipher v4).
const DEFAULT_CIPHER = "sqlcipher";
const DEFAULT_KDF_ITER = 256000;
const DEFAULT_CIPHER_PAGE_SIZE = 4096;

// ─── Helpers ─────────────────────────────────────────────────────────────

function newGroupId() {
  // Lightweight uuid v4-ish for merge_groups.id. Doesn't need crypto
  // strength — uniqueness within one user's vault is enough.
  const r = () => Math.random().toString(16).slice(2, 10);
  return `mg-${r()}${r()}-${Date.now().toString(36)}`;
}

/**
 * Translate a bs3mc load-failure error into an actionable, user-readable
 * message. Detects NODE_MODULE_VERSION mismatch (the single most common
 * failure: Node 23/24/25 has no prebuild — bs3mc upstream only ships for
 * Node LTS ABIs 108/115/127). See memory `node_23_native_dep_trap.md`.
 *
 * Pure function so it can be unit-tested without poisoning require cache.
 *
 * @param {Error|unknown} err Original throw from `require("better-sqlite3-multiple-ciphers")`.
 * @param {string} [nodeVer] process.versions.node (override for tests).
 * @returns {Error} Wrapped Error with `cause` and (when ABI-related) `code: "BS3MC_ABI_MISMATCH"`.
 */
function formatDriverLoadError(err, nodeVer) {
  const originalMsg = err && err.message ? err.message : String(err);
  const runtimeNodeVer = nodeVer || process.versions.node;

  const abiMatch = originalMsg.match(
    /NODE_MODULE_VERSION\s+(\d+)[\s\S]+?requires\s+NODE_MODULE_VERSION\s+(\d+)/,
  );
  if (abiMatch) {
    const compiledAbi = abiMatch[1];
    const runtimeAbi = abiMatch[2];
    const lines = [
      "better-sqlite3-multiple-ciphers ABI mismatch — Node " +
        runtimeNodeVer +
        " has ABI " +
        runtimeAbi +
        " but bs3mc prebuild is ABI " +
        compiledAbi +
        ".",
      "",
      "修法（任选其一）：",
      "  1. 切 Node 22 LTS (推荐) — nvm-windows: `nvm install 22.12.0 && nvm use 22.12.0`",
      "  2. 源码重编 — `npm rebuild better-sqlite3-multiple-ciphers --build-from-source`",
      "     （需要本机有 Visual Studio Build Tools / node-gyp toolchain，慢且不推荐）",
      "",
      "为什么 bs3mc 没 ABI " + runtimeAbi + " prebuild：",
      "  bs3mc 上游只 ship 主流 Node LTS 的 prebuild (ABI 108/115/127)。",
      "  Node 23/24/25 是 Current 系列，上游不给 prebuild。",
      "",
      "项目 engines.node 允许 >=22.12 是为了兼容未来 LTS，但实际推荐 22.x。",
    ];
    const wrapped = new Error(lines.join("\n"));
    wrapped.cause = err;
    wrapped.code = "BS3MC_ABI_MISMATCH";
    return wrapped;
  }

  const wrapped = new Error(
    "Failed to load better-sqlite3-multiple-ciphers. " +
      "Install it as a workspace dep or pin the version in your package. " +
      "Original error: " +
      originalMsg,
  );
  wrapped.cause = err;
  return wrapped;
}

function loadDriver() {
  // Lazy require so consumers that only need schemas don't pay for the
  // native binding load. Errors surface here with a precise message.
  try {
    return require("better-sqlite3-multiple-ciphers");
  } catch (err) {
    throw formatDriverLoadError(err);
  }
}

function escSingleQuote(s) {
  // Used only for PRAGMA values — better-sqlite3 doesn't bind PRAGMA values.
  return String(s).replace(/'/g, "''");
}

function ensureValidId(id, label) {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`${label} must be a non-empty string id`);
  }
}

// ─── LocalVault ──────────────────────────────────────────────────────────

class LocalVault {
  /**
   * @param {object} opts
   * @param {string} opts.path        absolute path to vault file
   * @param {string} opts.key         hex-encoded 32-byte master key
   * @param {string} [opts.cipher]    SQLCipher cipher name (default "sqlcipher")
   * @param {number} [opts.kdfIter]   PBKDF2 iterations (default 256000)
   * @param {number} [opts.pageSize]  cipher page size bytes (default 4096)
   * @param {boolean} [opts.readonly] open read-only (no migrations)
   * @param {boolean} [opts.skipAudit] skip writing the vault.opened audit row (tests)
   */
  constructor(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("LocalVault: opts required");
    }
    if (typeof opts.path !== "string" || opts.path.length === 0) {
      throw new Error("LocalVault: opts.path required");
    }
    if (!isValidKeyHex(opts.key)) {
      throw new Error("LocalVault: opts.key must be 64 hex chars (32 bytes)");
    }
    this.path = opts.path;
    this._key = opts.key;
    this.cipher = opts.cipher || DEFAULT_CIPHER;
    this.kdfIter = opts.kdfIter || DEFAULT_KDF_ITER;
    this.pageSize = opts.pageSize || DEFAULT_CIPHER_PAGE_SIZE;
    this.readonly = !!opts.readonly;
    this._skipAudit = !!opts.skipAudit;
    this.db = null;
  }

  /**
   * Open the vault. Applies PRAGMA key, runs pending migrations, enables WAL.
   * Idempotent — calling on an already-open vault returns the existing handle.
   */
  open() {
    if (this.db) return this.db;

    const Database = loadDriver();
    fs.mkdirSync(path.dirname(this.path), { recursive: true });

    const db = new Database(this.path, this.readonly ? { readonly: true } : {});

    // Cipher config goes BEFORE the key. better-sqlite3-multiple-ciphers
    // supports the sqlcipher dialect family natively.
    db.pragma(`cipher='${escSingleQuote(this.cipher)}'`);
    db.pragma(`kdf_iter=${this.kdfIter | 0}`);
    db.pragma(`cipher_page_size=${this.pageSize | 0}`);
    db.pragma(`key='${escSingleQuote(this._key)}'`);

    // Smoke check — verifies decryption succeeded. A wrong key surfaces here
    // as a SqliteError "file is not a database".
    try {
      db.prepare("SELECT count(*) FROM sqlite_master").get();
    } catch (err) {
      db.close();
      const wrapped = new Error(
        "LocalVault.open: decryption failed (likely wrong key or corrupted file)"
      );
      wrapped.cause = err;
      throw wrapped;
    }

    if (!this.readonly) {
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      applyMigrations(db);
    }

    this.db = db;

    if (!this.readonly && !this._skipAudit) {
      this._auditDirect("vault.opened", this.path, { schemaVersion: getSchemaVersion(db) });
    }

    return db;
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } finally {
        this.db = null;
      }
    }
  }

  /**
   * Close + delete vault file (and its sidecar -wal / -shm).
   * For "擦除所有数据" UX. Doesn't touch the master key in the KeyProvider —
   * that's the caller's job, since key lifecycle policy varies.
   */
  destroy() {
    this.close();
    const candidates = [this.path, this.path + "-wal", this.path + "-shm"];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (_err) {
        // Best-effort. Leftover sidecar files are harmless without the key.
      }
    }
  }

  _requireOpen() {
    if (!this.db) throw new Error("LocalVault: open() the vault first");
    return this.db;
  }

  // ─── Schema-versioned ID dedup ─────────────────────────────────────────

  schemaVersion() {
    return getSchemaVersion(this._requireOpen());
  }

  // ─── Entity put ────────────────────────────────────────────────────────

  /**
   * Insert or replace an Event. Validates first; throws on invalid input
   * (caller should partition before calling — see batch.partitionBatch).
   */
  putEvent(event) {
    const r = validate(event);
    if (!r.valid) {
      throw new Error(
        `LocalVault.putEvent: invalid event ${event && event.id} — ${r.errors.join("; ")}`
      );
    }
    const db = this._requireOpen();
    return db
      .prepare(
        `INSERT INTO events
        (id, subtype, occurred_at, duration_ms, actor, participants, place, items, topics,
         content, source_adapter, source_original_id, source, extra, ingested_at, confidence)
        VALUES (@id, @subtype, @occurredAt, @durationMs, @actor, @participants, @place, @items, @topics,
                @content, @sourceAdapter, @sourceOriginalId, @source, @extra, @ingestedAt, @confidence)
        ON CONFLICT(id) DO UPDATE SET
          subtype = excluded.subtype,
          occurred_at = excluded.occurred_at,
          duration_ms = excluded.duration_ms,
          actor = excluded.actor,
          participants = excluded.participants,
          place = excluded.place,
          items = excluded.items,
          topics = excluded.topics,
          content = excluded.content,
          source_adapter = excluded.source_adapter,
          source_original_id = excluded.source_original_id,
          source = excluded.source,
          extra = excluded.extra,
          ingested_at = excluded.ingested_at,
          confidence = excluded.confidence
        ON CONFLICT(source_adapter, source_original_id)
          WHERE source_original_id IS NOT NULL
          DO UPDATE SET
          subtype = excluded.subtype,
          occurred_at = excluded.occurred_at,
          duration_ms = excluded.duration_ms,
          actor = excluded.actor,
          participants = excluded.participants,
          place = excluded.place,
          items = excluded.items,
          topics = excluded.topics,
          content = excluded.content,
          source = excluded.source,
          extra = excluded.extra,
          ingested_at = excluded.ingested_at,
          confidence = excluded.confidence`
      )
      .run({
        id: event.id,
        subtype: event.subtype,
        occurredAt: event.occurredAt,
        durationMs: event.durationMs ?? null,
        actor: event.actor ?? null,
        participants: event.participants ? JSON.stringify(event.participants) : null,
        place: event.place ?? null,
        items: event.items ? JSON.stringify(event.items) : null,
        topics: event.topics ? JSON.stringify(event.topics) : null,
        content: JSON.stringify(event.content),
        sourceAdapter: event.source.adapter,
        sourceOriginalId: event.source.originalId ?? null,
        source: JSON.stringify(event.source),
        extra: event.extra ? JSON.stringify(event.extra) : null,
        ingestedAt: event.ingestedAt,
        confidence: event.confidence ?? null,
      });
  }

  putPerson(person) {
    const r = validate(person);
    if (!r.valid) {
      throw new Error(
        `LocalVault.putPerson: invalid person ${person && person.id} — ${r.errors.join("; ")}`
      );
    }
    const db = this._requireOpen();
    return db
      .prepare(
        `INSERT INTO persons
        (id, subtype, names, identifiers, relation, notes,
         source_adapter, source_original_id, source, extra, ingested_at, confidence)
        VALUES (@id, @subtype, @names, @identifiers, @relation, @notes,
                @sourceAdapter, @sourceOriginalId, @source, @extra, @ingestedAt, @confidence)
        ON CONFLICT(id) DO UPDATE SET
          subtype = excluded.subtype,
          names = excluded.names,
          identifiers = excluded.identifiers,
          relation = excluded.relation,
          notes = excluded.notes,
          source_adapter = excluded.source_adapter,
          source_original_id = excluded.source_original_id,
          source = excluded.source,
          extra = excluded.extra,
          ingested_at = excluded.ingested_at,
          confidence = excluded.confidence
        ON CONFLICT(source_adapter, source_original_id)
          WHERE source_original_id IS NOT NULL
          DO UPDATE SET
          subtype = excluded.subtype,
          names = excluded.names,
          identifiers = excluded.identifiers,
          relation = excluded.relation,
          notes = excluded.notes,
          source = excluded.source,
          extra = excluded.extra,
          ingested_at = excluded.ingested_at,
          confidence = excluded.confidence`
      )
      .run({
        id: person.id,
        subtype: person.subtype,
        names: JSON.stringify(person.names),
        identifiers: person.identifiers ? JSON.stringify(person.identifiers) : null,
        relation: person.relation ?? null,
        notes: person.notes ?? null,
        sourceAdapter: person.source.adapter,
        sourceOriginalId: person.source.originalId ?? null,
        source: JSON.stringify(person.source),
        extra: person.extra ? JSON.stringify(person.extra) : null,
        ingestedAt: person.ingestedAt,
        confidence: person.confidence ?? null,
      });
  }

  putPlace(place) {
    const r = validate(place);
    if (!r.valid) {
      throw new Error(
        `LocalVault.putPlace: invalid place ${place && place.id} — ${r.errors.join("; ")}`
      );
    }
    const db = this._requireOpen();
    return db
      .prepare(
        `INSERT INTO places
        (id, name, coordinates_lat, coordinates_lng, address, category, aliases,
         source_adapter, source_original_id, source, extra, ingested_at, confidence)
        VALUES (@id, @name, @lat, @lng, @address, @category, @aliases,
                @sourceAdapter, @sourceOriginalId, @source, @extra, @ingestedAt, @confidence)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          coordinates_lat = excluded.coordinates_lat,
          coordinates_lng = excluded.coordinates_lng,
          address = excluded.address,
          category = excluded.category,
          aliases = excluded.aliases,
          source_adapter = excluded.source_adapter,
          source_original_id = excluded.source_original_id,
          source = excluded.source,
          extra = excluded.extra,
          ingested_at = excluded.ingested_at,
          confidence = excluded.confidence
        ON CONFLICT(source_adapter, source_original_id)
          WHERE source_original_id IS NOT NULL
          DO UPDATE SET
          name = excluded.name,
          coordinates_lat = excluded.coordinates_lat,
          coordinates_lng = excluded.coordinates_lng,
          address = excluded.address,
          category = excluded.category,
          aliases = excluded.aliases,
          source = excluded.source,
          extra = excluded.extra,
          ingested_at = excluded.ingested_at,
          confidence = excluded.confidence`
      )
      .run({
        id: place.id,
        name: place.name,
        lat: place.coordinates ? place.coordinates.lat : null,
        lng: place.coordinates ? place.coordinates.lng : null,
        address: place.address ?? null,
        category: place.category ?? null,
        aliases: JSON.stringify(place.aliases),
        sourceAdapter: place.source.adapter,
        sourceOriginalId: place.source.originalId ?? null,
        source: JSON.stringify(place.source),
        extra: place.extra ? JSON.stringify(place.extra) : null,
        ingestedAt: place.ingestedAt,
        confidence: place.confidence ?? null,
      });
  }

  putItem(item) {
    const r = validate(item);
    if (!r.valid) {
      throw new Error(
        `LocalVault.putItem: invalid item ${item && item.id} — ${r.errors.join("; ")}`
      );
    }
    const db = this._requireOpen();
    return db
      .prepare(
        `INSERT INTO items
        (id, subtype, name, category, price_value, price_currency, merchant,
         external_url, thumbnail_local_path,
         source_adapter, source_original_id, source, extra, ingested_at, confidence)
        VALUES (@id, @subtype, @name, @category, @priceValue, @priceCurrency, @merchant,
                @externalUrl, @thumbnailLocalPath,
                @sourceAdapter, @sourceOriginalId, @source, @extra, @ingestedAt, @confidence)
        ON CONFLICT(id) DO UPDATE SET
          subtype = excluded.subtype,
          name = excluded.name,
          category = excluded.category,
          price_value = excluded.price_value,
          price_currency = excluded.price_currency,
          merchant = excluded.merchant,
          external_url = excluded.external_url,
          thumbnail_local_path = excluded.thumbnail_local_path,
          source_adapter = excluded.source_adapter,
          source_original_id = excluded.source_original_id,
          source = excluded.source,
          extra = excluded.extra,
          ingested_at = excluded.ingested_at,
          confidence = excluded.confidence
        ON CONFLICT(source_adapter, source_original_id)
          WHERE source_original_id IS NOT NULL
          DO UPDATE SET
          subtype = excluded.subtype,
          name = excluded.name,
          category = excluded.category,
          price_value = excluded.price_value,
          price_currency = excluded.price_currency,
          merchant = excluded.merchant,
          external_url = excluded.external_url,
          thumbnail_local_path = excluded.thumbnail_local_path,
          source = excluded.source,
          extra = excluded.extra,
          ingested_at = excluded.ingested_at,
          confidence = excluded.confidence`
      )
      .run({
        id: item.id,
        subtype: item.subtype,
        name: item.name,
        category: item.category ?? null,
        priceValue: item.price ? item.price.value : null,
        priceCurrency: item.price ? item.price.currency : null,
        merchant: item.merchant ?? null,
        externalUrl: item.externalUrl ?? null,
        thumbnailLocalPath: item.thumbnailLocalPath ?? null,
        sourceAdapter: item.source.adapter,
        sourceOriginalId: item.source.originalId ?? null,
        source: JSON.stringify(item.source),
        extra: item.extra ? JSON.stringify(item.extra) : null,
        ingestedAt: item.ingestedAt,
        confidence: item.confidence ?? null,
      });
  }

  putTopic(topic) {
    const r = validate(topic);
    if (!r.valid) {
      throw new Error(
        `LocalVault.putTopic: invalid topic ${topic && topic.id} — ${r.errors.join("; ")}`
      );
    }
    const db = this._requireOpen();
    return db
      .prepare(
        `INSERT INTO topics
        (id, name, parent_topic, derived_from_events,
         source_adapter, source_original_id, source, extra, ingested_at, confidence)
        VALUES (@id, @name, @parentTopic, @derivedFromEvents,
                @sourceAdapter, @sourceOriginalId, @source, @extra, @ingestedAt, @confidence)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          parent_topic = excluded.parent_topic,
          derived_from_events = excluded.derived_from_events,
          source_adapter = excluded.source_adapter,
          source_original_id = excluded.source_original_id,
          source = excluded.source,
          extra = excluded.extra,
          ingested_at = excluded.ingested_at,
          confidence = excluded.confidence`
      )
      .run({
        id: topic.id,
        name: topic.name,
        parentTopic: topic.parentTopic ?? null,
        derivedFromEvents: topic.derivedFromEvents ? JSON.stringify(topic.derivedFromEvents) : null,
        sourceAdapter: topic.source.adapter,
        sourceOriginalId: topic.source.originalId ?? null,
        source: JSON.stringify(topic.source),
        extra: topic.extra ? JSON.stringify(topic.extra) : null,
        ingestedAt: topic.ingestedAt,
        confidence: topic.confidence ?? null,
      });
  }

  /**
   * Transactionally insert/update an entire NormalizedBatch.
   * Validates every entity up-front; aborts the whole batch on any failure.
   * Returns counts per entity type.
   */
  putBatch(batch) {
    if (batch == null || typeof batch !== "object") {
      throw new Error("LocalVault.putBatch: batch must be a plain object");
    }
    const db = this._requireOpen();
    const counts = { events: 0, persons: 0, places: 0, items: 0, topics: 0 };

    const tx = db.transaction(() => {
      for (const e of batch.events || []) {
        this.putEvent(e);
        counts.events += 1;
      }
      for (const p of batch.persons || []) {
        this.putPerson(p);
        counts.persons += 1;
      }
      for (const pl of batch.places || []) {
        this.putPlace(pl);
        counts.places += 1;
      }
      for (const i of batch.items || []) {
        this.putItem(i);
        counts.items += 1;
      }
      for (const t of batch.topics || []) {
        this.putTopic(t);
        counts.topics += 1;
      }
    });
    tx();

    return counts;
  }

  /**
   * Append a raw adapter payload to the raw_events archive. Idempotent on
   * (adapter, originalId) — re-ingest replaces the existing row, preserving
   * the original capture timestamp.
   */
  putRawEvent({ adapter, originalId, capturedAt, payload }) {
    if (typeof adapter !== "string" || adapter.length === 0)
      throw new Error("putRawEvent: adapter required");
    if (typeof originalId !== "string" || originalId.length === 0)
      throw new Error("putRawEvent: originalId required");
    if (!Number.isInteger(capturedAt) || capturedAt <= 0)
      throw new Error("putRawEvent: capturedAt must be positive integer ms");

    const db = this._requireOpen();
    const json = typeof payload === "string" ? payload : JSON.stringify(payload);
    return db
      .prepare(
        `INSERT INTO raw_events (adapter, original_id, captured_at, payload)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(adapter, original_id) DO UPDATE SET
           captured_at = excluded.captured_at,
           payload = excluded.payload`
      )
      .run(adapter, originalId, capturedAt, json);
  }

  /**
   * 2026-05-24 — iterate raw_events sequentially for re-derive flow.
   * Returns rows shaped like the original raw payload object the adapter
   * yielded ({ originalId, capturedAt, payload }) so the caller can feed
   * directly into adapter.normalize().
   *
   * @param {object} [opts]
   * @param {string} [opts.adapter]  Filter by adapter name; default = all
   * @param {number} [opts.limit]    Max rows; default = unlimited
   * @param {number} [opts.offset=0] Skip first N rows
   * @returns {Array<{adapter: string, originalId: string, capturedAt: number, payload: object}>}
   */
  queryRawEvents({ adapter, limit, offset = 0 } = {}) {
    const db = this._requireOpen();
    let sql =
      "SELECT adapter, original_id, captured_at, payload FROM raw_events";
    const args = [];
    if (adapter) {
      sql += " WHERE adapter = ?";
      args.push(adapter);
    }
    sql += " ORDER BY adapter, captured_at, original_id";
    if (Number.isInteger(limit) && limit > 0) {
      sql += " LIMIT ? OFFSET ?";
      args.push(limit, Number.isInteger(offset) ? offset : 0);
    } else if (Number.isInteger(offset) && offset > 0) {
      sql += " LIMIT -1 OFFSET ?";
      args.push(offset);
    }
    const rows = db.prepare(sql).all(...args);
    return rows.map((r) => ({
      adapter: r.adapter,
      originalId: r.original_id,
      capturedAt: r.captured_at,
      payload: (() => {
        try {
          return JSON.parse(r.payload);
        } catch (_e) {
          return r.payload; // raw string if not JSON
        }
      })(),
    }));
  }

  // ─── Entity reads ──────────────────────────────────────────────────────

  getEvent(id) {
    ensureValidId(id, "getEvent");
    const row = this._requireOpen().prepare("SELECT * FROM events WHERE id = ?").get(id);
    return row ? this._rowToEvent(row) : null;
  }
  getPerson(id) {
    ensureValidId(id, "getPerson");
    const row = this._requireOpen().prepare("SELECT * FROM persons WHERE id = ?").get(id);
    return row ? this._rowToPerson(row) : null;
  }
  getPlace(id) {
    ensureValidId(id, "getPlace");
    const row = this._requireOpen().prepare("SELECT * FROM places WHERE id = ?").get(id);
    return row ? this._rowToPlace(row) : null;
  }
  getItem(id) {
    ensureValidId(id, "getItem");
    const row = this._requireOpen().prepare("SELECT * FROM items WHERE id = ?").get(id);
    return row ? this._rowToItem(row) : null;
  }
  getTopic(id) {
    ensureValidId(id, "getTopic");
    const row = this._requireOpen().prepare("SELECT * FROM topics WHERE id = ?").get(id);
    return row ? this._rowToTopic(row) : null;
  }

  /**
   * Lookup an entity by (adapter, originalId). Useful for dedup checks
   * before normalizing — adapters do this in their sync loop to skip rows
   * already in the vault.
   */
  findBySource(table, adapter, originalId) {
    if (!["events", "persons", "places", "items", "topics"].includes(table)) {
      throw new Error(`findBySource: unknown table "${table}"`);
    }
    if (typeof adapter !== "string" || typeof originalId !== "string") return null;
    const row = this._requireOpen()
      .prepare(`SELECT * FROM ${table} WHERE source_adapter = ? AND source_original_id = ?`)
      .get(adapter, originalId);
    if (!row) return null;
    switch (table) {
      case "events":
        return this._rowToEvent(row);
      case "persons":
        return this._rowToPerson(row);
      case "places":
        return this._rowToPlace(row);
      case "items":
        return this._rowToItem(row);
      case "topics":
        return this._rowToTopic(row);
    }
    return null;
  }

  /**
   * queryEvents — common filters with sensible defaults. Returns events
   * ordered by occurred_at DESC (newest first) since that's the vast
   * majority of analysis queries ("recent X by Y").
   *
   * @param {object} q
   * @param {string} [q.subtype]
   * @param {number} [q.since]    occurred_at >= since
   * @param {number} [q.until]    occurred_at <= until
   * @param {string} [q.actor]
   * @param {string} [q.adapter]
   * @param {number} [q.limit=100]
   * @param {number} [q.offset=0]
   */
  queryEvents(q = {}) {
    const where = [];
    const params = {};
    if (q.subtype) {
      where.push("subtype = @subtype");
      params.subtype = q.subtype;
    }
    if (Number.isFinite(q.since)) {
      where.push("occurred_at >= @since");
      params.since = q.since;
    }
    if (Number.isFinite(q.until)) {
      where.push("occurred_at <= @until");
      params.until = q.until;
    }
    if (q.actor) {
      where.push("actor = @actor");
      params.actor = q.actor;
    }
    if (q.adapter) {
      where.push("source_adapter = @adapter");
      params.adapter = q.adapter;
    }
    if (Array.isArray(q.excludeExtraKinds) && q.excludeExtraKinds.length > 0) {
      // Exclude inventory-snapshot events (e.g. installed-app / contact-roster
      // facet events) whose extra.kind is in the given list. Those carry a
      // synthetic collection-time occurredAt and would otherwise dominate any
      // time-ordered (occurred_at DESC) query. Rows with no extra.kind are kept.
      const placeholders = q.excludeExtraKinds.map((_v, i) => `@xk${i}`);
      q.excludeExtraKinds.forEach((v, i) => { params[`xk${i}`] = v; });
      where.push(
        "(json_extract(extra, '$.kind') IS NULL OR json_extract(extra, '$.kind') NOT IN (" +
        placeholders.join(", ") + "))",
      );
    }

    const limit = Number.isInteger(q.limit) && q.limit > 0 ? Math.min(q.limit, 10000) : 100;
    const offset = Number.isInteger(q.offset) && q.offset >= 0 ? q.offset : 0;
    params.limit = limit;
    params.offset = offset;

    // order: 'asc' (oldest first — intent=first/最早) else 'desc' (newest first,
    // the default for latest/timeline). Tie-break on id for a stable order.
    const dir = q.order === "asc" ? "ASC" : "DESC";
    const sql =
      "SELECT * FROM events" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      ` ORDER BY occurred_at ${dir}, id ${dir} LIMIT @limit OFFSET @offset`;

    return this._requireOpen()
      .prepare(sql)
      .all(params)
      .map((row) => this._rowToEvent(row));
  }

  /**
   * queryPersons — list person entities (contacts, family, colleagues...).
   * Phase 14.x Path C — needed so AnalysisEngine can answer questions about
   * "how many contacts" / "did I call mom last week" without missing the
   * persons-table half of the world.
   *
   * @param {object} q
   * @param {string} [q.subtype]   e.g. "contact" / "family" / "colleague"
   * @param {string} [q.adapter]   source_adapter filter
   * @param {number} [q.limit=100]
   * @param {number} [q.offset=0]
   */
  queryPersons(q = {}) {
    const where = [];
    const params = {};
    if (q.subtype) {
      where.push("subtype = @subtype");
      params.subtype = q.subtype;
    }
    if (q.adapter) {
      where.push("source_adapter = @adapter");
      params.adapter = q.adapter;
    }
    const limit = Number.isInteger(q.limit) && q.limit > 0 ? Math.min(q.limit, 10000) : 100;
    const offset = Number.isInteger(q.offset) && q.offset >= 0 ? q.offset : 0;
    params.limit = limit;
    params.offset = offset;
    const sql =
      "SELECT * FROM persons" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY ingested_at DESC LIMIT @limit OFFSET @offset";
    return this._requireOpen()
      .prepare(sql)
      .all(params)
      .map((row) => this._rowToPerson(row));
  }

  /**
   * searchPersons — LIKE-based name/identifier/notes search.
   *
   * 2026-05-27 — AnalysisEngine entityFocus="persons" path uses this when the
   * question carries a probable person-name candidate ("妈手机号", "张三的电话").
   * Pre-fix the engine dumped the first N contacts by ingest_at and let the
   * LLM scan — but on small-model (Qwen 0.5B/1.5B, 20-fact budget) and large
   * contact tables (100+), the target person rarely landed in the slice.
   * Searching by LIKE %term% against the JSON-serialized `names` column +
   * `identifiers` (phone numbers) + `notes` + `relation` gives the LLM the
   * matching contact directly, eliminating that miss.
   *
   * No FTS5 schema migration: contact tables are small (typically <2000
   * rows on Android), full LIKE scan stays sub-millisecond. Sticking with
   * LIKE also avoids partial-index drift trap #25.
   *
   * @param {object} q
   * @param {string} q.q          term to match. Falls back to queryPersons when empty.
   * @param {string} [q.subtype]
   * @param {string} [q.adapter]
   * @param {number} [q.limit=100]
   * @param {number} [q.offset=0]
   */
  searchPersons(q = {}) {
    const term = typeof q.q === "string" ? q.q.trim() : "";
    if (term.length === 0) {
      return this.queryPersons(q);
    }
    const where = [];
    const params = {};
    // LIKE-escape % and _ in the user input so a name with literal % won't
    // wildcard. SQLite LIKE ESCAPE clause handles this.
    const escaped = term.replace(/([\\%_])/g, "\\$1");
    params.qPat = "%" + escaped + "%";
    where.push(
      "(" +
        "names LIKE @qPat ESCAPE '\\' OR " +
        "identifiers LIKE @qPat ESCAPE '\\' OR " +
        "notes LIKE @qPat ESCAPE '\\' OR " +
        "relation LIKE @qPat ESCAPE '\\'" +
        ")"
    );
    if (q.subtype) {
      where.push("subtype = @subtype");
      params.subtype = q.subtype;
    }
    if (q.adapter) {
      where.push("source_adapter = @adapter");
      params.adapter = q.adapter;
    }
    const limit = Number.isInteger(q.limit) && q.limit > 0 ? Math.min(q.limit, 10000) : 100;
    const offset = Number.isInteger(q.offset) && q.offset >= 0 ? q.offset : 0;
    params.limit = limit;
    params.offset = offset;
    const sql =
      "SELECT * FROM persons WHERE " + where.join(" AND ") +
      " ORDER BY (confidence IS NULL) ASC, confidence DESC, ingested_at DESC" +
      " LIMIT @limit OFFSET @offset";
    return this._requireOpen()
      .prepare(sql)
      .all(params)
      .map((row) => this._rowToPerson(row));
  }

  /**
   * queryItems — list item entities (installed apps, purchases, media...).
   * Pairs with queryPersons for AnalysisEngine fact gathering.
   *
   * @param {object} q
   * @param {string} [q.subtype]
   * @param {string} [q.adapter]
   * @param {string} [q.category]
   * @param {number} [q.limit=100]
   * @param {number} [q.offset=0]
   */
  queryItems(q = {}) {
    const where = [];
    const params = {};
    if (q.subtype) {
      where.push("subtype = @subtype");
      params.subtype = q.subtype;
    }
    if (q.adapter) {
      where.push("source_adapter = @adapter");
      params.adapter = q.adapter;
    }
    if (q.category) {
      where.push("category = @category");
      params.category = q.category;
    }
    const limit = Number.isInteger(q.limit) && q.limit > 0 ? Math.min(q.limit, 10000) : 100;
    const offset = Number.isInteger(q.offset) && q.offset >= 0 ? q.offset : 0;
    params.limit = limit;
    params.offset = offset;
    const sql =
      "SELECT * FROM items" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY ingested_at DESC LIMIT @limit OFFSET @offset";
    return this._requireOpen()
      .prepare(sql)
      .all(params)
      .map((row) => this._rowToItem(row));
  }

  /**
   * Mode (`'fts5'` or `'like'`) recorded by migration 3. Determines whether
   * searchEvents uses the FTS5 virtual table or falls back to LIKE scans.
   * Cached on first read.
   */
  ftsMode() {
    if (!this._ftsMode) this._ftsMode = getFtsMode(this._requireOpen());
    return this._ftsMode;
  }

  /**
   * Full-text + faceted search over events for the Vault Browser UI.
   *
   * Filters (all optional, ANDed):
   *   q         — keyword string; FTS5 phrase match if length >= 3 (or LIKE
   *               substring match on subtype/content/actor/place/extra in
   *               fallback mode). Shorter queries are ignored as if absent.
   *   adapter   — exact source_adapter
   *   category  — one of categories.CATEGORIES; expands to adapter prefix list
   *   subtype   — exact subtype match
   *   since     — occurred_at >= since (ms epoch)
   *   until     — occurred_at <= until
   *   cursor    — { occurredAt, id } from previous page's last row
   *   limit     — default 50, max 500
   *
   * Pagination is cursor-based on (occurred_at DESC, id DESC) — stable under
   * concurrent inserts (newer events appear only on re-fetch of page 1).
   *
   * Returns `{ rows: Event[], nextCursor: {occurredAt, id} | null, mode: 'fts5'|'like', shortQuery: boolean }`.
   *   - shortQuery=true means the q was non-empty but below FTS5_MIN_QUERY_LEN
   *     and was dropped — UI should hint "请输入至少 3 个字".
   */
  searchEvents(q = {}) {
    const db = this._requireOpen();
    const mode = this.ftsMode();
    const limit = Number.isInteger(q.limit) && q.limit > 0 ? Math.min(q.limit, 500) : 50;

    const where = [];
    const params = { limit: limit + 1 }; // +1 to detect "is there a next page?"

    let shortQuery = false;
    const rawQ = typeof q.q === "string" ? q.q.trim() : "";

    // Keyword filter — FTS5 path uses MATCH on events_fts; LIKE path does
    // OR across the 5 indexed columns. Sub-min-length q in FTS5 mode is
    // dropped silently (and reported back as shortQuery=true).
    let joinFts = false;
    if (rawQ.length > 0) {
      if (mode === "fts5") {
        if (rawQ.length >= FTS5_MIN_QUERY_LEN) {
          joinFts = true;
          params.q = _quoteFtsQuery(rawQ);
          where.push("events_fts MATCH @q");
        } else {
          shortQuery = true;
        }
      } else {
        params.qLike = "%" + rawQ + "%";
        where.push(
          "(subtype LIKE @qLike OR content LIKE @qLike OR actor LIKE @qLike OR place LIKE @qLike OR extra LIKE @qLike)"
        );
      }
    }

    if (q.adapter) {
      where.push("source_adapter = @adapter");
      params.adapter = q.adapter;
    }
    if (q.category) {
      const { sql, params: catParams } = _categoryToWhere(q.category);
      if (sql) {
        where.push(sql);
        Object.assign(params, catParams);
      }
    }
    if (q.subtype) {
      where.push("e.subtype = @subtype");
      params.subtype = q.subtype;
    }
    if (Number.isFinite(q.since)) {
      where.push("occurred_at >= @since");
      params.since = q.since;
    }
    if (Number.isFinite(q.until)) {
      where.push("occurred_at <= @until");
      params.until = q.until;
    }
    // Cursor: rows strictly older than the cursor's (occurred_at, id) tuple.
    // SQLite tuple comparison handles this natively.
    if (q.cursor && Number.isFinite(q.cursor.occurredAt) && typeof q.cursor.id === "string") {
      where.push("(occurred_at, e.id) < (@cursorAt, @cursorId)");
      params.cursorAt = q.cursor.occurredAt;
      params.cursorId = q.cursor.id;
    }

    const sql =
      "SELECT e.* FROM events e" +
      (joinFts ? " JOIN events_fts f ON e.rowid = f.rowid" : "") +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY occurred_at DESC, e.id DESC LIMIT @limit";

    const rowsPlusOne = db.prepare(sql).all(params);
    const hasMore = rowsPlusOne.length > limit;
    const rows = hasMore ? rowsPlusOne.slice(0, limit) : rowsPlusOne;
    const events = rows.map((r) => this._rowToEvent(r));
    const last = rows[rows.length - 1];
    return {
      rows: events,
      nextCursor: hasMore && last ? { occurredAt: last.occurred_at, id: last.id } : null,
      mode,
      shortQuery,
    };
  }

  /**
   * Counts events grouped by category / adapter / subtype, honoring the
   * same q/since/until filters as searchEvents. Powers the sidebar badges
   * + adapter chips ("社交聊天 (123)" / "social-bilibili (45)").
   *
   * Returns `{ byCategory, byAdapter, bySubtype, total, mode, shortQuery }`.
   * Each map is `{ key: count }`. Empty keys are omitted.
   */
  facetCounts(q = {}) {
    const db = this._requireOpen();
    const mode = this.ftsMode();
    const params = {};
    const where = [];

    let shortQuery = false;
    const rawQ = typeof q.q === "string" ? q.q.trim() : "";
    let joinFts = false;
    if (rawQ.length > 0) {
      if (mode === "fts5") {
        if (rawQ.length >= FTS5_MIN_QUERY_LEN) {
          joinFts = true;
          params.q = _quoteFtsQuery(rawQ);
          where.push("events_fts MATCH @q");
        } else {
          shortQuery = true;
        }
      } else {
        params.qLike = "%" + rawQ + "%";
        where.push(
          "(subtype LIKE @qLike OR content LIKE @qLike OR actor LIKE @qLike OR place LIKE @qLike OR extra LIKE @qLike)"
        );
      }
    }
    if (Number.isFinite(q.since)) {
      where.push("occurred_at >= @since");
      params.since = q.since;
    }
    if (Number.isFinite(q.until)) {
      where.push("occurred_at <= @until");
      params.until = q.until;
    }

    const baseFrom =
      "FROM events e" + (joinFts ? " JOIN events_fts f ON e.rowid = f.rowid" : "");
    const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";

    const adapterRows = db
      .prepare(
        `SELECT source_adapter AS k, COUNT(*) AS n ${baseFrom}${whereSql} GROUP BY source_adapter`
      )
      .all(params);
    const subtypeRows = db
      .prepare(`SELECT e.subtype AS k, COUNT(*) AS n ${baseFrom}${whereSql} GROUP BY e.subtype`)
      .all(params);

    const byAdapter = {};
    const byCategory = {};
    let total = 0;
    for (const r of adapterRows) {
      byAdapter[r.k] = r.n;
      const cat = getCategory(r.k);
      byCategory[cat] = (byCategory[cat] || 0) + r.n;
      total += r.n;
    }
    const bySubtype = {};
    for (const r of subtypeRows) bySubtype[r.k] = r.n;

    return { byCategory, byAdapter, bySubtype, total, mode, shortQuery };
  }

  countEvents(q = {}) {
    const where = [];
    const params = {};
    if (q.subtype) {
      where.push("subtype = @subtype");
      params.subtype = q.subtype;
    }
    if (Number.isFinite(q.since)) {
      where.push("occurred_at >= @since");
      params.since = q.since;
    }
    if (Number.isFinite(q.until)) {
      where.push("occurred_at <= @until");
      params.until = q.until;
    }
    if (q.actor) {
      where.push("actor = @actor");
      params.actor = q.actor;
    }
    if (q.adapter) {
      where.push("source_adapter = @adapter");
      params.adapter = q.adapter;
    }
    const sql =
      "SELECT COUNT(*) as n FROM events" + (where.length ? " WHERE " + where.join(" AND ") : "");
    return this._requireOpen().prepare(sql).get(params).n;
  }

  /**
   * Authoritative SUM of amount-bearing events (PDH AnalysisEngine intent=
   * sum-amount Phase 2). Aggregated in SQL so "总共花了多少" answers come from
   * the real total, not a truncated FACTS sample the LLM would undercount.
   *
   * Amount lives in JSON (no dedicated column). Two normalized shapes coexist:
   *   - shopping-* / travel-*: content.amount = { value (major units), currency,
   *     direction }
   *   - finance-alipay:        extra.amountFen (cents) + extra.direction
   * Both are COALESCE'd: value prefers content.amount.value, falls back to
   * extra.amountFen/100; direction/currency likewise. Rows with no extractable
   * amount are excluded (WHERE amt IS NOT NULL) so non-amount events (messages /
   * visits) don't dilute the sum.
   *
   * Filters mirror {@link countEvents} (subtype / since / until / actor /
   * adapter). Returns
   *   { total, currency, count, byDirection: { out, in }, byCurrency: { <cur>: { total, count, byDirection } } }
   * Amounts in major units (yuan), rounded to 2 decimals.
   *
   * Cross-currency sums are meaningless (¥ + $ ≠ a number), so the SUM is
   * grouped per currency. byCurrency holds the full per-currency breakdown;
   * the top-level total / currency / byDirection report the PRIMARY currency
   * (the one with the most events — almost always CNY) so a single-currency
   * vault (the common case) reads exactly as before. count is the total event
   * count across all currencies. Empty → total 0, currency "CNY", byCurrency {}.
   */
  sumEventAmount(q = {}) {
    const where = [];
    const params = {};
    if (q.subtype) {
      where.push("subtype = @subtype");
      params.subtype = q.subtype;
    }
    if (Array.isArray(q.subtypes) && q.subtypes.length > 0) {
      // Multi-subtype filter (e.g. all SPEND_SUBTYPES at once) so callers can
      // aggregate a money figure across payment/transfer/refund/… in one SQL
      // pass instead of summing a row-capped JS loop.
      const names = q.subtypes.filter((s) => typeof s === "string" && s.length > 0);
      if (names.length > 0) {
        const placeholders = names.map((_s, i) => `@subtype_${i}`);
        where.push(`subtype IN (${placeholders.join(", ")})`);
        names.forEach((s, i) => {
          params[`subtype_${i}`] = s;
        });
      }
    }
    if (Number.isFinite(q.since)) {
      where.push("occurred_at >= @since");
      params.since = q.since;
    }
    if (Number.isFinite(q.until)) {
      where.push("occurred_at <= @until");
      params.until = q.until;
    }
    if (q.actor) {
      where.push("actor = @actor");
      params.actor = q.actor;
    }
    if (q.adapter) {
      where.push("source_adapter = @adapter");
      params.adapter = q.adapter;
    }
    const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
    const sql =
      "SELECT dir, cur, SUM(amt) AS s, COUNT(*) AS c FROM (" +
      "SELECT " +
      "COALESCE(json_extract(content,'$.amount.direction'), json_extract(extra,'$.direction')) AS dir, " +
      "COALESCE(json_extract(content,'$.amount.currency'), 'CNY') AS cur, " +
      "CASE " +
      "WHEN json_extract(content,'$.amount.value') IS NOT NULL THEN json_extract(content,'$.amount.value') " +
      "WHEN json_extract(extra,'$.amountFen') IS NOT NULL THEN json_extract(extra,'$.amountFen') / 100.0 " +
      "ELSE NULL END AS amt " +
      "FROM events" +
      whereSql +
      ") WHERE amt IS NOT NULL GROUP BY dir, cur";
    const rows = this._requireOpen().prepare(sql).all(params);

    // Group per currency — cross-currency sums are meaningless.
    const acc = {}; // cur -> { total, count, out, in }
    let totalCount = 0;
    for (const r of rows) {
      const cur = r.cur || "CNY";
      const s = Number(r.s) || 0;
      const c = Number(r.c) || 0;
      totalCount += c;
      const e = acc[cur] || (acc[cur] = { total: 0, count: 0, out: 0, in: 0 });
      e.total += s;
      e.count += c;
      // null / unknown direction → treat as spending (out) so it isn't dropped.
      const d = r.dir === "in" ? "in" : "out";
      e[d] += s;
    }
    const round2 = (n) => Math.round(n * 100) / 100;
    const currencies = Object.keys(acc);
    // Primary currency = most events (stable: first-seen wins a tie via reduce seed).
    const primary =
      currencies.length === 0
        ? "CNY"
        : currencies.reduce((a, b) => (acc[b].count > acc[a].count ? b : a), currencies[0]);
    const byCurrency = {};
    for (const cur of currencies) {
      const e = acc[cur];
      byCurrency[cur] = {
        total: round2(e.total),
        count: e.count,
        byDirection: { out: round2(e.out), in: round2(e.in) },
      };
    }
    const p = acc[primary] || { total: 0, out: 0, in: 0 };
    return {
      total: round2(p.total),
      currency: primary,
      count: totalCount,
      byDirection: { out: round2(p.out), in: round2(p.in) },
      byCurrency,
    };
  }

  /**
   * topSpendingByAdapter — authoritative spending breakdown: SUM of OUTBOUND
   * amounts GROUP BY source_adapter over the full vault, top-N by total. Pairs
   * with intent=amount-rank to answer "我钱主要花在哪 / 哪个平台花最多". Reuses
   * sumEventAmount's amount extraction (content.amount.value | extra.amountFen/100)
   * and direction model — only OUT (spending) is counted, income/refund-in
   * excluded (the overview.spending bug taught us to filter direction). Amounts
   * grouped per currency; the breakdown is in the primary currency (most spend
   * events) since cross-currency sums are meaningless.
   *
   * @param {object} q  subtype/subtypes/since/until/limit
   * @returns {{ by:'adapter', currency:string, total:number, count:number,
   *            adapters: Array<{adapter:string,total:number,count:number}> }}
   */
  topSpendingByAdapter(q = {}) {
    const where = [];
    const params = {};
    if (q.subtype) {
      where.push("subtype = @subtype");
      params.subtype = q.subtype;
    }
    if (Array.isArray(q.subtypes) && q.subtypes.length > 0) {
      const names = q.subtypes.filter((s) => typeof s === "string" && s.length > 0);
      if (names.length > 0) {
        const ph = names.map((_s, i) => `@st_${i}`);
        where.push(`subtype IN (${ph.join(", ")})`);
        names.forEach((s, i) => {
          params[`st_${i}`] = s;
        });
      }
    }
    if (Number.isFinite(q.since)) {
      where.push("occurred_at >= @since");
      params.since = q.since;
    }
    if (Number.isFinite(q.until)) {
      where.push("occurred_at <= @until");
      params.until = q.until;
    }
    const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
    const limit = Number.isInteger(q.limit) && q.limit > 0 ? Math.min(q.limit, 50) : 10;
    const sql =
      "SELECT adapter, cur, SUM(amt) AS s, COUNT(*) AS c FROM (" +
      "SELECT source_adapter AS adapter, " +
      "COALESCE(json_extract(content,'$.amount.direction'), json_extract(extra,'$.direction')) AS dir, " +
      "COALESCE(json_extract(content,'$.amount.currency'), 'CNY') AS cur, " +
      "CASE " +
      "WHEN json_extract(content,'$.amount.value') IS NOT NULL THEN json_extract(content,'$.amount.value') " +
      "WHEN json_extract(extra,'$.amountFen') IS NOT NULL THEN json_extract(extra,'$.amountFen') / 100.0 " +
      "ELSE NULL END AS amt " +
      "FROM events" +
      whereSql +
      ") WHERE amt IS NOT NULL AND COALESCE(dir,'out') != 'in' GROUP BY adapter, cur";
    const rows = this._requireOpen().prepare(sql).all(params);

    // Accumulate per (adapter, currency); pick the primary currency (most spend
    // events) and rank adapters within it.
    const perCur = {}; // cur -> { count, adapters: {adapter -> {total,count}} }
    for (const r of rows) {
      const cur = r.cur || "CNY";
      const s = Number(r.s) || 0;
      const c = Number(r.c) || 0;
      const e = perCur[cur] || (perCur[cur] = { count: 0, adapters: {} });
      e.count += c;
      const a = e.adapters[r.adapter] || (e.adapters[r.adapter] = { total: 0, count: 0 });
      a.total += s;
      a.count += c;
    }
    const curs = Object.keys(perCur);
    if (curs.length === 0) return { by: "adapter", currency: "CNY", total: 0, count: 0, adapters: [] };
    const primary = curs.reduce((a, b) => (perCur[b].count > perCur[a].count ? b : a), curs[0]);
    const round2 = (n) => Math.round(n * 100) / 100;
    const e = perCur[primary];
    const ranked = Object.entries(e.adapters)
      .map(([adapter, v]) => ({ adapter, total: round2(v.total), count: v.count }))
      .sort((x, y) => y.total - x.total || x.adapter.localeCompare(y.adapter));
    // total = grand spending across ALL adapters in the primary currency (so the
    // LLM knows what fraction the returned top-N covers), not just the top-N sum.
    const total = round2(ranked.reduce((s, a) => s + a.total, 0));
    return { by: "adapter", currency: primary, total, count: e.count, adapters: ranked.slice(0, limit) };
  }

  /**
   * topActors — authoritative top-N senders by event count, grouped in SQL over
   * the FULL vault (not the ≤80-fact prompt sample). Pairs with AnalysisEngine
   * intent=rank to answer "谁给我发消息最多 / who contacts me most" precisely,
   * instead of the LLM refusing to rank from a truncated FACTS sample.
   *
   * @param {object} q
   * @param {string}   [q.adapter]       source_adapter exact match
   * @param {string}   [q.subtype]       single subtype filter (e.g. "message")
   * @param {number}   [q.since]         occurred_at >= (unix-ms)
   * @param {number}   [q.until]         occurred_at <= (unix-ms)
   * @param {string[]} [q.excludeActors] actor ids to drop (e.g. the account owner)
   * @param {number}   [q.limit=10]      top-N (clamped to 50)
   * @returns {{ by:'actor', total:number, actors: Array<{actor:string,count:number,name:(string|null)}> }}
   */
  topActors(q = {}) {
    const where = ["actor IS NOT NULL", "actor != ''"];
    const params = {};
    if (q.subtype) {
      where.push("subtype = @subtype");
      params.subtype = q.subtype;
    }
    if (Number.isFinite(q.since)) {
      where.push("occurred_at >= @since");
      params.since = q.since;
    }
    if (Number.isFinite(q.until)) {
      where.push("occurred_at <= @until");
      params.until = q.until;
    }
    if (Array.isArray(q.adapters) && q.adapters.length > 0) {
      // Multi-adapter scope (e.g. QQ = qq-pc + messaging-qq) so "谁发QQ最多"
      // ranks across all of an app's adapters. Takes precedence over single.
      const names = q.adapters.filter((a) => typeof a === "string" && a.length > 0);
      if (names.length > 0) {
        const ph = names.map((_a, i) => `@ad_${i}`);
        where.push(`source_adapter IN (${ph.join(", ")})`);
        names.forEach((a, i) => {
          params[`ad_${i}`] = a;
        });
      }
    } else if (q.adapter) {
      where.push("source_adapter = @adapter");
      params.adapter = q.adapter;
    }
    if (Array.isArray(q.excludeActors) && q.excludeActors.length > 0) {
      const names = q.excludeActors.filter((a) => typeof a === "string" && a.length > 0);
      if (names.length > 0) {
        const ph = names.map((_a, i) => `@ex_${i}`);
        where.push(`actor NOT IN (${ph.join(", ")})`);
        names.forEach((a, i) => {
          params[`ex_${i}`] = a;
        });
      }
    }
    // excludeSelf — drop the account owner's own outbound by the common id
    // convention ("self" / "<adapter>-self") so "谁给我发最多 / who contacts me
    // most" ranks the OTHER party, not the user. Adapters that key self by a raw
    // account id (e.g. QQ uin) won't match this and slip through — the RANK
    // prompt rule tells the LLM to skip a clearly-self entry as a backstop.
    if (q.excludeSelf) {
      where.push("actor != 'self'");
      where.push("actor NOT LIKE '%-self'");
    }
    const limit = Number.isInteger(q.limit) && q.limit > 0 ? Math.min(q.limit, 50) : 10;
    const whereSql = " WHERE " + where.join(" AND ");
    const db = this._requireOpen();

    // Grand total of matching events (so the LLM knows what fraction top-N covers).
    const totalRow = db.prepare("SELECT COUNT(*) AS c FROM events" + whereSql).get(params);
    const total = totalRow ? Number(totalRow.c) || 0 : 0;

    // names is a correlated subquery on the group key (e.actor) — runs once per
    // returned group row (≤limit), not per source event.
    const sql =
      "SELECT e.actor AS actor, COUNT(*) AS count, " +
      "(SELECT names FROM persons WHERE id = e.actor) AS names " +
      "FROM events e" +
      whereSql +
      " GROUP BY e.actor ORDER BY count DESC, e.actor ASC LIMIT @limit";
    const rows = db.prepare(sql).all({ ...params, limit });

    const actors = rows.map((r) => {
      let name = null;
      if (r.names) {
        try {
          const parsed = JSON.parse(r.names);
          if (Array.isArray(parsed)) {
            name = parsed.find((n) => typeof n === "string" && n.trim()) || null;
          } else if (typeof parsed === "string" && parsed.trim()) {
            name = parsed.trim();
          }
        } catch (_e) {
          /* names column not JSON — leave name null */
        }
      }
      return { actor: r.actor, count: Number(r.count) || 0, name };
    });
    return { by: "actor", total, actors };
  }

  /**
   * topTopics — authoritative top-N topics (groups / conversations) by event
   * count, GROUP BY json_each(topics) over the full vault. Pairs with
   * intent=rank dimension="topic" to answer "哪个群最活跃 / which group is most
   * active". Same filter/name-resolution pattern as topActors but grouped on the
   * `topics` JSON array (events with NULL/empty topics drop out naturally; an
   * event with multiple topics counts under each). Topic name resolved from the
   * topics table.
   *
   * @param {object} q  adapter/adapters/subtype/since/until/limit (same as topActors)
   * @returns {{ by:'topic', total:number, topics: Array<{topic:string,count:number,name:(string|null)}> }}
   */
  topTopics(q = {}) {
    const where = ["e.topics IS NOT NULL", "e.topics != '[]'"];
    const params = {};
    if (q.subtype) {
      where.push("e.subtype = @subtype");
      params.subtype = q.subtype;
    }
    if (Number.isFinite(q.since)) {
      where.push("e.occurred_at >= @since");
      params.since = q.since;
    }
    if (Number.isFinite(q.until)) {
      where.push("e.occurred_at <= @until");
      params.until = q.until;
    }
    if (Array.isArray(q.adapters) && q.adapters.length > 0) {
      const names = q.adapters.filter((a) => typeof a === "string" && a.length > 0);
      if (names.length > 0) {
        const ph = names.map((_a, i) => `@ad_${i}`);
        where.push(`e.source_adapter IN (${ph.join(", ")})`);
        names.forEach((a, i) => {
          params[`ad_${i}`] = a;
        });
      }
    } else if (q.adapter) {
      where.push("e.source_adapter = @adapter");
      params.adapter = q.adapter;
    }
    const limit = Number.isInteger(q.limit) && q.limit > 0 ? Math.min(q.limit, 50) : 10;
    const baseFrom = "FROM events e, json_each(e.topics) je WHERE " + where.join(" AND ");
    const db = this._requireOpen();

    const totalRow = db.prepare("SELECT COUNT(*) AS c " + baseFrom).get(params);
    const total = totalRow ? Number(totalRow.c) || 0 : 0;

    const sql =
      "SELECT je.value AS topic, COUNT(*) AS count, " +
      "(SELECT name FROM topics WHERE id = je.value) AS name " +
      baseFrom +
      " GROUP BY je.value ORDER BY count DESC, je.value ASC LIMIT @limit";
    const rows = db.prepare(sql).all({ ...params, limit });
    const topics = rows.map((r) => ({
      topic: r.topic,
      count: Number(r.count) || 0,
      name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : null,
    }));
    return { by: "topic", total, topics };
  }

  /**
   * distinctActorCount — authoritative COUNT(DISTINCT actor) over events. Pairs
   * with intent=distinct-count to answer "我跟多少人聊过 / 认识多少人" with the
   * number of DISTINCT people interacted with, instead of the persons-table
   * total (which counts every ingested contact incl. never-messaged ones).
   *
   * @param {object} q  adapter/adapters/subtype/since/until/excludeSelf (same as topActors)
   * @returns {{ distinct:number, events:number }}  distinct actors + matching event rows
   */
  distinctActorCount(q = {}) {
    const where = ["actor IS NOT NULL", "actor != ''"];
    const params = {};
    if (q.subtype) {
      where.push("subtype = @subtype");
      params.subtype = q.subtype;
    }
    if (Number.isFinite(q.since)) {
      where.push("occurred_at >= @since");
      params.since = q.since;
    }
    if (Number.isFinite(q.until)) {
      where.push("occurred_at <= @until");
      params.until = q.until;
    }
    if (Array.isArray(q.adapters) && q.adapters.length > 0) {
      const names = q.adapters.filter((a) => typeof a === "string" && a.length > 0);
      if (names.length > 0) {
        const ph = names.map((_a, i) => `@ad_${i}`);
        where.push(`source_adapter IN (${ph.join(", ")})`);
        names.forEach((a, i) => {
          params[`ad_${i}`] = a;
        });
      }
    } else if (q.adapter) {
      where.push("source_adapter = @adapter");
      params.adapter = q.adapter;
    }
    if (q.excludeSelf) {
      where.push("actor != 'self'");
      where.push("actor NOT LIKE '%-self'");
    }
    const whereSql = " WHERE " + where.join(" AND ");
    const db = this._requireOpen();
    const row = db
      .prepare("SELECT COUNT(DISTINCT actor) AS d, COUNT(*) AS e FROM events" + whereSql)
      .get(params);
    return {
      distinct: row ? Number(row.d) || 0 : 0,
      events: row ? Number(row.e) || 0 : 0,
    };
  }

  /**
   * eventHistogram — authoritative activity distribution over a time bucket
   * (hour-of-day / weekday / month), GROUP BY strftime over the full vault.
   * Pairs with intent=time-histogram to answer "我几点最活跃 / 哪个月聊得最多 /
   * 星期几最忙". occurred_at is unix-ms; bucketed in LOCAL time (the user's tz).
   * occurred_at < 1 (epoch-0/missing) and inventory snapshots are excluded so
   * they don't distort the shape. hour/weekday buckets are zero-filled for a
   * complete distribution; months return only the months present (chronological).
   *
   * @param {object} q  bucket('hour'|'weekday'|'month')/subtype/since/until/adapter/adapters
   * @returns {{ by:string, total:number, peak:({bucket,label,count}|null),
   *            buckets: Array<{bucket:string,label:string,count:number}> }}
   */
  eventHistogram(q = {}) {
    const bucket = ["hour", "weekday", "month"].includes(q.bucket) ? q.bucket : "hour";
    const expr = {
      hour: "strftime('%H', occurred_at/1000.0, 'unixepoch', 'localtime')",
      weekday: "strftime('%w', occurred_at/1000.0, 'unixepoch', 'localtime')",
      month: "strftime('%Y-%m', occurred_at/1000.0, 'unixepoch', 'localtime')",
    }[bucket];

    const where = ["occurred_at >= 1"];
    const params = {};
    if (q.subtype) {
      where.push("subtype = @subtype");
      params.subtype = q.subtype;
    }
    if (Number.isFinite(q.since)) {
      where.push("occurred_at >= @since");
      params.since = q.since;
    }
    if (Number.isFinite(q.until)) {
      where.push("occurred_at <= @until");
      params.until = q.until;
    }
    if (Array.isArray(q.adapters) && q.adapters.length > 0) {
      const names = q.adapters.filter((a) => typeof a === "string" && a.length > 0);
      if (names.length > 0) {
        const ph = names.map((_a, i) => `@ad_${i}`);
        where.push(`source_adapter IN (${ph.join(", ")})`);
        names.forEach((a, i) => {
          params[`ad_${i}`] = a;
        });
      }
    } else if (q.adapter) {
      where.push("source_adapter = @adapter");
      params.adapter = q.adapter;
    }
    // Exclude inventory snapshots (synthetic collection-time stamps).
    where.push(
      "(json_extract(extra, '$.kind') IS NULL OR json_extract(extra, '$.kind') NOT IN ('app-snapshot', 'contact-snapshot', 'app-usage-profile'))"
    );

    const sql =
      "SELECT " + expr + " AS b, COUNT(*) AS c FROM events WHERE " + where.join(" AND ") + " GROUP BY b";
    const rows = this._requireOpen().prepare(sql).all(params);

    const counts = {};
    let total = 0;
    for (const r of rows) {
      if (r.b == null) continue;
      counts[r.b] = (counts[r.b] || 0) + (Number(r.c) || 0);
      total += Number(r.c) || 0;
    }

    const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    let keys;
    if (bucket === "hour") keys = Array.from({ length: 24 }, (_v, i) => String(i).padStart(2, "0"));
    else if (bucket === "weekday") keys = ["0", "1", "2", "3", "4", "5", "6"];
    else keys = Object.keys(counts).sort(); // months chronological
    const label = (k) =>
      bucket === "hour" ? `${parseInt(k, 10)}点` : bucket === "weekday" ? WEEKDAY_LABELS[parseInt(k, 10)] : k;

    const buckets = keys.map((k) => ({ bucket: k, label: label(k), count: counts[k] || 0 }));
    let peak = null;
    for (const b of buckets) if (b.count > 0 && (!peak || b.count > peak.count)) peak = b;
    return { by: bucket, total, peak, buckets };
  }

  /**
   * latestWithPerson — the most recent events involving a specific person, BOTH
   * directions: events where the person is the `actor` (their inbound) OR appears
   * in `participants` (covers the user's own outbound in a 1-1 chat). Pairs with
   * intent=entity-latest to answer "我上次跟妈妈聊是什么时候". Newest first.
   *
   * @param {object} q  personIds(string[])/since/until/limit
   * @returns {Array<object>} events (newest first), [] when no personIds
   */
  latestWithPerson(q = {}) {
    const ids = (Array.isArray(q.personIds) ? q.personIds : []).filter(
      (s) => typeof s === "string" && s.length > 0
    );
    if (ids.length === 0) return [];
    const ph = ids.map((_x, i) => `@p${i}`);
    const params = {};
    ids.forEach((id, i) => {
      params[`p${i}`] = id;
    });
    const where = [
      `(actor IN (${ph.join(", ")}) OR EXISTS (SELECT 1 FROM json_each(COALESCE(participants, '[]')) je WHERE je.value IN (${ph.join(", ")})))`,
      "occurred_at >= 1",
    ];
    if (Number.isFinite(q.since)) {
      where.push("occurred_at >= @since");
      params.since = q.since;
    }
    if (Number.isFinite(q.until)) {
      where.push("occurred_at <= @until");
      params.until = q.until;
    }
    const limit = Number.isInteger(q.limit) && q.limit > 0 ? Math.min(q.limit, 50) : 3;
    params.limit = limit;
    const sql =
      "SELECT * FROM events WHERE " +
      where.join(" AND ") +
      " ORDER BY occurred_at DESC, id DESC LIMIT @limit";
    return this._requireOpen()
      .prepare(sql)
      .all(params)
      .map((r) => this._rowToEvent(r));
  }

  // ─── Sync watermarks ───────────────────────────────────────────────────

  getWatermark(adapter, scope = "") {
    if (typeof adapter !== "string" || adapter.length === 0) {
      throw new Error("getWatermark: adapter required");
    }
    const row = this._requireOpen()
      .prepare(
        `SELECT adapter, scope, watermark, last_synced_at, last_status, last_error
         FROM sync_watermarks WHERE adapter = ? AND scope = ?`
      )
      .get(adapter, scope);
    return row || null;
  }

  setWatermark(adapter, scope, record) {
    if (typeof adapter !== "string" || adapter.length === 0) {
      throw new Error("setWatermark: adapter required");
    }
    if (!record || typeof record !== "object") {
      throw new Error("setWatermark: record must be a plain object");
    }
    const scopeStr = typeof scope === "string" ? scope : "";
    return this._requireOpen()
      .prepare(
        `INSERT INTO sync_watermarks (adapter, scope, watermark, last_synced_at, last_status, last_error)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(adapter, scope) DO UPDATE SET
           watermark = excluded.watermark,
           last_synced_at = excluded.last_synced_at,
           last_status = excluded.last_status,
           last_error = excluded.last_error`
      )
      .run(
        adapter,
        scopeStr,
        record.watermark != null ? String(record.watermark) : null,
        Number.isInteger(record.lastSyncedAt) ? record.lastSyncedAt : null,
        record.lastStatus != null ? String(record.lastStatus) : null,
        record.lastError != null ? String(record.lastError) : null
      );
  }

  // ─── Audit log ─────────────────────────────────────────────────────────

  audit(action, target, details) {
    return this._auditDirect(action, target, details);
  }

  _auditDirect(action, target, details) {
    if (typeof action !== "string" || action.length === 0) {
      throw new Error("audit: action required");
    }
    return this._requireOpen()
      .prepare(
        "INSERT INTO audit_log (at, action, target, details) VALUES (?, ?, ?, ?)"
      )
      .run(
        Date.now(),
        action,
        target == null ? null : String(target),
        details == null ? null : typeof details === "string" ? details : JSON.stringify(details)
      );
  }

  queryAudit({ since, action, limit = 100 } = {}) {
    const where = [];
    const params = {};
    if (Number.isFinite(since)) {
      where.push("at >= @since");
      params.since = since;
    }
    if (action) {
      where.push("action = @action");
      params.action = action;
    }
    params.limit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 10000) : 100;

    const sql =
      "SELECT * FROM audit_log" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY at DESC LIMIT @limit";
    return this._requireOpen().prepare(sql).all(params);
  }

  // ─── Stats ─────────────────────────────────────────────────────────────

  stats() {
    const db = this._requireOpen();
    const count = (tbl) => db.prepare(`SELECT COUNT(*) as n FROM ${tbl}`).get().n;
    const safeCount = (tbl) => {
      try { return count(tbl); } catch (_e) { return 0; }
    };
    return {
      schemaVersion: getSchemaVersion(db),
      events: count("events"),
      persons: count("persons"),
      places: count("places"),
      items: count("items"),
      topics: count("topics"),
      rawEvents: count("raw_events"),
      auditLog: count("audit_log"),
      watermarks: count("sync_watermarks"),
      // Phase 8 — EntityResolver tables (safeCount because v1 vaults
      // don't have these yet until migrate).
      mergeGroups: safeCount("merge_groups"),
      mergeMembers: safeCount("merge_members"),
      resolveQueue: safeCount("resolve_queue"),
      reviewQueue: safeCount("review_queue"),
      resolveDecisions: safeCount("resolve_decisions"),
    };
  }

  // ─── Phase 8 EntityResolver helpers ───────────────────────────────────

  /**
   * Insert a new pending row into resolve_queue. Idempotent — already-
   * pending rows for the same person are not duplicated. Returns the
   * row id (existing or newly inserted).
   */
  enqueueResolve(personId) {
    if (typeof personId !== "string" || personId.length === 0) {
      throw new Error("enqueueResolve: personId required");
    }
    const db = this._requireOpen();
    const existing = db.prepare(
      "SELECT id FROM resolve_queue WHERE person_id = ? AND status IN ('pending','in-progress')"
    ).get(personId);
    if (existing) return existing.id;
    const info = db.prepare(
      "INSERT INTO resolve_queue (person_id, enqueued_at, status) VALUES (?, ?, 'pending')"
    ).run(personId, Date.now());
    return info.lastInsertRowid;
  }

  /**
   * Pull up to `limit` pending rows + atomically mark them in-progress.
   * Returns [{id, person_id, attempts}, ...].
   */
  claimResolveBatch(limit = 50) {
    const db = this._requireOpen();
    const tx = db.transaction(() => {
      const rows = db.prepare(
        "SELECT id, person_id, attempts FROM resolve_queue WHERE status = 'pending' ORDER BY enqueued_at LIMIT ?"
      ).all(limit);
      if (rows.length === 0) return [];
      const stmt = db.prepare(
        "UPDATE resolve_queue SET status = 'in-progress', attempts = attempts + 1 WHERE id = ?"
      );
      for (const r of rows) stmt.run(r.id);
      return rows;
    });
    return tx();
  }

  /**
   * Mark a resolve_queue row as done (success path).
   */
  completeResolve(queueId) {
    const db = this._requireOpen();
    db.prepare("UPDATE resolve_queue SET status = 'done' WHERE id = ?").run(queueId);
  }

  /**
   * Mark a resolve_queue row as errored (retry-eligible if attempts < 3).
   */
  errorResolve(queueId, errMsg) {
    const db = this._requireOpen();
    // If attempts < 3, leave status 'pending' for retry; else 'error'
    db.prepare(
      `UPDATE resolve_queue
         SET status = CASE WHEN attempts >= 3 THEN 'error' ELSE 'pending' END,
             last_error = ?
       WHERE id = ?`
    ).run(errMsg || "unknown", queueId);
  }

  /**
   * Record a resolve_decisions row. Lex-orders the two ids so each pair
   * is stored only once. Returns inserted-or-updated row.
   */
  recordResolveDecision({ aId, bId, verdict, confidence, decidedBy, reason }) {
    const db = this._requireOpen();
    const [lo, hi] = aId < bId ? [aId, bId] : [bId, aId];
    db.prepare(
      `INSERT INTO resolve_decisions
         (a_person_id, b_person_id, verdict, confidence, decided_at, decided_by, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(a_person_id, b_person_id) DO UPDATE SET
         verdict = excluded.verdict,
         confidence = excluded.confidence,
         decided_at = excluded.decided_at,
         decided_by = excluded.decided_by,
         reason = excluded.reason`
    ).run(lo, hi, verdict, confidence, Date.now(), decidedBy || "rule", reason || null);
  }

  getResolveDecision(aId, bId) {
    const db = this._requireOpen();
    const [lo, hi] = aId < bId ? [aId, bId] : [bId, aId];
    return db.prepare(
      "SELECT * FROM resolve_decisions WHERE a_person_id = ? AND b_person_id = ?"
    ).get(lo, hi);
  }

  /**
   * Merge a pair into a merge_group. If either side already belongs to a
   * group, the other side joins it (and the two groups merge if both
   * already existed). Returns the resulting group_id.
   */
  mergePair({ aId, bId, joinedBy = "rule" }) {
    const db = this._requireOpen();
    const tx = db.transaction(() => {
      const aGroup = db.prepare("SELECT group_id FROM merge_members WHERE person_id = ?").get(aId);
      const bGroup = db.prepare("SELECT group_id FROM merge_members WHERE person_id = ?").get(bId);
      const now = Date.now();

      if (aGroup && bGroup && aGroup.group_id === bGroup.group_id) {
        return aGroup.group_id; // already same group
      }
      if (aGroup && bGroup) {
        // Merge two existing groups → keep aGroup, move bGroup members in
        db.prepare(
          "UPDATE merge_members SET group_id = ? WHERE group_id = ?"
        ).run(aGroup.group_id, bGroup.group_id);
        db.prepare("DELETE FROM merge_groups WHERE id = ?").run(bGroup.group_id);
        db.prepare(
          "UPDATE merge_groups SET member_count = (SELECT COUNT(*) FROM merge_members WHERE group_id = ?), last_updated = ? WHERE id = ?"
        ).run(aGroup.group_id, now, aGroup.group_id);
        return aGroup.group_id;
      }
      if (aGroup) {
        // Add b to a's group
        db.prepare(
          "INSERT INTO merge_members (group_id, person_id, joined_at, joined_by) VALUES (?, ?, ?, ?)"
        ).run(aGroup.group_id, bId, now, joinedBy);
        db.prepare(
          "UPDATE merge_groups SET member_count = member_count + 1, last_updated = ? WHERE id = ?"
        ).run(now, aGroup.group_id);
        return aGroup.group_id;
      }
      if (bGroup) {
        db.prepare(
          "INSERT INTO merge_members (group_id, person_id, joined_at, joined_by) VALUES (?, ?, ?, ?)"
        ).run(bGroup.group_id, aId, now, joinedBy);
        db.prepare(
          "UPDATE merge_groups SET member_count = member_count + 1, last_updated = ? WHERE id = ?"
        ).run(now, bGroup.group_id);
        return bGroup.group_id;
      }
      // Neither in any group — create new
      const groupId = newGroupId();
      db.prepare(
        "INSERT INTO merge_groups (id, primary_id, member_count, created_at, last_updated) VALUES (?, ?, 2, ?, ?)"
      ).run(groupId, aId, now, now);
      const ins = db.prepare(
        "INSERT INTO merge_members (group_id, person_id, joined_at, joined_by) VALUES (?, ?, ?, ?)"
      );
      ins.run(groupId, aId, now, joinedBy);
      ins.run(groupId, bId, now, joinedBy);
      return groupId;
    });
    return tx();
  }

  /**
   * Remove a person from its merge group (unmerge). If only one member
   * remains, the group is deleted entirely.
   */
  unmergePerson(personId) {
    const db = this._requireOpen();
    const tx = db.transaction(() => {
      const row = db.prepare(
        "SELECT group_id FROM merge_members WHERE person_id = ?"
      ).get(personId);
      if (!row) return { ok: false, reason: "not in any group" };
      const groupId = row.group_id;
      db.prepare("DELETE FROM merge_members WHERE person_id = ?").run(personId);
      const remaining = db.prepare(
        "SELECT COUNT(*) as n FROM merge_members WHERE group_id = ?"
      ).get(groupId).n;
      if (remaining < 2) {
        // Group of 1 or 0 — delete the group + remaining member row
        db.prepare("DELETE FROM merge_members WHERE group_id = ?").run(groupId);
        db.prepare("DELETE FROM merge_groups WHERE id = ?").run(groupId);
      } else {
        db.prepare(
          "UPDATE merge_groups SET member_count = ?, last_updated = ? WHERE id = ?"
        ).run(remaining, Date.now(), groupId);
      }
      return { ok: true, groupId, remaining };
    });
    return tx();
  }

  /**
   * Get all person ids in the same merge group as the given person.
   * Returns [personId, ...] including the input (whether or not it's in
   * a group — a "group of 1" is just `[personId]`).
   */
  getMergeGroupMembers(personId) {
    const db = this._requireOpen();
    const groupRow = db.prepare(
      "SELECT group_id FROM merge_members WHERE person_id = ?"
    ).get(personId);
    if (!groupRow) return [personId];
    return db.prepare(
      "SELECT person_id FROM merge_members WHERE group_id = ? ORDER BY joined_at"
    ).all(groupRow.group_id).map((r) => r.person_id);
  }

  /**
   * Insert a row into review_queue when the LLM stage returns "maybe".
   * UI lists these for user one-click decisions.
   */
  enqueueReview({ aId, bId, embedSim, llmVerdict, llmReason, llmConfidence }) {
    const db = this._requireOpen();
    const [lo, hi] = aId < bId ? [aId, bId] : [bId, aId];
    const info = db.prepare(
      `INSERT INTO review_queue
         (a_person_id, b_person_id, embed_sim, llm_verdict, llm_reason, llm_confidence, enqueued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(lo, hi, embedSim || null, llmVerdict || null, llmReason || null, llmConfidence || null, Date.now());
    return info.lastInsertRowid;
  }

  /**
   * List pending review rows (oldest first).
   */
  listReviewQueue({ limit = 50 } = {}) {
    const db = this._requireOpen();
    return db.prepare(
      "SELECT * FROM review_queue WHERE reviewed_at IS NULL ORDER BY enqueued_at ASC LIMIT ?"
    ).all(Math.min(limit, 1000));
  }

  /**
   * Mark a review row as decided by the user.
   */
  recordReviewDecision({ reviewId, decision }) {
    if (!["same", "different", "skip"].includes(decision)) {
      throw new Error(`invalid review decision: ${decision}`);
    }
    const db = this._requireOpen();
    const row = db.prepare("SELECT * FROM review_queue WHERE id = ?").get(reviewId);
    if (!row) throw new Error(`review row ${reviewId} not found`);
    db.prepare(
      "UPDATE review_queue SET reviewed_at = ?, user_decision = ? WHERE id = ?"
    ).run(Date.now(), decision, reviewId);
    return row;
  }

  resolveQueueStats() {
    const db = this._requireOpen();
    const rows = db.prepare(
      "SELECT status, COUNT(*) as n FROM resolve_queue GROUP BY status"
    ).all();
    const out = { pending: 0, "in-progress": 0, done: 0, error: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  // ─── Key rotation ──────────────────────────────────────────────────────

  /**
   * Rotate the master key. Uses SQLCipher's `PRAGMA rekey` which rewrites
   * every page with the new key. Atomic from SQLite's POV; the caller is
   * responsible for arranging that no other process has the vault open
   * during this call.
   *
   * `PRAGMA rekey` is rejected by SQLCipher when journal_mode = WAL (since
   * rekeying needs single-process exclusive page access). We temporarily
   * switch the journal mode to DELETE, rekey, then restore WAL.
   *
   * Audits the rotation event AFTER successful rekey.
   */
  rotateKey(newKeyHex) {
    if (!isValidKeyHex(newKeyHex)) {
      throw new Error("rotateKey: newKeyHex must be 64 hex chars (32 bytes)");
    }
    if (newKeyHex === this._key) {
      throw new Error("rotateKey: new key equals current key — refusing no-op rotation");
    }
    const db = this._requireOpen();

    // Snapshot current journal mode so we can restore. better-sqlite3 returns
    // an array for journal_mode queries (one row per attached DB).
    const beforeRows = db.pragma("journal_mode");
    const before =
      Array.isArray(beforeRows) && beforeRows[0]
        ? beforeRows[0].journal_mode || beforeRows[0]
        : "delete";

    if (String(before).toLowerCase() === "wal") {
      db.pragma("journal_mode = DELETE");
    }

    try {
      db.pragma(`rekey='${escSingleQuote(newKeyHex)}'`);
      this._key = newKeyHex;
    } finally {
      if (String(before).toLowerCase() === "wal") {
        db.pragma("journal_mode = WAL");
      }
    }

    this._auditDirect("vault.key_rotated", this.path, { at: Date.now() });
  }

  // ─── Row → entity helpers ──────────────────────────────────────────────

  _parseJson(s, fallback) {
    if (s == null) return fallback;
    try {
      return JSON.parse(s);
    } catch (_err) {
      return fallback;
    }
  }

  _rowToEvent(row) {
    return {
      id: row.id,
      type: "event",
      subtype: row.subtype,
      occurredAt: row.occurred_at,
      ...(row.duration_ms != null ? { durationMs: row.duration_ms } : {}),
      ...(row.actor != null ? { actor: row.actor } : {}),
      ...(row.participants ? { participants: this._parseJson(row.participants, []) } : {}),
      ...(row.place != null ? { place: row.place } : {}),
      ...(row.items ? { items: this._parseJson(row.items, []) } : {}),
      ...(row.topics ? { topics: this._parseJson(row.topics, []) } : {}),
      content: this._parseJson(row.content, {}),
      source: this._parseJson(row.source, {}),
      ...(row.extra ? { extra: this._parseJson(row.extra, {}) } : {}),
      ingestedAt: row.ingested_at,
      ...(row.confidence != null ? { confidence: row.confidence } : {}),
    };
  }

  _rowToPerson(row) {
    return {
      id: row.id,
      type: "person",
      subtype: row.subtype,
      names: this._parseJson(row.names, []),
      ...(row.identifiers ? { identifiers: this._parseJson(row.identifiers, {}) } : {}),
      ...(row.relation != null ? { relation: row.relation } : {}),
      ...(row.notes != null ? { notes: row.notes } : {}),
      source: this._parseJson(row.source, {}),
      ...(row.extra ? { extra: this._parseJson(row.extra, {}) } : {}),
      ingestedAt: row.ingested_at,
      ...(row.confidence != null ? { confidence: row.confidence } : {}),
    };
  }

  _rowToPlace(row) {
    return {
      id: row.id,
      type: "place",
      name: row.name,
      ...(row.coordinates_lat != null && row.coordinates_lng != null
        ? { coordinates: { lat: row.coordinates_lat, lng: row.coordinates_lng } }
        : {}),
      ...(row.address != null ? { address: row.address } : {}),
      ...(row.category != null ? { category: row.category } : {}),
      aliases: this._parseJson(row.aliases, []),
      source: this._parseJson(row.source, {}),
      ...(row.extra ? { extra: this._parseJson(row.extra, {}) } : {}),
      ingestedAt: row.ingested_at,
      ...(row.confidence != null ? { confidence: row.confidence } : {}),
    };
  }

  _rowToItem(row) {
    return {
      id: row.id,
      type: "item",
      subtype: row.subtype,
      name: row.name,
      ...(row.category != null ? { category: row.category } : {}),
      ...(row.price_value != null && row.price_currency != null
        ? { price: { value: row.price_value, currency: row.price_currency } }
        : {}),
      ...(row.merchant != null ? { merchant: row.merchant } : {}),
      ...(row.external_url != null ? { externalUrl: row.external_url } : {}),
      ...(row.thumbnail_local_path != null
        ? { thumbnailLocalPath: row.thumbnail_local_path }
        : {}),
      source: this._parseJson(row.source, {}),
      ...(row.extra ? { extra: this._parseJson(row.extra, {}) } : {}),
      ingestedAt: row.ingested_at,
      ...(row.confidence != null ? { confidence: row.confidence } : {}),
    };
  }

  _rowToTopic(row) {
    return {
      id: row.id,
      type: "topic",
      name: row.name,
      ...(row.parent_topic != null ? { parentTopic: row.parent_topic } : {}),
      ...(row.derived_from_events
        ? { derivedFromEvents: this._parseJson(row.derived_from_events, []) }
        : {}),
      source: this._parseJson(row.source, {}),
      ...(row.extra ? { extra: this._parseJson(row.extra, {}) } : {}),
      ingestedAt: row.ingested_at,
      ...(row.confidence != null ? { confidence: row.confidence } : {}),
    };
  }
}

module.exports = {
  LocalVault,
  _internal: { loadDriver, formatDriverLoadError },
  // Pure-JS helpers exported for unit testing without the native bs3mc
  // binding (search SQL builders, category WHERE translator, FTS5 escape).
  _searchHelpers: { _categoryToWhere, _quoteFtsQuery, FTS5_MIN_QUERY_LEN },
};
