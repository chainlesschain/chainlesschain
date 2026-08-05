import {
  spawn as nativeSpawn,
  spawnSync as nativeSpawnSync,
} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MCPClient, _deps as mcpDeps } from "../../src/harness/mcp-client.js";
import { terminateOwnedProcessTree } from "../../src/lib/process-tree-termination.js";
import { issueMcpStdioExecutionAuthority } from "../../src/lib/mcp-stdio-execution-authority.js";

const SUPPORTED_PLATFORMS = new Set(["darwin", "linux", "win32"]);
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

async function waitForMarker(markerPath, nonce, timeoutMs, getEarlyOutcome) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
      if (
        marker?.nonce === nonce &&
        Number.isInteger(marker.parentPid) &&
        Number.isInteger(marker.grandchildPid)
      ) {
        return marker;
      }
    } catch {
      // The fixture publishes atomically after the grandchild starts.
    }
    const earlyOutcome = getEarlyOutcome();
    if (earlyOutcome) {
      throw new Error(
        `MCP process-tree fixture settled before publishing PIDs: ${earlyOutcome.error?.code || earlyOutcome.error?.message || (earlyOutcome.resolved ? "connected unexpectedly" : "unknown")}`,
      );
    }
    await delay(25);
  } while (Date.now() < deadline);
  throw new Error("MCP process-tree fixture did not publish its PIDs");
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
      { shell: false, stdio: "ignore", windowsHide: true },
    );
  } catch {
    return false;
  }
  const closed = new Promise((resolve) => child.once("close", resolve));
  let succeeded = false;
  try {
    const result = nativeSpawnSync(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { shell: false, stdio: "ignore", timeout: 5_000, windowsHide: true },
    );
    succeeded = !result?.error && result?.status === 0;
  } catch {
    succeeded = false;
  }
  if (!succeeded) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Best-effort cleanup of the capability probe.
    }
  }
  await Promise.race([closed, delay(2_000)]);
  if (isProcessAlive(child.pid)) {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may exit between the liveness probe and final signal.
    }
  }
  return succeeded && !isProcessAlive(child.pid);
}

function forceCleanupKnownTree(rootPid, knownPids) {
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
        // Fall through to the direct known-PID cleanup below.
      }
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Continue so every known PID gets a cleanup attempt.
      }
    }
    return;
  }
  try {
    process.kill(-rootPid, "SIGKILL");
  } catch {
    // The process group may already be empty.
  }
  for (const pid of knownPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The descendant may already be gone.
    }
  }
}

describe.skipIf(!SUPPORTED_PLATFORMS.has(process.platform))(
  "MCP stdio real process-tree cleanup",
  () => {
    it(
      "reaps the MCP root and grandchild before a failed connect settles",
      { timeout: process.platform === "win32" ? 35_000 : 20_000 },
      async ({ skip }) => {
        if (process.platform === "win32") {
          const taskkillAvailable = await canTerminateWindowsChildTree();
          if (!taskkillAvailable && process.env.CI) {
            throw new Error("taskkill /T /F is unavailable in Windows CI");
          }
          if (!taskkillAvailable) {
            skip("taskkill /T /F is unavailable in this Windows runner");
          }
        }

        const workspace = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-mcp-stdio-tree-"),
        );
        const markerPath = path.join(workspace, "tree.json");
        const nonce = `${process.pid}-${Date.now()}-${Math.random()}`;
        const originalSpawn = mcpDeps.spawn;
        const originalTerminator = mcpDeps.terminateOwnedProcessTree;
        const originalTrust = process.env.CC_MCP_EXECUTABLE_TRUST;
        const originalTrustStore = process.env.CC_MCP_EXECUTABLE_TRUST_STORE;
        let rootChild = null;
        let marker = null;
        let earlyOutcome = null;

        mcpDeps.spawn = (file, args, options) => {
          rootChild = originalSpawn(file, args, options);
          return rootChild;
        };
        mcpDeps.terminateOwnedProcessTree = (child, options) =>
          terminateOwnedProcessTree(child, {
            ...options,
            spawnSync: nativeSpawnSync,
          });
        process.env.CC_MCP_EXECUTABLE_TRUST = "1";
        process.env.CC_MCP_EXECUTABLE_TRUST_STORE = path.join(
          workspace,
          "mcp-executable-identities.json",
        );

        const client = new MCPClient();
        const connectionConfig = {
          command: process.execPath,
          args: [fixturePath],
          env: {
            ...process.env,
            CC_MCP_HEADERS_HELPER_TREE_MARKER: markerPath,
            CC_MCP_HEADERS_HELPER_TREE_NONCE: nonce,
          },
          requestTimeoutMs: process.platform === "win32" ? 8_000 : 2_000,
          processTreeGraceMs: 50,
          processTreeCleanupTimeoutMs: 2_000,
        };
        connectionConfig.mcpStdioExecutionAuthority =
          issueMcpStdioExecutionAuthority({
            serverName: "real-tree",
            config: connectionConfig,
            approvalKind: "explicit-config",
            approvalSource: "integration-fixture",
          });
        const outcome = client.connect("real-tree", connectionConfig).then(
          () => ({ resolved: true, error: null }),
          (error) => ({ resolved: false, error }),
        );
        void outcome.then((result) => {
          earlyOutcome = result;
        });

        try {
          marker = await waitForMarker(
            markerPath,
            nonce,
            process.platform === "win32" ? 12_000 : 5_000,
            () => earlyOutcome,
          );
          // POSIX launches the MCP root directly. Windows may return the
          // restricted-token Job launcher while the fixture root is its child;
          // the cleanup assertions below prove that the whole Job tree closes.
          if (process.platform !== "win32") {
            expect(marker.parentPid).toBe(rootChild.pid);
          } else {
            expect(rootChild.pid).toBeGreaterThan(0);
          }
          expect(marker.grandchildPid).not.toBe(marker.parentPid);
          expect(isProcessAlive(marker.parentPid)).toBe(true);
          expect(isProcessAlive(marker.grandchildPid)).toBe(true);

          const result = await outcome;
          expect(result.resolved).toBe(false);
          expect(result.error?.processTreeCleanup).toMatchObject({
            verifiable: true,
            closed: true,
            treeTerminated: true,
            confirmed: true,
          });

          const pids = [marker.parentPid, marker.grandchildPid];
          expect(await waitForProcessesToExit(pids, 5_000)).toBe(true);
          for (const pid of pids) expect(isProcessAlive(pid)).toBe(false);
        } finally {
          mcpDeps.spawn = originalSpawn;
          mcpDeps.terminateOwnedProcessTree = originalTerminator;
          if (originalTrust === undefined) {
            delete process.env.CC_MCP_EXECUTABLE_TRUST;
          } else {
            process.env.CC_MCP_EXECUTABLE_TRUST = originalTrust;
          }
          if (originalTrustStore === undefined) {
            delete process.env.CC_MCP_EXECUTABLE_TRUST_STORE;
          } else {
            process.env.CC_MCP_EXECUTABLE_TRUST_STORE = originalTrustStore;
          }
          const knownPids = marker ? [marker.grandchildPid] : [];
          forceCleanupKnownTree(rootChild?.pid, knownPids);
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
