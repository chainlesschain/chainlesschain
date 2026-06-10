/**
 * Shared e2e helpers — DB isolation, ephemeral ports, throwaway scripts.
 *
 * Two recurring e2e failure modes this addresses:
 *   1. Shared-DB contention — every spawned `cc` opens the bootstrap DB at
 *      getUserDataPath() (win32: %APPDATA%, then CHAINLESSCHAIN_HOME — NOT HOME).
 *      Without isolation, concurrent/overlapping runs contend and a recovery
 *      path leaks "[AppConfig]/[DatabaseManager]" onto stdout, breaking --json
 *      parses ("Unexpected token 'A'" / "database disk image is malformed").
 *   2. Port collisions — server e2e files binding hardcoded ports (19820, 19870…)
 *      collide when two land in the same shard or a port lingers in TIME_WAIT.
 *
 * Usage:
 *   import { testHome, freePort, CLI_BIN } from "./_helpers/cli-e2e.js";
 *   const t = testHome("ui");            // module scope
 *   afterAll(() => t.cleanup());
 *   spawnSync(process.execPath, [CLI_BIN, ...], { env: t.env() });
 *   const port = await freePort();        // inside an async beforeAll/it
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the CLI bin (…/packages/cli/bin/chainlesschain.js). */
export const CLI_BIN = join(
  __dirname,
  "..",
  "..",
  "..",
  "bin",
  "chainlesschain.js",
);

/**
 * Create a per-file temp HOME and return helpers bound to it. Call once at
 * module scope; register `cleanup()` in afterAll.
 *
 * @param {string} label  short slug for the temp-dir name
 * @returns {{ home: string, env: (extra?: object) => object,
 *             writeScript: (body: string) => string, cleanup: () => void }}
 */
export function testHome(label = "e2e") {
  const home = mkdtempSync(join(tmpdir(), `cc-${label}-`));
  return {
    home,
    // CHAINLESSCHAIN_HOME is what getUserDataPath() honors first → isolates the
    // bootstrap DB. HOME/USERPROFILE are set too for any path that still reads
    // them, but they do NOT redirect the DB on Windows on their own.
    env: (extra = {}) => ({
      ...process.env,
      CHAINLESSCHAIN_HOME: home,
      HOME: home,
      USERPROFILE: home,
      ...extra,
    }),
    // A throwaway .js script, run as `node <path>`. Use instead of inline
    // `node -e "...()"` — exec-mode loops are shell:true, and the "()" in an
    // inline -e is a POSIX /bin/sh (dash) syntax error. A path is portable.
    writeScript(body) {
      const p = join(home, `s${Math.random().toString(36).slice(2)}.js`);
      writeFileSync(p, body, "utf-8");
      return p;
    },
    cleanup() {
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

/**
 * Reserve an ephemeral TCP port the OS just confirmed free (bind :0 on
 * 127.0.0.1, read the assigned port, release). Replaces hardcoded ports so
 * server e2e tests can't collide. There's a small inherent TOCTOU window
 * between release here and the real server binding — acceptable for tests and
 * far more robust than a fixed port that may already be in use / TIME_WAIT.
 *
 * @returns {Promise<number>}
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}
