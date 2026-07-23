/** Startup update notice — cache read/print + detached refresh spawning. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  maybeNotifyUpdate,
  refreshCacheOnce,
  cachePath,
  CACHE_TTL_MS,
} from "../../src/lib/update-notice.js";

let home;
let deps;
let spawned;

function writeCache(obj) {
  const p = cachePath(deps);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj), "utf-8");
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "cc-upnote-"));
  spawned = [];
  deps = {
    fs,
    path,
    os: { homedir: () => home },
    spawn: (...args) => {
      spawned.push(args);
      return { unref: () => {} };
    },
  };
});

afterEach(() => {
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

const NOW = 1765000000000;

describe("maybeNotifyUpdate", () => {
  it("prints when the cached latest is newer (TTY)", () => {
    writeCache({ checkedAt: NOW - 1000, latest: "9.9.9" });
    const lines = [];
    const res = maybeNotifyUpdate({
      deps,
      env: {},
      now: NOW,
      isTTY: true,
      currentVersion: "0.1.0",
      installedVersion: "0.1.0",
      print: (l) => lines.push(l),
    });
    expect(res.printed).toBe(true);
    expect(lines[0]).toContain("0.1.0 → 9.9.9");
    expect(res.spawned).toBe(false); // cache fresh → no refresher
  });

  it("stays silent without TTY, when disabled, or when up to date", () => {
    writeCache({ checkedAt: NOW - 1000, latest: "9.9.9" });
    const base = {
      deps,
      now: NOW,
      currentVersion: "0.1.0",
      installedVersion: "0.1.0",
      print: () => {},
    };
    expect(maybeNotifyUpdate({ ...base, env: {}, isTTY: false }).printed).toBe(
      false,
    );
    expect(
      maybeNotifyUpdate({
        ...base,
        env: { CC_UPDATE_NOTICE: "0" },
        isTTY: true,
      }).printed,
    ).toBe(false);
    writeCache({ checkedAt: NOW - 1000, latest: "0.0.1" });
    expect(maybeNotifyUpdate({ ...base, env: {}, isTTY: true }).printed).toBe(
      false,
    );
  });

  it("compares the INSTALLED (disk) version vs latest — a stale process whose disk is already current does NOT nag npm i -g, but is told to restart", () => {
    // npm latest == what's installed on disk, but THIS process loaded an older
    // version (long-lived process survived an `npm i -g`). It must not say
    // "Update available / npm i -g" (disk is current) — it must say "restart".
    writeCache({ checkedAt: NOW - 1000, latest: "0.162.118" });
    const lines = [];
    const res = maybeNotifyUpdate({
      deps,
      env: {},
      now: NOW,
      isTTY: true,
      currentVersion: "0.162.117", // running (stale, in memory)
      installedVersion: "0.162.118", // on disk (already updated)
      print: (l) => lines.push(l),
    });
    expect(res.printed).toBe(true);
    expect(lines[0]).toContain("restart");
    expect(lines[0]).toContain("0.162.117 → 0.162.118");
    expect(lines[0]).not.toContain("npm i -g"); // re-install would be a no-op
  });

  it("a genuine new release (disk < latest) still says Update available, keyed on the installed version", () => {
    writeCache({ checkedAt: NOW - 1000, latest: "0.162.120" });
    const lines = [];
    const res = maybeNotifyUpdate({
      deps,
      env: {},
      now: NOW,
      isTTY: true,
      currentVersion: "0.162.118",
      installedVersion: "0.162.118",
      print: (l) => lines.push(l),
    });
    expect(res.printed).toBe(true);
    expect(lines[0]).toContain("Update available");
    expect(lines[0]).toContain("0.162.118 → 0.162.120");
    expect(lines[0]).toContain("npm i -g");
  });

  it("skew is detected even without a cache (running < installed) → restart message", () => {
    // no cache written → first branch can't fire; the skew branch still does.
    const lines = [];
    const res = maybeNotifyUpdate({
      deps,
      env: {},
      now: NOW,
      isTTY: true,
      currentVersion: "0.162.117",
      installedVersion: "0.162.118",
      print: (l) => lines.push(l),
    });
    expect(res.printed).toBe(true);
    expect(lines[0]).toContain("restart");
  });

  it("running == installed == latest → silent (no false nag)", () => {
    writeCache({ checkedAt: NOW - 1000, latest: "0.162.118" });
    const lines = [];
    const res = maybeNotifyUpdate({
      deps,
      env: {},
      now: NOW,
      isTTY: true,
      currentVersion: "0.162.118",
      installedVersion: "0.162.118",
      print: (l) => lines.push(l),
    });
    expect(res.printed).toBe(false);
    expect(lines).toHaveLength(0);
  });

  it("spawns the detached refresher when the cache is stale, touching checkedAt first", () => {
    writeCache({ checkedAt: NOW - CACHE_TTL_MS - 1, latest: "0.0.1" });
    const res = maybeNotifyUpdate({
      deps,
      env: {},
      now: NOW,
      isTTY: true,
      currentVersion: "1.0.0",
      installedVersion: "1.0.0",
      print: () => {},
    });
    expect(res.spawned).toBe(true);
    expect(spawned).toHaveLength(1);
    const [bin, args, opts] = spawned[0];
    expect(bin).toBe(process.execPath);
    expect(String(args[0])).toContain("update-notice-refresh.mjs");
    expect(opts.detached).toBe(true);
    expect(opts).toMatchObject({
      origin: "update:notice-refresh",
      policy: "allow",
      scope: "update",
      shell: false,
    });
    // optimistic touch — a second call inside the window must NOT respawn
    const again = maybeNotifyUpdate({
      deps,
      env: {},
      now: NOW + 1000,
      isTTY: true,
      currentVersion: "1.0.0",
      installedVersion: "1.0.0",
      print: () => {},
    });
    expect(again.spawned).toBe(false);
    expect(spawned).toHaveLength(1);
  });

  it("missing cache → no print, but refresher spawns (first run)", () => {
    const res = maybeNotifyUpdate({
      deps,
      env: {},
      now: NOW,
      isTTY: true,
      currentVersion: "1.0.0",
      installedVersion: "1.0.0",
      print: () => {},
    });
    expect(res.printed).toBe(false);
    expect(res.spawned).toBe(true);
  });

  it("corrupt cache is fail-open", () => {
    const p = cachePath(deps);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "{not json", "utf-8");
    expect(() =>
      maybeNotifyUpdate({
        deps,
        env: {},
        now: NOW,
        isTTY: true,
        print: () => {},
      }),
    ).not.toThrow();
  });
});

describe("refreshCacheOnce", () => {
  it("writes {checkedAt, latest} from the npm registry response", async () => {
    const cacheFile = path.join(home, "sub", "update-check.json");
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: "2.3.4" }),
    }));
    const res = await refreshCacheOnce({
      cacheFile,
      fetchImpl,
      deps,
      now: NOW,
    });
    expect(res).toEqual({ ok: true, latest: "2.3.4" });
    expect(JSON.parse(fs.readFileSync(cacheFile, "utf-8"))).toEqual({
      checkedAt: NOW,
      latest: "2.3.4",
    });
  });

  it("reports failure without throwing on HTTP errors", async () => {
    const res = await refreshCacheOnce({
      cacheFile: path.join(home, "x.json"),
      fetchImpl: async () => ({ ok: false, status: 503 }),
      deps,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("503");
  });
});
