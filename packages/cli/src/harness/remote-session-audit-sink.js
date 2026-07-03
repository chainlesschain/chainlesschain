// Remote Session audit log — durable JSONL sink.
//
// Attaches to RemoteSessionAuditLog's `sink` seam to persist the (already
// privacy-filtered) audit trail to a newline-delimited JSON file so it survives
// a host restart for forensics. Each entry is one JSON line; the file is
// size-bounded with simple rotation (audit.jsonl → audit.jsonl.1 → …) so it can
// never grow unbounded. Reads tolerate a torn last line (crash mid-append) by
// skipping any line that will not parse.
//
// Deliberately dependency-free (node:fs only) and injectable — a SQLite-backed
// sink could implement the same { handler, readAll } shape later without
// touching the audit log or its call sites.

import fs from "node:fs";
import path from "node:path";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB
const DEFAULT_BACKUPS = 1;

export class RemoteSessionAuditFileSink {
  constructor(options = {}) {
    if (!options.path) {
      throw new Error("RemoteSessionAuditFileSink requires a path");
    }
    this.path = options.path;
    this.maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
    this.backups = Number.isInteger(options.backups)
      ? options.backups
      : DEFAULT_BACKUPS;
    this.fs = options.fs || fs;
    this._ensureDir();
  }

  _ensureDir() {
    try {
      this.fs.mkdirSync(path.dirname(this.path), { recursive: true });
    } catch {
      // Best effort — a later append will surface a real error if the dir is
      // genuinely unwritable, and the audit log swallows sink throws anyway.
    }
  }

  /** Bound function to pass as RemoteSessionAuditLog({ sink }). */
  get handler() {
    return (entry) => this.append(entry);
  }

  /** Append one entry as a JSON line, rotating first if it would overflow. */
  append(entry) {
    const line = `${JSON.stringify(entry)}\n`;
    this._rotateIfNeeded(Buffer.byteLength(line, "utf8"));
    this.fs.appendFileSync(this.path, line, "utf8");
  }

  _rotateIfNeeded(incomingBytes) {
    let size = 0;
    try {
      size = this.fs.statSync(this.path).size;
    } catch {
      return; // No file yet — nothing to rotate.
    }
    if (size + incomingBytes <= this.maxBytes) return;
    if (this.backups <= 0) {
      // No history kept — truncate by removing the active file.
      try {
        this.fs.rmSync(this.path);
      } catch {
        /* ignore */
      }
      return;
    }
    // Shift backups: .(<n-1>) → .(<n>), …, active → .1, dropping the oldest.
    for (let i = this.backups; i >= 1; i -= 1) {
      const src = i === 1 ? this.path : `${this.path}.${i - 1}`;
      const dst = `${this.path}.${i}`;
      try {
        if (this.fs.existsSync(src)) this.fs.renameSync(src, dst);
      } catch {
        /* ignore a single failed rotation step */
      }
    }
  }

  /**
   * Read persisted entries oldest-first across the active file and its backups.
   * Corrupt/partial lines are skipped. `limit` keeps only the newest N.
   */
  readAll({ limit } = {}) {
    const files = [];
    for (let i = this.backups; i >= 1; i -= 1) files.push(`${this.path}.${i}`);
    files.push(this.path);
    const entries = [];
    for (const file of files) {
      let raw;
      try {
        raw = this.fs.readFileSync(file, "utf8");
      } catch {
        continue; // Missing backup slot — expected.
      }
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed));
        } catch {
          // Torn write (crash mid-append) or manual edit — skip the line.
        }
      }
    }
    if (limit && limit > 0 && entries.length > limit) {
      return entries.slice(entries.length - limit);
    }
    return entries;
  }

  /**
   * Build a sink from env, or null when no audit file is configured. Enable with
   * CHAINLESSCHAIN_REMOTE_SESSION_AUDIT_FILE (path); tune the rotation ceiling
   * with CHAINLESSCHAIN_REMOTE_SESSION_AUDIT_MAX_BYTES.
   */
  static fromEnv(env = {}, options = {}) {
    const filePath = env.CHAINLESSCHAIN_REMOTE_SESSION_AUDIT_FILE;
    if (!filePath) return null;
    const maxBytes =
      Number(env.CHAINLESSCHAIN_REMOTE_SESSION_AUDIT_MAX_BYTES) || undefined;
    return new RemoteSessionAuditFileSink({
      path: filePath,
      maxBytes,
      ...options,
    });
  }
}
