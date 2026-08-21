import {
  spawn as nativeSpawn,
  spawnSync as nativeSpawnSync,
} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runMcpHeadersHelper } from "../../src/lib/mcp-headers-helper.js";

const SUPPORTED_PLATFORMS = new Set(["darwin", "linux", "win32"]);
const windowsTreeKillRestricted =
  process.platform === "win32" && Boolean(process.env.CODEX_PERMISSION_PROFILE);
const fixturePath = fileURLToPath(
  new URL("../fixtures/mcp-headers-helper-process-tree.mjs", import.meta.url),
);

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForMarker(markerPath, nonce, timeoutMs, getEarlyExit) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
      if (
        marker?.nonce === nonce &&
        Number.isInteger(marker.parentPid) &&
        marker.parentPid > 0 &&
        Number.isInteger(marker.grandchildPid) &&
        marker.grandchildPid > 0
      ) {
        return marker;
      }
    } catch {
      // The grandchild publishes the marker atomically after it starts.
    }
    const earlyExit = getEarlyExit?.();
    if (earlyExit) {
      throw new Error(
        `headersHelper fixture exited before publishing its PIDs (${earlyExit.error?.code || "resolved"}: ${earlyExit.error?.message || "no error"}; ${earlyExit.diagnostic || "no diagnostics"})`,
      );
    }
    await delay(25);
  } while (Date.now() < deadline);
  throw new Error(
    "headersHelper process-tree fixture did not publish its PIDs",
  );
}

async function waitForProcessesToExit(pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (pids.every((pid) => !isProcessAlive(pid))) return true;
    await delay(25);
  } while (Date.now() < deadline);
  return pids.every((pid) => !isProcessAlive(pid));
}

async function canTerminateWindowsChildTree() {
  let child;
  try {
    child = nativeSpawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      },
    );
  } catch {
    return false;
  }
  const closed = new Promise((resolve) => {
    child.once("close", () => resolve(true));
    child.once("error", () => resolve(false));
  });
  let taskkillSucceeded = false;
  try {
    const result = nativeSpawnSync(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      {
        shell: false,
        stdio: "ignore",
        timeout: 5_000,
        windowsHide: true,
      },
    );
    taskkillSucceeded = !result?.error && result?.status === 0;
  } catch {
    taskkillSucceeded = false;
  }
  if (!taskkillSucceeded) {
    try {
      child.kill("SIGKILL");
    } catch {
      // The probe may have exited while taskkill was settling.
    }
  }
  const didClose = await Promise.race([closed, delay(2_000).then(() => false)]);
  if (!didClose && isProcessAlive(child.pid)) {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // Best-effort final cleanup of the single-process capability probe.
    }
  }
  return taskkillSucceeded && didClose;
}

function killKnownTree(rootPid, knownPids) {
  if (process.platform === "win32") {
    for (const pid of [rootPid, ...knownPids]) {
      if (!isProcessAlive(pid)) continue;
      try {
        const result = nativeSpawnSync(
          "taskkill",
          ["/PID", String(pid), "/T", "/F"],
          {
            shell: false,
            stdio: "ignore",
            timeout: 5_000,
            windowsHide: true,
          },
        );
        if (!result?.error && result?.status === 0) continue;
      } catch {
        // Fall through to direct termination of this known process.
      }
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Continue with every PID so a partial fixture cannot leak.
      }
    }
    return;
  }

  if (Number.isInteger(rootPid) && rootPid > 0) {
    try {
      process.kill(-rootPid, "SIGKILL");
    } catch {
      // The runner may already have reaped the independent process group.
    }
  }
  for (const pid of knownPids) {
    if (!isProcessAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

async function settleWithin(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("headersHelper timeout did not settle")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe.skipIf(!SUPPORTED_PLATFORMS.has(process.platform))(
  "MCP headersHelper real process-tree timeout",
  () => {
    it.skipIf(windowsTreeKillRestricted)(
      "reaps the helper parent and grandchild before rejecting",
      { timeout: process.platform === "win32" ? 25_000 : 15_000 },
      async ({ skip }) => {
        if (process.platform === "win32") {
          const taskkillAvailable = await canTerminateWindowsChildTree();
          if (!taskkillAvailable && process.env.CI) {
            throw new Error(
              "taskkill /T /F is unavailable in the Windows CI runner",
            );
          }
          if (!taskkillAvailable) {
            skip("taskkill /T /F is unavailable in this Windows runner");
          }
        }
        const workspace = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-mcp-helper-tree-"),
        );
        const markerPath = path.join(workspace, "tree.json");
        const localFixtureName = "headers-helper-tree-fixture.mjs";
        fs.copyFileSync(fixturePath, path.join(workspace, localFixtureName));
        const nonce = `${process.pid}-${Date.now()}-${Math.random()}`;
        const spawnCalls = [];
        const taskkillCalls = [];
        const posixKillCalls = [];
        let rootChild = null;
        let marker = null;
        let earlyOutcome = null;
        const rootDiagnostic = { close: null, error: null, stderr: "" };

        const spawn = (file, args, options) => {
          spawnCalls.push({
            file,
            args: [...args],
            options: {
              detached: options.detached,
              shell: options.shell,
            },
          });
          rootChild = nativeSpawn(file, args, options);
          rootChild.stderr?.on("data", (chunk) => {
            rootDiagnostic.stderr += String(chunk);
          });
          rootChild.once("error", (error) => {
            rootDiagnostic.error = error?.message || String(error);
          });
          rootChild.once("close", (code, signal) => {
            rootDiagnostic.close = { code, signal };
          });
          return rootChild;
        };
        const spawnSync = (file, args, options) => {
          taskkillCalls.push({
            file,
            args: [...args],
            options: {
              shell: options.shell,
              windowsHide: options.windowsHide,
            },
          });
          return nativeSpawnSync(file, args, options);
        };
        const kill = (pid, signal) => {
          posixKillCalls.push([pid, signal]);
          return process.kill(pid, signal);
        };
        const outcome = runMcpHeadersHelper(
          {
            command: `node ${localFixtureName}`,
            cwd: workspace,
            env: process.env,
            serverName: nonce,
          },
          {
            cleanupTimeoutMs: 2_000,
            issueSandboxExecutionContract: () => null,
            kill,
            spawn,
            spawnSync,
            timeoutMs: 5_000,
          },
        ).then(
          () => ({ resolved: true, error: null }),
          (error) => ({ resolved: false, error }),
        );
        void outcome.then((result) => {
          earlyOutcome = {
            ...result,
            diagnostic: JSON.stringify(rootDiagnostic),
          };
        });

        try {
          marker = await waitForMarker(
            markerPath,
            nonce,
            4_000,
            () => earlyOutcome,
          );
          expect(marker.parentPid).not.toBe(marker.grandchildPid);
          expect(isProcessAlive(marker.parentPid)).toBe(true);
          expect(isProcessAlive(marker.grandchildPid)).toBe(true);

          const result = await settleWithin(outcome, 9_000);
          expect(result.resolved).toBe(false);
          expect(result.error).toMatchObject({
            code: "CC_MCP_HEADERS_HELPER_TIMEOUT",
            cleanupConfirmed: true,
          });

          const pids = [
            rootChild?.pid,
            marker.parentPid,
            marker.grandchildPid,
          ].filter((pid) => Number.isInteger(pid) && pid > 0);
          expect(await waitForProcessesToExit(pids, 5_000)).toBe(true);
          for (const pid of pids) expect(isProcessAlive(pid)).toBe(false);

          expect(spawnCalls).toHaveLength(1);
          if (process.platform === "win32") {
            expect(taskkillCalls).toContainEqual(
              expect.objectContaining({
                file: "taskkill",
                args: ["/PID", String(rootChild.pid), "/T", "/F"],
                options: expect.objectContaining({ shell: false }),
              }),
            );
          } else {
            expect(spawnCalls[0].options).toMatchObject({
              detached: true,
              shell: false,
            });
            expect(posixKillCalls).toContainEqual([-rootChild.pid, "SIGKILL"]);
          }
        } finally {
          const knownPids = marker
            ? [marker.parentPid, marker.grandchildPid]
            : [];
          killKnownTree(rootChild?.pid, knownPids);
          await waitForProcessesToExit(
            [rootChild?.pid, ...knownPids].filter(
              (pid) => Number.isInteger(pid) && pid > 0,
            ),
            2_000,
          );
          fs.rmSync(workspace, {
            recursive: true,
            force: true,
            maxRetries: 20,
            retryDelay: 50,
          });
        }
      },
    );
  },
);
