/**
 * Phase 8: smoke-runner
 *
 * Post-build sanity check that actually launches the produced exe, waits
 * for the UI HTTP + WS ports to come up, probes both, and tears it down.
 * Its job is to catch packaging regressions that the unit tests can't see:
 *
 *   - entry compiled but pkg couldn't resolve `import(...)` at runtime
 *     (this is how we first noticed `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`)
 *   - native .node embedded but ABI-mismatched AND no sql.js fallback wired
 *   - command registry missing `ui` after the entry shim injects it
 *   - HTTP listens but returns non-200 for `/` (web-panel assets not
 *     embedded, or pkg snapshot path mismatch)
 *   - project mode: /api/skills doesn't list all bundled skills
 *
 * The probe is deliberately narrow (HTTP 200 from `/` + TCP-level WS port
 * binding). Deeper handshakes belong in e2e tests.
 *
 * Called from `runPack()` as Phase 8 when `cliOpts.smokeTest !== false`.
 */

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import http from "node:http";
import path from "node:path";
import { PackError, EXIT } from "./errors.js";

const DEFAULT_BOOT_TIMEOUT_MS = 45_000;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/**
 * @param {object} ctx
 * @param {string} ctx.exePath                 absolute path to the produced .exe
 * @param {number} [ctx.uiPort=18811]          UI port to probe (must NOT clash
 *                                             with any long-running instance;
 *                                             the caller picks an unused one)
 * @param {number} [ctx.wsPort=18801]          WS port to probe
 * @param {number} [ctx.bootTimeoutMs]
 * @param {number} [ctx.probeTimeoutMs]
 * @param {string[]|null} [ctx.bundledSkillNames]  project-mode: assert these
 *                                             skill names appear in /api/skills.
 *                                             null or empty = skip the check.
 *                                             404 is tolerated (skipped with a
 *                                             warning) so packs produced against
 *                                             an older web-ui-server don't fail
 *                                             the probe.
 * @param {object} [ctx.logger]                logger.log/warn/error
 * @returns {Promise<{ok:true, uiStatus:number, wsListening:true, stdout:string, skillsCheck:object|null}>}
 */
export async function smokeTestExe(ctx) {
  const {
    exePath,
    uiPort = 18811,
    wsPort = 18801,
    bootTimeoutMs = DEFAULT_BOOT_TIMEOUT_MS,
    probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    bundledSkillNames = null,
    logger = console,
  } = ctx;

  const log = (m) => (logger.log ? logger.log(m) : logger.info?.(m));
  const warn = (m) => (logger.warn ? logger.warn(m) : log(m));

  if (!exePath) {
    throw new PackError("smokeTestExe: exePath is required", EXIT.SMOKE);
  }

  // Use env overrides so we never clash with an already-running instance
  // on the default 18800/18810. These are honored by the pack-entry shim.
  const env = {
    ...process.env,
    CC_PACK_UI_PORT: String(uiPort),
    CC_PACK_WS_PORT: String(wsPort),
    // Disable browser-open to avoid spawning a real browser in CI.
    // `cc ui --no-open` is the flag; the entry doesn't bake it, so we
    // forward it via argv below.
  };

  // Windows `spawn` refuses .cmd/.bat/.sh without shell:true. Real packed
  // artifacts are always .exe so this only kicks in during tests that use
  // a shim — kept here so the smoke-runner is self-testable.
  const needsShell = /\.(cmd|bat|sh)$/i.test(exePath);
  const child = spawn(exePath, ["ui", "--no-open"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: needsShell,
  });

  let stdoutBuf = "";
  let stderrBuf = "";
  child.stdout.on("data", (d) => {
    stdoutBuf += d.toString("utf8");
  });
  child.stderr.on("data", (d) => {
    stderrBuf += d.toString("utf8");
  });

  const killChild = () => {
    try {
      if (process.platform === "win32") {
        // child.kill on Windows doesn't traverse the process tree; taskkill
        // does. We spawned a single exe with no subprocesses so plain kill
        // is enough in practice, but /T protects us if that ever changes.
        spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
          stdio: "ignore",
        });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      /* best effort */
    }
  };

  // Early-death watchdog: if the child exits before we see a listening
  // port, report the stdout/stderr so the user sees the real failure
  // instead of a generic timeout.
  const deathPromise = new Promise((_, reject) => {
    child.on("exit", (code, signal) => {
      reject(
        new PackError(
          `Smoke-test process exited (code=${code}, signal=${signal}) before ports came up.\n` +
            `  stdout:\n${indent(stdoutBuf || "(empty)")}` +
            `\n  stderr:\n${indent(stderrBuf || "(empty)")}`,
          EXIT.SMOKE,
        ),
      );
    });
  });

  try {
    await Promise.race([
      waitForPorts({ uiPort, wsPort, timeoutMs: bootTimeoutMs }),
      deathPromise,
    ]);
  } catch (e) {
    killChild();
    throw e;
  }

  let uiStatus;
  try {
    uiStatus = await probeHttp({
      host: "127.0.0.1",
      port: uiPort,
      path: "/",
      timeoutMs: probeTimeoutMs,
    });
  } catch (e) {
    killChild();
    throw new PackError(
      `Smoke-test HTTP probe failed: ${e.message}`,
      EXIT.SMOKE,
    );
  }

  if (uiStatus < 200 || uiStatus >= 300) {
    killChild();
    throw new PackError(
      `Smoke-test HTTP probe: http://127.0.0.1:${uiPort}/ returned ${uiStatus} (expected 2xx)`,
      EXIT.SMOKE,
    );
  }

  // WS port already verified via waitForPorts — we don't do a full WS
  // upgrade here because it requires a token, which the baked-in `auto`
  // mode emits on stdout and isn't worth parsing for a smoke test.
  log(
    `        UI=${uiStatus} on :${uiPort}, WS listening on :${wsPort}, exe=${path.basename(exePath)}`,
  );

  // ── Project mode: verify bundled skills are registered ──────────────────
  // /api/skills is served by web-ui-server (Phase 2b, shipped in 69a91c450).
  // We still tolerate 404 here so older packs produced before 2b don't regress
  // the probe when re-smoked. A real HTTP error (connection refused, 5xx, JSON
  // parse failure) is a hard fail — that means the server is broken.
  let skillsCheck = null;
  if (bundledSkillNames && bundledSkillNames.length > 0) {
    let skillsBody;
    try {
      skillsBody = await probeHttpJson({
        host: "127.0.0.1",
        port: uiPort,
        path: "/api/skills",
        timeoutMs: probeTimeoutMs,
      });
    } catch (e) {
      if (/HTTP 404/.test(e.message)) {
        warn(
          `        skills check: /api/skills returned 404 — skipping (older pack predating Phase 2b)`,
        );
        skillsCheck = { ok: true, skipped: "endpoint-404" };
        killChild();
        return {
          ok: true,
          uiStatus,
          wsListening: true,
          stdout: stdoutBuf,
          skillsCheck,
        };
      }
      killChild();
      throw new PackError(
        `Smoke-test /api/skills probe failed: ${e.message}`,
        EXIT.SMOKE,
      );
    }
    const items = Array.isArray(skillsBody)
      ? skillsBody
      : Array.isArray(skillsBody?.skills)
        ? skillsBody.skills
        : [];
    const registeredNames = new Set(
      items.map((s) => (typeof s === "string" ? s : s?.name)).filter(Boolean),
    );
    const missing = bundledSkillNames.filter((n) => !registeredNames.has(n));
    if (missing.length > 0) {
      killChild();
      throw new PackError(
        `Smoke-test skills check: bundled skill(s) not registered: ${missing.join(", ")}`,
        EXIT.SMOKE,
      );
    }
    warn(
      `        skills check: ${bundledSkillNames.length} bundled skill(s) verified in /api/skills`,
    );
    skillsCheck = { ok: true, checked: bundledSkillNames.length };
  }

  killChild();

  return {
    ok: true,
    uiStatus,
    wsListening: true,
    stdout: stdoutBuf,
    skillsCheck,
  };
}

/** Wait until both TCP ports accept a connection (or we time out). */
async function waitForPorts({ uiPort, wsPort, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  const ports = [uiPort, wsPort];
  while (Date.now() < deadline) {
    const results = await Promise.all(
      ports.map((p) => tryConnect("127.0.0.1", p, 750)),
    );
    if (results.every(Boolean)) return;
    await sleep(300);
  }
  throw new PackError(
    `Smoke-test timeout: ports :${uiPort} / :${wsPort} did not open within ${timeoutMs}ms`,
    EXIT.SMOKE,
  );
}

function tryConnect(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        /* noop */
      }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("error", () => finish(false));
    sock.once("timeout", () => finish(false));
  });
}

function probeHttp({ host, port, path: urlPath, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host, port, path: urlPath, timeout: timeoutMs },
      (res) => {
        const status = res.statusCode || 0;
        // Drain body so the socket can close cleanly.
        res.on("data", () => {});
        res.on("end", () => resolve(status));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`HTTP probe timeout after ${timeoutMs}ms`));
    });
    req.on("error", reject);
  });
}

function probeHttpJson({ host, port, path: urlPath, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host, port, path: urlPath, timeout: timeoutMs },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} from ${urlPath}`));
          return;
        }
        let body = "";
        res.on("data", (d) => {
          body += d.toString("utf8");
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`JSON parse failed for ${urlPath}: ${e.message}`));
          }
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`HTTP probe timeout after ${timeoutMs}ms`));
    });
    req.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function indent(s) {
  return s
    .split("\n")
    .map((l) => "    " + l)
    .join("\n");
}
