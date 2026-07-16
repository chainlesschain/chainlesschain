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
  unlinkSync,
} from "node:fs";
import {
  scryptSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { join, basename } from "node:path";
import { isUnsafeSessionId } from "./jsonl-session-store.js";

const CIPHER_VERSION = 1;
const CIPHER_ALGO = "aes-256-gcm";

/**
 * Build a mirror driver from config. `config.kind` selects the driver:
 *   { kind: "fs",   dir: "/mnt/backup/sessions" }
 *   { kind: "http", baseUrl: "https://mirror.local", token: "…" }
 * Returns null when no mirror is configured (kind falsy / "none").
 */
export function createMirror(config = {}, deps = {}) {
  const kind = String(config.kind || config.type || "none").toLowerCase();
  if (!kind || kind === "none") return null;
  let driver;
  if (kind === "fs" || kind === "dir" || kind === "directory") {
    driver = createFsMirror(config, deps);
  } else if (kind === "http" || kind === "api") {
    driver = createHttpMirror(config, deps);
  } else {
    throw new Error(
      `unknown session mirror kind "${kind}" (use fs | http, or wire an s3/webdav/redis driver)`,
    );
  }
  // When `encryption` (a passphrase) is configured, wrap the driver so bytes are
  // AES-256-GCM encrypted at rest — the mirror target only ever holds ciphertext,
  // and only the run-time passphrase can decrypt it. Absent → raw bytes (the
  // prior behaviour, byte-for-byte).
  const enc = config.encryption || config.encrypt;
  if (enc && (enc.passphrase || enc.secret)) {
    return wrapEncryptedMirror(driver, createMirrorCipher(enc, deps));
  }
  return driver;
}

/**
 * Passphrase-based AES-256-GCM cipher for mirrored session bytes. scrypt derives
 * a 256-bit key from the passphrase + a per-record random salt; a random 12-byte
 * nonce and the GCM tag give confidentiality + integrity (a tampered ciphertext
 * fails to decrypt). Each envelope is self-describing JSON — `{ v, alg, keyId,
 * salt, nonce, tag, ct }`, all base64url — carrying `keyId` so key ROTATION can
 * tell old ciphertext from new. No secret is ever stored; only the passphrase
 * supplied at run time can read it. `randomBytes`/`scryptSync` are injectable so
 * round-trips are unit-testable deterministically.
 */
export function createMirrorCipher(config = {}, deps = {}) {
  const passphrase = config.passphrase || config.secret;
  if (!passphrase) throw new Error("mirror encryption requires a `passphrase`");
  const keyId = String(config.keyId || "default");
  const _randomBytes = deps.randomBytes || randomBytes;
  const _scrypt = deps.scryptSync || scryptSync;
  const deriveKey = (salt) => _scrypt(String(passphrase), salt, 32);

  return {
    keyId,
    encrypt(bytes) {
      const salt = Buffer.from(_randomBytes(16));
      const nonce = Buffer.from(_randomBytes(12));
      const cipher = createCipheriv(CIPHER_ALGO, deriveKey(salt), nonce);
      const ct = Buffer.concat([
        cipher.update(Buffer.from(bytes, "utf-8")),
        cipher.final(),
      ]);
      return JSON.stringify({
        v: CIPHER_VERSION,
        alg: CIPHER_ALGO,
        keyId,
        salt: salt.toString("base64url"),
        nonce: nonce.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        ct: ct.toString("base64url"),
      });
    },
    decrypt(envelope) {
      let e;
      try {
        e = typeof envelope === "string" ? JSON.parse(envelope) : envelope;
      } catch {
        throw new Error("mirror ciphertext is not a valid envelope");
      }
      if (!e || e.v !== CIPHER_VERSION || e.alg !== CIPHER_ALGO) {
        throw new Error("unsupported mirror ciphertext envelope");
      }
      const key = deriveKey(Buffer.from(e.salt, "base64url"));
      const decipher = createDecipheriv(
        CIPHER_ALGO,
        key,
        Buffer.from(e.nonce, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(e.tag, "base64url"));
      const pt = Buffer.concat([
        decipher.update(Buffer.from(e.ct, "base64url")),
        decipher.final(),
      ]);
      return pt.toString("utf-8");
    },
    /** Read an envelope's keyId without decrypting (rotation bookkeeping). */
    envelopeKeyId(envelope) {
      try {
        const e =
          typeof envelope === "string" ? JSON.parse(envelope) : envelope;
        return e && e.keyId != null ? String(e.keyId) : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Wrap a driver so push encrypts and pull decrypts transparently, keeping the
 * raw driver reachable as `.raw` (key rotation drives the raw driver with two
 * ciphers). list/delete pass through — ids stay plaintext in the target (they
 * are random handles, not content).
 */
function wrapEncryptedMirror(driver, cipher) {
  return {
    ...driver,
    encrypted: true,
    keyId: cipher.keyId,
    raw: driver,
    cipher,
    async push(id, bytes) {
      const enc = cipher.encrypt(bytes);
      const r = await driver.push(id, enc);
      return {
        ...r,
        bytes: Buffer.byteLength(bytes),
        storedBytes: Buffer.byteLength(enc),
        encrypted: true,
      };
    },
    async pull(id) {
      const raw = await driver.pull(id);
      return raw == null ? null : cipher.decrypt(raw);
    },
  };
}

/**
 * RETENTION: delete every mirror entry whose id is NOT in `keep` — the mirror is
 * one-way derived from the local store, so retention = "hold only what the local
 * source still keeps" (e.g. the ids `cc session list` still returns). Best-effort
 * per id; returns what was deleted vs kept.
 */
export async function pruneMirror(mirror, { keep = [] } = {}) {
  if (!mirror || typeof mirror.list !== "function") {
    return { deleted: [], kept: [] };
  }
  const keepSet = new Set((keep || []).map(String));
  const ids = (await mirror.list()) || [];
  const deleted = [];
  for (const id of ids) {
    if (keepSet.has(String(id))) continue;
    try {
      await mirror.delete(id);
      deleted.push(id);
    } catch {
      /* best-effort — a failed delete must not abort the prune */
    }
  }
  return { deleted, kept: ids.filter((i) => keepSet.has(String(i))) };
}

/**
 * KEY ROTATION: re-encrypt every mirrored session from the `from` cipher to the
 * `to` cipher, in place. Drives the RAW driver (pass `mirror.raw` for an
 * encrypted mirror) so it reads/writes ciphertext directly. Entries already at
 * `to.keyId` are skipped (idempotent re-runs); an entry that fails to decrypt
 * with `from` is reported, not silently dropped.
 */
export async function rotateMirrorKey(driver, { from, to } = {}) {
  if (!driver || !from || !to) {
    throw new Error("rotateMirrorKey requires (driver, { from, to })");
  }
  const ids = (await driver.list()) || [];
  const rotated = [];
  const skipped = [];
  const failed = [];
  for (const id of ids) {
    let raw;
    try {
      raw = await driver.pull(id);
    } catch (e) {
      failed.push({ id, error: e.message });
      continue;
    }
    if (raw == null) continue;
    if (from.envelopeKeyId(raw) === to.keyId) {
      skipped.push(id);
      continue;
    }
    try {
      const plain = from.decrypt(raw);
      await driver.push(id, to.encrypt(plain));
      rotated.push(id);
    } catch (e) {
      failed.push({ id, error: e.message });
    }
  }
  return { rotated, skipped, failed, keyId: to.keyId };
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
  const _unlinkSync = deps.unlinkSync || unlinkSync;

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
    async delete(id) {
      const f = fileFor(id);
      if (!_existsSync(f)) return { id, deleted: false };
      _unlinkSync(f);
      return { id, deleted: true };
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
    async delete(id) {
      const res = await doFetch(`${baseUrl}/sessions/${guard(id)}`, {
        method: "DELETE",
        headers: headers(),
      });
      // 404 = already gone → idempotent success, not an error.
      if (!res.ok && res.status !== 404) {
        throw new Error(`mirror DELETE ${id} → HTTP ${res.status}`);
      }
      return { id, deleted: res.ok };
    },
  };
}
