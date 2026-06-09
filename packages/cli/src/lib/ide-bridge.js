/**
 * IDE bridge discovery (Phase 0) — find a first-party IDE MCP server that an
 * editor extension advertises via a lockfile, and turn it into an MCP server
 * config the agent loop can connect to.
 *
 * Protocol (design: docs/design/modules/98_IDE桥接对标方案.md): each running
 * IDE instance writes
 *     ~/.chainlesschain/ide/<port>.json     (file 0600, dir 0700)
 * describing a localhost SSE/HTTP MCP server + a per-instance bearer token.
 * The extension that owns the integrated terminal ALSO injects
 *     CHAINLESSCHAIN_IDE_PORT   (+ optional CHAINLESSCHAIN_IDE_TOKEN)
 * so the CLI can lock onto the exact instance without scanning/guessing
 * (the deterministic "path A" below). Plain terminals fall back to a lockfile
 * scan + workspace match ("path B").
 *
 * Phase 0 is pure CLI: no extension code, no VS Code dependency, fully
 * unit-testable through `_deps`. The connect path itself reuses the existing
 * MCP client (SSE/HTTP) via mcp-config.js `loadIdeMcp`.
 */
import fs from "fs";
import path from "path";
import os from "os";

/** A lock whose pid is dead and whose file is older than this = stale. */
const STALE_TTL_MS = 30_000;

/** Transports the CLI's MCP client can actually talk (see mcp-client.js). */
const SUPPORTED_TRANSPORTS = new Set(["sse", "http", "https"]);

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

/** `~/.chainlesschain/ide/`. */
export function ideLockDir(deps = _deps) {
  return path.join(deps.homedir(), ".chainlesschain", "ide");
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
  if (!lock.url || !isLocalhostUrl(lock.url)) return null;

  const transport = String(
    lock.transport || inferTransportFromUrl(lock.url) || "",
  ).toLowerCase();
  if (!SUPPORTED_TRANSPORTS.has(transport)) return null; // e.g. ws — not yet

  let folders = lock.workspaceFolders;
  if (typeof folders === "string") folders = [folders];
  if (!Array.isArray(folders)) folders = [];
  folders = folders.filter((f) => typeof f === "string" && f.length > 0);

  return {
    ide: typeof lock.ide === "string" ? lock.ide : "unknown",
    transport,
    url: lock.url,
    port: lock.port,
    token: typeof lock.token === "string" ? lock.token : null,
    workspaceFolders: folders,
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
export function readIdeLocks(deps = _deps) {
  const dir = ideLockDir(deps);
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

/** Are we running inside an editor's integrated terminal? */
export function isInIdeTerminal(env = process.env) {
  if (!env) return false;
  if (env.CHAINLESSCHAIN_IDE_PORT) return true;
  if (env.TERM_PROGRAM === "vscode") return true;
  if (env.CHAINLESSCHAIN_IDE) return true;
  if (env.TERMINAL_EMULATOR && /jetbrains/i.test(env.TERMINAL_EMULATOR)) {
    return true;
  }
  return false;
}

/** Normalize a path for prefix comparison (sep + trailing slash + win case). */
function normPath(p) {
  const s = String(p)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  return process.platform === "win32" ? s.toLowerCase() : s;
}

/**
 * Longest matching workspace-folder length for `cwd`, or -1 if none of the
 * lock's folders contains (or equals) cwd. Longer = more specific.
 */
function workspaceMatchScore(lock, cwd) {
  const c = normPath(cwd);
  let best = -1;
  for (const f of lock.workspaceFolders) {
    const nf = normPath(f);
    if (c === nf || c.startsWith(nf + "/")) {
      if (nf.length > best) best = nf.length;
    }
  }
  return best;
}

/**
 * Pick the IDE server to connect to, or null.
 *
 * Path A (deterministic): if `CHAINLESSCHAIN_IDE_PORT` is set and a live lock
 *   has that port, use it (token may come from the lock or the env).
 * Path B (scan): otherwise rank live locks by (longest workspace-prefix match,
 *   then newest started_at). With `force`, fall back to the newest lock even
 *   when no folder matches (used by `--ide`).
 *
 * @param {object} opts { cwd?, env?, force? }
 * @param {object} [deps]
 */
export function discoverIdeServer(
  { cwd = process.cwd(), env = process.env, force = false } = {},
  deps = _deps,
) {
  const locks = readIdeLocks(deps);
  if (!locks.length) return null;

  // Path A — env fast-path.
  const envPort = env && env.CHAINLESSCHAIN_IDE_PORT;
  if (envPort) {
    const hit = locks.find((l) => String(l.port) === String(envPort));
    if (hit) {
      if (!hit.token && env.CHAINLESSCHAIN_IDE_TOKEN) {
        hit.token = env.CHAINLESSCHAIN_IDE_TOKEN;
      }
      return hit;
    }
    // env named a port with no live lock — fall through to scan.
  }

  // Path B — workspace match.
  let best = null;
  let bestScore = -1;
  let bestStarted = -1;
  for (const l of locks) {
    const score = workspaceMatchScore(l, cwd);
    if (score < 0) continue;
    if (
      score > bestScore ||
      (score === bestScore && l.startedAt > bestStarted)
    ) {
      best = l;
      bestScore = score;
      bestStarted = l.startedAt;
    }
  }
  if (best) return best;

  // --ide forced but no workspace match → newest live lock.
  if (force) {
    return locks
      .slice()
      .sort((a, b) => b.startedAt - a.startedAt)[0];
  }
  return null;
}

/**
 * A discovered lock → an MCP server config row for `setupMcpFromConfig`.
 * `longRunning` is forward-compat metadata: IDE tools like `ide_openDiff` may
 * block on the user for minutes, so the agent loop should exempt them from a
 * per-call timeout (consumed in Phase 1).
 */
export function ideServerToMcpConfig(lock) {
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
 * `cc ide doctor`. Returns { inIdeTerminal, locks:[{...,reasons?}], chosen,
 * reason }.
 */
export function diagnoseIde(
  { cwd = process.cwd(), env = process.env, force = false } = {},
  deps = _deps,
) {
  const inIdeTerminal = isInIdeTerminal(env);
  const locks = readIdeLocks(deps);
  const chosen = discoverIdeServer({ cwd, env, force }, deps);

  let reason;
  if (chosen) {
    reason = env && env.CHAINLESSCHAIN_IDE_PORT &&
      String(chosen.port) === String(env.CHAINLESSCHAIN_IDE_PORT)
      ? "matched CHAINLESSCHAIN_IDE_PORT (env fast-path)"
      : force
        ? "forced (--ide); newest live lock"
        : "workspace match";
  } else if (!locks.length) {
    reason =
      "no live IDE lockfiles in " +
      ideLockDir(deps) +
      " (is an IDE extension running? are locks stale?)";
  } else {
    reason =
      "lockfiles present but none match cwd's workspace " +
      "(run with --ide to force the newest, or cd into the IDE workspace)";
  }
  return {
    inIdeTerminal,
    lockDir: ideLockDir(deps),
    locks: locks.map((l) => ({
      ide: l.ide,
      port: l.port,
      transport: l.transport,
      url: l.url,
      hasToken: !!l.token,
      workspaceFolders: l.workspaceFolders,
      pid: l.pid,
      matchScore: workspaceMatchScore(l, cwd),
    })),
    chosen: chosen
      ? { ide: chosen.ide, port: chosen.port, url: chosen.url }
      : null,
    reason,
  };
}
