/**
 * Session mirror (gap-2026-07-11 P2#14) — a pluggable off-box copy of the JSONL
 * session store for cross-device / cloud-runner / team scenarios.
 *
 * The mirror is one-way derived from the local JSONL (which stays the source of
 * truth): `push(id)` copies a session's bytes out, `pull(id)` fetches them back,
 * `list()` enumerates what the remote holds. Encryption and access control are
 * the driver's concern (configured independently), so a driver may wrap bytes
 * before they leave the box.
 *
 * Drivers implement a tiny interface `{ push(id, bytes), pull(id), list() }`.
 * Two are built in:
 *   - `fs`   : mirror to a local/mounted directory (reference impl; also the
 *              test target). Covers NFS/SMB-mounted shares for free.
 *   - `http` : PUT/GET/list against a self-hosted API mirror (injectable fetch).
 * S3 / WebDAV / Redis are additional drivers that plug in behind the same
 * factory; they need real endpoints so they are configured, not bundled.
 *
 * Pure/DI: filesystem and fetch go through injected deps so the factory and the
 * fs driver are unit-testable without network or a real home dir.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join, basename } from "node:path";
import { isUnsafeSessionId } from "./jsonl-session-store.js";

/**
 * Build a mirror driver from config. `config.kind` selects the driver:
 *   { kind: "fs",   dir: "/mnt/backup/sessions" }
 *   { kind: "http", baseUrl: "https://mirror.local", token: "…" }
 * Returns null when no mirror is configured (kind falsy / "none").
 */
export function createMirror(config = {}, deps = {}) {
  const kind = String(config.kind || config.type || "none").toLowerCase();
  if (!kind || kind === "none") return null;
  if (kind === "fs" || kind === "dir" || kind === "directory") {
    return createFsMirror(config, deps);
  }
  if (kind === "http" || kind === "api") {
    return createHttpMirror(config, deps);
  }
  throw new Error(
    `unknown session mirror kind "${kind}" (use fs | http, or wire an s3/webdav/redis driver)`,
  );
}

/** Directory mirror — the reference driver. */
export function createFsMirror(config = {}, deps = {}) {
  const dir = config.dir || config.path;
  if (!dir) throw new Error("fs mirror requires a `dir`");
  const _existsSync = deps.existsSync || existsSync;
  const _mkdirSync = deps.mkdirSync || mkdirSync;
  const _readFileSync = deps.readFileSync || readFileSync;
  const _writeFileSync = deps.writeFileSync || writeFileSync;
  const _readdirSync = deps.readdirSync || readdirSync;

  const ensure = () => {
    if (!_existsSync(dir)) _mkdirSync(dir, { recursive: true });
    return dir;
  };
  const fileFor = (id) => {
    if (isUnsafeSessionId(id)) throw new Error(`unsafe session id: ${id}`);
    return join(dir, `${id}.jsonl`);
  };

  return {
    kind: "fs",
    target: dir,
    async push(id, bytes) {
      ensure();
      _writeFileSync(fileFor(id), bytes, "utf-8");
      return { id, bytes: Buffer.byteLength(bytes) };
    },
    async pull(id) {
      const f = fileFor(id);
      if (!_existsSync(f)) return null;
      return _readFileSync(f, "utf-8");
    },
    async list() {
      if (!_existsSync(dir)) return [];
      return _readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => basename(f, ".jsonl"));
    },
  };
}

/** HTTP mirror — PUT/GET/list against a self-hosted API. `fetch` injectable. */
export function createHttpMirror(config = {}, deps = {}) {
  const baseUrl = String(config.baseUrl || config.url || "").replace(
    /\/+$/,
    "",
  );
  if (!baseUrl) throw new Error("http mirror requires a `baseUrl`");
  const token = config.token || null;
  const doFetch = deps.fetch || ((...a) => globalThis.fetch(...a));
  const headers = (extra = {}) => ({
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  const guard = (id) => {
    if (isUnsafeSessionId(id)) throw new Error(`unsafe session id: ${id}`);
    return encodeURIComponent(id);
  };

  return {
    kind: "http",
    target: baseUrl,
    async push(id, bytes) {
      const res = await doFetch(`${baseUrl}/sessions/${guard(id)}`, {
        method: "PUT",
        headers: headers({ "Content-Type": "application/x-ndjson" }),
        body: bytes,
      });
      if (!res.ok) throw new Error(`mirror PUT ${id} → HTTP ${res.status}`);
      return { id, bytes: Buffer.byteLength(bytes) };
    },
    async pull(id) {
      const res = await doFetch(`${baseUrl}/sessions/${guard(id)}`, {
        headers: headers(),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`mirror GET ${id} → HTTP ${res.status}`);
      return res.text();
    },
    async list() {
      const res = await doFetch(`${baseUrl}/sessions`, { headers: headers() });
      if (!res.ok) throw new Error(`mirror list → HTTP ${res.status}`);
      const data = await res.json();
      const ids = Array.isArray(data) ? data : data?.sessions || [];
      return ids
        .map((x) => (typeof x === "string" ? x : x?.id))
        .filter(Boolean);
    },
  };
}
