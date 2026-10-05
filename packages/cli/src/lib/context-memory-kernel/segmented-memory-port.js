import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  canonicalDigest,
  cloneCanonical,
  normalizeMemoryRecord,
} from "@chainlesschain/context-memory-kernel";
import {
  DurableJsonMemoryPort,
  STORE_SCHEMA,
  corruptStore,
  normalizeState,
  readBoundedState,
  stateDigest,
  syncDirectory,
} from "./durable-memory-port.js";
import {
  compareMemoryRows,
  compileQueryIndex,
  decodeListCursor,
  encodeListCursor,
  encodeQueryIndex,
  listCursorBinding,
  matchesListQuery,
  mergeQueryRows,
  normalizeListQuery,
  pageLimit,
  queryDigest,
  selectQueryRows,
} from "./memory-query-index.js";

export const SEGMENTED_STORE_SCHEMA =
  "chainlesschain.cli-context-memory-store/v2";
export const DEFAULT_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_SEGMENTED_MAX_EVENTS = 1_000_000;
const MANIFEST_LIMIT = 256 * 1024;
const HEX = /^sha256:[a-f0-9]{64}$/u;
const BUCKET = /^[a-f0-9]{2}$/u;

function bucketOf(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 2);
}
function own(object, key) {
  return Object.hasOwn(object, key) ? object[key] : null;
}
function put(object, key, value) {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}
function limit(reason) {
  return Object.assign(
    new Error(`Context/Memory store limit reached: ${reason}`),
    { code: "CONTEXT_MEMORY_STORE_LIMIT" },
  );
}
function manifestDigest(value) {
  const copy = { ...value };
  delete copy.digest;
  return canonicalDigest(copy, SEGMENTED_STORE_SCHEMA);
}
function blankShard() {
  return {
    schema: STORE_SCHEMA,
    schemaVersion: 1,
    storeRevision: 0,
    records: {},
    events: [],
    reconciliations: {},
  };
}
function blankManifest() {
  return {
    schema: SEGMENTED_STORE_SCHEMA,
    schemaVersion: 2,
    storeRevision: 0,
    shards: {},
    totalBytes: 0,
    eventCount: 0,
    recordCount: 0,
  };
}
function regular(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw corruptStore(file, "authority must be an unlinked regular file");
  }
}
function directories(directory) {
  let current = resolve(directory);
  while (true) {
    const stat = lstatSync(current);
    // macOS exposes its system temporary tree through the root-owned /var
    // alias. This exact OS alias is not a user-controlled authority redirect.
    const systemAlias =
      process.platform === "darwin" &&
      ["/var", "/tmp"].includes(current) &&
      stat.isSymbolicLink() &&
      stat.uid === 0 &&
      realpathSync(current) === `/private${current}`;
    if (!systemAlias && (!stat.isDirectory() || stat.isSymbolicLink()))
      throw corruptStore(current, "authority directory is unsafe");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function identity(directory) {
  const stat = lstatSync(directory);
  return `${stat.dev}:${stat.ino}`;
}
function existsSync(file) {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function ensureSafeDirectory(directory) {
  let existing = resolve(directory);
  while (!existsSync(existing)) existing = dirname(existing);
  directories(existing);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  directories(directory);
}

/**
 * 256 immutable hash buckets, committed by one atomic manifest replacement.
 * The inherited lock is on the original authority path, including during v1
 * migration. A v1-only client therefore rejects v2 instead of writing a second
 * authority. Audit events are retained, not truncated to buy record capacity.
 */
export class SegmentedMemoryPort extends DurableJsonMemoryPort {
  constructor({
    maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
    maxEvents = DEFAULT_SEGMENTED_MAX_EVENTS,
    readOnly = false,
    ...options
  } = {}) {
    super({ ...options, maxEvents });
    if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1)
      throw new TypeError("maxTotalBytes must be a positive safe integer");
    this.maxTotalBytes = maxTotalBytes;
    this.readOnly = Boolean(readOnly);
    this.filePath = resolve(this.filePath);
    this.shardDirectory = `${this.filePath}.shards`;
    this._queryIndexes = new Map();
  }

  _locked(operation) {
    ensureSafeDirectory(dirname(this.filePath));
    directories(dirname(this.filePath));
    return super._locked(() => {
      directories(dirname(this.filePath));
      this._parentIdentity = identity(dirname(this.filePath));
      this._shardIdentity = existsSync(this.shardDirectory)
        ? identity(this.shardDirectory)
        : null;
      if (existsSync(this.filePath)) regular(this.filePath);
      return operation();
    });
  }

  _checkDirectories() {
    directories(dirname(this.filePath));
    directories(this.shardDirectory);
    if (
      identity(dirname(this.filePath)) !== this._parentIdentity ||
      (this._shardIdentity !== null &&
        identity(this.shardDirectory) !== this._shardIdentity)
    ) {
      throw corruptStore(
        this.filePath,
        "authority directory was replaced during an operation",
      );
    }
    this._shardIdentity = identity(this.shardDirectory);
    if (
      process.platform !== "win32" &&
      lstatSync(this.shardDirectory).mode & 0o077
    )
      throw corruptStore(
        this.shardDirectory,
        "shard directory must be private",
      );
  }

  _shardPath(bucket, descriptor) {
    return join(
      this.shardDirectory,
      `${bucket}-${descriptor.digest.slice(7)}.json`,
    );
  }

  _queryIndexPath(bucket, descriptor) {
    return join(
      this.shardDirectory,
      `query-${bucket}-${descriptor.queryDigest.slice(7)}.json`,
    );
  }

  _validateManifest(input) {
    const invalid = () => {
      throw corruptStore(this.filePath, "segmented manifest is invalid");
    };
    if (
      !input ||
      input.schema !== SEGMENTED_STORE_SCHEMA ||
      input.schemaVersion !== 2 ||
      !Number.isSafeInteger(input.storeRevision) ||
      input.storeRevision < 0 ||
      !input.shards ||
      Array.isArray(input.shards) ||
      typeof input.shards !== "object" ||
      Object.keys(input).sort().join() !==
        "digest,eventCount,recordCount,schema,schemaVersion,shards,storeRevision,totalBytes" ||
      input.digest !== manifestDigest(input)
    )
      invalid();
    let bytes = 0;
    let events = 0;
    let records = 0;
    for (const [bucket, entry] of Object.entries(input.shards)) {
      if (
        !BUCKET.test(bucket) ||
        !entry ||
        ![
          "bytes,digest,eventCount,recordCount",
          "bytes,digest,eventCount,queryBytes,queryDigest,recordCount",
        ].includes(Object.keys(entry).sort().join()) ||
        !HEX.test(entry.digest)
      )
        invalid();
      for (const key of ["bytes", "eventCount", "recordCount"])
        if (!Number.isSafeInteger(entry[key]) || entry[key] < 0) invalid();
      if (
        entry.queryDigest !== undefined &&
        (!HEX.test(entry.queryDigest) ||
          !Number.isSafeInteger(entry.queryBytes) ||
          entry.queryBytes < 1 ||
          entry.queryBytes > this.maxStoreBytes)
      )
        invalid();
      if (entry.bytes > this.maxStoreBytes)
        throw limit("shard exceeds configured byte limit");
      bytes += entry.bytes;
      events += entry.eventCount;
      records += entry.recordCount;
    }
    if (
      bytes !== input.totalBytes ||
      events !== input.eventCount ||
      records !== input.recordCount ||
      ![bytes, events, records].every(Number.isSafeInteger)
    )
      invalid();
    if (bytes > this.maxTotalBytes || events > this.maxEvents)
      throw limit("aggregate capacity exceeded");
    if (
      bytes +
        Object.values(input.shards).reduce(
          (sum, entry) => sum + (entry.queryBytes || 0),
          0,
        ) >
      this.maxTotalBytes
    )
      throw limit("authority and query indexes exceed aggregate capacity");
    return input;
  }

  _loadManifest() {
    if (!existsSync(this.filePath)) return blankManifest();
    regular(this.filePath);
    // v1 can be larger than a manifest; preserve its existing read boundary.
    let input;
    let bytes;
    try {
      bytes = readBoundedState(
        this.filePath,
        Math.max(this.maxStoreBytes, MANIFEST_LIMIT),
        true,
      );
      input = JSON.parse(bytes.toString("utf8"));
    } catch (cause) {
      throw corruptStore(this.filePath, "authority cannot be parsed", cause);
    }
    if (input?.schema === STORE_SCHEMA) {
      if (bytes.length > this.maxStoreBytes)
        throw corruptStore(
          this.filePath,
          "legacy store exceeds its configured byte limit",
        );
      const legacy = normalizeState(input, this.filePath);
      if (this.readOnly) return legacy;
      return this._installSnapshot(legacy);
    }
    const manifest = this._validateManifest(input);
    if (bytes.length > MANIFEST_LIMIT)
      throw corruptStore(this.filePath, "manifest is too large");
    this._checkDirectories();
    if (!this.readOnly) this._collect(manifest);
    return manifest;
  }

  _readShard(manifest, bucket) {
    if (manifest.schema === STORE_SCHEMA) return manifest;
    const descriptor = manifest.shards[bucket];
    if (!descriptor) return blankShard();
    return this._decodeShard(
      manifest,
      bucket,
      this._readShardBytes(manifest, bucket),
    );
  }

  _readShardBytes(manifest, bucket) {
    const descriptor = manifest.shards[bucket];
    this._checkDirectories();
    const file = this._shardPath(bucket, descriptor);
    regular(file);
    const bytes = readBoundedState(
      file,
      Math.min(this.maxStoreBytes, descriptor.bytes),
      true,
    );
    if (bytes.length !== descriptor.bytes)
      throw corruptStore(file, "shard byte length changed");
    return bytes;
  }

  _decodeShard(manifest, bucket, bytes) {
    const descriptor = manifest.shards[bucket];
    const file = this._shardPath(bucket, descriptor);
    let state;
    try {
      state = normalizeState(JSON.parse(bytes.toString("utf8")), file);
    } catch (cause) {
      throw corruptStore(file, "shard cannot be validated", cause);
    }
    if (
      state.digest !== descriptor.digest ||
      state.events.length !== descriptor.eventCount ||
      Object.keys(state.records).length !== descriptor.recordCount ||
      Object.keys(state.records).some((id) => bucketOf(id) !== bucket) ||
      Object.keys(state.reconciliations).some(
        (id) => bucketOf(id) !== bucket,
      ) ||
      state.events.some(
        (entry, index) =>
          !entry ||
          Object.keys(entry).sort().join() !== "event,sequence" ||
          !Number.isSafeInteger(entry.sequence) ||
          entry.sequence < 1 ||
          entry.sequence > manifest.eventCount ||
          (index > 0 && entry.sequence <= state.events[index - 1].sequence),
      )
    ) {
      throw corruptStore(file, "shard does not match its manifest");
    }
    return state;
  }

  _collect(manifest) {
    this._checkDirectories();
    const live = new Set(
      Object.entries(manifest.shards).flatMap(([bucket, entry]) => [
        `${bucket}-${entry.digest.slice(7)}.json`,
        ...(entry.queryDigest
          ? [`query-${bucket}-${entry.queryDigest.slice(7)}.json`]
          : []),
      ]),
    );
    // All readers hold the same authority lock. No reader can still be using
    // a superseded shard here. Unknown files are never treated as our garbage.
    const directory = opendirSync(this.shardDirectory);
    let scanned = 0;
    let removed = false;
    try {
      let entry;
      while ((entry = directory.readSync()) !== null) {
        if (++scanned > 4096)
          throw limit("shard directory inventory exceeds 4096 entries");
        const owned =
          /^[a-f0-9]{2}-[a-f0-9]{64}\.json$/u.test(entry.name) ||
          /^query-[a-f0-9]{2}-[a-f0-9]{64}\.json$/u.test(entry.name) ||
          /^query-rebuild-[a-f0-9-]{36}\.tmp$/u.test(entry.name) ||
          /^manifest-[a-f0-9-]{36}\.tmp$/u.test(entry.name);
        if (owned && !live.has(entry.name)) {
          const file = join(this.shardDirectory, entry.name);
          regular(file);
          this._checkDirectories();
          rmSync(file);
          removed = true;
        }
      }
    } finally {
      directory.closeSync();
    }
    // A successful purge must persist the removal of superseded plaintext
    // shards on platforms supporting directory fsync, not just the manifest.
    if (removed) syncDirectory(this.shardDirectory);
  }

  _publish(manifest, changed) {
    if (this.readOnly)
      throw Object.assign(
        new Error("Context/Memory shadow authority is read-only"),
        { code: "CONTEXT_MEMORY_READ_ONLY" },
      );
    ensureSafeDirectory(this.shardDirectory);
    this._checkDirectories();
    this._collect(manifest);
    const next = cloneCanonical(manifest);
    const pending = [];
    let pendingBytes = manifest.totalBytes;
    let pendingEvents = manifest.eventCount;
    for (const [bucket, state] of changed) {
      state.digest = stateDigest(state);
      const bytes = `${JSON.stringify(state)}\n`;
      const unchanged = manifest.shards[bucket]?.digest === state.digest;
      // Canonical digests do not encode JSON property order. During a derived
      // index upgrade retain the original immutable authority bytes verbatim.
      const size = unchanged
        ? manifest.shards[bucket].bytes
        : Buffer.byteLength(bytes);
      if (size > this.maxStoreBytes)
        throw limit("shard exceeds configured byte limit");
      pendingBytes += size - (next.shards[bucket]?.bytes || 0);
      pendingEvents +=
        state.events.length - (next.shards[bucket]?.eventCount || 0);
      if (pendingBytes > this.maxTotalBytes || pendingEvents > this.maxEvents)
        throw limit("aggregate capacity exceeded");
      next.shards[bucket] = {
        digest: state.digest,
        bytes: size,
        eventCount: state.events.length,
        recordCount: Object.keys(state.records).length,
      };
      const queryBytes = encodeQueryIndex(state);
      if (queryBytes.length > this.maxStoreBytes)
        throw limit("query index exceeds configured byte limit");
      next.shards[bucket].queryDigest = queryDigest(queryBytes);
      next.shards[bucket].queryBytes = queryBytes.length;
      if (!unchanged)
        pending.push({
          file: this._shardPath(bucket, next.shards[bucket]),
          bytes,
        });
      pending.push({
        file: this._queryIndexPath(bucket, next.shards[bucket]),
        bytes: queryBytes,
      });
    }
    next.totalBytes = Object.values(next.shards).reduce(
      (sum, entry) => sum + entry.bytes,
      0,
    );
    next.eventCount = Object.values(next.shards).reduce(
      (sum, entry) => sum + entry.eventCount,
      0,
    );
    next.recordCount = Object.values(next.shards).reduce(
      (sum, entry) => sum + entry.recordCount,
      0,
    );
    next.digest = manifestDigest(next);
    this._validateManifest(next);
    const serialized = `${JSON.stringify(next)}\n`;
    if (Buffer.byteLength(serialized) > MANIFEST_LIMIT)
      throw limit("manifest exceeds byte limit");
    const temporary = join(this.shardDirectory, `manifest-${randomUUID()}.tmp`);
    const created = [];
    let published = false;
    let directorySynced = false;
    let failure = null;
    try {
      for (const { file, bytes } of pending) {
        // Content-addressed existing files must match, including crash leftovers.
        if (existsSync(file)) {
          regular(file);
          if (
            !readBoundedState(file, this.maxStoreBytes, true).equals(
              Buffer.from(bytes),
            )
          )
            throw corruptStore(file, "immutable shard was modified");
          continue;
        }
        const fd = openSync(file, "wx", 0o600);
        created.push(file);
        try {
          writeFileSync(fd, bytes, "utf8");
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
      syncDirectory(this.shardDirectory);
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(fd, serialized, "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this._checkDirectories();
      if (existsSync(this.filePath)) regular(this.filePath);
      renameSync(temporary, this.filePath);
      published = true;
      syncDirectory(dirname(this.filePath));
      directorySynced = true;
      this._collect(next);
      return next;
    } catch (cause) {
      failure = cause;
      if (published) {
        // The manifest is now authoritative: never roll it back or remove its
        // shards. Callers must observe the revision before attempting a retry.
        throw Object.assign(
          new Error(
            "Context/Memory commit was published but post-commit maintenance failed",
            { cause },
          ),
          {
            code: "CONTEXT_MEMORY_COMMIT_PUBLISHED",
            committed: true,
            storeRevision: next.storeRevision,
            durability:
              process.platform === "win32"
                ? "directory-sync-unsupported"
                : directorySynced
                  ? "directory-sync-completed"
                  : "unknown",
            cleanupComplete: false,
          },
        );
      }
      throw cause;
    } finally {
      if (!published) {
        try {
          this._checkDirectories();
          rmSync(temporary, { force: true });
          for (const file of created) {
            this._checkDirectories();
            rmSync(file, { force: true });
          }
        } catch {
          // Preserve the primary failure and leave recoverable private orphans;
          // never follow a replaced parent directory to perform cleanup.
          if (failure) failure.unpublishedCleanupIncomplete = true;
        }
      }
    }
  }

  _installSnapshot(state) {
    const shards = new Map();
    const get = (id) => {
      const bucket = bucketOf(id);
      if (!shards.has(bucket)) shards.set(bucket, blankShard());
      return shards.get(bucket);
    };
    for (const [id, record] of Object.entries(state.records))
      put(get(id).records, id, record);
    for (const [index, event] of state.events.entries()) {
      // Keep even legacy events without a memoryId; never discard audit data.
      get(
        typeof event?.memoryId === "string" ? event.memoryId : "",
      ).events.push({ sequence: index + 1, event });
    }
    for (const [id, operation] of Object.entries(state.reconciliations))
      put(get(id).reconciliations, id, operation);
    const manifest = blankManifest();
    manifest.storeRevision = state.storeRevision;
    return this._publish(manifest, shards);
  }

  /** Explicit atomic import into an empty authority; also used by migration. */
  async importSnapshot(snapshot) {
    const state = normalizeState(snapshot, this.filePath);
    return this._locked(() => {
      if (existsSync(this.filePath))
        throw Object.assign(
          new Error("Snapshot import requires an absent authority"),
          { code: "CONTEXT_MEMORY_IMPORT_CONFLICT" },
        );
      const result = this._installSnapshot(state);
      return {
        ok: true,
        storeRevision: result.storeRevision,
        recordCount: result.recordCount,
      };
    });
  }

  async read(id) {
    return this._locked(() =>
      cloneCanonical(
        own(this._readShard(this._loadManifest(), bucketOf(id)).records, id),
      ),
    );
  }

  _ensureQueryIndexes(manifest) {
    if (manifest.schema === STORE_SCHEMA || this.readOnly) return manifest;
    const missing = Object.keys(manifest.shards).filter(
      (bucket) => !manifest.shards[bucket].queryDigest,
    );
    if (!missing.length) return manifest;
    // Upgrade older v2 snapshots without changing records, revisions or audit.
    // Old strict readers reject these extended descriptors instead of writing
    // a second authority. Shadow readers derive indexes only in memory.
    return this._publish(
      manifest,
      new Map(
        missing.map((bucket) => [bucket, this._readShard(manifest, bucket)]),
      ),
    );
  }

  _readQueryIndex(manifest, bucket) {
    const descriptor = manifest.shards[bucket];
    let bytes;
    if (descriptor.queryDigest) {
      const file = this._queryIndexPath(bucket, descriptor);
      this._checkDirectories();
      if (existsSync(file)) {
        // Unsafe filesystem objects are authority errors, never repair targets.
        regular(file);
        try {
          bytes = readBoundedState(file, descriptor.queryBytes, true);
        } catch (error) {
          if (error.code !== "CONTEXT_MEMORY_STORE_CORRUPT") throw error;
        }
      }
      if (
        !bytes ||
        bytes.length !== descriptor.queryBytes ||
        queryDigest(bytes) !== descriptor.queryDigest
      ) {
        bytes = encodeQueryIndex(this._readShard(manifest, bucket));
        if (
          bytes.length !== descriptor.queryBytes ||
          queryDigest(bytes) !== descriptor.queryDigest
        )
          throw corruptStore(
            file,
            "query index cannot be reproduced from authority",
          );
        if (!this.readOnly) {
          const temporary = join(
            this.shardDirectory,
            `query-rebuild-${randomUUID()}.tmp`,
          );
          const fd = openSync(temporary, "wx", 0o600);
          try {
            writeFileSync(fd, bytes);
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
          this._checkDirectories();
          if (existsSync(file)) regular(file);
          renameSync(temporary, file);
          syncDirectory(this.shardDirectory);
        }
      }
    } else {
      bytes = encodeQueryIndex(this._readShard(manifest, bucket));
    }
    const digest = descriptor.queryDigest || queryDigest(bytes);
    const cached = this._queryIndexes.get(bucket);
    if (cached?.digest === digest) return cached.index;
    let index;
    try {
      index = compileQueryIndex(bytes, descriptor);
    } catch (cause) {
      throw corruptStore(
        this.filePath,
        "query index structure is invalid",
        cause,
      );
    }
    this._queryIndexes.set(bucket, { digest, index });
    return index;
  }

  async _indexedRecords(
    options = {},
    { limit: count = Infinity, cursor = null } = {},
  ) {
    const query = normalizeListQuery(options);
    const captured = await this._locked(() => {
      const manifest = this._ensureQueryIndexes(this._loadManifest());
      const binding = listCursorBinding(
        this.filePath,
        manifest.digest || queryDigest(JSON.stringify(manifest)),
        query,
      );
      const after = decodeListCursor(cursor, binding);
      if (manifest.schema === STORE_SCHEMA) {
        const matches = Object.values(manifest.records)
          .filter(
            (row) =>
              matchesListQuery(row, query) &&
              (!after || compareMemoryRows(row, after) > 0),
          )
          .sort(compareMemoryRows);
        const records = matches.slice(0, count);
        return {
          legacy: records,
          storeRevision: manifest.storeRevision,
          nextCursor:
            matches.length > count
              ? encodeListCursor(binding, records.at(-1))
              : null,
        };
      }
      // Merge each sorted posting lazily. Only the requested page is captured;
      // every candidate has already passed scope, sink and lifecycle filters.
      const heads = [];
      for (const bucket of Object.keys(manifest.shards)) {
        const iterator = selectQueryRows(
          this._readQueryIndex(manifest, bucket),
          query,
          after,
        );
        const next = iterator.next();
        if (!next.done) heads.push({ bucket, iterator, row: next.value });
      }
      const selected = [];
      for (const row of mergeQueryRows(heads)) {
        selected.push(row);
        if (selected.length > count) break;
      }
      const more = selected.length > count;
      if (more) selected.pop();
      const shards = new Map();
      for (const { bucket } of selected)
        if (!shards.has(bucket))
          shards.set(bucket, this._readShardBytes(manifest, bucket));
      return {
        manifest,
        selected,
        shards,
        storeRevision: manifest.storeRevision,
        nextCursor: more
          ? encodeListCursor(binding, selected.at(-1).row)
          : null,
      };
    });
    if (captured.legacy)
      return {
        records: captured.legacy,
        nextCursor: captured.nextCursor,
        storeRevision: captured.storeRevision,
      };
    const decoded = new Map(
      [...captured.shards].map(([bucket, bytes]) => [
        bucket,
        this._decodeShard(captured.manifest, bucket, bytes),
      ]),
    );
    const records = captured.selected.map(({ bucket, row }) => {
      const record = own(decoded.get(bucket).records, row.memoryId);
      if (
        !record ||
        !matchesListQuery(record, query) ||
        compareMemoryRows(record, row) !== 0
      )
        throw corruptStore(
          this.filePath,
          "query index result disagrees with authority",
        );
      return record;
    });
    return {
      records,
      nextCursor: captured.nextCursor,
      storeRevision: captured.storeRevision,
    };
  }

  async listRecords(options = {}) {
    const count =
      options.limit == null
        ? Infinity
        : Math.max(1, Number(options.limit) || 20);
    return (await this._indexedRecords(options, { limit: count })).records;
  }

  async listPage(options = {}) {
    return this._indexedRecords(options, {
      limit: pageLimit(options.limit),
      cursor: options.cursor,
    });
  }

  async query(request) {
    if (request?.scopeAdmissions || request?.sink) {
      // Do not push recall's limit before lexical/semantic ranking in the
      // kernel. Push only gates that cannot discard an admissible result.
      return (
        await this._indexedRecords({
          scopeAdmissions: request.scopeAdmissions,
          sink: request.sink,
          states: ["active", "reinforced"],
        })
      ).records;
    }
    const snapshot = await this._locked(() => {
      const manifest = this._loadManifest();
      if (manifest.schema === STORE_SCHEMA) return { legacy: manifest };
      let capturedBytes = 0;
      const shards = Object.keys(manifest.shards).map((bucket) => {
        const bytes = this._readShardBytes(manifest, bucket);
        capturedBytes += bytes.length;
        if (
          capturedBytes > manifest.totalBytes ||
          capturedBytes > this.maxTotalBytes
        )
          throw limit("snapshot exceeds aggregate byte limit");
        return [bucket, bytes];
      });
      if (capturedBytes !== manifest.totalBytes)
        throw corruptStore(
          this.filePath,
          "snapshot byte count does not match manifest",
        );
      return { manifest, shards };
    });
    if (snapshot.legacy) return Object.values(snapshot.legacy.records);
    // The lock protects capture of every byte in one manifest generation.
    // Expensive validation uses owned buffers after releasing the lock, so GC
    // and other readers/writers need not wait for whole-store JSON validation.
    return snapshot.shards.flatMap(([bucket, bytes]) =>
      Object.values(
        this._decodeShard(snapshot.manifest, bucket, bytes).records,
      ),
    );
  }
  async getRevision() {
    return this._locked(() => this._loadManifest().storeRevision);
  }
  async exportSnapshot() {
    return this._locked(() => {
      const manifest = this._loadManifest();
      if (manifest.schema === STORE_SCHEMA) return manifest;
      const state = blankShard();
      state.storeRevision = manifest.storeRevision;
      const events = [];
      for (const bucket of Object.keys(manifest.shards)) {
        const shard = this._readShard(manifest, bucket);
        for (const [id, record] of Object.entries(shard.records))
          put(state.records, id, record);
        for (const [id, operation] of Object.entries(shard.reconciliations))
          put(state.reconciliations, id, operation);
        for (const entry of shard.events) events.push(entry);
      }
      events.sort((left, right) => left.sequence - right.sequence);
      if (events.some((entry, index) => entry.sequence !== index + 1))
        throw corruptStore(this.filePath, "audit sequence is invalid");
      state.events = events.map((entry) => entry.event);
      state.digest = stateDigest(state);
      return state;
    });
  }
  async getReconciliation(id) {
    return this._locked(() =>
      cloneCanonical(
        own(
          this._readShard(this._loadManifest(), bucketOf(id)).reconciliations,
          id,
        ),
      ),
    );
  }
  _advance(manifest) {
    if (manifest.storeRevision >= Number.MAX_SAFE_INTEGER)
      throw limit("store revision is exhausted");
    manifest.storeRevision += 1;
  }
  async commit({ record, event, reconciliation }, expectedRevision = 0) {
    const normalized = normalizeMemoryRecord(record);
    return this._locked(() => {
      const manifest = this._loadManifest();
      const bucket = bucketOf(normalized.memoryId);
      const shard = this._readShard(manifest, bucket);
      const actual = own(shard.records, normalized.memoryId)?.revision || 0;
      if (actual !== expectedRevision)
        return {
          ok: false,
          currentRevision: actual,
          storeRevision: manifest.storeRevision,
        };
      const changed = new Map([[bucket, shard]]);
      put(shard.records, normalized.memoryId, normalized);
      shard.events.push({
        sequence: manifest.eventCount + 1,
        event: cloneCanonical(event),
      });
      if (reconciliation) {
        const target = bucketOf(reconciliation.requestId);
        if (!changed.has(target))
          changed.set(target, this._readShard(manifest, target));
        put(
          changed.get(target).reconciliations,
          reconciliation.requestId,
          cloneCanonical(reconciliation),
        );
      }
      this._advance(manifest);
      this._publish(manifest, changed);
      return {
        ok: true,
        revision: normalized.revision,
        storeRevision: manifest.storeRevision,
        reconciliationStored: Boolean(reconciliation),
      };
    });
  }
  async putReconciliation(operation) {
    return this._locked(() => {
      const manifest = this._loadManifest();
      const bucket = bucketOf(operation.requestId);
      const shard = this._readShard(manifest, bucket);
      put(
        shard.reconciliations,
        operation.requestId,
        cloneCanonical(operation),
      );
      this._advance(manifest);
      this._publish(manifest, new Map([[bucket, shard]]));
      return { ok: true, storeRevision: manifest.storeRevision };
    });
  }
}
