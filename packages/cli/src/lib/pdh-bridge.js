/**
 * PDH bridge discovery (Phase 0) — find a first-party "device capability" MCP
 * server that the Android app advertises via a lockfile, and turn it into an
 * MCP server config the agent loop can connect to.
 *
 * This is the cc-side (CLI) half of the Personal-Data IDE / PDH Bridge
 * (design: docs/design/modules/101_个人数据IDE桥接方案.md). It mirrors the IDE
 * bridge (ide-bridge.js, design module 98): the app runs a localhost MCP server
 * exposing collect / query / file / task tools, and writes
 *     <appFiles>/.chainlesschain/pdh-bridge/<port>.json   (file 0600, dir 0700)
 * The app ALSO injects CHAINLESSCHAIN_PDH_PORT (+ optional _TOKEN) into the env
 * of the in-APK cc it spawns, so cc locks onto the exact instance without
 * scanning ("path A"). External agents (e.g. desktop over a forwarded port)
 * fall back to a lockfile scan ("path B").
 *
 * Unlike the IDE bridge there is no multi-root workspace concept: a device has
 * a single PDH server, so discovery is env-port → else the newest live lock.
 *
 * Pure CLI, no Android dependency, fully unit-testable through `_deps`. The
 * connect path reuses the existing MCP client (HTTP) via mcp-config.js
 * `loadPdhMcp`. Reserved server name `pdh` → tools `mcp__pdh__*`.
 *
 * NOTE: the discovery mechanics (localhost / transport / stale filtering,
 * env fast-path, bearer headers) duplicate ide-bridge.js by design — keeping
 * the two bridges decoupled for Phase 0. A later refactor may extract a shared
 * device-bridge core; until then this file is self-contained on purpose.
 */
import fs from "fs";
import path from "path";
import os from "os";

/** A lock whose pid is dead and whose file is older than this = stale. */
const STALE_TTL_MS = 30_000;

/** Transports the CLI's MCP client can actually talk (see mcp-client.js). */
const SUPPORTED_TRANSPORTS = new Set(["http", "https", "sse"]);

/** Lock `kind` we accept (absent is tolerated; the dir already scopes us). */
const EXPECTED_KIND = "pdh-bridge";

/** Liveness probe via signal 0 — cross-platform (works on Windows too). */
function defaultProcessAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but we may not signal it → still alive.
    return !!(err && err.code === "EPERM");
  }
}

export const _deps = {
  readDir: (d) => fs.readdirSync(d),
  readFile: (p) => fs.readFileSync(p, "utf-8"),
  statMtimeMs: (p) => fs.statSync(p).mtimeMs,
  homedir: () => os.homedir(),
  now: () => Date.now(),
  processAlive: defaultProcessAlive,
};

/** `~/.chainlesschain/pdh-bridge/`. */
export function pdhLockDir(deps = _deps) {
  return path.join(deps.homedir(), ".chainlesschain", "pdh-bridge");
}

function isLocalhostUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "127.0.0.1" || u.hostname === "::1";
  } catch {
    return false;
  }
}

function inferTransportFromUrl(url) {
  if (/\/sse(\b|\/|$)/i.test(url)) return "sse";
  if (/^https:/i.test(url)) return "https";
  if (/^http:/i.test(url)) return "http";
  return null;
}

/** Parse + validate one lock JSON. Returns a normalized lock or null. */
function parseLock(raw, filePath) {
  let lock;
  try {
    lock = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!lock || typeof lock !== "object") return null;
  // Reject a foreign lock kind if present; absent kind is tolerated (the
  // pdh-bridge/ dir already scopes us, but a stray file gets rejected here).
  if (lock.kind != null && String(lock.kind) !== EXPECTED_KIND) return null;
  if (!lock.url || !isLocalhostUrl(lock.url)) return null;

  const transport = String(
    lock.transport || inferTransportFromUrl(lock.url) || "",
  ).toLowerCase();
  if (!SUPPORTED_TRANSPORTS.has(transport)) return null; // e.g. ws — not yet

  return {
    kind: EXPECTED_KIND,
    device: typeof lock.device === "string" ? lock.device : "unknown",
    appUid: typeof lock.appUid === "number" ? lock.appUid : null,
    transport,
    url: lock.url,
    port: lock.port,
    token: typeof lock.token === "string" ? lock.token : null,
    pid: typeof lock.pid === "number" ? lock.pid : null,
    startedAt: typeof lock.started_at === "number" ? lock.started_at : 0,
    _file: filePath,
  };
}

/** True when a lock is dead: pid gone AND file older than the TTL. */
function isStale(lock, deps) {
  if (lock.pid && deps.processAlive(lock.pid)) return false;
  let mtime;
  try {
    mtime = deps.statMtimeMs(lock._file);
  } catch {
    return true;
  }
  return deps.now() - mtime > STALE_TTL_MS;
}

/**
 * Scan the lock dir → normalized, live, localhost, supported-transport locks.
 * Missing dir / unreadable files are silently skipped (best-effort).
 */
export function readPdhLocks(deps = _deps) {
  const dir = pdhLockDir(deps);
  let names;
  try {
    names = deps.readDir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names || []) {
    if (!String(name).endsWith(".json")) continue;
    const fp = path.join(dir, name);
    let raw;
    try {
      raw = deps.readFile(fp);
    } catch {
      continue;
    }
    const lock = parseLock(raw, fp);
    if (!lock) continue;
    if (isStale(lock, deps)) continue;
    out.push(lock);
  }
  return out;
}

/** Is the env wired to a PDH bridge (app-spawned cc, or explicit opt-in)? */
export function isInPdhTerminal(env = process.env) {
  if (!env) return false;
  if (env.CHAINLESSCHAIN_PDH_PORT) return true;
  if (env.CHAINLESSCHAIN_PDH) return true;
  return false;
}

/**
 * Pick the PDH server to connect to, or null.
 *
 * Path A (deterministic): if `CHAINLESSCHAIN_PDH_PORT` is set and a live lock
 *   has that port, use it (token may come from the lock or the env).
 * Path B (scan): otherwise the newest live lock (a device has one PDH server;
 *   no workspace concept to match on, unlike the IDE bridge).
 *
 * @param {object} opts { env?, force? }   (force kept for API symmetry)
 * @param {object} [deps]
 */
export function discoverPdhServer(
  { env = process.env, force = false } = {},
  deps = _deps,
) {
  void force; // no workspace gating for PDH; param kept for call-site symmetry
  const locks = readPdhLocks(deps);
  if (!locks.length) return null;

  // Path A — env fast-path.
  const envPort = env && env.CHAINLESSCHAIN_PDH_PORT;
  if (envPort) {
    const hit = locks.find((l) => String(l.port) === String(envPort));
    if (hit) {
      if (!hit.token && env.CHAINLESSCHAIN_PDH_TOKEN) {
        hit.token = env.CHAINLESSCHAIN_PDH_TOKEN;
      }
      return hit;
    }
    // env named a port with no live lock — fall through to newest.
  }

  // Path B — newest live lock.
  return locks.slice().sort((a, b) => b.startedAt - a.startedAt)[0];
}

/**
 * A discovered lock → an MCP server config row for `setupMcpFromConfig`.
 * `longRunning` flags the server as exempt from the agent loop's per-call
 * timeout: PDH collect tools can block on `assist_required` (the user does a
 * step in the target app, then resumes) — the same blocking-tool contract as
 * the IDE bridge's `openDiff`.
 */
export function pdhServerToMcpConfig(lock) {
  if (!lock || !lock.url) return null;
  const headers = {};
  if (lock.token) headers.Authorization = `Bearer ${lock.token}`;
  return {
    url: lock.url,
    transport: lock.transport,
    headers,
    longRunning: true,
  };
}

/**
 * Human-readable explanation of why discovery did/didn't find a server — backs
 * `cc pdh doctor`. Returns { inPdhTerminal, lockDir, locks:[...], chosen, reason }.
 */
export function diagnosePdh(
  { env = process.env, force = false } = {},
  deps = _deps,
) {
  const inPdhTerminal = isInPdhTerminal(env);
  const locks = readPdhLocks(deps);
  const chosen = discoverPdhServer({ env, force }, deps);

  let reason;
  if (chosen) {
    reason =
      env &&
      env.CHAINLESSCHAIN_PDH_PORT &&
      String(chosen.port) === String(env.CHAINLESSCHAIN_PDH_PORT)
        ? "matched CHAINLESSCHAIN_PDH_PORT (env fast-path)"
        : "newest live lock";
  } else if (!locks.length) {
    reason =
      "no live PDH lockfiles in " +
      pdhLockDir(deps) +
      " (is the app's PDH bridge server running? are locks stale?)";
  } else {
    reason = "lockfiles present but none usable";
  }
  return {
    inPdhTerminal,
    lockDir: pdhLockDir(deps),
    locks: locks.map((l) => ({
      device: l.device,
      appUid: l.appUid,
      port: l.port,
      transport: l.transport,
      url: l.url,
      hasToken: !!l.token,
      pid: l.pid,
    })),
    chosen: chosen
      ? { device: chosen.device, port: chosen.port, url: chosen.url }
      : null,
    reason,
  };
}
