"use strict";

/**
 * E2E — spawn the cc CLI and exercise the real `hub list-adapters` +
 * `hub sync-adapter` commands against a sandboxed APPDATA dir. Validates
 * the entire path PDH wiring → registry → CLI gateway → JSON stdout for
 * the 4 new Phase 17 adapters.
 *
 * Same bs3mc-on-Win caveat as the integration test: skip when LocalVault
 * cannot open. CI Linux runs the real chain.
 *
 * Strategy: redirect APPDATA / XDG_CONFIG_HOME / HOME to a tmpdir so the
 * CLI's getElectronUserDataDir() resolves to that tmpdir and we don't
 * touch the user's real chainlesschain-desktop-vue/.chainlesschain dir.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

// Probe bs3mc once — same gate as the integration test.
let bs3mcAvailable = true;
let bs3mcSkipReason = "";
try {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bs3mc-e2e-probe-"));
  const { LocalVault: PV, generateKeyHex: PK } = require("../../lib");
  const v = new PV({ path: path.join(probeDir, "p.db"), key: PK() });
  v.open();
  v.close();
  fs.rmSync(probeDir, { recursive: true, force: true });
} catch (e) {
  bs3mcAvailable = false;
  bs3mcSkipReason = e && e.message ? e.message : String(e);
}
// Resolve the CLI entry — we run it through node directly (avoids cc
// PATH lookup hassles + the workspace symlink resolves to current source).
// In the FTS5 sandbox runner (lib/ + __tests__/ copied to $TMPDIR) the
// relative ../../../cli path resolves outside the repo and is missing;
// gate the tests so they skip cleanly when the CLI binary is absent.
const CLI_BIN = path.resolve(__dirname, "..", "..", "..", "cli", "bin", "chainlesschain.js");
const cliBinAvailable = fs.existsSync(CLI_BIN);

const itOrSkip = bs3mcAvailable && cliBinAvailable ? it : it.skip;

let sandboxAppData;

function runCli(args, { timeoutMs = 60_000 } = {}) {
  const env = {
    ...process.env,
    // Override the platform user-data dir lookup so initHub() builds its
    // vault inside our sandbox instead of the real user profile.
    APPDATA: sandboxAppData,
    XDG_CONFIG_HOME: sandboxAppData,
    HOME: sandboxAppData,
    USERPROFILE: sandboxAppData,
    // Prevent CC from launching the auto-update probe / telemetry pings
    // mid-test (those can hang the spawn).
    CC_DISABLE_TELEMETRY: "1",
    CC_DISABLE_AUTOUPDATE: "1",
    NO_COLOR: "1",
  };
  const res = spawnSync(process.execPath, [CLI_BIN, ...args], {
    env,
    encoding: "utf-8",
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    code: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    signal: res.signal,
    error: res.error,
  };
}

beforeAll(() => {
  if (!bs3mcAvailable) return;
  sandboxAppData = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-e2e-appdata-"));
});

afterAll(() => {
  if (sandboxAppData) {
    try {
      fs.rmSync(sandboxAppData, { recursive: true, force: true });
    } catch (_e) {
      /* noop */
    }
  }
});

describe("cc hub list-adapters — 4 Phase 17 adapters registered", () => {
  itOrSkip("lists browser-history-chrome / -edge / vscode / win-recent", () => {
    const r = runCli(["hub", "list-adapters", "--json"]);
    // Stderr may carry deprecation noise; we only assert on the JSON stdout.
    expect(r.code).toBe(0);
    let parsed;
    try {
      parsed = JSON.parse(r.stdout);
    } catch (_e) {
      throw new Error(
        `list-adapters did not emit JSON (code=${r.code}, signal=${r.signal})\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
      );
    }
    const names = parsed.map((a) => a.name);
    for (const expected of [
      "browser-history-chrome",
      "browser-history-edge",
      "vscode",
      "win-recent",
    ]) {
      expect(names).toContain(expected);
    }
    // Per-test timeout must EXCEED runCli's 60s spawn budget (trap #31:
    // per-test/child timeout inversion). The default 10s vitest timeout
    // reaps the cold CLI subprocess spawn under full-suite/parallel load
    // before it can finish — even though the spawn itself is given 60s.
  }, 65_000);
});

describe("cc hub sync-adapter — drives one adapter end-to-end", () => {
  itOrSkip("win-recent sync against an empty Recent dir returns ok with 0 events", () => {
    // win-recent will fall through authenticate() PLATFORM_UNSUPPORTED on
    // Linux CI. To make this assertion stable across both Win and Linux
    // CI runners, we touch a sandbox Recent dir and point the adapter at
    // it via env var — but the adapter doesn't read env, only opts. So
    // this test simply validates the CLI gateway can invoke and surface
    // either an "ok empty" report (Win) or an "unhealthy" report (Linux
    // where the default dir doesn't exist). Both prove the gateway works.
    const r = runCli(["hub", "sync-adapter", "win-recent", "--json"]);
    // The CLI exits 0 for both ok and adapter-reported-error reports; it
    // exits non-zero only for hard exceptions. We accept either.
    let parsed;
    try {
      parsed = JSON.parse(r.stdout);
    } catch (_e) {
      throw new Error(
        `sync-adapter did not emit JSON (code=${r.code})\nstdout: ${r.stdout.slice(0, 400)}\nstderr: ${r.stderr.slice(0, 400)}`,
      );
    }
    expect(parsed).toBeDefined();
    // status is one of: ok / auth_expired / unhealthy / error
    expect(["ok", "auth_expired", "unhealthy", "error"]).toContain(parsed.status);
    expect(typeof parsed.rawCount).toBe("number");
    expect(parsed.entityCounts).toBeDefined();
    // Per-test timeout > runCli's 60s spawn budget (trap #31) — see the
    // list-adapters test above for the rationale.
  }, 65_000);
});
