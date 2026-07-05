import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Regression: every DB-backed `cc sso` subcommand crashed with
// "Cannot read properties of undefined (reading 'prepare')". The preAction hook
// stores the opened db on the `sso` command node (thisCommand._db), but
// _dbFromCtx resolved it from `cmd.parent.parent._db` = the ROOT program node,
// which is never assigned — the `?? cmd.parent` fallback never fires because the
// root is truthy for a 3-level tree. So the db handle was always undefined and
// the first db.prepare() threw. Fix: resolve _db from the `sso` node
// (cmd.parent._db ?? cmd._db). This test exercises the real CLI wiring + hook.

const CLI_DIR = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(CLI_DIR, "bin", "chainlesschain.js");

describe("cc sso resolves the db from the sso command node (context wiring)", () => {
  let home;

  // Pass argv as an array (no shell) so JSON args with quotes survive on
  // Windows cmd.exe as well as POSIX shells.
  function cli(args) {
    return execFileSync(process.execPath, [BIN, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
      env: { ...process.env, CHAINLESSCHAIN_HOME: home },
    });
  }

  // Strip bootstrap log lines (e.g. "[AppConfig] …") that precede a --json
  // payload, then extract the JSON array/object.
  function parseJson(out) {
    // Strip only bootstrap "[Tag] …" log lines — NOT a bare "[" that opens a
    // JSON array (the payload of `--json` list commands).
    const cleaned = out
      .split("\n")
      .filter((l) => !/^\s*\[[A-Za-z0-9_]+\]/.test(l))
      .join("\n");
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cc-sso-home-"));
  });

  afterEach(() => {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("lists configs without crashing (db handle is wired)", () => {
    // With the bug this exits 1 with the undefined-prepare crash.
    const rows = parseJson(cli(["sso", "configs", "--json"]));
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it("create then list round-trips a persisted config across processes", () => {
    const config = JSON.stringify({
      clientId: "abc",
      authorizationUrl: "https://idp.example/authorize",
      tokenUrl: "https://idp.example/token",
      redirectUri: "https://app.example/callback",
    });
    // Separate process — must not crash on db.prepare.
    cli(["sso", "create", "-n", "Acme", "-p", "oidc", "-c", config]);

    const rows = parseJson(cli(["sso", "configs", "--json"]));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Acme");
    expect(rows[0].protocol).toBe("oidc");
  });
});
