/**
 * Startup update notice — Claude-Code-style "new version available" line.
 *
 * Zero startup cost by design:
 *  - the CLI entry only does ONE sync cache read (~/.chainlesschain/
 *    update-check.json) and prints a single gray stderr line when the cached
 *    latest version is newer than the running one (TTY only, never pollutes
 *    piped/JSON output);
 *  - when the cache is stale (>24h) it spawns a DETACHED, unref'd child that
 *    refreshes the cache from the npm registry for the NEXT run — the current
 *    invocation never waits on the network. The cache's checkedAt is touched
 *    optimistically before spawning so concurrent invocations don't stampede.
 *
 * Disable with CC_UPDATE_NOTICE=0. `cc update` remains the full interactive
 * checker (GitHub releases + assets); this is just the passive nudge.
 */

import fsDefault from "fs";
import pathDefault from "path";
import osDefault from "os";
import { spawn as spawnDefault } from "child_process";
import { fileURLToPath } from "url";
import chalk from "chalk";
import semver from "semver";
import { VERSION } from "../constants.js";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const NPM_LATEST_URL = "https://registry.npmjs.org/chainlesschain/latest";

export const _deps = {
  fs: fsDefault,
  path: pathDefault,
  os: osDefault,
  spawn: spawnDefault,
};

export function cachePath(deps = _deps) {
  return deps.path.join(
    deps.os.homedir() || "",
    ".chainlesschain",
    "update-check.json",
  );
}

function readCache(deps) {
  try {
    return JSON.parse(deps.fs.readFileSync(cachePath(deps), "utf-8"));
  } catch {
    return null;
  }
}

function writeCache(deps, cache) {
  try {
    const p = cachePath(deps);
    deps.fs.mkdirSync(deps.path.dirname(p), { recursive: true });
    deps.fs.writeFileSync(p, JSON.stringify(cache), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Entry-point hook. Cheap and fail-open — never throws, never blocks.
 *
 * @returns {{ printed: boolean, spawned: boolean }}
 */
export function maybeNotifyUpdate(opts = {}) {
  const deps = { ..._deps, ...(opts.deps || {}) };
  const env = opts.env || process.env;
  const now = opts.now ?? Date.now();
  const isTTY = opts.isTTY ?? Boolean(process.stderr.isTTY);
  const current = opts.currentVersion || VERSION;
  const print =
    opts.print || ((line) => process.stderr.write(chalk.gray(line) + "\n"));

  const out = { printed: false, spawned: false };
  try {
    if (env.CC_UPDATE_NOTICE === "0") return out;

    const cache = readCache(deps);

    if (
      isTTY &&
      cache?.latest &&
      semver.valid(cache.latest) &&
      semver.valid(current) &&
      semver.gt(cache.latest, current)
    ) {
      print(
        `Update available: chainlesschain ${current} → ${cache.latest} (npm i -g chainlesschain · CC_UPDATE_NOTICE=0 to hide)`,
      );
      out.printed = true;
    }

    const stale = !cache?.checkedAt || now - cache.checkedAt > CACHE_TTL_MS;
    if (stale) {
      // Optimistic touch first: parallel `cc` invocations inside the stale
      // window won't each spawn a refresher.
      writeCache(deps, { ...(cache || {}), checkedAt: now });
      const refresher = deps.path.join(
        deps.path.dirname(fileURLToPath(import.meta.url)),
        "update-notice-refresh.mjs",
      );
      const child = deps.spawn(
        process.execPath,
        [refresher, cachePath(deps)],
        { detached: true, stdio: "ignore", windowsHide: true },
      );
      if (child && typeof child.unref === "function") child.unref();
      out.spawned = true;
    }
  } catch {
    /* fail-open: a broken cache or spawn must never affect the CLI */
  }
  return out;
}

/**
 * One cache refresh (used by the detached child; exported for tests).
 * npm registry only — light, unauthenticated, no GitHub rate-limit risk.
 */
export async function refreshCacheOnce({
  cacheFile,
  fetchImpl = fetch,
  deps = _deps,
  now = Date.now(),
  timeoutMs = 10_000,
} = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(NPM_LATEST_URL, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.version) throw new Error("no version field");
    const file = cacheFile || cachePath(deps);
    deps.fs.mkdirSync(deps.path.dirname(file), { recursive: true });
    deps.fs.writeFileSync(
      file,
      JSON.stringify({ checkedAt: now, latest: data.version }),
      "utf-8",
    );
    return { ok: true, latest: data.version };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}
