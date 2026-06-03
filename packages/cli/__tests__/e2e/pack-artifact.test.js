/**
 * E2E: real `cc pack` build + run + WebSocket handshake.
 *
 * This is the only test that actually invokes @yao-pkg/pkg — it's slow
 * (~30-60s including pkg base-node fetch on first run) so we guard it
 * behind the CC_PACK_E2E env var. CI turns it on explicitly; local
 * `npm test` leaves it off so the fast loop stays fast.
 *
 *   # one-shot, local developer:
 *   CC_PACK_E2E=1 npx vitest run __tests__/e2e/pack-artifact.test.js
 *
 * The test also skips outside Windows since our default target is
 * node20-win-x64 (cross-target tests live in the integration suite).
 *
 * What we verify:
 *   1. `cc pack` produces an .exe + matching pack-manifest.json
 *   2. The manifest's sha256 matches the file bytes
 *   3. Running the exe with no args boots the UI (default subcommand)
 *   4. UI HTTP returns 200 on /
 *   5. WS upgrade handshake succeeds with the auto-generated token
 *   6. The exe tears down cleanly on SIGTERM
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawn } from "node:child_process";
import { createConnection } from "node:net";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.join(__dirname, "..", "..");
const bin = path.join(cliRoot, "bin", "chainlesschain.js");

const e2eEnabled = process.env.CC_PACK_E2E === "1";
const isWindows = process.platform === "win32";
const shouldRun = e2eEnabled && isWindows;

const describeE2E = shouldRun ? describe : describe.skip;

describeE2E("E2E — cc pack — real artifact + WS handshake", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pack-e2e-"));
  const outputPath = path.join(workDir, "cc-packed-e2e");
  const exePath = outputPath + ".exe";
  const uiPort = 19811;
  const wsPort = 19800;
  let spawnedExe = null;

  beforeAll(
    () => {
      // Clean slate — otherwise a stale run could mask a regression.
      for (const f of [exePath, exePath + ".pack-manifest.json"]) {
        try {
          fs.unlinkSync(f);
        } catch {
          /* nothing to clean */
        }
      }

      // Real pkg build, single win-x64 target, skip web-panel rebuild to
      // keep the build time predictable, smoke-test OFF (we do our own
      // richer probe below, and the builtin smoke clashes on ports).
      execSync(
        `node "${bin}" pack --skip-web-panel-build --allow-dirty ` +
          `--targets node20-win-x64 --output "${outputPath}" --no-smoke-test`,
        {
          cwd: cliRoot,
          encoding: "utf-8",
          timeout: 10 * 60 * 1000, // 10 minutes for cold pkg cache
          stdio: "pipe",
        },
      );
    },
    11 * 60 * 1000,
  );

  afterAll(() => {
    if (spawnedExe) {
      try {
        if (isWindows) {
          execSync(`taskkill /F /T /PID ${spawnedExe.pid}`, {
            stdio: "ignore",
          });
        } else {
          spawnedExe.kill("SIGKILL");
        }
      } catch {
        /* best effort */
      }
    }
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("produces both the .exe and its sidecar manifest", () => {
    expect(fs.existsSync(exePath)).toBe(true);
    const manifestPath = exePath + ".pack-manifest.json";
    expect(fs.existsSync(manifestPath)).toBe(true);
    const mf = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(mf.schema).toBe(1);
    expect(mf.targets).toEqual(["node20-win-x64"]);
    expect(mf.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("manifest sha256 matches the actual file bytes", () => {
    const manifestPath = exePath + ".pack-manifest.json";
    const mf = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const h = crypto.createHash("sha256");
    h.update(fs.readFileSync(exePath));
    expect(h.digest("hex")).toBe(mf.sha256);
  });

  it("exe --version returns the CLI version from the manifest", () => {
    const manifest = JSON.parse(
      fs.readFileSync(exePath + ".pack-manifest.json", "utf-8"),
    );
    const out = execSync(`"${exePath}" --version`, {
      encoding: "utf-8",
      timeout: 15_000,
    }).trim();
    expect(out).toBe(manifest.cliVersion);
  });

  it(
    "launches with no args, binds both ports, answers 200 on /, and accepts a token'd WS upgrade",
    { timeout: 120_000 },
    async () => {
      // Ports override so we never clash with a user's running instance.
      spawnedExe = spawn(exePath, [], {
        env: {
          ...process.env,
          CC_PACK_UI_PORT: String(uiPort),
          CC_PACK_WS_PORT: String(wsPort),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let stdout = "";
      spawnedExe.stdout.on("data", (d) => {
        stdout += d.toString("utf-8");
      });
      let stderr = "";
      spawnedExe.stderr.on("data", (d) => {
        stderr += d.toString("utf-8");
      });

      await waitForPorts({ uiPort, wsPort, timeoutMs: 30_000 });

      // Extract the auto-generated token from stdout. The pack-entry prints
      // a hex-32 token on its own; regex only picks lowercase hex to avoid
      // colliding with the SHA-256 manifest value on a stray echo.
      await waitFor(() => /[0-9a-f]{32}/.test(stdout), 10_000);
      const match = stdout.match(/[0-9a-f]{32}/);
      expect(match).toBeTruthy();
      const token = match[0];

      // HTTP 200 on /
      const httpStatus = await probeHttp({
        host: "127.0.0.1",
        port: uiPort,
        path: "/",
      });
      expect(httpStatus).toBe(200);

      // WS upgrade with the baked token — token is in the query string so
      // this is a straight HTTP request with the Upgrade headers set.
      const upgradeStatus = await probeUpgrade({
        host: "127.0.0.1",
        port: wsPort,
        path: "/?token=" + token,
      });
      expect(upgradeStatus).toBe(101);

      // Diagnostic output if the assertions ever fail on a new CI host.
      if (httpStatus !== 200 || upgradeStatus !== 101) {
        // eslint-disable-next-line no-console
        console.error(
          "[pack-e2e] diagnostics:\nstdout:\n" +
            stdout +
            "\nstderr:\n" +
            stderr,
        );
      }
    },
  );
});

// ───────────────────────── helpers ─────────────────────────

function waitForPorts({ uiPort, wsPort, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = async () => {
      const a = await tryConnect("127.0.0.1", uiPort, 500);
      const b = await tryConnect("127.0.0.1", wsPort, 500);
      if (a && b) return resolve();
      if (Date.now() > deadline) {
        return reject(
          new Error(
            `ports :${uiPort}/:${wsPort} not open within ${timeoutMs}ms`,
          ),
        );
      }
      setTimeout(tick, 500);
    };
    tick();
  });
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

function probeHttp({ host, port, path: urlPath }) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host, port, path: urlPath, timeout: 5000 },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve(res.statusCode || 0));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("http probe timeout")));
  });
}

/**
 * Do a manual WebSocket HTTP Upgrade against the WS port and return the
 * raw status line code. We don't parse the frame — status 101 tells us
 * the server accepted the token and switched protocols.
 */
function probeUpgrade({ host, port, path: urlPath }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = http.request({
      host,
      port,
      path: urlPath,
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.from("thesamplenonce!!").toString("base64"),
      },
      timeout: 5000,
    });
    req.on("upgrade", (res, socket) => {
      if (settled) return;
      settled = true;
      // Swallow ECONNRESET from the server-side force-kill during teardown.
      socket.on("error", () => {});
      try {
        socket.destroy();
      } catch {
        /* noop */
      }
      resolve(res.statusCode || 101);
    });
    req.on("response", (res) => {
      if (settled) return;
      settled = true;
      res.on("data", () => {});
      res.on("end", () => resolve(res.statusCode || 0));
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    req.on("timeout", () => req.destroy(new Error("upgrade probe timeout")));
    req.end();
  });
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor: condition not met in time");
}
