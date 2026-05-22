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
const { applyMigrations, getSchemaVersion } = require("./migrations");
const { isValidKeyHex } = require("./key-providers");

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

    const limit = Number.isInteger(q.limit) && q.limit > 0 ? Math.min(q.limit, 10000) : 100;
    const offset = Number.isInteger(q.offset) && q.offset >= 0 ? q.offset : 0;
    params.limit = limit;
    params.offset = offset;

    const sql =
      "SELECT * FROM events" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY occurred_at DESC LIMIT @limit OFFSET @offset";

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

module.exports = { LocalVault, _internal: { loadDriver, formatDriverLoadError } };
