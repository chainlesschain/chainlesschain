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

export class ArtifactStore {
  constructor({ dir = null, now = () => Date.now() } = {}) {
    this.dir = dir || artifactsDir();
    this._now = typeof now === "function" ? now : () => now;
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
    const sha256 = crypto.createHash("sha256").update(body).digest("hex");
    const ext = path.extname(abs);
    const id = `art_${this._now().toString(36)}_${crypto
      .randomBytes(4)
      .toString("hex")}`;
    const days = Number.isFinite(Number(ttlDays))
      ? Math.max(1, Number(ttlDays))
      : DEFAULT_TTL_DAYS;
    const createdAt = this._now();
    const entry = {
      id,
      title: String(title || path.basename(abs)),
      kind: normalizeKind(kind),
      mime: mimeForExt(ext),
      size: stat.size,
      sha256,
      sourcePath: abs,
      file: `${id}${ext}`,
      sessionId: sessionId ? String(sessionId) : null,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + days * 24 * 60 * 60 * 1000).toISOString(),
    };
    this._ensureDirs();
    fs.writeFileSync(path.join(this._filesDir(), entry.file), body);
    fs.appendFileSync(this._indexFile(), JSON.stringify(entry) + "\n", "utf-8");
    return entry;
  }

  /** All (non-corrupt) metadata rows, oldest first. */
  list({ sessionId } = {}) {
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

  /** Remove one artifact (file + index row). @returns {boolean} found */
  remove(id) {
    const entries = this.list();
    const target = entries.find((e) => e.id === id);
    if (!target) return false;
    try {
      fs.rmSync(this.storedPath(target), { force: true });
    } catch {
      /* best-effort — the index row is the source of truth */
    }
    this._rewrite(entries.filter((e) => e.id !== id));
    return true;
  }

  /**
   * Remove expired artifacts (expiresAt in the past).
   * @returns {{ removed: number }}
   */
  cleanupExpired() {
    const entries = this.list();
    const now = this._now();
    const keep = [];
    let removed = 0;
    for (const e of entries) {
      const exp = Date.parse(e.expiresAt || "");
      if (Number.isFinite(exp) && exp <= now) {
        try {
          fs.rmSync(this.storedPath(e), { force: true });
        } catch {
          /* best-effort */
        }
        removed += 1;
      } else {
        keep.push(e);
      }
    }
    if (removed > 0) this._rewrite(keep);
    return { removed };
  }

  _rewrite(entries) {
    this._ensureDirs();
    const text = entries.map((e) => JSON.stringify(e)).join("\n");
    fs.writeFileSync(this._indexFile(), text ? text + "\n" : "", "utf-8");
  }
}
