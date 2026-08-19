/**
 * ArtifactStore — durable home for agent DELIVERABLES (gap-analysis P1 #10).
 *
 * An agent run produces important files — a Markdown report, a patch, a
 * screenshot, test logs, review findings JSON — that otherwise live as loose
 * paths the user has to remember. `publish_artifact` copies such a file into
 * `~/.chainlesschain/artifacts/` with metadata (title, kind, mime, sha256,
 * session), so:
 *   - the session transcript only records the small METADATA object (the tool
 *     result), never the file body;
 *   - `cc artifacts` lists/inspects/cleans them across sessions;
 *   - web-panel / remote surfaces can later serve previews from one place.
 *
 * Layout:
 *   ~/.chainlesschain/artifacts/index.jsonl   one metadata row per artifact
 *   ~/.chainlesschain/artifacts/files/<id><ext>  the stored copy
 *
 * Per-row tolerant JSONL (a corrupt line never poisons the store); injected
 * clock + dir for unit tests; TTL-based expiry with an explicit cleanup call
 * (`cc artifacts clean` / opportunistic on publish).
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { withFileLock } from "./with-file-lock.js";

export const ARTIFACT_KINDS = Object.freeze([
  "report",
  "patch",
  "screenshot",
  "log",
  "data",
  "other",
]);

/** Copy-size guard: an "artifact" is a deliverable, not a build tree. */
export const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024; // 100 MB

/** Default retention before `clean` removes an artifact. */
export const DEFAULT_TTL_DAYS = 30;

/**
 * Metadata safe to return across the agent/session protocol boundary.
 *
 * The persisted index deliberately retains sourcePath for local artifact
 * management, but absolute source paths are host details and must not enter
 * model transcripts or remote-session payloads.
 */
export function publicArtifactMetadata(entry) {
  if (!entry || typeof entry !== "object") return null;
  const {
    id,
    title,
    kind,
    mime,
    size,
    sha256,
    file,
    sessionId,
    createdAt,
    expiresAt,
    immutable,
    recordDigest,
    lineage,
  } = entry;
  return {
    id,
    title,
    kind,
    mime,
    size,
    sha256,
    file,
    sessionId,
    createdAt,
    expiresAt,
    immutable: immutable === true,
    recordDigest: recordDigest || null,
    ...(lineage ? { lineage } : {}),
  };
}

const MIME_BY_EXT = Object.freeze({
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".json": "application/json",
  ".html": "text/html",
  ".htm": "text/html",
  ".csv": "text/csv",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".patch": "text/x-patch",
  ".diff": "text/x-patch",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
});

export function artifactsDir(homedir = os.homedir()) {
  // Test/deployment override (same convention as CC_BACKGROUND_AGENTS_DIR).
  if (process.env.CC_ARTIFACTS_DIR) return process.env.CC_ARTIFACTS_DIR;
  return path.join(homedir, ".chainlesschain", "artifacts");
}

function mimeForExt(ext) {
  return (
    MIME_BY_EXT[String(ext || "").toLowerCase()] || "application/octet-stream"
  );
}

function normalizeKind(kind) {
  const k = typeof kind === "string" ? kind.trim().toLowerCase() : "";
  return ARTIFACT_KINDS.includes(k) ? k : "other";
}

function normalizeLineage(lineage) {
  if (lineage == null) return null;
  if (typeof lineage !== "object" || Array.isArray(lineage)) {
    throw new Error("artifact lineage must be an object");
  }
  let normalized;
  try {
    normalized = JSON.parse(JSON.stringify(lineage));
  } catch {
    throw new Error("artifact lineage must be JSON serializable");
  }
  if (
    !normalized ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  ) {
    throw new Error("artifact lineage must be a JSON object");
  }
  return normalized;
}

export class ArtifactStore {
  constructor({
    dir = null,
    now = () => Date.now(),
    indexLock = withFileLock,
  } = {}) {
    this.dir = dir || artifactsDir();
    this._now = typeof now === "function" ? now : () => now;
    this._indexLock = indexLock;
  }

  _indexFile() {
    return path.join(this.dir, "index.jsonl");
  }

  _filesDir() {
    return path.join(this.dir, "files");
  }

  _ensureDirs() {
    fs.mkdirSync(this._filesDir(), { recursive: true });
  }

  _withIndexLock(callback) {
    this._ensureDirs();
    return this._indexLock(this._indexFile(), callback, {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
    });
  }

  /**
   * Run a read-only callback against one locked index generation. The callback
   * may inspect stored bytes before it returns; all ArtifactStore mutations use
   * this same lock and therefore cannot replace that generation mid-read.
   */
  withIndexSnapshot(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("artifact index snapshot requires a callback");
    }
    return this._withIndexLock(() =>
      callback(Object.freeze(this._readEntries())),
    );
  }

  /**
   * Publish a file as an artifact (copy + metadata row).
   * @param {{ filePath: string, title?: string, kind?: string,
   *           sessionId?: string|null, ttlDays?: number }} opts
   * @returns {object} the metadata entry (what the tool returns — no body)
   */
  publish({ filePath, title, kind, sessionId = null, ttlDays } = {}) {
    if (!filePath) throw new Error("publish requires a filePath");
    const abs = path.resolve(filePath);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw new Error(`artifact source not found: ${abs}`);
    }
    if (!stat.isFile()) {
      throw new Error(`artifact source is not a regular file: ${abs}`);
    }
    if (stat.size > MAX_ARTIFACT_BYTES) {
      throw new Error(
        `artifact too large (${stat.size} bytes > ${MAX_ARTIFACT_BYTES}); artifacts are deliverables, not build output`,
      );
    }
    const body = fs.readFileSync(abs);
    return this._withIndexLock(() =>
      this._publishDataUnlocked(body, {
        fileName: path.basename(abs),
        title,
        kind,
        sessionId,
        ttlDays,
        sourcePath: abs,
      }),
    );
  }

  /**
   * Publish generated bytes without an intermediate temp file. This is used by
   * versioned evidence records so the exact digested JSON bytes are the bytes
   * stored in the artifact directory.
   */
  publishData({
    data,
    fileName = "artifact.bin",
    title,
    kind,
    mime,
    sessionId = null,
    ttlDays,
    immutable = false,
    recordDigest = null,
  } = {}) {
    if (typeof data !== "string" && !Buffer.isBuffer(data)) {
      throw new Error("publishData requires string or Buffer data");
    }
    return this._withIndexLock(() =>
      this._publishDataUnlocked(Buffer.from(data), {
        fileName,
        title,
        kind,
        mime,
        sessionId,
        ttlDays,
        immutable,
        recordDigest,
        sourcePath: null,
      }),
    );
  }

  /**
   * Publish generated bytes once for a stable authority digest.
   *
   * The strict cross-process index lock makes response-loss retries return the
   * same metadata row instead of creating duplicate managed artifacts. The
   * caller still owns the semantic validation of the persisted lineage and
   * must verifyIntegrity() before treating the returned entry as readable.
   */
  publishDataOnce({
    data,
    fileName = "artifact.bin",
    title,
    kind,
    mime,
    sessionId = null,
    ttlDays,
    immutable = false,
    recordDigest,
    lineage,
  } = {}) {
    if (typeof data !== "string" && !Buffer.isBuffer(data)) {
      throw new Error("publishDataOnce requires string or Buffer data");
    }
    const stableDigest = String(recordDigest || "");
    if (!/^sha256:[a-f0-9]{64}$/u.test(stableDigest)) {
      throw new Error("publishDataOnce requires a canonical recordDigest");
    }
    const normalizedLineage = normalizeLineage(lineage);
    return this._withIndexLock(() => {
      const matches = this._readEntries().filter(
        (entry) => entry.recordDigest === stableDigest,
      );
      if (matches.length > 1) {
        throw new Error(
          `artifact authority ${stableDigest} has duplicate index rows`,
        );
      }
      if (matches.length === 1) {
        return Object.freeze({ entry: matches[0], published: false });
      }
      const entry = this._publishDataUnlocked(Buffer.from(data), {
        fileName,
        title,
        kind,
        mime,
        sessionId,
        ttlDays,
        immutable,
        recordDigest: stableDigest,
        lineage: normalizedLineage,
        sourcePath: null,
      });
      return Object.freeze({ entry, published: true });
    });
  }

  _publishDataUnlocked(
    body,
    {
      fileName,
      title,
      kind,
      mime,
      sessionId,
      ttlDays,
      immutable = false,
      recordDigest = null,
      lineage = null,
      sourcePath = null,
    },
  ) {
    if (body.length > MAX_ARTIFACT_BYTES) {
      throw new Error(
        `artifact too large (${body.length} bytes > ${MAX_ARTIFACT_BYTES}); artifacts are deliverables, not build output`,
      );
    }
    const safeFileName = path.basename(String(fileName || "artifact.bin"));
    const sha256 = crypto.createHash("sha256").update(body).digest("hex");
    const ext = path.extname(safeFileName);
    const id = `art_${this._now().toString(36)}_${crypto
      .randomBytes(4)
      .toString("hex")}`;
    const days = Number.isFinite(Number(ttlDays))
      ? Math.max(1, Number(ttlDays))
      : DEFAULT_TTL_DAYS;
    const createdAt = this._now();
    const entry = {
      id,
      title: String(title || safeFileName),
      kind: normalizeKind(kind),
      mime: mime ? String(mime) : mimeForExt(ext),
      size: body.length,
      sha256,
      sourcePath,
      file: `${id}${ext}`,
      sessionId: sessionId ? String(sessionId) : null,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + days * 24 * 60 * 60 * 1000).toISOString(),
      immutable: immutable === true,
      recordDigest: recordDigest ? String(recordDigest) : null,
      ...(lineage ? { lineage: normalizeLineage(lineage) } : {}),
    };
    this._ensureDirs();
    const storedPath = path.join(this._filesDir(), entry.file);
    fs.writeFileSync(storedPath, body, {
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    if (entry.immutable) {
      try {
        fs.chmodSync(storedPath, 0o444);
      } catch {
        // The content hash still detects mutation on filesystems without mode
        // support; immutable here means append-only/no update API, not WORM.
      }
    }
    let descriptor = null;
    try {
      descriptor = fs.openSync(
        this._indexFile(),
        fs.constants.O_WRONLY |
          fs.constants.O_APPEND |
          fs.constants.O_CREAT |
          Number(fs.constants.O_NOFOLLOW || 0),
        0o600,
      );
      const indexStat = fs.fstatSync(descriptor);
      if (!indexStat.isFile() || Number(indexStat.nlink) !== 1) {
        throw new Error("artifact index identity is invalid");
      }
      fs.writeFileSync(descriptor, `${JSON.stringify(entry)}\n`, "utf-8");
      fs.fsyncSync(descriptor);
    } catch (error) {
      try {
        this._deleteStoredFile(entry);
      } catch {
        /* best-effort rollback of an unpublished stored copy */
      }
      throw error;
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
    }
    return entry;
  }

  /** All (non-corrupt) metadata rows, oldest first. */
  _readEntries({ sessionId } = {}) {
    let raw;
    try {
      raw = fs.readFileSync(this._indexFile(), "utf-8");
    } catch {
      return [];
    }
    const out = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const e = JSON.parse(t);
        if (e && typeof e === "object" && e.id) out.push(e);
      } catch {
        /* per-row tolerance — a corrupt line never poisons the store */
      }
    }
    return sessionId ? out.filter((e) => e.sessionId === sessionId) : out;
  }

  list(options = {}) {
    return this._withIndexLock(() => this._readEntries(options));
  }

  /** One entry by id (or null). */
  get(id) {
    return this.list().find((e) => e.id === id) || null;
  }

  /** Absolute path of an artifact's stored copy (or null). */
  storedPath(idOrEntry) {
    const entry =
      typeof idOrEntry === "object" && idOrEntry
        ? idOrEntry
        : this.get(idOrEntry);
    if (!entry) return null;
    return path.join(this._filesDir(), entry.file);
  }

  /** Recompute the stored copy's digest; unknown/missing bytes fail closed. */
  verifyIntegrity(idOrEntry) {
    const entry =
      typeof idOrEntry === "object" && idOrEntry
        ? idOrEntry
        : this.get(idOrEntry);
    if (!entry) {
      return {
        ok: false,
        reason: "artifact-not-found",
        expectedSha256: null,
        actualSha256: null,
      };
    }
    let body;
    try {
      body = fs.readFileSync(this.storedPath(entry));
    } catch {
      return {
        ok: false,
        reason: "artifact-bytes-unavailable",
        expectedSha256: entry.sha256 || null,
        actualSha256: null,
      };
    }
    const actualSha256 = crypto.createHash("sha256").update(body).digest("hex");
    return {
      ok: actualSha256 === entry.sha256,
      reason: actualSha256 === entry.sha256 ? "ok" : "artifact-digest-mismatch",
      expectedSha256: entry.sha256 || null,
      actualSha256,
    };
  }

  _deleteStoredFile(entry) {
    const storedPath = this.storedPath(entry);
    if (entry?.immutable) {
      try {
        fs.chmodSync(storedPath, 0o666);
      } catch {
        // Explicit deletion remains best-effort on filesystems without modes.
      }
    }
    fs.rmSync(storedPath, { force: true });
  }

  /** Remove one artifact (file + index row). @returns {boolean} found */
  remove(id) {
    return this._withIndexLock(() => {
      const entries = this._readEntries();
      const matches = entries.filter((entry) => entry.id === id);
      if (matches.length === 0) return false;
      if (matches.length > 1) {
        throw new Error(`artifact id ${id} has duplicate index rows`);
      }
      const target = matches[0];
      this._rewriteUnlocked(entries.filter((entry) => entry.id !== id));
      try {
        this._deleteStoredFile(target);
      } catch {
        /* best-effort — the locked index generation is the source of truth */
      }
      return true;
    });
  }

  /**
   * Low-level legacy primitive for removing expired artifacts.
   * Official CLI and WebSocket callers must use artifact cleanup settlement so
   * retries preserve a frozen scope and leave content-free audit evidence.
   * @returns {{ removed: number }}
   */
  cleanupExpired() {
    return this._withIndexLock(() => {
      const entries = this._readEntries();
      const now = this._now();
      const keep = [];
      const expired = [];
      for (const entry of entries) {
        const exp = Date.parse(entry.expiresAt || "");
        if (Number.isFinite(exp) && exp <= now) {
          expired.push(entry);
        } else {
          keep.push(entry);
        }
      }
      if (expired.length > 0) this._rewriteUnlocked(keep);
      for (const entry of expired) {
        try {
          this._deleteStoredFile(entry);
        } catch {
          /* best-effort — the locked index generation is the source of truth */
        }
      }
      return { removed: expired.length };
    });
  }

  _rewriteUnlocked(entries) {
    this._ensureDirs();
    const text = entries.map((e) => JSON.stringify(e)).join("\n");
    const indexFile = this._indexFile();
    const temporary = `${indexFile}.${process.pid}.${crypto
      .randomBytes(8)
      .toString("hex")}.tmp`;
    let descriptor = null;
    try {
      descriptor = fs.openSync(
        temporary,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          Number(fs.constants.O_NOFOLLOW || 0),
        0o600,
      );
      fs.writeFileSync(descriptor, text ? `${text}\n` : "", "utf-8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.renameSync(temporary, indexFile);
      this._syncIndexDirectory();
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        /* best-effort cleanup of an unpublished index generation */
      }
    }
  }

  _syncIndexDirectory() {
    let descriptor = null;
    try {
      descriptor = fs.openSync(this.dir, "r");
      fs.fsyncSync(descriptor);
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !["EACCES", "EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)
      ) {
        throw error;
      }
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
    }
  }
}
