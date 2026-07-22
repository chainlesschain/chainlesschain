/**
 * Passive startup update notice. Cache reads are synchronous and fail-open;
 * refreshing the npm metadata is delegated to a detached child process.
 */
import fsDefault from "fs";
import pathDefault from "path";
import osDefault from "os";
import { spawn as spawnDefault } from "child_process";
import { fileURLToPath } from "url";
import chalk from "chalk";
import semver from "semver";
import { VERSION } from "../constants.js";
import { readDiskVersion } from "./version-skew.js";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const NPM_LATEST_URL =
  "https://registry.npmjs.org/chainlesschain/latest";
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

export function maybeNotifyUpdate(opts = {}) {
  const deps = { ..._deps, ...(opts.deps || {}) };
  const env = opts.env || process.env;
  const now = opts.now ?? Date.now();
  const isTTY = opts.isTTY ?? Boolean(process.stderr.isTTY);
  const running = opts.currentVersion || VERSION;
  const installed = opts.installedVersion ?? readDiskVersion() ?? running;
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
      semver.valid(installed) &&
      semver.gt(cache.latest, installed)
    ) {
      print(
        `Update available: chainlesschain ${installed} → ${cache.latest} (npm i -g chainlesschain · CC_UPDATE_NOTICE=0 to hide)`,
      );
      out.printed = true;
    } else if (
      isTTY &&
      semver.valid(installed) &&
      semver.valid(running) &&
      semver.gt(installed, running)
    ) {
      print(
        `cc was updated ${running} → ${installed} on disk — restart cc (or reload your IDE panel) to apply (CC_UPDATE_NOTICE=0 to hide)`,
      );
      out.printed = true;
    }
    const stale = !cache?.checkedAt || now - cache.checkedAt > CACHE_TTL_MS;
    if (stale) {
      writeCache(deps, { ...(cache || {}), checkedAt: now });
      const refresher = deps.path.join(
        deps.path.dirname(fileURLToPath(import.meta.url)),
        "update-notice-refresh.mjs",
      );
      const child = deps.spawn(process.execPath, [refresher, cachePath(deps)], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      if (child && typeof child.unref === "function") child.unref();
      out.spawned = true;
    }
  } catch {
    /* update hints must never affect the CLI */
  }
  return out;
}

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
