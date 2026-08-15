/**
 * Real ProcessExecutionBroker platform-boundary smoke test.
 *
 * The dedicated CI matrix sets CC_SANDBOX_LIVE=1 on Linux, macOS, and
 * Windows. A missing native primitive must fail the test; it must never turn
 * into an always-green skip in that workflow.
 */

import {
  spawn as nativeSpawn,
  spawnSync as nativeSpawnSync,
} from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import { executeBackgroundTaskCommand } from "../../src/harness/background-task-command-runner.js";
import {
  applySandbox,
  applyWindowsSandbox,
  resetWindowsSandboxAdapterCache,
  SANDBOX_BOUNDARIES,
} from "../../src/lib/process-execution-broker/platform-sandbox.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";

const LIVE = process.env.CC_SANDBOX_LIVE === "1";
const SUPPORTED = ["linux", "darwin", "win32"].includes(process.platform);
const expectedEnforcement = {
  linux: "linux-prlimit",
  darwin: "macos-seatbelt",
  win32: "windows-job-restricted-token",
};
const LINUX_BWRAP_PATH = "/usr/bin/bwrap";
const LINUX_BWRAP_SUPERVISOR_STAGING_PATH = "/run/.chainless-bwrap-supervisor";
const LINUX_BWRAP_SUPERVISOR_BINDING =
  "pinned-child-fd3-file-consume-run-overmount-v1";
const LINUX_ENTRY_SNAPSHOT_MECHANISM =
  "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1";

afterAll(() => {
  expect(resetWindowsSandboxAdapterCache()).toBe(true);
});

function quotePosix(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function mountInfoPath(value) {
  return String(value)
    .replaceAll("\\", "\\134")
    .replaceAll(" ", "\\040")
    .replaceAll("\t", "\\011")
    .replaceAll("\n", "\\012");
}

function fileSha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function fileIdentity(filePath) {
  const realPath = fs.realpathSync.native(filePath);
  const stat = fs.statSync(realPath);
  const preciseStat = fs.statSync(realPath, { bigint: true });
  return {
    contractVersion: 1,
    realPath,
    sha256: fileSha256(realPath),
    bytes: Number(preciseStat.size),
    fileId: {
      dev: String(preciseStat.dev),
      ino: String(preciseStat.ino),
    },
    mtimeMs: stat.mtimeMs,
    attestation: "realpath-file-id-sha256",
  };
}

async function warmBrokerAsyncRuntime(cwd) {
  // The credential transport Worker and first piped async child intentionally
  // establish process-lifetime libuv descriptors. Establish those host-runtime
  // descriptors before measuring per-launch FD ownership. Keep the warmup
  // explicitly unsandboxed so a first-use sandbox leak can never be absorbed
  // into the baseline.
  let readyTimeout;
  try {
    await Promise.race([
      executionBroker._credentialAgent.waitForTransportReady(),
      new Promise((_, reject) => {
        readyTimeout = setTimeout(
          () => reject(new Error("credential transport warmup timed out")),
          10_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(readyTimeout);
  }
  const previousStrict = process.env.CC_SANDBOX_STRICT;
  const previousDisable = process.env.CC_SANDBOX_DISABLE;
  try {
    delete process.env.CC_SANDBOX_STRICT;
    process.env.CC_SANDBOX_DISABLE = "1";
    await new Promise((resolve, reject) => {
      executionBroker.execFile(
        process.execPath,
        ["-e", ""],
        {
          cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          origin: "test:linux-live-fd-baseline-warmup",
          scope: "sandbox-test",
          policy: "allow",
        },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });
  } finally {
    if (previousStrict === undefined) {
      delete process.env.CC_SANDBOX_STRICT;
    } else {
      process.env.CC_SANDBOX_STRICT = previousStrict;
    }
    if (previousDisable === undefined) {
      delete process.env.CC_SANDBOX_DISABLE;
    } else {
      process.env.CC_SANDBOX_DISABLE = previousDisable;
    }
  }
  await new Promise((resolve) => setImmediate(resolve));
}

function expectLinuxSupervisorPlan(supervisorPlan) {
  expect(supervisorPlan).toMatchObject({
    command: "/proc/self/fd/3",
    childFd3Mapped: true,
    supervisorFile: {
      childFd: "3",
      destination: LINUX_BWRAP_SUPERVISOR_STAGING_PATH,
      permissions: "0000",
    },
  });
  expect(supervisorPlan.runDirectoryIndex).toBeGreaterThanOrEqual(0);
  expect(supervisorPlan.supervisorFile.index).toBeGreaterThan(
    supervisorPlan.runDirectoryIndex,
  );
  expect(supervisorPlan.runTmpfsIndex).toBeGreaterThan(
    supervisorPlan.supervisorFile.index,
  );
  expect(supervisorPlan.descriptorChildFds.length).toBeGreaterThan(0);
  expect(
    supervisorPlan.descriptorChildFds.every(
      (childFd) => Number.isInteger(childFd) && childFd >= 4,
    ),
  ).toBe(true);
}

function expectLinuxSupervisorAudit(
  audit,
  supervisorIdentity,
  { pid1ExecutableExposure = "procfs" } = {},
) {
  expect(audit.sandboxRuntimeProbe).toMatchObject({
    supervisorDescriptorBound: true,
    supervisorExecutablePinned: true,
    supervisorBindingScope: "host-path-replacement",
    supervisorDescriptorBindingMechanism: LINUX_BWRAP_SUPERVISOR_BINDING,
    supervisorDescriptorContained: true,
    supervisorDescriptorConsumedBeforeTarget: true,
    supervisorStagingPathHidden: true,
    supervisorTemporaryCopyObscured: true,
    supervisorPid1ExecutableExposure: pid1ExecutableExposure,
    supervisorExecutableIdentity: {
      path: LINUX_BWRAP_PATH,
      fileId: supervisorIdentity.fileId,
      sha256: supervisorIdentity.sha256,
      bytes: supervisorIdentity.bytes,
    },
  });
}

function waitForJsonLine(
  child,
  stream,
  predicate,
  label,
  timeoutMs = 15_000,
  diagnostics = () => "",
) {
  return new Promise((resolve, reject) => {
    let pending = "";
    let transcript = "";
    let settled = false;
    const failureContext = () => {
      let diagnosticText = "";
      try {
        diagnosticText = String(diagnostics() || "");
      } catch (error) {
        diagnosticText = `diagnostic callback failed: ${error?.message || error}`;
      }
      return `stdout=${JSON.stringify(transcript)} stderr=${JSON.stringify(
        diagnosticText,
      )}`;
    };
    const timer = setTimeout(() => {
      finish(
        reject,
        new Error(`Timed out waiting for ${label}: ${failureContext()}`),
      );
    }, timeoutMs);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.off("data", onData);
      child.off("error", onError);
      child.off("close", onClose);
      callback(value);
    };
    const inspectLine = (line) => {
      if (!line.trim()) return false;
      try {
        const parsed = JSON.parse(line);
        if (predicate(parsed)) {
          finish(resolve, parsed);
          return true;
        }
      } catch {
        // Keep non-JSON diagnostics for the timeout/exit failure context.
      }
      return false;
    };
    const onData = (chunk) => {
      pending += chunk;
      transcript = `${transcript}${chunk}`.slice(-16 * 1024);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) {
        if (inspectLine(line)) return;
      }
    };
    const onError = (error) => finish(reject, error);
    const onClose = (code, signal) => {
      if (inspectLine(pending)) return;
      finish(
        reject,
        new Error(
          `${label} process closed before its report (${code}/${signal}): ${failureContext()}`,
        ),
      );
    };
    stream.setEncoding("utf8");
    stream.on("data", onData);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

describe("live sandbox helper diagnostics", () => {
  it("drains stdout and stderr before reporting a missing JSON event", async () => {
    const stderrChunks = [];
    const child = nativeSpawn(
      process.execPath,
      [
        "-e",
        [
          'process.stdout.write(JSON.stringify({ event: "OTHER" }) + "\\n");',
          'process.stderr.write("native helper detail\\n", () => {',
          "  process.exit(125);",
          "});",
        ].join("\n"),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    const failure = await waitForJsonLine(
      child,
      child.stdout,
      (record) => record?.event === "EXPECTED",
      "diagnostic fixture",
      10_000,
      () => Buffer.concat(stderrChunks).toString(),
    ).then(
      () => null,
      (error) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("(125/null)");
    expect(failure.message).toContain(String.raw`{\"event\":\"OTHER\"}`);
    expect(failure.message).toContain(String.raw`native helper detail\n`);
  });
});

async function waitForChildClose(closePromise, timeoutMs = 10_000) {
  let timer;
  try {
    await Promise.race([
      closePromise.catch(() => null),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function shutdownLoopbackServer(serverChild, stderrChunks) {
  const stderr = () => Buffer.concat(stderrChunks).toString();
  if (serverChild.exitCode !== null || serverChild.signalCode !== null) {
    throw new Error(
      `Loopback server exited unexpectedly (${serverChild.exitCode}/${serverChild.signalCode}): ${stderr()}`,
    );
  }

  const serverExit = once(serverChild, "exit");
  let onClosed;
  const closed = new Promise((resolve) => {
    onClosed = (message) => {
      if (message?.closed === true) resolve(message);
    };
    serverChild.on("message", onClosed);
  });
  const withTimeout = (promise, message) => {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 10_000);
      }),
    ]).finally(() => clearTimeout(timer));
  };

  try {
    await new Promise((resolve, reject) => {
      serverChild.send({ shutdown: true }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await withTimeout(closed, "Timed out closing loopback server");
    const [serverExitCode, serverSignal] = await withTimeout(
      serverExit,
      "Timed out waiting for loopback server exit",
    );
    if (serverExitCode !== 0 || serverSignal !== null) {
      throw new Error(
        `Loopback server cleanup failed (${serverExitCode}/${serverSignal}): ${stderr()}`,
      );
    }
  } catch (error) {
    serverChild.kill();
    throw error;
  } finally {
    serverChild.off("message", onClosed);
  }
}

describe.runIf(LIVE && SUPPORTED)(
  "live ProcessExecutionBroker strict platform boundary",
  () => {
    let previousStrict;
    let previousDisable;
    let previousSandboxEnabled;
    let previousPlatformEnabled;
    let forbiddenPath;
    let cleanupPaths;

    beforeEach(() => {
      previousStrict = process.env.CC_SANDBOX_STRICT;
      previousDisable = process.env.CC_SANDBOX_DISABLE;
      previousSandboxEnabled = executionBroker._sandboxEnabled;
      previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      executionBroker.flushAuditLog();
      forbiddenPath = null;
      cleanupPaths = [];
    });

    afterEach(() => {
      if (previousStrict === undefined) {
        delete process.env.CC_SANDBOX_STRICT;
      } else {
        process.env.CC_SANDBOX_STRICT = previousStrict;
      }
      if (previousDisable === undefined) {
        delete process.env.CC_SANDBOX_DISABLE;
      } else {
        process.env.CC_SANDBOX_DISABLE = previousDisable;
      }
      executionBroker._sandboxEnabled = previousSandboxEnabled;
      executionBroker._platformSandboxEnabled = previousPlatformEnabled;
      executionBroker.flushAuditLog();
      if (forbiddenPath) {
        fs.rmSync(forbiddenPath, { force: true });
      }
      for (const cleanupPath of cleanupPaths) {
        fs.rmSync(cleanupPath, { force: true });
      }
    });

    it("executes through the real strict adapter and records its enforcement", () => {
      let command;
      let args;
      if (process.platform === "win32") {
        command = process.execPath;
        args = [
          "-e",
          [
            'if (process.env.CC_WINDOWS_SANDBOX_PROFILE !== "strict") {',
            "  process.exit(70);",
            "}",
            'process.stdout.write("strict-ok");',
          ].join("\n"),
        ];
      } else if (process.platform === "darwin") {
        forbiddenPath = path.join(
          os.homedir(),
          `.cc-seatbelt-forbidden-${process.pid}-${Date.now()}`,
        );
        command = "/bin/sh";
        args = [
          "-c",
          `if printf blocked > ${quotePosix(
            forbiddenPath,
          )} 2>/dev/null; then exit 77; fi; printf strict-ok`,
        ];
      } else {
        command = "/bin/sh";
        args = [
          "-c",
          'test "$CHAINLESS_SANDBOXED" = "1" && test "$(ulimit -n)" -le 64 && printf strict-ok',
        ];
      }

      const result = executionBroker.spawnSync(command, args, {
        origin: "test:strict-platform-sandbox-live",
        scope: "sandbox-test",
        policy: "allow",
        encoding: "utf8",
        timeout: 120_000,
        env: process.env,
      });

      const failureContext = JSON.stringify({
        status: result.status,
        signal: result.signal,
        error: result.error?.message,
        stderr: String(result.stderr || ""),
      });
      expect(result.error, failureContext).toBeUndefined();
      expect(result.status, failureContext).toBe(0);
      expect(result.stdout.trim()).toBe("strict-ok");
      if (forbiddenPath) {
        expect(fs.existsSync(forbiddenPath)).toBe(false);
      }
      expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
        sandboxed: true,
        sandboxState: "ready",
        sandboxProfile: "strict",
        sandboxEnforcement: expectedEnforcement[process.platform],
      });
    }, 180_000);

    it.runIf(process.platform === "win32")(
      "enforces the attested AppContainer filesystem and network boundary and removes its profile",
      async () => {
        const nonce = `${process.pid}-${Date.now()}`;
        const secretPath = path.join(
          os.tmpdir(),
          `.cc-appcontainer-secret-${nonce}`,
        );
        const markerPath = path.join(
          os.tmpdir(),
          `.cc-appcontainer-marker-${nonce}`,
        );
        cleanupPaths.push(secretPath, markerPath);
        fs.writeFileSync(secretPath, "host-only-secret", { mode: 0o600 });
        fs.rmSync(markerPath, { force: true });

        const serverStderr = [];
        const serverChild = nativeSpawn(
          process.execPath,
          [
            "-e",
            [
              'const net = require("node:net");',
              "const server = net.createServer((socket) => {",
              "  socket.on('error', () => {});",
              "  socket.end('ok');",
              "});",
              "server.once('error', (error) => {",
              "  process.send({ error: error.message });",
              "  process.exit(2);",
              "});",
              "server.listen(0, '127.0.0.1', () => {",
              "  process.send({ ready: true, port: server.address().port });",
              "});",
              "process.on('message', (message) => {",
              "  if (message?.shutdown !== true) return;",
              "  server.close(() => {",
              "    process.send({ closed: true }, (error) => {",
              "      process.exitCode = error ? 3 : 0;",
              "      process.disconnect();",
              "    });",
              "  });",
              "});",
            ].join("\n"),
          ],
          {
            env: process.env,
            stdio: ["ignore", "ignore", "pipe", "ipc"],
            windowsHide: true,
          },
        );
        serverChild.stderr.on("data", (chunk) => serverStderr.push(chunk));
        const serverReady = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            serverChild.kill();
            finish(
              reject,
              new Error(
                `Timed out waiting for loopback server: ${Buffer.concat(
                  serverStderr,
                ).toString()}`,
              ),
            );
          }, 10_000);
          const finish = (callback, value) => {
            clearTimeout(timer);
            serverChild.off("message", onMessage);
            serverChild.off("error", onError);
            serverChild.off("exit", onExit);
            callback(value);
          };
          const onMessage = (message) => {
            if (message?.error) {
              finish(reject, new Error(message.error));
              return;
            }
            if (
              message?.ready === true &&
              Number.isSafeInteger(message.port) &&
              message.port > 0
            ) {
              finish(resolve, message);
            }
          };
          const onError = (error) => finish(reject, error);
          const onExit = (code, signal) =>
            finish(
              reject,
              new Error(
                `Loopback server exited before ready (${code}/${signal}): ${Buffer.concat(
                  serverStderr,
                ).toString()}`,
              ),
            );
          serverChild.on("message", onMessage);
          serverChild.once("error", onError);
          serverChild.once("exit", onExit);
        });
        let result;
        let launchError;
        let cleanupError;
        try {
          await new Promise((resolve, reject) => {
            const socket = net.connect({
              host: "127.0.0.1",
              port: serverReady.port,
            });
            let response = "";
            const timer = setTimeout(() => {
              socket.destroy();
              reject(new Error("Host control connection timed out"));
            }, 5_000);
            socket.setEncoding("utf8");
            socket.on("data", (chunk) => {
              response += chunk;
            });
            socket.once("end", () => {
              clearTimeout(timer);
              if (response === "ok") {
                resolve();
              } else {
                reject(
                  new Error(
                    `Host control connection returned ${JSON.stringify(
                      response,
                    )}`,
                  ),
                );
              }
            });
            socket.once("error", (error) => {
              clearTimeout(timer);
              reject(error);
            });
          });
          result = executionBroker.spawnSync(
            process.execPath,
            [
              "-e",
              [
                'const fs = require("node:fs");',
                'const net = require("node:net");',
                "const report = {",
                "  started: true,",
                "  appContainer: process.env.CC_WINDOWS_APPCONTAINER,",
                "  appContainerProfile:",
                "    process.env.CC_WINDOWS_APPCONTAINER_PROFILE,",
                "  appContainerSid: process.env.CC_WINDOWS_APPCONTAINER_SID,",
                "  secretReadable: false,",
                "  secretError: null,",
                "  markerWritable: false,",
                "  markerError: null,",
                "  loopbackConnected: false,",
                "  networkError: null,",
                "};",
                "try {",
                `  fs.readFileSync(${JSON.stringify(secretPath)}, "utf8");`,
                "  report.secretReadable = true;",
                "} catch (error) {",
                "  report.secretError = error.code || error.message;",
                "}",
                "try {",
                `  fs.writeFileSync(${JSON.stringify(markerPath)}, "blocked");`,
                "  report.markerWritable = true;",
                "} catch (error) {",
                "  report.markerError = error.code || error.message;",
                "}",
                "let finished = false;",
                "let socket;",
                "const finish = (connected, error) => {",
                "  if (finished) return;",
                "  finished = true;",
                "  clearTimeout(timer);",
                "  socket?.destroy();",
                "  report.loopbackConnected = connected;",
                "  report.networkError = error;",
                "  process.stdout.write(JSON.stringify(report));",
                "};",
                "const timer = setTimeout(() => finish(false, 'timeout'), 3000);",
                "try {",
                "  socket = net.connect({",
                "    host: '127.0.0.1',",
                `    port: ${serverReady.port},`,
                "  });",
                "  socket.once('connect', () => finish(true, null));",
                "  socket.once('error', (error) =>",
                "    finish(false, error.code || error.message),",
                "  );",
                "} catch (error) {",
                "  finish(false, error.code || error.message);",
                "}",
              ].join("\n"),
            ],
            {
              origin: "test:windows-appcontainer-boundaries-live",
              scope: "sandbox-test",
              policy: "allow",
              encoding: "utf8",
              timeout: 180_000,
              env: process.env,
              sandboxPolicy: {
                profile: "strict",
                requiredBoundaries: [
                  SANDBOX_BOUNDARIES.FILESYSTEM,
                  SANDBOX_BOUNDARIES.NETWORK,
                ],
              },
            },
          );
        } catch (error) {
          launchError = error;
        } finally {
          try {
            await shutdownLoopbackServer(serverChild, serverStderr);
          } catch (error) {
            cleanupError = error;
          }
        }
        if (launchError) {
          if (cleanupError) launchError.loopbackCleanupError = cleanupError;
          throw new Error(
            `Windows AppContainer launch failed: ${JSON.stringify({
              message: launchError.message,
              code: launchError.code,
              sandboxReason: launchError.sandboxReason,
              sandboxCandidateReason: launchError.sandboxCandidateReason,
              sandboxRuntimeProbe: launchError.sandboxRuntimeProbe,
              loopbackCleanupError:
                launchError.loopbackCleanupError?.message || null,
              audit: executionBroker.getAuditLog(1)[0] || null,
            })}`,
            { cause: launchError },
          );
        }
        if (cleanupError) throw cleanupError;

        const failureContext = JSON.stringify({
          status: result?.status,
          signal: result?.signal,
          error: result?.error?.message,
          stderr: String(result?.stderr || ""),
        });
        expect(result?.error, failureContext).toBeUndefined();
        expect(result?.status, failureContext).toBe(0);
        const report = JSON.parse(result.stdout);
        expect(report).toMatchObject({
          started: true,
          appContainer: "1",
          secretReadable: false,
          markerWritable: false,
          loopbackConnected: false,
        });
        expect(report.appContainerProfile).toMatch(
          /^ChainlessChain\.CliSandbox\.[a-f0-9]{24}$/,
        );
        expect(report.appContainerSid).toMatch(/^S-1-15-2(?:-\d+)+$/);
        expect(report.secretError).toBeTruthy();
        expect(report.markerError).toBeTruthy();
        expect(report.networkError).toBeTruthy();
        expect(fs.existsSync(markerPath)).toBe(false);
        expect(fs.readFileSync(secretPath, "utf8")).toBe("host-only-secret");

        const audit = executionBroker.getAuditLog(1)[0];
        expect(audit).toMatchObject({
          sandboxed: true,
          sandboxState: "ready",
          sandboxProfile: "strict",
          sandboxBackend: "windows-appcontainer-job-restricted-token",
          sandboxEnforcement: "windows-appcontainer-job-restricted-token",
          sandboxPolicyAttested: true,
          sandboxRequired: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
          sandboxRuntimeProbe: {
            kind: "windows-appcontainer-launch-attestation-v1",
            attempted: true,
            runnable: true,
            reason: null,
          },
        });
        expect(audit.sandboxGuarantees).toEqual(
          expect.arrayContaining([
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
            SANDBOX_BOUNDARIES.PROCESS_TREE,
            SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
            SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
          ]),
        );

        // The synchronous broker cleanup calls the digest-attested helper's
        // delete-and-assert-absent operation. A failed absence proof throws
        // from spawnSync's finally block, so reaching here proves cleanup.
      },
      300_000,
    );

    it.runIf(process.platform === "win32")(
      "runs a self-contained policy-bearing Plugin Node bin from a verified entry snapshot",
      () => {
        const workspace = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-windows-plugin-node-live-"),
        );
        const pluginRoot = pluginVersionDir("local", "strict-live", "1.0.0", {
          cwd: workspace,
        });
        const pluginEntry = path.join(pluginRoot, "bin", "strict-live.cjs");
        const childFixture = fileURLToPath(
          new URL(
            "../fixtures/process-broker-linux-bwrap-live-child.mjs",
            import.meta.url,
          ),
        );

        try {
          fs.mkdirSync(path.dirname(pluginEntry), { recursive: true });
          fs.writeFileSync(
            path.join(pluginRoot, "plugin.json"),
            JSON.stringify({
              name: "strict-live",
              version: "1.0.0",
              permissions: { process: true },
              sandboxPolicy: {
                requiredBoundaries: [
                  SANDBOX_BOUNDARIES.FILESYSTEM,
                  SANDBOX_BOUNDARIES.NETWORK,
                ],
              },
              bin: { "strict-live": "bin/strict-live.cjs" },
            }),
            "utf8",
          );
          fs.writeFileSync(
            pluginEntry,
            [
              "process.stdout.write(JSON.stringify({",
              "  filename: __filename,",
              "  argvEntry: process.argv[1],",
              "  mainMatches: require.main === module,",
              "  evalPresent: Object.prototype.hasOwnProperty.call(process, '_eval'),",
              "  cwd: process.cwd(),",
              "  sandboxed: process.env.CC_WINDOWS_SANDBOXED || null,",
              "  profile: process.env.CC_WINDOWS_SANDBOX_PROFILE || null,",
              "}));",
            ].join("\n") + `\n/*${"x".repeat(128 * 1024)}*/\n`,
            "utf8",
          );

          const coordinator = nativeSpawnSync(
            process.execPath,
            [childFixture, "positive", workspace],
            {
              encoding: "utf8",
              timeout: 300_000,
              windowsHide: true,
              env: {
                ...process.env,
                CC_SANDBOX_STRICT: "1",
              },
            },
          );
          const failureContext = JSON.stringify({
            status: coordinator.status,
            signal: coordinator.signal,
            error: coordinator.error?.message,
            stdout: coordinator.stdout,
            stderr: coordinator.stderr,
          });
          expect(coordinator.error, failureContext).toBeUndefined();
          expect(coordinator.status, failureContext).toBe(0);
          const envelope = JSON.parse(coordinator.stdout);
          expect(envelope.result).toMatchObject({
            plugin_bin: {
              plugin: "strict-live",
              runtime: "node",
              identity_attested: true,
              launch_identity_reattested: true,
              direct_argv: true,
            },
          });
          expect(typeof envelope.result.stdout, JSON.stringify(envelope)).toBe(
            "string",
          );
          const pluginOutput = JSON.parse(envelope.result.stdout);
          expect(
            pluginOutput,
            JSON.stringify({ pluginOutput, envelope }),
          ).toMatchObject({
            filename: fs.realpathSync.native(pluginEntry),
            argvEntry: fs.realpathSync.native(pluginEntry),
            mainMatches: true,
            evalPresent: false,
            cwd: fs.realpathSync.native(pluginRoot),
            sandboxed: "1",
            profile: "strict",
          });
          expect(envelope.audit).toMatchObject({
            permissionDecision: "allow",
            sandboxed: true,
            sandboxProfile: "strict",
            sandboxState: "ready",
            sandboxBackend: "windows-appcontainer-job-restricted-token",
            sandboxEnforcement: "windows-appcontainer-job-restricted-token",
            sandboxRequired: [
              SANDBOX_BOUNDARIES.FILESYSTEM,
              SANDBOX_BOUNDARIES.NETWORK,
            ],
            sandboxGuarantees: [
              SANDBOX_BOUNDARIES.FILESYSTEM,
              SANDBOX_BOUNDARIES.NETWORK,
              SANDBOX_BOUNDARIES.PROCESS_TREE,
              SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
              SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
            ],
            sandboxRuntimeProbe: {
              kind: "windows-appcontainer-launch-attestation-v1",
              attempted: true,
              runnable: true,
              reason: null,
              probeRuntime: "node",
              targetRuntime: "node",
              contentSnapshot: true,
              contentSnapshotScope: "plugin-entry-source",
              contentSnapshotMechanism:
                "verified-handle-inherited-pipe-module-compile-v1",
              handleAtomic: false,
            },
          });
          expect(envelope.audit.sandboxPolicyDigest).toMatch(/^[a-f0-9]{64}$/);
        } finally {
          fs.rmSync(workspace, { recursive: true, force: true });
        }
      },
      360_000,
    );

    it.runIf(process.platform === "win32")(
      "runs a verified MCP entry snapshot inside the zero-capability AppContainer boundary",
      async () => {
        const workspace = fs.realpathSync.native(
          fs.mkdtempSync(
            path.join(os.tmpdir(), "cc-windows-mcp-appcontainer-"),
          ),
        );
        const entryPath = path.join(workspace, "server.cjs");
        const secretPath = path.join(
          os.tmpdir(),
          `.cc-mcp-appcontainer-secret-${process.pid}-${Date.now()}`,
        );
        const markerPath = `${secretPath}.write`;
        const server = net.createServer((socket) => {
          socket.on("error", () => {});
          socket.end("host-network-visible");
        });
        let plan = null;

        await new Promise((resolve, reject) => {
          const onError = (error) => reject(error);
          server.once("error", onError);
          server.listen(0, "127.0.0.1", () => {
            server.off("error", onError);
            resolve();
          });
        });

        try {
          const address = server.address();
          expect(address && typeof address === "object").toBe(true);
          fs.writeFileSync(secretPath, "host-only-secret", "utf8");
          fs.rmSync(markerPath, { force: true });
          fs.writeFileSync(
            entryPath,
            [
              'const fs = require("node:fs");',
              'const net = require("node:net");',
              "const report = {",
              "  appContainer: process.env.CC_WINDOWS_APPCONTAINER,",
              "  readDenied: false,",
              "  writeDenied: false,",
              "  networkDenied: false,",
              "};",
              `try { fs.readFileSync(${JSON.stringify(secretPath)}, "utf8"); } catch (error) { report.readDenied = Boolean(error); }`,
              `try { fs.writeFileSync(${JSON.stringify(markerPath)}, "escape", "utf8"); } catch (error) { report.writeDenied = Boolean(error); }`,
              "let finished = false;",
              "let socket;",
              "const finish = (networkDenied) => {",
              "  if (finished) return;",
              "  finished = true;",
              "  clearTimeout(timer);",
              "  socket?.destroy();",
              "  report.networkDenied = networkDenied;",
              "  process.stdout.write(JSON.stringify(report));",
              "};",
              "const timer = setTimeout(() => finish(false), 3000);",
              "try {",
              "  socket = net.connect({",
              "    host: '127.0.0.1',",
              `    port: ${address.port},`,
              "  });",
              "  socket.once('connect', () => finish(false));",
              "  socket.once('error', () => finish(true));",
              "} catch {",
              "  finish(true);",
              "}",
            ].join("\n"),
            "utf8",
          );

          const runtimePath = fs.realpathSync.native(process.execPath);
          const canonicalEntry = fs.realpathSync.native(entryPath);
          const requiredBoundaries = [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
            SANDBOX_BOUNDARIES.PROCESS_TREE,
            SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
          ];
          plan = applyWindowsSandbox(
            runtimePath,
            [canonicalEntry, "--stdio"],
            {
              cwd: workspace,
              shell: false,
              detached: false,
              env: process.env,
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true,
            },
            {
              profileName: "strict",
              requiredBoundaries,
              sync: true,
              executionContract: {
                kind: "strict-mcp-node-capsule",
                runtimePath,
                runtimeIdentity: fileIdentity(runtimePath),
                entryIdentity: fileIdentity(canonicalEntry),
              },
            },
            { platform: "win32" },
          );

          expect(
            plan,
            JSON.stringify({
              applied: plan.applied,
              backend: plan.backend,
              candidateBackend: plan.candidateBackend,
              reason: plan.reason,
              runtimeProbe: plan.runtimeProbe,
            }),
          ).toMatchObject({
            applied: true,
            backend: "windows-appcontainer-job-restricted-token",
            guarantees: expect.arrayContaining(requiredBoundaries),
            runtimeProbe: {
              kind: "windows-appcontainer-launch-attestation-v1",
              runnable: true,
              contentSnapshotScope: "mcp-capsule-entry-source",
              entrySnapshotAtomic: true,
              runtimeLaunchAtomic: true,
              runtimeLaunchMechanism:
                "filter-oplock-locked-createprocess-suspended-image-v1",
              sharedLibraryClosure: false,
            },
          });

          const result = nativeSpawnSync(plan.command, plan.args, {
            ...plan.options,
            encoding: "utf8",
            timeout: 180_000,
          });
          const failureContext = JSON.stringify({
            status: result.status,
            signal: result.signal,
            error: result.error?.message,
            stdout: String(result.stdout || ""),
            stderr: String(result.stderr || ""),
          });
          expect(result.error, failureContext).toBeUndefined();
          expect(result.status, failureContext).toBe(0);
          expect(JSON.parse(result.stdout)).toEqual({
            appContainer: "1",
            readDenied: true,
            writeDenied: true,
            networkDenied: true,
          });
          expect(fs.existsSync(markerPath)).toBe(false);
          expect(fs.readFileSync(secretPath, "utf8")).toBe("host-only-secret");
        } finally {
          plan?.cleanup?.();
          await new Promise((resolve) => server.close(resolve));
          fs.rmSync(secretPath, { force: true });
          fs.rmSync(markerPath, { force: true });
          fs.rmSync(workspace, { recursive: true, force: true });
        }
      },
      300_000,
    );

    it.runIf(process.platform === "win32")(
      "keeps executing the verified entry snapshot after a POSIX path replacement",
      async () => {
        const workspace = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-windows-oplock-live-"),
        );
        const pluginRoot = path.join(workspace, "plugin");
        const pluginEntry = path.join(pluginRoot, "bin", "strict-live.cjs");
        const dependencyPath = path.join(pluginRoot, "lib", "value.cjs");
        const preloadPath = path.join(workspace, "untrusted-preload.cjs");
        const preloadMarker = path.join(workspace, "preload-ran.txt");
        const replacementEntry = path.join(
          pluginRoot,
          "bin",
          "replacement.cjs",
        );
        const snapshotGateToken = crypto.randomBytes(32).toString("hex");
        const snapshotReleasePath = path.join(workspace, "snapshot-release");
        const attackerFixture = fileURLToPath(
          new URL(
            "../fixtures/process-broker-windows-posix-replace.ps1",
            import.meta.url,
          ),
        );
        const runtimePath = fs.realpathSync.native(process.execPath);
        let plan = null;
        let helper = null;
        let attacker = null;
        let helperExit = null;
        let attackerExit = null;
        const helperStdout = [];
        const helperStderr = [];
        const attackerStdout = [];
        const attackerStderr = [];

        try {
          fs.mkdirSync(path.dirname(pluginEntry), { recursive: true });
          fs.mkdirSync(path.dirname(dependencyPath), { recursive: true });
          fs.writeFileSync(
            dependencyPath,
            "module.exports = 'relative-dependency-ok';\n",
            "utf8",
          );
          fs.writeFileSync(
            preloadPath,
            `require("node:fs").writeFileSync(${JSON.stringify(
              preloadMarker,
            )}, "unsafe");\n`,
            "utf8",
          );
          fs.writeFileSync(
            pluginEntry,
            [
              "#!/usr/bin/env node",
              'const dependency = require("../lib/value.cjs");',
              "module.exports.snapshotMarker = 'cached';",
              "const self = require(__filename);",
              "process.stdout.write(",
              "  JSON.stringify({",
              '    event: "READY",',
              '    version: "original",',
              "    filename: __filename,",
              "    argvEntry: process.argv[1],",
              "    execArgv: process.execArgv,",
              "    mainMatches: require.main === module,",
              "    evalPresent: Object.prototype.hasOwnProperty.call(process, '_eval'),",
              "    selfCached: self === module.exports,",
              "    injectionKeysPresent: Object.keys(process.env)",
              "      .map((key) => key.toUpperCase())",
              "      .filter((key) => [",
              "        'APPDOMAIN_MANAGER_ASM',",
              "        'APPDOMAIN_MANAGER_TYPE',",
              "        'NODE_CHANNEL_FD',",
              "        'NODE_OPTIONS',",
              "        'OPENSSL_CONF_INCLUDE',",
              "      ].includes(key)),",
              "    dependency,",
              '  }) + "\\n",',
              ");",
              "process.stdin.setEncoding('utf8');",
              "process.stdin.resume();",
              "let input = '';",
              "process.stdin.on('data', (chunk) => {",
              "  input += chunk;",
              "  if (!input.includes('EXIT\\n')) return;",
              "  process.stdout.write(",
              '    JSON.stringify({ event: "EXIT", version: "original" }) + "\\n",',
              "  );",
              "  process.exit(0);",
              "});",
              "setTimeout(() => process.exit(88), 30000).unref();",
            ].join("\n") + `\n/*${"x".repeat(128 * 1024)}*/\n`,
            "utf8",
          );
          fs.writeFileSync(
            replacementEntry,
            'process.stdout.write("replacement-entry");\n',
            "utf8",
          );
          const canonicalEntry = fs.realpathSync.native(pluginEntry);
          const executionContract = {
            contractVersion: 1,
            kind: "strict-plugin-node-bin",
            pluginRoot: fs.realpathSync.native(pluginRoot),
            workingDirectory: fs.realpathSync.native(pluginRoot),
            runtimePath,
            runtimeIdentity: fileIdentity(runtimePath),
            entryIdentity: fileIdentity(canonicalEntry),
          };

          plan = applyWindowsSandbox(
            runtimePath,
            [canonicalEntry],
            {
              cwd: pluginRoot,
              env: {
                ...process.env,
                APPDOMAIN_MANAGER_ASM:
                  "Missing.Manager, Version=1.0.0.0, Culture=neutral",
                APPDOMAIN_MANAGER_TYPE: "Missing.Manager.Bootstrap",
                NODE_OPTIONS: `--require=${preloadPath}`,
                NODE_CHANNEL_FD: "4",
                OPENSSL_CONF_INCLUDE: path.dirname(preloadPath),
              },
              stdio: ["pipe", "pipe", "pipe"],
              windowsHide: true,
            },
            {
              profileName: "strict",
              sync: true,
              requiredBoundaries: [
                SANDBOX_BOUNDARIES.PROCESS_TREE,
                SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
                SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
              ],
              executionContract,
            },
            {
              platform: "win32",
              windowsSnapshotTestGate: {
                token: snapshotGateToken,
                releasePath: snapshotReleasePath,
              },
            },
          );
          expect(
            plan,
            JSON.stringify({
              applied: plan.applied,
              backend: plan.backend,
              candidateBackend: plan.candidateBackend,
              reason: plan.reason,
              runtimeProbe: plan.runtimeProbe,
            }),
          ).toMatchObject({
            applied: true,
            backend: "windows-job-restricted-token",
            runtimeProbe: {
              kind: "windows-plugin-node-entry-snapshot-v1",
              attempted: true,
              runnable: true,
              reason: null,
              probeRuntime: "node",
              targetRuntime: "node",
              contentSnapshot: true,
              contentSnapshotScope: "plugin-entry-source",
              contentSnapshotMechanism:
                "verified-handle-inherited-pipe-module-compile-v1",
              handleAtomic: false,
            },
          });

          helper = nativeSpawn(plan.command, plan.args, plan.options);
          helperExit = once(helper, "close");
          helper.stdout.on("data", (chunk) => helperStdout.push(chunk));
          helper.stderr.on("data", (chunk) => helperStderr.push(chunk));
          const snapshotCaptured = await waitForJsonLine(
            helper,
            helper.stdout,
            (record) =>
              record?.eventName === "SNAPSHOT_CAPTURED" &&
              record?.token === snapshotGateToken,
            "verified entry snapshot gate",
            30_000,
            () => helperStderr.join(""),
          );
          expect(snapshotCaptured).toEqual({
            eventName: "SNAPSHOT_CAPTURED",
            token: snapshotGateToken,
          });

          attacker = nativeSpawn(
            path.join(
              process.env.SystemRoot || process.env.WINDIR,
              "System32",
              "WindowsPowerShell",
              "v1.0",
              "powershell.exe",
            ),
            [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              attackerFixture,
              "-SourcePath",
              replacementEntry,
              "-DestinationPath",
              canonicalEntry,
            ],
            {
              cwd: pluginRoot,
              env: process.env,
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true,
            },
          );
          attackerExit = once(attacker, "close");
          attacker.stdout.on("data", (chunk) => attackerStdout.push(chunk));
          attacker.stderr.on("data", (chunk) => attackerStderr.push(chunk));
          const attempting = await waitForJsonLine(
            attacker,
            attacker.stdout,
            (record) => record?.state === "ATTEMPTING",
            "POSIX replacement ATTEMPTING",
            30_000,
            () => attackerStderr.join(""),
          );
          expect(attempting).toMatchObject({
            state: "ATTEMPTING",
            api: "SetFileInformationByHandle",
            class: "FileRenameInfoEx",
            flags: ["REPLACE_IF_EXISTS", "POSIX_SEMANTICS"],
          });

          const attackerCompletedBeforeTargetStart = await Promise.race([
            attackerExit.then(() => true),
            new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
          ]);
          expect(
            attackerCompletedBeforeTargetStart,
            JSON.stringify({
              helperExitCode: helper.exitCode,
              attackerExitCode: attacker.exitCode,
              helperStdout: helperStdout.join(""),
              helperStderr: helperStderr.join(""),
              attackerStdout: attackerStdout.join(""),
              attackerStderr: attackerStderr.join(""),
            }),
          ).toBe(true);
          expect(helper.exitCode).toBeNull();
          expect(fs.readFileSync(canonicalEntry, "utf8")).toBe(
            'process.stdout.write("replacement-entry");\n',
          );
          const readyPromise = waitForJsonLine(
            helper,
            helper.stdout,
            (record) =>
              record?.event === "READY" && record?.version === "original",
            "original target READY",
            30_000,
            () => helperStderr.join(""),
          );
          fs.writeFileSync(snapshotReleasePath, "release", "utf8");

          const ready = await readyPromise;
          expect(ready).toMatchObject({
            event: "READY",
            version: "original",
            filename: canonicalEntry,
            argvEntry: canonicalEntry,
            execArgv: [],
            mainMatches: true,
            evalPresent: false,
            selfCached: true,
            injectionKeysPresent: [],
            dependency: "relative-dependency-ok",
          });
          expect(fs.existsSync(preloadMarker)).toBe(false);

          helper.stdin.end("EXIT\n");
          const [helperCode, helperSignal] = await helperExit;
          const [attackerCode, attackerSignal] = await attackerExit;
          expect(
            { helperCode, helperSignal },
            `${helperStdout.join("")}\n${helperStderr.join("")}`,
          ).toEqual({ helperCode: 0, helperSignal: null });
          expect(
            { attackerCode, attackerSignal },
            `${attackerStdout.join("")}\n${attackerStderr.join("")}`,
          ).toEqual({ attackerCode: 0, attackerSignal: null });
          expect(attackerStdout.join("")).toContain('"state":"REPLACED"');
          expect(helperStdout.join("")).toContain(
            '{"event":"EXIT","version":"original"}',
          );
          expect(helperStdout.join("")).not.toContain("replacement-entry");
          expect(fs.existsSync(replacementEntry)).toBe(false);

          const replaced = nativeSpawnSync(runtimePath, [canonicalEntry], {
            cwd: pluginRoot,
            encoding: "utf8",
            timeout: 15_000,
            windowsHide: true,
          });
          expect(replaced.error).toBeUndefined();
          expect(replaced.status, replaced.stderr).toBe(0);
          expect(replaced.stdout).toBe("replacement-entry");
        } finally {
          if (
            helper &&
            helper.exitCode === null &&
            helper.signalCode === null
          ) {
            helper.kill();
          }
          if (helperExit && helper) {
            await waitForChildClose(helperExit);
          }
          if (
            attacker &&
            attacker.exitCode === null &&
            attacker.signalCode === null
          ) {
            attacker.kill();
          }
          if (attackerExit && attacker) {
            await waitForChildClose(attackerExit);
          }
          if (typeof plan?.cleanup === "function") plan.cleanup();
          fs.rmSync(snapshotReleasePath, { force: true });
          fs.rmSync(workspace, { recursive: true, force: true });
        }
      },
      300_000,
    );

    it.runIf(process.platform === "win32")(
      "fails closed when a Windows MCP capsule runtime replacement races launch",
      async () => {
        const workspace = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-windows-mcp-runtime-race-"),
        );
        const runtimePath = path.join(workspace, "node.exe");
        const replacementRuntime = path.join(workspace, "replacement.exe");
        const entryPath = path.join(workspace, "server.cjs");
        const snapshotGateToken = crypto.randomBytes(32).toString("hex");
        const snapshotReleasePath = path.join(workspace, "snapshot-release");
        const attackerFixture = fileURLToPath(
          new URL(
            "../fixtures/process-broker-windows-posix-replace.ps1",
            import.meta.url,
          ),
        );
        const commandRuntime = path.join(
          process.env.SystemRoot || process.env.WINDIR,
          "System32",
          "cmd.exe",
        );
        let plan = null;
        let helper = null;
        let attacker = null;
        let helperExit = null;
        let attackerExit = null;
        const helperStdout = [];
        const helperStderr = [];
        const attackerStdout = [];
        const attackerStderr = [];

        try {
          fs.copyFileSync(process.execPath, runtimePath);
          fs.copyFileSync(commandRuntime, replacementRuntime);
          fs.writeFileSync(
            entryPath,
            'process.stdout.write("verified-runtime-executed");\n',
            "utf8",
          );
          const canonicalRuntime = fs.realpathSync.native(runtimePath);
          const canonicalEntry = fs.realpathSync.native(entryPath);
          plan = applyWindowsSandbox(
            canonicalRuntime,
            [canonicalEntry, "--stdio"],
            {
              cwd: workspace,
              shell: false,
              detached: false,
              env: process.env,
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true,
            },
            {
              profileName: "default",
              sync: false,
              requiredBoundaries: [
                SANDBOX_BOUNDARIES.PROCESS_TREE,
                SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
              ],
              executionContract: {
                kind: "strict-mcp-node-capsule",
                runtimePath: canonicalRuntime,
                runtimeIdentity: fileIdentity(canonicalRuntime),
                entryIdentity: fileIdentity(canonicalEntry),
              },
            },
            {
              platform: "win32",
              windowsSnapshotTestGate: {
                token: snapshotGateToken,
                releasePath: snapshotReleasePath,
              },
            },
          );
          expect(plan).toMatchObject({
            applied: true,
            backend: "windows-job-restricted-token",
            guarantees: expect.arrayContaining([
              SANDBOX_BOUNDARIES.PROCESS_TREE,
              SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
            ]),
            runtimeProbe: {
              contentSnapshot: true,
              contentSnapshotScope: "mcp-capsule-entry-source",
              entrySnapshotAtomic: true,
              runtimeLaunchAtomic: true,
              runtimeLaunchMechanism:
                "filter-oplock-locked-createprocess-suspended-image-v1",
              sharedLibraryClosure: false,
            },
          });

          helper = nativeSpawn(plan.command, plan.args, plan.options);
          helperExit = once(helper, "close");
          helper.stdout.on("data", (chunk) => helperStdout.push(chunk));
          helper.stderr.on("data", (chunk) => helperStderr.push(chunk));
          await waitForJsonLine(
            helper,
            helper.stdout,
            (record) =>
              record?.eventName === "SNAPSHOT_CAPTURED" &&
              record?.token === snapshotGateToken,
            "MCP runtime snapshot gate",
            30_000,
            () => helperStderr.join(""),
          );

          attacker = nativeSpawn(
            path.join(
              process.env.SystemRoot || process.env.WINDIR,
              "System32",
              "WindowsPowerShell",
              "v1.0",
              "powershell.exe",
            ),
            [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              attackerFixture,
              "-SourcePath",
              replacementRuntime,
              "-DestinationPath",
              canonicalRuntime,
            ],
            {
              cwd: workspace,
              env: process.env,
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true,
            },
          );
          attackerExit = once(attacker, "close");
          attacker.stdout.on("data", (chunk) => attackerStdout.push(chunk));
          attacker.stderr.on("data", (chunk) => attackerStderr.push(chunk));
          await waitForJsonLine(
            attacker,
            attacker.stdout,
            (record) => record?.state === "ATTEMPTING",
            "runtime replacement ATTEMPTING",
            30_000,
            () => attackerStderr.join(""),
          );

          const attackerCompletedWhileRuntimeLocked = await Promise.race([
            attackerExit.then(() => true),
            new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
          ]);
          expect(attackerCompletedWhileRuntimeLocked).toBe(false);
          expect(helper.exitCode).toBeNull();

          fs.writeFileSync(snapshotReleasePath, "release", "utf8");
          const [helperCode, helperSignal] = await helperExit;
          const [attackerCode, attackerSignal] = await attackerExit;
          expect(
            { helperCode, helperSignal },
            `${helperStdout.join("")}\n${helperStderr.join("")}`,
          ).not.toEqual({ helperCode: 0, helperSignal: null });
          expect(helperStdout.join("")).not.toContain(
            "verified-runtime-executed",
          );
          expect(helperStderr.join("")).toMatch(
            /Filter oplock broke before target resume/i,
          );
          expect(
            { attackerCode, attackerSignal },
            `${attackerStdout.join("")}\n${attackerStderr.join("")}`,
          ).toEqual({ attackerCode: 0, attackerSignal: null });
          expect(attackerStdout.join("")).toContain('"state":"REPLACED"');
          expect(fileSha256(canonicalRuntime)).toBe(fileSha256(commandRuntime));
          expect(fs.existsSync(replacementRuntime)).toBe(false);
        } finally {
          if (
            helper &&
            helper.exitCode === null &&
            helper.signalCode === null
          ) {
            helper.kill();
          }
          if (helperExit && helper) await waitForChildClose(helperExit);
          if (
            attacker &&
            attacker.exitCode === null &&
            attacker.signalCode === null
          ) {
            attacker.kill();
          }
          if (attackerExit && attacker) await waitForChildClose(attackerExit);
          if (typeof plan?.cleanup === "function") plan.cleanup();
          fs.rmSync(snapshotReleasePath, { force: true });
          fs.rmSync(workspace, { recursive: true, force: true });
        }
      },
      300_000,
    );

    it.runIf(process.platform === "linux")(
      "runs a fixed MCP capsule with code, filesystem, network, and process-tree boundaries",
      () => {
        const capsuleRoot = fs.realpathSync.native(
          fs.mkdtempSync(path.join(os.tmpdir(), "cc-linux-mcp-capsule-")),
        );
        const entryPath = path.join(capsuleRoot, "server.cjs");
        const outsideReadPath = path.join(
          os.tmpdir(),
          `.cc-linux-mcp-outside-${process.pid}-${Date.now()}`,
        );
        const outsideWritePath = `${outsideReadPath}.write`;
        let plan = null;
        try {
          fs.writeFileSync(outsideReadPath, "host-only", "utf8");
          fs.writeFileSync(
            entryPath,
            [
              'const fs = require("node:fs");',
              'const net = require("node:net");',
              `const readPath = ${JSON.stringify(outsideReadPath)};`,
              `const writePath = ${JSON.stringify(outsideWritePath)};`,
              "const outcome = { readHidden: false, writeContained: false, networkDenied: false };",
              "try { fs.readFileSync(readPath); } catch (error) { outcome.readHidden = error?.code === 'ENOENT'; }",
              "try { fs.writeFileSync(writePath, 'sandbox-only'); outcome.writeContained = true; } catch {}",
              "const socket = new net.Socket();",
              "socket.once('error', (error) => { outcome.networkDenied = error?.code === 'EPERM'; process.stdout.write(JSON.stringify(outcome)); });",
              "socket.connect(9, '127.0.0.1');",
            ].join("\n"),
            "utf8",
          );
          const rootStat = fs.statSync(capsuleRoot, { bigint: true });
          const runtimeIdentity = fileIdentity(process.execPath);
          const entryIdentity = fileIdentity(entryPath);
          const requiredBoundaries = [
            SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ];
          plan = applySandbox(
            runtimeIdentity.realPath,
            [entryIdentity.realPath, "--stdio"],
            {
              cwd: capsuleRoot,
              shell: false,
              detached: false,
              stdio: ["ignore", "pipe", "pipe"],
            },
            {
              profile: "strict",
              requiredBoundaries,
              sync: true,
              executionContract: {
                contractVersion: 1,
                kind: "strict-mcp-node-capsule",
                pluginRoot: capsuleRoot,
                workingDirectory: capsuleRoot,
                runtimePath: runtimeIdentity.realPath,
                rootIdentity: {
                  realPath: capsuleRoot,
                  fileId: {
                    dev: String(rootStat.dev),
                    ino: String(rootStat.ino),
                  },
                },
                entryIdentity,
                runtimeIdentity,
              },
            },
          );

          expect(plan).toMatchObject({
            applied: true,
            backend: "linux-bwrap",
            policyAttested: true,
            guarantees: [
              SANDBOX_BOUNDARIES.FILESYSTEM,
              SANDBOX_BOUNDARIES.NETWORK,
              SANDBOX_BOUNDARIES.PROCESS_TREE,
              SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
            ],
            runtimeProbe: {
              runnable: true,
              mcpCapsuleCodeSnapshot: true,
              entrySnapshotAtomic: true,
              runtimeLaunchAtomic: true,
              sharedLibraryClosure: false,
            },
          });
          const result = nativeSpawnSync(plan.command, plan.args, {
            ...plan.options,
            encoding: "utf8",
            timeout: 30_000,
          });
          expect(result.error).toBeUndefined();
          expect(result.status, result.stderr).toBe(0);
          expect(JSON.parse(result.stdout)).toEqual({
            readHidden: true,
            writeContained: true,
            networkDenied: true,
          });
          expect(fs.readFileSync(outsideReadPath, "utf8")).toBe("host-only");
          expect(fs.existsSync(outsideWritePath)).toBe(false);
        } finally {
          plan?.cleanup?.();
          fs.rmSync(outsideReadPath, { force: true });
          fs.rmSync(outsideWritePath, { force: true });
          fs.rmSync(capsuleRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it.runIf(process.platform === "linux")(
      "runs and tears down a direct policy-bearing Plugin Node background tree without retaining parent mount descriptors",
      () => {
        const nonce = `${process.pid}-${Date.now()}`;
        const workspace = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-linux-plugin-background-"),
        );
        const pluginRoot = pluginVersionDir(
          "local",
          "strict-background",
          "1.0.0",
          { cwd: workspace },
        );
        const pluginEntry = path.join(
          pluginRoot,
          "bin",
          "strict-background.cjs",
        );
        const configPath = path.join(pluginRoot, "config.json");
        const allowedPath = path.join(pluginRoot, "allowed.txt");
        const secretPath = path.join(
          os.homedir(),
          `.cc-linux-plugin-background-secret-${nonce}`,
        );
        const hostMarker = path.join(
          os.homedir(),
          `.cc-linux-plugin-background-host-${nonce}`,
        );
        const pluginMarker = "/opt/chainless/plugin/plugin-marker.txt";
        const sandboxTmpPath = `/tmp/.cc-linux-plugin-background-${nonce}`;
        const supervisorIdentity = fileIdentity(LINUX_BWRAP_PATH);
        const childFixture = fileURLToPath(
          new URL(
            "../fixtures/process-broker-linux-bwrap-live-child.mjs",
            import.meta.url,
          ),
        );

        try {
          fs.mkdirSync(path.dirname(pluginEntry), { recursive: true });
          fs.writeFileSync(secretPath, "host-only-secret", { mode: 0o600 });
          fs.writeFileSync(allowedPath, "background-allowed", "utf8");
          fs.writeFileSync(
            path.join(pluginRoot, "plugin.json"),
            JSON.stringify({
              name: "strict-background",
              version: "1.0.0",
              permissions: { process: true },
              sandboxPolicy: {
                requiredBoundaries: [
                  SANDBOX_BOUNDARIES.FILESYSTEM,
                  SANDBOX_BOUNDARIES.NETWORK,
                ],
              },
              bin: {
                "strict-background": "bin/strict-background.cjs",
              },
            }),
            "utf8",
          );
          fs.writeFileSync(
            configPath,
            JSON.stringify({
              secretPath,
              hostMarker,
              pluginMarker,
              sandboxTmpPath,
            }),
            "utf8",
          );
          fs.writeFileSync(
            pluginEntry,
            [
              'const fs = require("node:fs");',
              'const net = require("node:net");',
              'const { spawn } = require("node:child_process");',
              'const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
              "const hold = process.argv[3] === '--background-hold';",
              "const report = {",
              "  cwd: process.cwd(),",
              "  allowed: fs.readFileSync('allowed.txt', 'utf8'),",
              "  chainlessSandboxed: process.env.CHAINLESS_SANDBOXED || null,",
              "  secretReadable: false,",
              "  hostRootReadable: false,",
              "  pluginWritable: false,",
              "  hostWritable: false,",
              "  tmpWritable: false,",
              "  loopbackConnected: false,",
              "  networkError: null,",
              "  nestedProcessStarted: false,",
              "  nestedProcessError: null,",
              "};",
              "try { fs.readFileSync(config.secretPath, 'utf8'); report.secretReadable = true; } catch {}",
              "try { fs.readFileSync('/etc/passwd', 'utf8'); report.hostRootReadable = true; } catch {}",
              "try { fs.writeFileSync(config.pluginMarker, 'blocked'); report.pluginWritable = true; } catch {}",
              "try { fs.writeFileSync(config.hostMarker, 'blocked'); report.hostWritable = true; } catch {}",
              "try { fs.writeFileSync(config.sandboxTmpPath, 'ephemeral'); report.tmpWritable = true; } catch {}",
              "if (hold) {",
              "  const nested = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
              "  report.nestedProcessStarted = Number.isInteger(nested.pid);",
              "  nested.once('error', (error) => { report.nestedProcessError = error.code || error.message; });",
              "}",
              "let socket;",
              "let finished = false;",
              "const finish = (connected, error) => {",
              "  if (finished) return;",
              "  finished = true;",
              "  clearTimeout(timer);",
              "  socket?.destroy();",
              "  report.loopbackConnected = connected;",
              "  report.networkError = error;",
              "  process.stdout.write(JSON.stringify(report));",
              "  if (hold) setInterval(() => {}, 1000);",
              "};",
              "const timer = setTimeout(() => finish(false, 'timeout'), 3000);",
              "try {",
              "  socket = net.connect({ host: '127.0.0.1', port: 9 });",
              "  socket.once('connect', () => finish(true, null));",
              "  socket.once('error', (error) => finish(false, error.code || error.message));",
              "} catch (error) {",
              "  finish(false, error.code || error.message);",
              "}",
            ].join("\n"),
            "utf8",
          );

          const coordinator = nativeSpawnSync(
            process.execPath,
            [
              childFixture,
              "plugin-command-background",
              workspace,
              "strict-background config.json --background-hold",
            ],
            {
              encoding: "utf8",
              timeout: 60_000,
              windowsHide: true,
              env: {
                ...process.env,
                CC_SANDBOX_STRICT: "1",
                NODE_OPTIONS: "--no-warnings",
                LD_LIBRARY_PATH: "/host/sensitive/library-path",
                CC_TEST_SENSITIVE_ENV: "must-not-cross-boundary",
              },
            },
          );
          const failureContext = JSON.stringify({
            status: coordinator.status,
            signal: coordinator.signal,
            error: coordinator.error?.message,
            stdout: coordinator.stdout,
            stderr: coordinator.stderr,
          });
          expect(coordinator.error, failureContext).toBeUndefined();
          expect(coordinator.status, failureContext).toBe(0);

          const envelope = JSON.parse(coordinator.stdout);
          expect(envelope.launch).toMatchObject({
            background: true,
            status: "running",
            task_id: expect.stringMatching(/^bg_/),
            plugin_bin: {
              plugin: "strict-background",
              runtime: "node",
              identity_attested: true,
              launch_identity_reattested: true,
              direct_argv: true,
            },
          });
          expect(envelope.activeStatus).toBe("running");
          expect(envelope.killRequested).toBe(true);
          expect(
            envelope.activeDescendantHostPids.length,
          ).toBeGreaterThanOrEqual(2);
          expect(envelope.survivingDescendantHostPids).toEqual([]);
          expect(envelope.completion).toMatchObject({
            running: false,
            task_id: envelope.launch.task_id,
          });
          const report = JSON.parse(envelope.completion.stdout);
          expect(report).toMatchObject({
            cwd: "/opt/chainless/plugin",
            allowed: "background-allowed",
            chainlessSandboxed: "1",
            secretReadable: false,
            hostRootReadable: false,
            pluginWritable: false,
            hostWritable: false,
            tmpWritable: true,
            loopbackConnected: false,
            networkError: "EPERM",
            nestedProcessStarted: true,
            nestedProcessError: null,
          });

          const mountAuthorityFdGrowth = (growth) =>
            (growth || []).filter(
              ({ target }) =>
                target !== "/dev/null" &&
                (target.startsWith("/") || target.includes("(deleted)")),
            );
          // A running child may retain the ordinary /dev/null stdin sentinel;
          // it is not a bind-source authority. Every filesystem-backed mount
          // descriptor must already be gone while active, and every parent FD
          // of any kind must return to baseline after teardown.
          expect(mountAuthorityFdGrowth(envelope.activeFdGrowth)).toEqual([]);
          expect(envelope.finalFdGrowth).toEqual([]);
          expectLinuxSupervisorPlan(envelope.supervisorPlan);
          expect(envelope.audit).toMatchObject({
            permissionDecision: "allow",
            sandboxed: true,
            sandboxState: "ready",
            sandboxBackend: "linux-bwrap",
            sandboxEnforcement: "linux-bwrap",
            sandboxPolicyAttested: true,
            sandboxRequired: [
              SANDBOX_BOUNDARIES.FILESYSTEM,
              SANDBOX_BOUNDARIES.NETWORK,
            ],
            sandboxGuarantees: [
              SANDBOX_BOUNDARIES.FILESYSTEM,
              SANDBOX_BOUNDARIES.NETWORK,
              SANDBOX_BOUNDARIES.PROCESS_TREE,
            ],
            sandboxRuntimeProbe: {
              kind: "linux-bwrap-plugin-node-policy-v1",
              attempted: true,
              runnable: true,
              reason: null,
              contentSnapshot: true,
              pluginTreeContentSnapshot: true,
              handleAtomic: false,
            },
          });
          expectLinuxSupervisorAudit(envelope.audit, supervisorIdentity);
          expect(envelope.audit.sandboxPolicyDigest).toMatch(/^[a-f0-9]{64}$/);
          expect(fs.readFileSync(secretPath, "utf8")).toBe("host-only-secret");
          expect(fs.existsSync(hostMarker)).toBe(false);
          expect(
            fs.existsSync(path.join(pluginRoot, "plugin-marker.txt")),
          ).toBe(false);
          expect(fs.existsSync(sandboxTmpPath)).toBe(false);
        } finally {
          fs.rmSync(workspace, { recursive: true, force: true });
          fs.rmSync(secretPath, { force: true });
          fs.rmSync(hostMarker, { force: true });
          fs.rmSync(sandboxTmpPath, { force: true });
        }
      },
      90_000,
    );

    it.runIf(process.platform === "linux")(
      "keeps executing attested Plugin Node entry and tree snapshots after same-inode source rewrites",
      async () => {
        const nonce = `${process.pid}-${Date.now()}`;
        const workspace = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-linux-bwrap-live-"),
        );
        const pluginRoot = pluginVersionDir("local", "strict-live", "1.0.0", {
          cwd: workspace,
        });
        const pluginEntry = path.join(pluginRoot, "bin", "strict-live.cjs");
        const replacementEntry = path.join(
          workspace,
          "replacement-strict-live.cjs",
        );
        const dependencyPath = path.join(pluginRoot, "lib", "value.cjs");
        const replacementDependencyPath = path.join(
          workspace,
          "replacement-value.cjs",
        );
        const pluginManifestPath = path.join(pluginRoot, "plugin.json");
        const configPath = path.join(pluginRoot, "config.json");
        const allowedPath = path.join(pluginRoot, "allowed.txt");
        const sandboxEntryPath = "/opt/chainless/plugin/bin/strict-live.cjs";
        const sandboxDependencyPath = "/opt/chainless/plugin/lib/value.cjs";
        const sandboxManifestPath = "/opt/chainless/plugin/plugin.json";
        const sandboxConfigPath = "/opt/chainless/plugin/config.json";
        const sandboxAllowedPath = "/opt/chainless/plugin/allowed.txt";
        const sandboxRuntimePath = "/opt/chainless/runtime/node";
        const pluginMarker = path.join(pluginRoot, "plugin-marker.txt");
        const sandboxPluginMarker = "/opt/chainless/plugin/plugin-marker.txt";
        const secretPath = path.join(
          os.homedir(),
          `.cc-linux-bwrap-secret-${nonce}`,
        );
        const hostMarker = path.join(
          os.homedir(),
          `.cc-linux-bwrap-host-marker-${nonce}`,
        );
        const sandboxTmpPath = `/tmp/.cc-linux-bwrap-tmp-${nonce}`;
        const supervisorIdentity = fileIdentity(LINUX_BWRAP_PATH);
        const childFixture = fileURLToPath(
          new URL(
            "../fixtures/process-broker-linux-bwrap-live-child.mjs",
            import.meta.url,
          ),
        );
        let serverChild = null;
        let serverShutdown = false;
        let expectedPluginTreeSnapshotFiles = null;
        let expectedPluginTreeSnapshotBytes = null;
        let expectedPluginFileBindings = null;
        try {
          fs.mkdirSync(path.dirname(pluginEntry), { recursive: true });
          fs.mkdirSync(path.dirname(dependencyPath), { recursive: true });
          fs.writeFileSync(secretPath, "host-only-secret", { mode: 0o600 });
          expect(fs.readFileSync(secretPath, "utf8")).toBe("host-only-secret");
          fs.writeFileSync(allowedPath, "allowed-plugin-data", "utf8");
          fs.writeFileSync(
            dependencyPath,
            "module.exports = Object.freeze({ value: 'ORIGINAL_DEPENDENCY' });\n",
            "utf8",
          );
          fs.writeFileSync(
            pluginManifestPath,
            JSON.stringify({
              name: "strict-live",
              version: "1.0.0",
              permissions: { process: true },
              sandboxPolicy: {
                requiredBoundaries: ["filesystem", "network"],
              },
              bin: { "strict-live": "bin/strict-live.cjs" },
            }),
            "utf8",
          );
          fs.writeFileSync(
            pluginEntry,
            [
              'const fs = require("node:fs");',
              'const net = require("node:net");',
              'const dependency = require("../lib/value.cjs");',
              'const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
              "const processStatus = Object.fromEntries(",
              "  fs.readFileSync('/proc/self/status', 'utf8')",
              "    .split(/\\r?\\n/)",
              "    .map((line) => line.match(/^([^:]+):\\s*(.*)$/))",
              "    .filter(Boolean)",
              "    .map((match) => [match[1], match[2]]),",
              ");",
              "const entryMode = (fs.statSync(__filename).mode & 0o777)",
              '  .toString(8).padStart(4, "0");',
              "let entryWritable = false;",
              "try {",
              '  const entryFd = fs.openSync(__filename, "r+");',
              "  fs.closeSync(entryFd);",
              "  entryWritable = true;",
              "} catch {}",
              "let entryChmodWritable = false;",
              "try {",
              "  fs.chmodSync(__filename, 0o600);",
              "  entryChmodWritable = true;",
              "} catch {}",
              'const dependencyFilename = require.resolve("../lib/value.cjs");',
              "const dependencyMode = (fs.statSync(dependencyFilename).mode & 0o777)",
              '  .toString(8).padStart(4, "0");',
              "let dependencyWritable = false;",
              "try {",
              '  const dependencyFd = fs.openSync(dependencyFilename, "r+");',
              "  fs.closeSync(dependencyFd);",
              "  dependencyWritable = true;",
              "} catch {}",
              "let dependencyChmodWritable = false;",
              "try {",
              "  fs.chmodSync(dependencyFilename, 0o600);",
              "  dependencyChmodWritable = true;",
              "} catch {}",
              "const supervisorFdMatches = [];",
              "let supervisorFdScanError = null;",
              "try {",
              "  for (const name of fs.readdirSync('/proc/self/fd')) {",
              "    if (!/^\\d+$/.test(name)) continue;",
              "    let descriptorStat;",
              "    try {",
              "      descriptorStat = fs.fstatSync(Number(name), { bigint: true });",
              "    } catch {",
              "      continue;",
              "    }",
              "    if (",
              "      String(descriptorStat.dev) === config.supervisorIdentity.fileId.dev &&",
              "      String(descriptorStat.ino) === config.supervisorIdentity.fileId.ino",
              "    ) {",
              "      supervisorFdMatches.push(Number(name));",
              "    }",
              "  }",
              "} catch (error) {",
              "  supervisorFdScanError = error.code || error.message;",
              "}",
              "let supervisorStagingPathVisible = false;",
              "let supervisorStagingPathError = null;",
              "try {",
              "  fs.lstatSync(config.supervisorStagingPath);",
              "  supervisorStagingPathVisible = true;",
              "} catch (error) {",
              "  supervisorStagingPathError = error.code || error.message;",
              "}",
              "let pid1ExecutableStatOk = false;",
              "let pid1ExecutableMatchesSupervisor = false;",
              "let pid1ExecutableError = null;",
              "try {",
              "  const pid1ExecutableStat = fs.statSync('/proc/1/exe', { bigint: true });",
              "  pid1ExecutableStatOk = true;",
              "  pid1ExecutableMatchesSupervisor =",
              "    String(pid1ExecutableStat.dev) === config.supervisorIdentity.fileId.dev &&",
              "    String(pid1ExecutableStat.ino) === config.supervisorIdentity.fileId.ino;",
              "} catch (error) {",
              "  pid1ExecutableError = error.code || error.message;",
              "}",
              "const report = {",
              "  entryVersion: 'original',",
              "  processStatus: {",
              "    NoNewPrivs: processStatus.NoNewPrivs || null,",
              "    CapInh: processStatus.CapInh || null,",
              "    CapEff: processStatus.CapEff || null,",
              "    CapPrm: processStatus.CapPrm || null,",
              "    CapAmb: processStatus.CapAmb || null,",
              "    CapBnd: processStatus.CapBnd || null,",
              "  },",
              "  dependency: dependency.value,",
              "  cwd: process.cwd(),",
              "  allowed: fs.readFileSync('allowed.txt', 'utf8'),",
              "  chainlessSandboxed: process.env.CHAINLESS_SANDBOXED || null,",
              "  nodeOptions: process.env.NODE_OPTIONS || null,",
              "  ldLibraryPath: process.env.LD_LIBRARY_PATH || null,",
              "  sensitiveEnv: process.env.CC_TEST_SENSITIVE_ENV || null,",
              "  secretReadable: false,",
              "  hostRootReadable: false,",
              "  pluginWritable: false,",
              "  hostWritable: false,",
              "  tmpWritable: false,",
              "  loopbackConnected: false,",
              "  networkError: null,",
              "  entryMode,",
              "  entryWritable,",
              "  entryChmodWritable,",
              "  dependencyMode,",
              "  dependencyWritable,",
              "  dependencyChmodWritable,",
              "  supervisorFdMatches,",
              "  supervisorFdScanError,",
              "  supervisorStagingPathVisible,",
              "  supervisorStagingPathError,",
              "  pid1ExecutableStatOk,",
              "  pid1ExecutableMatchesSupervisor,",
              "  pid1ExecutableError,",
              "};",
              "try { fs.readFileSync(config.secretPath, 'utf8'); report.secretReadable = true; } catch {}",
              "try { fs.readFileSync('/etc/passwd', 'utf8'); report.hostRootReadable = true; } catch {}",
              "try { fs.writeFileSync(config.pluginMarker, 'blocked'); report.pluginWritable = true; } catch {}",
              "try { fs.writeFileSync(config.hostMarker, 'blocked'); report.hostWritable = true; } catch {}",
              "try { fs.writeFileSync(config.sandboxTmpPath, 'ephemeral'); report.tmpWritable = true; } catch {}",
              "let socket;",
              "let finished = false;",
              "const finish = (connected, error) => {",
              "  if (finished) return;",
              "  finished = true;",
              "  clearTimeout(timer);",
              "  socket?.destroy();",
              "  report.loopbackConnected = connected;",
              "  report.networkError = error;",
              "  process.stdout.write(JSON.stringify(report));",
              "};",
              "const timer = setTimeout(() => finish(false, 'timeout'), 3000);",
              "try {",
              "  socket = net.connect({ host: '127.0.0.1', port: config.port });",
              "  socket.once('connect', () => finish(true, null));",
              "  socket.once('error', (error) => finish(false, error.code || error.message));",
              "} catch (error) {",
              "  finish(false, error.code || error.message);",
              "}",
            ].join("\n"),
            "utf8",
          );
          fs.writeFileSync(
            replacementEntry,
            'process.stdout.write("REPLACEMENT_NODE_ENTRY\\n");\n',
            "utf8",
          );
          fs.writeFileSync(
            replacementDependencyPath,
            "module.exports = Object.freeze({ value: 'REPLACEMENT_DEPENDENCY' });\n",
            "utf8",
          );

          const serverStderr = [];
          serverChild = nativeSpawn(
            process.execPath,
            [
              "-e",
              [
                'const net = require("node:net");',
                "const server = net.createServer((socket) => {",
                "  socket.on('error', () => {});",
                "  socket.end('host-loopback-ok');",
                "});",
                "server.once('error', (error) => {",
                "  process.send({ error: error.message });",
                "  process.exitCode = 2;",
                "});",
                "server.listen(0, '127.0.0.1', () => {",
                "  process.send({ ready: true, port: server.address().port });",
                "});",
                "process.on('message', (message) => {",
                "  if (message?.shutdown !== true) return;",
                "  server.close(() => {",
                "    process.send({ closed: true }, () => process.exit(0));",
                "  });",
                "});",
              ].join("\n"),
            ],
            {
              env: process.env,
              stdio: ["ignore", "ignore", "pipe", "ipc"],
              windowsHide: true,
            },
          );
          serverChild.stderr.on("data", (chunk) => serverStderr.push(chunk));
          const serverReady = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              serverChild.kill();
              reject(
                new Error(
                  `Timed out waiting for Linux loopback server: ${Buffer.concat(
                    serverStderr,
                  ).toString()}`,
                ),
              );
            }, 10_000);
            const finish = (callback, value) => {
              clearTimeout(timer);
              serverChild.off("message", onMessage);
              serverChild.off("error", onError);
              serverChild.off("exit", onExit);
              callback(value);
            };
            const onMessage = (message) => {
              if (message?.error) {
                finish(reject, new Error(message.error));
              } else if (
                message?.ready === true &&
                Number.isSafeInteger(message.port)
              ) {
                finish(resolve, message);
              }
            };
            const onError = (error) => finish(reject, error);
            const onExit = (code, signal) =>
              finish(
                reject,
                new Error(
                  `Linux loopback server exited early (${code}/${signal})`,
                ),
              );
            serverChild.on("message", onMessage);
            serverChild.once("error", onError);
            serverChild.once("exit", onExit);
          });
          let coordinator;
          let cleanupError;
          try {
            await new Promise((resolve, reject) => {
              const chunks = [];
              const socket = net.connect({
                host: "127.0.0.1",
                port: serverReady.port,
              });
              const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error("Host loopback control connection timed out"));
              }, 5_000);
              socket.on("data", (chunk) => chunks.push(chunk));
              socket.once("error", (error) => {
                clearTimeout(timer);
                reject(error);
              });
              socket.once("end", () => {
                clearTimeout(timer);
                expect(Buffer.concat(chunks).toString()).toBe(
                  "host-loopback-ok",
                );
                resolve();
              });
            });
            fs.writeFileSync(
              configPath,
              JSON.stringify({
                secretPath,
                pluginMarker: sandboxPluginMarker,
                hostMarker,
                sandboxTmpPath,
                port: serverReady.port,
                supervisorIdentity,
                supervisorStagingPath: LINUX_BWRAP_SUPERVISOR_STAGING_PATH,
              }),
              "utf8",
            );
            const pluginTreeSnapshotMembers = [
              {
                sourcePath: pluginManifestPath,
                destination: sandboxManifestPath,
              },
              {
                sourcePath: pluginEntry,
                destination: sandboxEntryPath,
              },
              {
                sourcePath: dependencyPath,
                destination: sandboxDependencyPath,
              },
              {
                sourcePath: configPath,
                destination: sandboxConfigPath,
              },
              {
                sourcePath: allowedPath,
                destination: sandboxAllowedPath,
              },
            ];
            expectedPluginTreeSnapshotFiles = pluginTreeSnapshotMembers.length;
            expectedPluginTreeSnapshotBytes = pluginTreeSnapshotMembers.reduce(
              (total, member) =>
                total + Number(fs.statSync(member.sourcePath).size),
              0,
            );
            expectedPluginFileBindings = pluginTreeSnapshotMembers
              .map((member) => ({
                destination: member.destination,
                roBindData: [
                  {
                    childFd: expect.any(String),
                    permissions:
                      (fs.statSync(member.sourcePath).mode & 0o111) !== 0
                        ? "0500"
                        : "0400",
                  },
                ],
                roBindFd: [],
              }))
              .sort((left, right) =>
                left.destination.localeCompare(right.destination),
              );
            coordinator = nativeSpawnSync(
              process.execPath,
              [
                childFixture,
                "plugin-command-snapshot-race",
                workspace,
                JSON.stringify({
                  command: "strict-live config.json",
                  entryPath: pluginEntry,
                  replacementPath: replacementEntry,
                  destination: sandboxEntryPath,
                  dependencyPath,
                  dependencyReplacementPath: replacementDependencyPath,
                  dependencyDestination: sandboxDependencyPath,
                  runtimeDestination: sandboxRuntimePath,
                }),
              ],
              {
                encoding: "utf8",
                timeout: 60_000,
                windowsHide: true,
                env: {
                  ...process.env,
                  CC_SANDBOX_STRICT: "1",
                  NODE_OPTIONS: "--no-warnings",
                  LD_LIBRARY_PATH: "/host/sensitive/library-path",
                  CC_TEST_SENSITIVE_ENV: "must-not-cross-boundary",
                },
              },
            );
          } finally {
            try {
              await shutdownLoopbackServer(serverChild, serverStderr);
            } catch (error) {
              cleanupError = error;
            } finally {
              serverShutdown = true;
            }
          }

          if (cleanupError) throw cleanupError;
          const failureContext = JSON.stringify({
            status: coordinator?.status,
            signal: coordinator?.signal,
            error: coordinator?.error?.message,
            stdout: String(coordinator?.stdout || ""),
            stderr: String(coordinator?.stderr || ""),
          });
          expect(coordinator?.error, failureContext).toBeUndefined();
          expect(coordinator?.status, failureContext).toBe(0);
          const envelope = JSON.parse(coordinator.stdout);
          expect(envelope.result).toMatchObject({
            plugin_bin: {
              plugin: "strict-live",
              runtime: "node",
              identity_attested: true,
              launch_identity_reattested: true,
              direct_argv: true,
            },
          });
          const report = JSON.parse(envelope.result.stdout);
          expect(report).toMatchObject({
            entryVersion: "original",
            processStatus: {
              NoNewPrivs: "1",
              CapInh: "0000000000000000",
              CapEff: "0000000000000000",
              CapPrm: "0000000000000000",
              CapAmb: "0000000000000000",
              CapBnd: "0000000000000000",
            },
            dependency: "ORIGINAL_DEPENDENCY",
            cwd: "/opt/chainless/plugin",
            allowed: "allowed-plugin-data",
            chainlessSandboxed: "1",
            nodeOptions: null,
            ldLibraryPath: null,
            sensitiveEnv: null,
            secretReadable: false,
            hostRootReadable: false,
            pluginWritable: false,
            hostWritable: false,
            tmpWritable: true,
            loopbackConnected: false,
            entryMode: "0400",
            entryWritable: false,
            entryChmodWritable: false,
            dependencyMode: "0400",
            dependencyWritable: false,
            dependencyChmodWritable: false,
            supervisorFdMatches: [],
            supervisorFdScanError: null,
            supervisorStagingPathVisible: false,
            supervisorStagingPathError: "ENOENT",
            pid1ExecutableStatOk: expect.any(Boolean),
            pid1ExecutableMatchesSupervisor: expect.any(Boolean),
          });
          // Bubblewrap may legitimately remain visible as PID 1's executable.
          // The boundary under test is the consumed launch FD and the hidden
          // staging file, not global invisibility of the supervisor's bytes.
          expect(
            report.pid1ExecutableError === null ||
              typeof report.pid1ExecutableError === "string",
          ).toBe(true);
          expect(report.networkError).toBe("EPERM");
          expectLinuxSupervisorPlan(envelope.supervisorPlan);
          expect(envelope.mutation).toMatchObject({
            sameDevice: true,
            sameInode: true,
            afterSha256: envelope.mutation.replacementSha256,
          });
          expect(envelope.mutation.beforeSha256).not.toBe(
            envelope.mutation.afterSha256,
          );
          expect(envelope.mutation.afterSha256).toBe(
            fileSha256(replacementEntry),
          );
          expect(envelope.entryBindings).toEqual({
            destination: sandboxEntryPath,
            roBindData: [
              {
                childFd: expect.any(String),
                permissions: "0400",
              },
            ],
            roBindFd: [],
          });
          expect(envelope.dependencyMutation).toMatchObject({
            sameDevice: true,
            sameInode: true,
            afterSha256: envelope.dependencyMutation.replacementSha256,
          });
          expect(envelope.dependencyMutation.beforeSha256).not.toBe(
            envelope.dependencyMutation.afterSha256,
          );
          expect(envelope.dependencyMutation.afterSha256).toBe(
            fileSha256(replacementDependencyPath),
          );
          expect(envelope.dependencyBindings).toEqual({
            destination: sandboxDependencyPath,
            roBindData: [
              {
                childFd: expect.any(String),
                permissions: "0400",
              },
            ],
            roBindFd: [],
          });
          expect(envelope.runtimeBindings).toEqual({
            destination: sandboxRuntimePath,
            roBindData: [],
            roBindFd: [{ childFd: expect.any(String) }],
          });
          expect(expectedPluginFileBindings).toHaveLength(5);
          expect(
            expectedPluginFileBindings.every(
              (binding) =>
                binding.roBindData.length === 1 &&
                binding.roBindData[0].permissions === "0400" &&
                binding.roBindFd.length === 0,
            ),
          ).toBe(true);
          expect(envelope.pluginFileBindings).toEqual(
            expectedPluginFileBindings,
          );
          expect(envelope.audit).toMatchObject({
            permissionDecision: "allow",
            sandboxed: true,
            sandboxState: "ready",
            sandboxBackend: "linux-bwrap",
            sandboxEnforcement: "linux-bwrap",
            sandboxPolicyAttested: true,
            sandboxRequired: [
              SANDBOX_BOUNDARIES.FILESYSTEM,
              SANDBOX_BOUNDARIES.NETWORK,
            ],
            sandboxGuarantees: [
              SANDBOX_BOUNDARIES.FILESYSTEM,
              SANDBOX_BOUNDARIES.NETWORK,
              SANDBOX_BOUNDARIES.PROCESS_TREE,
            ],
            sandboxRuntimeProbe: {
              kind: "linux-bwrap-plugin-node-policy-v1",
              attempted: true,
              runnable: true,
              reason: null,
              probeRuntime: "node",
              targetRuntime: "node",
              contentSnapshot: true,
              contentSnapshotScope: "plugin-entry-source",
              contentSnapshotMechanism: LINUX_ENTRY_SNAPSHOT_MECHANISM,
              handleAtomic: false,
              pluginTreeContentSnapshot: true,
              pluginTreeContentSnapshotScope: "all-pinned-plugin-regular-files",
              pluginTreeContentSnapshotMechanism:
                LINUX_ENTRY_SNAPSHOT_MECHANISM,
              pluginTreeContentSnapshotFiles: expectedPluginTreeSnapshotFiles,
              pluginTreeContentSnapshotBytes: expectedPluginTreeSnapshotBytes,
              pluginTreeContentSnapshotDigest:
                expect.stringMatching(/^[a-f0-9]{64}$/),
              pluginTreeSnapshotConsistency: "per-file-pin-to-launch",
              pluginTreeSnapshotContractBound: false,
              pluginTreeSnapshotAtomic: false,
            },
          });
          expectLinuxSupervisorAudit(envelope.audit, supervisorIdentity);
          expect(envelope.audit.sandboxPolicyDigest).toMatch(/^[a-f0-9]{64}$/);
          expect(fs.readFileSync(secretPath, "utf8")).toBe("host-only-secret");
          expect(fs.existsSync(pluginMarker)).toBe(false);
          expect(fs.existsSync(hostMarker)).toBe(false);
          expect(fs.existsSync(sandboxTmpPath)).toBe(false);

          const replaced = nativeSpawnSync(process.execPath, [pluginEntry], {
            encoding: "utf8",
            timeout: 15_000,
            windowsHide: true,
          });
          expect(replaced.error, replaced.stderr).toBeUndefined();
          expect(replaced.status, replaced.stderr).toBe(0);
          expect(replaced.stdout).toBe("REPLACEMENT_NODE_ENTRY\n");

          const replacedDependency = nativeSpawnSync(
            process.execPath,
            [
              "-e",
              "process.stdout.write(require(process.argv[1]).value)",
              dependencyPath,
            ],
            {
              encoding: "utf8",
              timeout: 15_000,
              windowsHide: true,
            },
          );
          expect(
            replacedDependency.error,
            replacedDependency.stderr,
          ).toBeUndefined();
          expect(replacedDependency.status, replacedDependency.stderr).toBe(0);
          expect(replacedDependency.stdout).toBe("REPLACEMENT_DEPENDENCY");
        } finally {
          if (
            serverChild &&
            !serverShutdown &&
            serverChild.exitCode === null &&
            serverChild.signalCode === null
          ) {
            serverChild.kill();
          }
          fs.rmSync(workspace, { recursive: true, force: true });
          fs.rmSync(secretPath, { force: true });
          fs.rmSync(hostMarker, { force: true });
          fs.rmSync(sandboxTmpPath, { force: true });
        }
      },
      90_000,
    );

    it.runIf(process.platform === "linux")(
      "runs static and runtime-pathname-closed dynamic Plugin native ELFs and rejects scripted entries",
      () => {
        const nonce = `${process.pid}-${Date.now()}`;
        const workspace = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-linux-bwrap-native-live-"),
        );
        const pluginRoot = pluginVersionDir("local", "strict-native", "1.0.0", {
          cwd: workspace,
        });
        const binDirectory = path.join(pluginRoot, "bin");
        const staticEntry = path.join(binDirectory, "strict-native");
        const staticPieEntry = path.join(
          binDirectory,
          "strict-native-static-pie",
        );
        const dynamicEntry = path.join(binDirectory, "dynamic-native");
        const dynamicPieEntry = path.join(binDirectory, "dynamic-pie-native");
        const scriptEntry = path.join(binDirectory, "script-native");
        const libraryDirectory = path.join(pluginRoot, "lib");
        const approvedLibrary = path.join(
          libraryDirectory,
          "libchainless-approved.so",
        );
        const replacementApprovedLibrary = path.join(
          workspace,
          "replacement-approved.so",
        );
        const unmountedSameSonameLibrary = path.join(
          workspace,
          "unmounted-same-soname.so",
        );
        const unmountedDifferentSonameLibrary = path.join(
          workspace,
          "unmounted-different-soname.so",
        );
        const sandboxApprovedLibrary =
          "/opt/chainless/plugin/lib/libchainless-approved.so";
        const sandboxRuntimePath = "/opt/chainless/runtime/node";
        const replacementEntry = path.join(workspace, "replacement-native");
        const replacementAllowedPath = path.join(
          workspace,
          "replacement-allowed.txt",
        );
        const allowedPath = path.join(pluginRoot, "allowed.txt");
        const sandboxAllowedPath = "/opt/chainless/plugin/allowed.txt";
        const secretPath = path.join(
          os.homedir(),
          `.cc-linux-native-secret-${nonce}`,
        );
        const hostMarker = path.join(
          os.homedir(),
          `.cc-linux-native-host-marker-${nonce}`,
        );
        const scriptMarker = path.join(
          os.homedir(),
          `.cc-linux-native-script-marker-${nonce}`,
        );
        const sandboxPluginMarker = "/opt/chainless/plugin/plugin-marker.txt";
        const sandboxTmpPath = `/tmp/.cc-linux-native-tmp-${nonce}`;
        const supervisorIdentity = fileIdentity(LINUX_BWRAP_PATH);
        const childFixture = fileURLToPath(
          new URL(
            "../fixtures/process-broker-linux-bwrap-live-child.mjs",
            import.meta.url,
          ),
        );
        const nativeSource = fileURLToPath(
          new URL(
            "../fixtures/process-broker-linux-bwrap-native-live.c",
            import.meta.url,
          ),
        );
        const dlopenLibrarySource = fileURLToPath(
          new URL(
            "../fixtures/process-broker-linux-bwrap-native-dlopen-library.c",
            import.meta.url,
          ),
        );
        const runPluginCommand = (command) =>
          nativeSpawnSync(
            process.execPath,
            [childFixture, "plugin-command", workspace, command],
            {
              encoding: "utf8",
              timeout: 60_000,
              windowsHide: true,
              env: {
                ...process.env,
                CC_SANDBOX_STRICT: "1",
                LD_LIBRARY_PATH: "/host/sensitive/library-path",
                CC_TEST_SENSITIVE_ENV: "must-not-cross-boundary",
              },
            },
          );
        const baseCommandArgs = [
          "allowed.txt",
          secretPath,
          sandboxPluginMarker,
          hostMarker,
          sandboxTmpPath,
          supervisorIdentity.fileId.dev,
          supervisorIdentity.fileId.ino,
        ];

        try {
          fs.mkdirSync(binDirectory, { recursive: true });
          fs.mkdirSync(libraryDirectory, { recursive: true });
          fs.writeFileSync(allowedPath, "allowed-native-data", "utf8");
          fs.writeFileSync(
            replacementAllowedPath,
            "replacement-native-data",
            "utf8",
          );
          fs.writeFileSync(secretPath, "host-only-secret", { mode: 0o600 });
          fs.writeFileSync(
            path.join(pluginRoot, "plugin.json"),
            JSON.stringify({
              name: "strict-native",
              version: "1.0.0",
              permissions: { process: true },
              sandboxPolicy: {
                requiredBoundaries: ["filesystem", "network"],
              },
              bin: {
                "strict-native": "bin/strict-native",
                "strict-native-static-pie": "bin/strict-native-static-pie",
                "dynamic-native": "bin/dynamic-native",
                "dynamic-pie-native": "bin/dynamic-pie-native",
                "script-native": "bin/script-native",
              },
            }),
            "utf8",
          );

          const buildDlopenLibrary = (output, soname, variant) => {
            const build = nativeSpawnSync(
              "/usr/bin/cc",
              [
                "-shared",
                "-fPIC",
                `-Wl,-soname,${soname}`,
                `-DCHAINLESS_DLOPEN_VARIANT=${variant}`,
                "-Wl,-z,noexecstack",
                "-O2",
                "-Wall",
                "-Wextra",
                "-o",
                output,
                dlopenLibrarySource,
              ],
              { encoding: "utf8", timeout: 60_000 },
            );
            expect(
              build.error,
              `${build.stdout}\n${build.stderr}`,
            ).toBeUndefined();
            expect(build.status, build.stderr).toBe(0);
          };
          buildDlopenLibrary(approvedLibrary, "libchainless-approved.so", 0);
          buildDlopenLibrary(
            replacementApprovedLibrary,
            "libchainless-approved.so",
            1,
          );
          buildDlopenLibrary(
            unmountedSameSonameLibrary,
            "libchainless-approved.so",
            2,
          );
          buildDlopenLibrary(
            unmountedDifferentSonameLibrary,
            "libchainless-unapproved.so",
            3,
          );
          const approvedLibraryOriginal = fs.readFileSync(approvedLibrary);

          const staticBuild = nativeSpawnSync(
            "/usr/bin/cc",
            [
              "-static",
              "-no-pie",
              "-Wl,-z,noexecstack",
              "-O2",
              "-Wall",
              "-Wextra",
              "-o",
              staticEntry,
              nativeSource,
            ],
            { encoding: "utf8", timeout: 60_000 },
          );
          expect(
            staticBuild.error,
            `${staticBuild.stdout}\n${staticBuild.stderr}`,
          ).toBeUndefined();
          expect(staticBuild.status, staticBuild.stderr).toBe(0);

          const staticPieBuild = nativeSpawnSync(
            "/usr/bin/cc",
            [
              "-fPIE",
              "-static-pie",
              "-Wl,-z,noexecstack",
              "-O2",
              "-Wall",
              "-Wextra",
              "-o",
              staticPieEntry,
              nativeSource,
            ],
            { encoding: "utf8", timeout: 60_000 },
          );
          expect(
            staticPieBuild.error,
            `${staticPieBuild.stdout}\n${staticPieBuild.stderr}`,
          ).toBeUndefined();
          expect(staticPieBuild.status, staticPieBuild.stderr).toBe(0);
          const staticPieImage = fs.readFileSync(staticPieEntry);
          expect(staticPieImage.readUInt16LE(16)).toBe(3);
          const staticPieProgramHeaderOffset = Number(
            staticPieImage.readBigUInt64LE(32),
          );
          const staticPieProgramHeaderBytes = staticPieImage.readUInt16LE(54);
          const staticPieProgramHeaderCount = staticPieImage.readUInt16LE(56);
          const staticPieProgramTypes = Array.from(
            { length: staticPieProgramHeaderCount },
            (_unused, index) =>
              staticPieImage.readUInt32LE(
                staticPieProgramHeaderOffset +
                  index * staticPieProgramHeaderBytes,
              ),
          );
          expect(staticPieProgramTypes).toContain(2);
          expect(staticPieProgramTypes).not.toContain(3);

          const replacementBuild = nativeSpawnSync(
            "/usr/bin/cc",
            [
              "-static",
              "-no-pie",
              "-Wl,-z,noexecstack",
              "-O2",
              "-Wall",
              "-Wextra",
              "-x",
              "c",
              "-o",
              replacementEntry,
              "-",
            ],
            {
              encoding: "utf8",
              input: [
                "#include <unistd.h>",
                "int main(void) {",
                '  static const char marker[] = "REPLACEMENT_MARKER\\n";',
                "  return write(1, marker, sizeof(marker) - 1) ==",
                "                 (ssize_t)(sizeof(marker) - 1)",
                "             ? 0",
                "             : 1;",
                "}",
              ].join("\n"),
              timeout: 60_000,
            },
          );
          expect(
            replacementBuild.error,
            `${replacementBuild.stdout}\n${replacementBuild.stderr}`,
          ).toBeUndefined();
          expect(replacementBuild.status, replacementBuild.stderr).toBe(0);

          const dynamicBuild = nativeSpawnSync(
            "/usr/bin/cc",
            [
              "-DCHAINLESS_DLOPEN_PROBE=1",
              "-no-pie",
              "-Wl,-z,noexecstack",
              "-O2",
              "-Wall",
              "-Wextra",
              "-o",
              dynamicEntry,
              nativeSource,
              "-ldl",
            ],
            { encoding: "utf8", timeout: 60_000 },
          );
          expect(
            dynamicBuild.error,
            `${dynamicBuild.stdout}\n${dynamicBuild.stderr}`,
          ).toBeUndefined();
          expect(dynamicBuild.status, dynamicBuild.stderr).toBe(0);
          const dynamicPieBuild = nativeSpawnSync(
            "/usr/bin/cc",
            [
              "-DCHAINLESS_DLOPEN_PROBE=1",
              "-fPIE",
              "-pie",
              "-Wl,-z,noexecstack",
              "-O2",
              "-Wall",
              "-Wextra",
              "-o",
              dynamicPieEntry,
              nativeSource,
              "-ldl",
            ],
            { encoding: "utf8", timeout: 60_000 },
          );
          expect(
            dynamicPieBuild.error,
            `${dynamicPieBuild.stdout}\n${dynamicPieBuild.stderr}`,
          ).toBeUndefined();
          expect(dynamicPieBuild.status, dynamicPieBuild.stderr).toBe(0);
          const dynamicPieImage = fs.readFileSync(dynamicPieEntry);
          expect(dynamicPieImage.readUInt16LE(16)).toBe(3);
          const nestedNamespaceControl = nativeSpawnSync(
            dynamicEntry,
            ["--nested-namespace-control", approvedLibrary],
            { encoding: "utf8", timeout: 60_000 },
          );
          const nestedNamespaceControlContext = JSON.stringify({
            status: nestedNamespaceControl.status,
            signal: nestedNamespaceControl.signal,
            error: nestedNamespaceControl.error?.message,
            stdout: nestedNamespaceControl.stdout,
            stderr: nestedNamespaceControl.stderr,
          });
          expect(
            nestedNamespaceControl.error,
            nestedNamespaceControlContext,
          ).toBeUndefined();
          expect(
            nestedNamespaceControl.status,
            nestedNamespaceControlContext,
          ).toBe(0);
          const nestedNamespaceControlReport = JSON.parse(
            nestedNamespaceControl.stdout,
          );
          expect(
            nestedNamespaceControlReport.nestedNamespaceControlSupported,
          ).toEqual(expect.any(Boolean));
          if (nestedNamespaceControlReport.nestedNamespaceControlSupported) {
            // When the host permits unprivileged user namespaces, prove the
            // adversarial fixture is not a constant-false dlopen check.
            expect(nestedNamespaceControlReport).toMatchObject({
              stage: "complete",
              errno: 0,
              dropinWritten: true,
              dropinDlopen: true,
            });
          } else {
            // Host userns/AppArmor policy may independently close the attack.
            // Record that as unsupported rather than counting it as seccomp
            // evidence; the sandboxed syscall probes below remain mandatory.
            expect(["unshare", "id-map", "mkdtemp", "mount"]).toContain(
              nestedNamespaceControlReport.stage,
            );
            expect(Number.isInteger(nestedNamespaceControlReport.errno)).toBe(
              true,
            );
            expect(nestedNamespaceControlReport.errno).toBeGreaterThan(0);
          }
          fs.writeFileSync(
            scriptEntry,
            `#!/bin/sh\nprintf launched > ${quotePosix(scriptMarker)}\n`,
            { mode: 0o700 },
          );

          for (const [alias, entryPath, targetRuntime] of [
            ["strict-native", staticEntry, "native-static-elf"],
            ["strict-native-static-pie", staticPieEntry, "native-static-elf"],
            ["dynamic-native", dynamicEntry, "native-dynamic-elf"],
            ["dynamic-pie-native", dynamicPieEntry, "native-dynamic-elf"],
          ]) {
            fs.writeFileSync(allowedPath, "allowed-native-data", "utf8");
            const dynamicRuntime = targetRuntime === "native-dynamic-elf";
            if (dynamicRuntime) {
              fs.writeFileSync(approvedLibrary, approvedLibraryOriginal);
              fs.chmodSync(approvedLibrary, 0o755);
            }
            const commandArgs = dynamicRuntime
              ? [
                  ...baseCommandArgs,
                  sandboxApprovedLibrary,
                  unmountedSameSonameLibrary,
                  unmountedDifferentSonameLibrary,
                ]
              : baseCommandArgs;
            const destination = `/opt/chainless/plugin/bin/${path.basename(
              entryPath,
            )}`;
            const pluginTreeSnapshotMembers = [
              path.join(pluginRoot, "plugin.json"),
              allowedPath,
              staticEntry,
              staticPieEntry,
              dynamicEntry,
              dynamicPieEntry,
              scriptEntry,
              approvedLibrary,
            ];
            const expectedPluginTreeSnapshotBytes =
              pluginTreeSnapshotMembers.reduce(
                (total, member) => total + Number(fs.statSync(member).size),
                0,
              );
            const expectedPluginFileBindings = pluginTreeSnapshotMembers
              .map((member) => ({
                destination: path.posix.join(
                  "/opt/chainless/plugin",
                  path.relative(pluginRoot, member).split(path.sep).join("/"),
                ),
                roBindData: [
                  {
                    childFd: expect.any(String),
                    permissions:
                      (fs.statSync(member).mode & 0o111) !== 0
                        ? "0500"
                        : "0400",
                  },
                ],
                roBindFd: [],
              }))
              .sort((left, right) =>
                left.destination.localeCompare(right.destination),
              );
            const positive = nativeSpawnSync(
              process.execPath,
              [
                childFixture,
                "plugin-command-snapshot-race",
                workspace,
                JSON.stringify({
                  command: [alias, ...commandArgs].join(" "),
                  entryPath,
                  replacementPath: replacementEntry,
                  destination,
                  dependencyPath: dynamicRuntime
                    ? approvedLibrary
                    : allowedPath,
                  dependencyReplacementPath: dynamicRuntime
                    ? replacementApprovedLibrary
                    : replacementAllowedPath,
                  dependencyDestination: dynamicRuntime
                    ? sandboxApprovedLibrary
                    : sandboxAllowedPath,
                  runtimeDestination: sandboxRuntimePath,
                }),
              ],
              {
                encoding: "utf8",
                timeout: 60_000,
                windowsHide: true,
                env: {
                  ...process.env,
                  CC_SANDBOX_STRICT: "1",
                  LD_LIBRARY_PATH: "/host/sensitive/library-path",
                  CC_TEST_SENSITIVE_ENV: "must-not-cross-boundary",
                },
              },
            );
            const positiveContext = JSON.stringify({
              alias,
              status: positive.status,
              signal: positive.signal,
              error: positive.error?.message,
              stdout: positive.stdout,
              stderr: positive.stderr,
            });
            expect(positive.error, positiveContext).toBeUndefined();
            expect(positive.status, positiveContext).toBe(0);
            const envelope = JSON.parse(positive.stdout);
            expect(envelope.result).toMatchObject({
              plugin_bin: {
                plugin: "strict-native",
                runtime: "native",
                identity_attested: true,
                launch_identity_reattested: true,
                direct_argv: true,
              },
            });
            const nativeReport = JSON.parse(envelope.result.stdout);
            expect(nativeReport).toMatchObject({
              allowedReadable: true,
              allowed: "allowed-native-data",
              cwd: "/opt/chainless/plugin",
              chainlessSandboxed: true,
              sensitiveEnv: false,
              ldLibraryPath: false,
              secretReadable: false,
              hostRootReadable: false,
              pluginWritable: false,
              hostWritable: false,
              tmpWritable: !dynamicRuntime,
              networkErrno: 1,
              entryMode: "0500",
              entryWritable: false,
              entryChmodWritable: false,
              supervisorFdScanOk: true,
              supervisorFdMatches: 0,
              supervisorFdScanErrno: 0,
              nonStdioOpenFds: 0,
              nonStdioRegularFds: 0,
              fdScanUpperBound: 1024,
              supervisorStagingPathVisible: false,
              supervisorStagingPathErrno: 2,
              ...(dynamicRuntime
                ? {
                    pid1ExecutableStatOk: false,
                    pid1ExecutableMatchesSupervisor: false,
                    pid1ExecutableErrno: 2,
                    approvedDlopenOriginal: true,
                    hostSameSonameDlopen: false,
                    hostDifferentSonameDlopen: false,
                    tmpDropinWritten: false,
                    tmpDropinDlopen: false,
                    varTmpDropinWritten: false,
                    varTmpDropinDlopen: false,
                    runDropinWritten: false,
                    runDropinDlopen: false,
                    homeDropinWritten: false,
                    homeDropinDlopen: false,
                    homePluginDirectoryWritable: false,
                    homePluginDropinWritten: false,
                    homePluginDropinDlopen: false,
                    pluginDropinWritten: false,
                    pluginDropinDlopen: false,
                    procFdPathMissing: true,
                    procFdPathErrno: 2,
                    devFdPathMissing: true,
                    devFdPathErrno: 2,
                    procFdDlopen: false,
                    devFdDlopen: false,
                    unixSocketpairCreated: false,
                    unixSocketpairErrno: 1,
                    recvmsgErrno: 1,
                    recvmmsgErrno: 1,
                    pidfdDuplicatedFds: 0,
                    pidfdRegularFds: 0,
                    nameToHandleSucceeded: expect.any(Boolean),
                    openByHandleMountFdSucceeded: expect.any(Boolean),
                    openByHandleSucceeded: false,
                    namespaceProbeErrno: 0,
                    unshareErrno: 1,
                    namespaceCloneErrno: 1,
                    clone3Errno: 38,
                    setnsErrno: 1,
                    mountErrno: 1,
                    umount2Errno: 1,
                    pivotRootErrno: 1,
                    openTreeErrno: 1,
                    moveMountErrno: 1,
                    fsopenErrno: 1,
                    fsconfigErrno: 1,
                    fsmountErrno: 1,
                    fspickErrno: 1,
                    mountSetattrErrno: 1,
                    nestedNamespaceDropinWritten: false,
                    nestedNamespaceDropinDlopen: false,
                  }
                : {
                    pid1ExecutableStatOk: expect.any(Boolean),
                    pid1ExecutableMatchesSupervisor: expect.any(Boolean),
                  }),
            });
            // Static profiles retain procfs for compatibility and treat PID 1
            // identity as diagnostic only. Dynamic pathname-closure profiles
            // require the same lookup to fail because procfs is not mounted.
            expect(Number.isInteger(nativeReport.pid1ExecutableErrno)).toBe(
              true,
            );
            if (dynamicRuntime) {
              expect(Number.isInteger(nativeReport.pidfdErrno)).toBe(true);
              if (nativeReport.pidfdOpened) {
                // A live pidfd alone is not evidence: every getfd attempt must
                // be rejected by the kernel policy, not merely miss an FD.
                expect(nativeReport.pidfdErrno).toBe(1);
              } else {
                // Keep unsupported/unavailable kernels explicit instead of
                // treating a zero-result scan as enforcement evidence.
                expect([1, 3, 13, 38]).toContain(nativeReport.pidfdErrno);
              }
              expect(Number.isInteger(nativeReport.openByHandleErrno)).toBe(
                true,
              );
              if (nativeReport.nameToHandleSucceeded) {
                expect(nativeReport.openByHandleMountFdSucceeded).toBe(true);
                expect(nativeReport.openByHandleErrno).toBe(1);
              } else {
                expect(nativeReport.openByHandleMountFdSucceeded).toBe(false);
              }
            }
            expectLinuxSupervisorPlan(envelope.supervisorPlan);
            if (dynamicRuntime) {
              expect(envelope.supervisorPlan).toMatchObject({
                tmpfsTargets: ["/run"],
                remountReadOnlyTargets: ["/", "/run"],
                procMounted: false,
                devMounted: false,
              });
              expect(envelope.supervisorPlan.maxDescriptorChildFd).toBeLessThan(
                nativeReport.fdScanUpperBound,
              );
            }
            expect(envelope.mutationPhase).toBe(
              "after-broker-plan-admission-before-native-spawn",
            );
            expect(envelope.mutationLaunchBinding).toEqual({
              commandMatchesPlan: true,
              argsMatchPlan: true,
            });
            expect(envelope.mutation).toMatchObject({
              sameDevice: true,
              sameInode: true,
              afterSha256: envelope.mutation.replacementSha256,
            });
            expect(envelope.mutation.beforeSha256).not.toBe(
              envelope.mutation.afterSha256,
            );
            expect(envelope.mutation.afterSha256).toBe(
              fileSha256(replacementEntry),
            );
            expect(envelope.entryBindings).toEqual({
              destination,
              roBindData: [
                {
                  childFd: expect.any(String),
                  permissions: "0500",
                },
              ],
              roBindFd: [],
            });
            expect(envelope.dependencyMutation).toMatchObject({
              sameDevice: true,
              sameInode: true,
              afterSha256: envelope.dependencyMutation.replacementSha256,
            });
            expect(envelope.dependencyMutation.beforeSha256).not.toBe(
              envelope.dependencyMutation.afterSha256,
            );
            expect(envelope.dependencyMutation.afterSha256).toBe(
              fileSha256(
                dynamicRuntime
                  ? replacementApprovedLibrary
                  : replacementAllowedPath,
              ),
            );
            expect(envelope.dependencyBindings).toEqual({
              destination: dynamicRuntime
                ? sandboxApprovedLibrary
                : sandboxAllowedPath,
              roBindData: [
                {
                  childFd: expect.any(String),
                  permissions: dynamicRuntime ? "0500" : "0400",
                },
              ],
              roBindFd: [],
            });
            expect(envelope.runtimeBindings).toEqual({
              destination: sandboxRuntimePath,
              roBindData: dynamicRuntime
                ? [
                    {
                      childFd: expect.any(String),
                      permissions: "0500",
                    },
                  ]
                : [],
              roBindFd: dynamicRuntime ? [] : [{ childFd: expect.any(String) }],
            });
            expect(envelope.pluginFileBindings).toEqual(
              expectedPluginFileBindings,
            );
            expect(envelope.audit).toMatchObject({
              permissionDecision: "allow",
              sandboxed: true,
              sandboxState: "ready",
              sandboxBackend: "linux-bwrap",
              sandboxEnforcement: "linux-bwrap",
              sandboxPolicyAttested: true,
              sandboxGuarantees: [
                SANDBOX_BOUNDARIES.FILESYSTEM,
                SANDBOX_BOUNDARIES.NETWORK,
                SANDBOX_BOUNDARIES.PROCESS_TREE,
              ],
              sandboxRuntimeProbe: {
                kind:
                  targetRuntime === "native-dynamic-elf"
                    ? "linux-bwrap-plugin-native-dynamic-elf-policy-v1"
                    : "linux-bwrap-plugin-native-static-elf-policy-v1",
                attempted: true,
                runnable: true,
                reason: null,
                probeRuntime: "node",
                targetRuntime,
                contentSnapshot: true,
                contentSnapshotScope: "plugin-entry-executable",
                contentSnapshotMechanism:
                  "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
                pluginTreeContentSnapshot: true,
                pluginTreeContentSnapshotScope:
                  "all-pinned-plugin-regular-files",
                pluginTreeContentSnapshotMechanism:
                  "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
                pluginTreeContentSnapshotFiles:
                  pluginTreeSnapshotMembers.length,
                pluginTreeContentSnapshotBytes: expectedPluginTreeSnapshotBytes,
                pluginTreeContentSnapshotDigest:
                  expect.stringMatching(/^[a-f0-9]{64}$/),
                pluginTreeSnapshotConsistency: "per-file-pin-to-launch",
                pluginTreeSnapshotContractBound: false,
                pluginTreeSnapshotAtomic: false,
                ...(targetRuntime === "native-dynamic-elf"
                  ? {
                      initialDynamicLoadClosureDescriptorBound: true,
                      initialDynamicLoadClosureScope:
                        "initial-pt_interp-and-recursive-dt_needed-attested-system-graph",
                      initialDynamicLoadClosureMechanism:
                        "recursive-parsed-elf-system-graph-to-attested-runtime-fds-v1",
                      initialDynamicInterpreter: expect.stringMatching(
                        /^\/(?:usr\/)?lib(?:64)?\//,
                      ),
                      initialDynamicDependencyCount: expect.any(Number),
                      initialDynamicRuntimeFileCount: expect.any(Number),
                      initialDynamicRuntimeBytes: expect.any(Number),
                      initialDynamicLoadClosureDigest:
                        expect.stringMatching(/^[a-f0-9]{64}$/),
                      sharedLibraryClosure: false,
                      runtimeSharedLibraryPathnameClosure: true,
                      runtimeSharedLibraryPathnameClosureExcludes:
                        "anonymous-jit-and-custom-in-process-loader",
                      runtimeSharedLibraryClosureScope:
                        "all-pathname-visible-regular-files-in-read-only-bwrap-namespace",
                      runtimeSharedLibraryClosureMechanism:
                        "descriptor-pinned-hashed-ro-mount-set-plus-loader-fd-and-namespace-mutation-seccomp-v2",
                      runtimeSharedLibraryLoadSetFiles: expect.any(Number),
                      runtimeSharedLibraryLoadSetBytes: expect.any(Number),
                      runtimeSharedLibraryLoadSetDigest:
                        expect.stringMatching(/^[a-f0-9]{64}$/),
                      runtimeLoadSetPolicyBound: true,
                      runtimeWritableFilesystems: false,
                      runtimeProcfsMounted: false,
                      runtimeDevfsMounted: false,
                      runtimeScratchWritable: false,
                      runtimeDescriptorReopenPaths: false,
                    }
                  : {}),
                handleAtomic: false,
              },
            });
            expectLinuxSupervisorAudit(envelope.audit, supervisorIdentity, {
              pid1ExecutableExposure: dynamicRuntime
                ? "procfs-not-mounted"
                : "procfs",
            });
            if (dynamicRuntime) {
              const runtimeProbe = envelope.audit.sandboxRuntimeProbe;
              expect(runtimeProbe.runtimeSharedLibraryLoadSetFiles).toBe(
                envelope.supervisorPlan.descriptorChildFds.length - 1,
              );
              expect(
                runtimeProbe.runtimeSharedLibraryLoadSetFiles,
              ).toBeLessThanOrEqual(512);
              expect(envelope.supervisorPlan.maxDescriptorChildFd).toBe(
                4 + runtimeProbe.runtimeSharedLibraryLoadSetFiles,
              );
            }
            expect(envelope.audit.sandboxPolicyDigest).toMatch(
              /^[a-f0-9]{64}$/,
            );
            expect(fs.readFileSync(allowedPath, "utf8")).toBe(
              dynamicRuntime
                ? "allowed-native-data"
                : "replacement-native-data",
            );
            if (dynamicRuntime) {
              expect(fileSha256(approvedLibrary)).toBe(
                fileSha256(replacementApprovedLibrary),
              );
            }

            const replaced = nativeSpawnSync(entryPath, [], {
              encoding: "utf8",
              timeout: 15_000,
            });
            expect(replaced.error, replaced.stderr).toBeUndefined();
            expect(replaced.status, replaced.stderr).toBe(0);
            expect(replaced.stdout).toBe("REPLACEMENT_MARKER\n");
          }

          for (const [alias, reason] of [
            ["script-native", "native_entry_not_elf"],
          ]) {
            const negative = runPluginCommand(
              [alias, ...baseCommandArgs].join(" "),
            );
            const negativeContext = JSON.stringify({
              alias,
              status: negative.status,
              signal: negative.signal,
              error: negative.error?.message,
              stdout: negative.stdout,
              stderr: negative.stderr,
            });
            expect(negative.error, negativeContext).toBeUndefined();
            expect(negative.status, negativeContext).toBe(0);
            const rejected = JSON.parse(negative.stdout);
            expect(rejected.result.error).toContain(
              "cannot satisfy required boundaries",
            );
            expect(rejected.audit).toMatchObject({
              permissionDecision: "deny",
              sandboxed: false,
              sandboxState: "denied",
              sandboxBackend: null,
              sandboxCandidateBackend: "linux-bwrap",
              sandboxPolicyAttested: false,
              sandboxRuntimeProbe: {
                kind: "linux-bwrap-plugin-native-elf-policy-v1",
                attempted: false,
                runnable: false,
                reason,
                probeRuntime: "node",
                targetRuntime: "native-unclassified",
                contentSnapshot: false,
                handleAtomic: false,
              },
            });
          }

          expect(fs.readFileSync(secretPath, "utf8")).toBe("host-only-secret");
          expect(
            fs.existsSync(path.join(pluginRoot, "plugin-marker.txt")),
          ).toBe(false);
          expect(fs.existsSync(hostMarker)).toBe(false);
          expect(fs.existsSync(scriptMarker)).toBe(false);
          expect(fs.existsSync(sandboxTmpPath)).toBe(false);
        } finally {
          fs.rmSync(workspace, { recursive: true, force: true });
          fs.rmSync(secretPath, { force: true });
          fs.rmSync(hostMarker, { force: true });
          fs.rmSync(scriptMarker, { force: true });
          fs.rmSync(sandboxTmpPath, { force: true });
        }
      },
      150_000,
    );

    it.runIf(process.platform === "linux")(
      "enforces the Broker-issued generic workspace boundary through the final target",
      async () => {
        const nonce = `${process.pid}-${Date.now()}`;
        const workspace = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-linux-generic-live-"),
        );
        const scriptPath = path.join(workspace, "verify-boundary.sh");
        const longRunningScriptPath = path.join(
          workspace,
          "verify-async-cleanup.sh",
        );
        const treeScriptPath = path.join(
          workspace,
          "verify-tree-termination.sh",
        );
        const workspaceMarker = path.join(workspace, "workspace-marker.txt");
        const backgroundMarker = path.join(
          workspace,
          "background-runner-marker.txt",
        );
        const asyncReadyMarker = path.join(workspace, "async-ready.txt");
        const asyncReleaseMarker = path.join(workspace, "async-release.txt");
        const asyncDoneMarker = path.join(workspace, "async-done.txt");
        const treePidMarker = path.join(workspace, "tree-grandchild.pid");
        const parentExitPidMarker = path.join(
          workspace,
          "parent-exit-grandchild.pid",
        );
        const hostileImportMarker = path.join(
          workspace,
          "hostile-python-imported.txt",
        );
        const outsideMarker = path.join(
          os.tmpdir(),
          `.cc-linux-generic-outside-${nonce}`,
        );
        const homeMarker = path.join(
          os.homedir(),
          `.cc-linux-generic-home-${nonce}`,
        );
        const devShmMarker = path.join(
          "/dev/shm",
          `.cc-linux-generic-dev-shm-${nonce}`,
        );
        const hostNetworkNamespace = fs.readlinkSync("/proc/self/ns/net");
        const fdTargetCounts = () => {
          const counts = new Map();
          for (const entry of fs.readdirSync("/proc/self/fd")) {
            try {
              const target = String(fs.readlinkSync(`/proc/self/fd/${entry}`));
              counts.set(target, (counts.get(target) || 0) + 1);
            } catch {
              // The descriptor used to enumerate /proc/self/fd can disappear.
            }
          }
          return counts;
        };
        const positiveFdGrowth = (before) =>
          [...fdTargetCounts().entries()]
            .map(([target, count]) => ({
              target,
              count: count - (before.get(target) || 0),
            }))
            .filter((entry) => entry.count > 0)
            .sort((left, right) => left.target.localeCompare(right.target));
        const waitForFdGrowthToClear = async (before, timeoutMs = 5_000) => {
          const deadline = Date.now() + timeoutMs;
          let growth = positiveFdGrowth(before);
          while (growth.length > 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            growth = positiveFdGrowth(before);
          }
          return growth;
        };
        const waitForPath = async (target, timeoutMs = 10_000) => {
          const deadline = Date.now() + timeoutMs;
          while (!fs.existsSync(target)) {
            if (Date.now() >= deadline) {
              throw new Error(`Timed out waiting for ${target}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        };
        const hostProcessExists = (pid) => {
          try {
            process.kill(pid, 0);
            return true;
          } catch (error) {
            if (error?.code === "ESRCH") return false;
            throw error;
          }
        };
        const hostDescendants = (rootPid) => {
          const children = new Map();
          for (const entry of fs.readdirSync("/proc")) {
            if (!/^\d+$/.test(entry)) continue;
            try {
              const status = fs.readFileSync(`/proc/${entry}/status`, "utf8");
              const parentPid = Number(status.match(/^PPid:\s+(\d+)$/m)?.[1]);
              if (!Number.isSafeInteger(parentPid)) continue;
              if (!children.has(parentPid)) children.set(parentPid, []);
              children.get(parentPid).push(Number(entry));
            } catch {
              // Processes can exit while /proc is being enumerated.
            }
          }
          const descendants = [];
          const pending = [...(children.get(rootPid) || [])];
          while (pending.length > 0) {
            const pid = pending.shift();
            descendants.push(pid);
            pending.push(...(children.get(pid) || []));
          }
          return descendants;
        };
        const waitForTreeGrandchild = async (
          wrapperPid,
          timeoutMs = 10_000,
        ) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            for (const pid of hostDescendants(wrapperPid)) {
              try {
                const commandLine = fs
                  .readFileSync(`/proc/${pid}/cmdline`)
                  .toString("utf8")
                  .replaceAll("\0", " ");
                if (
                  commandLine.includes("verify-tree-termination.sh") &&
                  commandLine.includes("grandchild")
                ) {
                  return pid;
                }
              } catch {
                // Retry while the sandbox process tree is stabilizing.
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          throw new Error(
            `Timed out locating sandbox grandchild below ${wrapperPid}`,
          );
        };
        const waitForHostProcessExit = async (pid, timeoutMs = 10_000) => {
          const deadline = Date.now() + timeoutMs;
          while (hostProcessExists(pid)) {
            if (Date.now() >= deadline) {
              throw new Error(`Timed out waiting for host pid ${pid} to exit`);
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        };
        const socketProbe = [
          "import errno,socket,sys",
          "try:",
          " s=socket.socket(socket.AF_INET,socket.SOCK_STREAM)",
          "except OSError as e:",
          " sys.exit(0 if e.errno==errno.EPERM else 6)",
          "else:",
          " s.close()",
          " sys.exit(5)",
        ].join("\n");
        const mountCheck = [
          "mount_is_read_only() {",
          '  want="$1"',
          "  seen=0",
          "  while IFS=' ' read -r _ _ _ _ mountpoint mountopts _; do",
          '    [ "$mountpoint" = "$want" ] || continue',
          "    seen=1",
          '    case ",$mountopts," in',
          "      *,ro,*) ;;",
          "      *) return 1 ;;",
          "    esac",
          "  done < /proc/self/mountinfo",
          '  [ "$seen" = 1 ]',
          "}",
          "workspace_mount_topology_is_attested() {",
          `  want=${quotePosix(mountInfoPath(workspace))}`,
          '  prefix="${want}/"',
          "  seen=0",
          "  while IFS=' ' read -r _ _ _ _ mountpoint _; do",
          '    [ "$mountpoint" = "$want" ] && seen=1',
          '    case "$mountpoint" in',
          '      "$prefix"*) return 1 ;;',
          "    esac",
          "  done < /proc/self/mountinfo",
          '  [ "$seen" = 1 ]',
          "}",
        ];
        const script = [
          "#!/bin/sh",
          "set -eu",
          ...mountCheck,
          "mount_is_read_only /",
          "mount_is_read_only /usr",
          "workspace_mount_topology_is_attested",
          "for fdpath in /proc/$$/fd/*; do",
          '  fd="${fdpath##*/}"',
          '  case "$fd" in 0|1|2) continue ;; esac',
          '  target="$(readlink "$fdpath" 2>/dev/null || true)"',
          `  case "$target" in ${quotePosix(
            workspace,
          )}|/usr|/etc/group|/etc/hosts|/etc/ld.so.cache|/etc/nsswitch.conf|/etc/passwd|*bwrap*|*"(deleted)"*) exit 22 ;; esac`,
          "done",
          `test ! -e ${quotePosix(homeMarker)}`,
          `test ! -e ${quotePosix(outsideMarker)}`,
          "test ! -e /etc/shadow",
          `test ! -e ${quotePosix(devShmMarker)}`,
          `printf sandbox-dev > ${quotePosix(devShmMarker)}`,
          `test "$(cat ${quotePosix(devShmMarker)})" = sandbox-dev`,
          `rm -f ${quotePosix(devShmMarker)}`,
          "if printf x > /chainless-final-root-write 2>/dev/null; then exit 20; fi",
          "test ! -e /chainless-final-root-write",
          "if printf x > /usr/.chainless-final-system-write 2>/dev/null; then exit 21; fi",
          "test ! -e /usr/.chainless-final-system-write",
          `test "$(readlink /proc/self/ns/net)" != ${quotePosix(
            hostNetworkNamespace,
          )}`,
          `printf workspace-ok > ${quotePosix(workspaceMarker)}`,
          `/usr/bin/python3 -I -S -c ${quotePosix(socketProbe)}`,
          "printf generic-live-ok",
        ].join("\n");
        let asyncChild = null;
        let treeChild = null;
        const trackedHostPids = new Set();

        try {
          fs.writeFileSync(outsideMarker, "host-outside", {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          });
          fs.writeFileSync(homeMarker, "host-home", {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          });
          fs.writeFileSync(devShmMarker, "host-dev-shm", {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          });
          fs.writeFileSync(
            path.join(workspace, "socket.py"),
            `open(${JSON.stringify(hostileImportMarker)}, "w").write("socket")\n`,
            "utf8",
          );
          fs.writeFileSync(
            path.join(workspace, "sitecustomize.py"),
            `open(${JSON.stringify(hostileImportMarker)}, "w").write("site")\n`,
            "utf8",
          );
          fs.writeFileSync(scriptPath, script, { mode: 0o700 });
          fs.writeFileSync(
            longRunningScriptPath,
            [
              "#!/bin/sh",
              "set -eu",
              `printf ready > ${quotePosix(asyncReadyMarker)}`,
              `while [ ! -e ${quotePosix(asyncReleaseMarker)} ]; do`,
              "  /usr/bin/sleep 0.05",
              "done",
              `printf done > ${quotePosix(asyncDoneMarker)}`,
            ].join("\n"),
            { mode: 0o700 },
          );
          fs.writeFileSync(
            treeScriptPath,
            [
              "#!/bin/sh",
              "set -eu",
              'pid_marker="$1"',
              'if [ "${2:-}" = "grandchild" ]; then',
              '  printf ready > "$pid_marker"',
              "  while :; do /usr/bin/sleep 1; done",
              "fi",
              '/bin/sh "$0" "$pid_marker" grandchild &',
              'grandchild="$!"',
              'while [ ! -s "$pid_marker" ]; do /usr/bin/sleep 0.05; done',
              'wait "$grandchild"',
            ].join("\n"),
            { mode: 0o700 },
          );

          const command = "/bin/sh";
          const args = [scriptPath];
          const spawnOptions = {
            cwd: workspace,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
            origin: "test:linux-generic-workspace-live",
            scope: "sandbox-test",
            policy: "allow",
            encoding: "utf8",
            timeout: 120_000,
            env: {
              ...process.env,
              PYTHONHOME: workspace,
              PYTHONPATH: workspace,
            },
            sandboxPolicy: {
              requiredBoundaries: [
                SANDBOX_BOUNDARIES.FILESYSTEM,
                SANDBOX_BOUNDARIES.NETWORK,
              ],
            },
          };
          const executionContract =
            executionBroker.issueLinuxWorkspaceSandboxExecutionContract(
              command,
              args,
              spawnOptions,
              workspace,
              { sync: true },
            );
          expect(executionContract).not.toBeNull();
          const beforeFds = fdTargetCounts();
          const result = executionBroker.spawnSync(command, args, {
            ...spawnOptions,
            sandboxExecutionContract: executionContract,
          });
          const afterFds = fdTargetCounts();
          const failureContext = JSON.stringify({
            status: result.status,
            signal: result.signal,
            error: result.error?.message,
            stdout: result.stdout,
            stderr: result.stderr,
          });

          expect(result.error, failureContext).toBeUndefined();
          expect(result.status, failureContext).toBe(0);
          expect(result.stdout).toBe("generic-live-ok");
          expect(fs.readFileSync(workspaceMarker, "utf8")).toBe("workspace-ok");
          expect(fs.readFileSync(outsideMarker, "utf8")).toBe("host-outside");
          expect(fs.readFileSync(homeMarker, "utf8")).toBe("host-home");
          expect(fs.readFileSync(devShmMarker, "utf8")).toBe("host-dev-shm");
          expect(fs.existsSync(hostileImportMarker)).toBe(false);
          expect(
            [...afterFds.entries()].filter(
              ([target, count]) => count > (beforeFds.get(target) || 0),
            ),
          ).toEqual([]);

          await warmBrokerAsyncRuntime(workspace);
          const credentialInfoBefore =
            executionBroker._credentialAgent.getInfo();
          const credentialWorkerThreadBefore =
            executionBroker._credentialAgent._credentialTransport?._worker
              ?.threadId ?? null;
          const credentialListenerPaths = () => {
            const currentProcessSocketInodes = new Set();
            for (const entry of fs.readdirSync("/proc/self/fd")) {
              try {
                const target = fs.readlinkSync(`/proc/self/fd/${entry}`);
                const match = /^socket:\[(\d+)\]$/.exec(target);
                if (match) currentProcessSocketInodes.add(match[1]);
              } catch {
                // The descriptor used to enumerate /proc/self/fd can disappear.
              }
            }
            return fs
              .readFileSync("/proc/net/unix", "utf8")
              .split("\n")
              .map((line) => line.trim().split(/\s+/))
              .filter(
                (fields) =>
                  fields.length >= 8 &&
                  currentProcessSocketInodes.has(fields[6]),
              )
              .map((fields) => fields.slice(7).join(" "))
              .filter((value) =>
                /^cc-cred-[a-f0-9]{24}\.sock$/.test(
                  path.posix.basename(value || ""),
                ),
              )
              .sort();
          };
          const credentialListenersBefore = credentialListenerPaths();
          expect(credentialInfoBefore.transportInfo).toMatchObject({
            available: true,
            ready: true,
          });
          expect(credentialListenersBefore).toEqual([
            credentialInfoBefore.transportInfo.endpoint,
          ]);
          const beforeBackgroundFds = fdTargetCounts();
          const backgroundRequest = {
            command: [
              `test ! -e ${quotePosix(outsideMarker)}`,
              `printf background-ok > ${quotePosix(backgroundMarker)}`,
              `/usr/bin/python3 -I -S -c ${quotePosix(socketProbe)}`,
              "printf background-live-ok",
            ].join(" && "),
            cwd: workspace,
            type: "shell",
            workspaceCwd: workspace,
            requiredBoundaries: ["filesystem", "network"],
          };
          const backgroundOutputs = [
            await executeBackgroundTaskCommand(backgroundRequest),
            await executeBackgroundTaskCommand(backgroundRequest),
          ];
          expect(backgroundOutputs).toEqual([
            "background-live-ok",
            "background-live-ok",
          ]);
          expect(fs.readFileSync(backgroundMarker, "utf8")).toBe(
            "background-ok",
          );
          expect(fs.readFileSync(outsideMarker, "utf8")).toBe("host-outside");
          const backgroundFdGrowth =
            await waitForFdGrowthToClear(beforeBackgroundFds);
          expect(
            backgroundFdGrowth,
            JSON.stringify(backgroundFdGrowth),
          ).toEqual([]);
          const credentialInfoAfter =
            executionBroker._credentialAgent.getInfo();
          expect(credentialInfoAfter.transportInfo.endpoint).toBe(
            credentialInfoBefore.transportInfo.endpoint,
          );
          expect(
            executionBroker._credentialAgent._credentialTransport?._worker
              ?.threadId ?? null,
          ).toBe(credentialWorkerThreadBefore);
          expect(credentialListenerPaths()).toEqual(credentialListenersBefore);

          expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
            permissionDecision: "allow",
            sandboxed: true,
            sandboxState: "ready",
            sandboxBackend: "linux-bwrap-workspace",
            sandboxEnforcement: "linux-bwrap-workspace",
            sandboxPolicyAttested: true,
            sandboxGuarantees: [
              SANDBOX_BOUNDARIES.FILESYSTEM,
              SANDBOX_BOUNDARIES.NETWORK,
              SANDBOX_BOUNDARIES.PROCESS_TREE,
            ],
            sandboxRuntimeProbe: {
              kind: "linux-bwrap-generic-workspace-policy-v1",
              runnable: true,
              emptyRoot: true,
              undeclaredRootReadOnly: true,
              workspaceReadWrite: true,
              workspaceMountTopologyAttested: true,
              workspaceRootAliasAttested: true,
              anonymousDevWritable: true,
              systemReadOnly: true,
              hostHomeHidden: true,
              outsideMarkerHidden: true,
              networkNamespace: true,
              networkNamespaceChanged: true,
              pidNamespace: true,
              pidNamespaceChanged: true,
              processTreeCloseProbe: true,
              bubblewrapPid1Reaper: true,
              dieWithParent: true,
              closeImpliesProcessTreeClosed: true,
              socketCreationDenied: true,
              descriptorMounts: true,
              mountTopologyAtomic: false,
              mountTopologyDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
            },
            sandboxFilesystemPolicy: {
              workspaceRoot: workspace,
              workingDirectory: workspace,
              workspaceAccess: "read-write",
              systemAccess: "read-only",
              undeclaredRootAccess: "read-only",
              anonymousWritablePaths: [
                "/home/sandbox",
                "/dev",
                "/run",
                "/tmp",
                "/var/tmp",
              ],
              hostRootMapped: false,
              hostHomeMapped: false,
              workspaceDescriptorBound: true,
              systemDescriptorBound: true,
              exactEtcFileDescriptors: true,
              workspaceRecursiveBind: true,
              workspaceMountTopology:
                "no-strict-descendants-or-forbidden-root-aliases-at-attestation",
              mountTopologySource: "proc-self-mountinfo",
              mountTopologyDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
              mountTopologyAtomic: false,
            },
            sandboxNetworkPolicy: {
              namespace: "new",
              namespaceIdentityChanged: true,
              seccomp: "deny-network-creation",
            },
            sandboxProcessTreePolicy: {
              namespace: "new",
              namespaceIdentityChanged: true,
              init: "bubblewrap-pid1-reaper",
              parentDeathSignal: "SIGKILL",
              asPid1: false,
              closeFence: "pid-namespace-empty-or-killed",
            },
          });

          fs.rmSync(workspaceMarker, { force: true });
          let replayError = null;
          try {
            executionBroker.spawnSync(command, args, {
              ...spawnOptions,
              sandboxExecutionContract: executionContract,
            });
          } catch (error) {
            replayError = error;
          }
          expect(replayError?.code).toBe(
            "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
          );
          expect(fs.existsSync(workspaceMarker)).toBe(false);

          const asyncArgs = [longRunningScriptPath];
          const asyncOptions = {
            ...spawnOptions,
            stdio: ["ignore", "ignore", "ignore"],
          };
          delete asyncOptions.encoding;
          const asyncExecutionContract =
            executionBroker.issueLinuxWorkspaceSandboxExecutionContract(
              command,
              asyncArgs,
              asyncOptions,
              workspace,
            );
          const beforeAsyncFds = fdTargetCounts();
          asyncChild = executionBroker.spawn(command, asyncArgs, {
            ...asyncOptions,
            sandboxExecutionContract: asyncExecutionContract,
          });
          await waitForPath(asyncReadyMarker);
          expect(asyncChild.exitCode).toBeNull();
          const activeAsyncFds = fdTargetCounts();
          const descriptorTargets = new Set([
            workspace,
            "/usr",
            "/etc/group",
            "/etc/hosts",
            "/etc/ld.so.cache",
            "/etc/nsswitch.conf",
            "/etc/passwd",
            "/usr/bin/bwrap",
          ]);
          expect(
            [...activeAsyncFds.entries()].filter(
              ([target, count]) =>
                count > (beforeAsyncFds.get(target) || 0) &&
                (descriptorTargets.has(target) || target.includes("(deleted)")),
            ),
          ).toEqual([]);
          const asyncExit = once(asyncChild, "exit");
          fs.writeFileSync(asyncReleaseMarker, "release", "utf8");
          const [asyncCode, asyncSignal] = await asyncExit;
          expect({ asyncCode, asyncSignal }).toEqual({
            asyncCode: 0,
            asyncSignal: null,
          });
          asyncChild = null;
          expect(fs.readFileSync(asyncDoneMarker, "utf8")).toBe("done");

          const treeArgs = [treeScriptPath, treePidMarker];
          const treeOptions = {
            ...spawnOptions,
            stdio: ["ignore", "ignore", "ignore"],
          };
          delete treeOptions.encoding;
          const treeContract =
            executionBroker.issueLinuxWorkspaceSandboxExecutionContract(
              command,
              treeArgs,
              treeOptions,
              workspace,
            );
          treeChild = executionBroker.spawn(command, treeArgs, {
            ...treeOptions,
            sandboxExecutionContract: treeContract,
          });
          await waitForPath(treePidMarker);
          expect(fs.readFileSync(treePidMarker, "utf8")).toBe("ready");
          const treeGrandchildPid = await waitForTreeGrandchild(treeChild.pid);
          const treeDescendants = hostDescendants(treeChild.pid);
          for (const pid of treeDescendants) trackedHostPids.add(pid);
          expect(treeDescendants).toContain(treeGrandchildPid);
          const treeExit = once(treeChild, "exit");
          expect(treeChild.kill("SIGTERM")).toBe(true);
          await treeExit;
          treeChild = null;
          for (const pid of treeDescendants) {
            await waitForHostProcessExit(pid);
            trackedHostPids.delete(pid);
          }

          const parentExitFixture = fileURLToPath(
            new URL(
              "../fixtures/process-broker-linux-bwrap-live-child.mjs",
              import.meta.url,
            ),
          );
          const parentExit = nativeSpawnSync(
            process.execPath,
            [
              parentExitFixture,
              "generic-parent-exit",
              workspace,
              JSON.stringify({
                scriptPath: treeScriptPath,
                pidMarker: parentExitPidMarker,
              }),
            ],
            {
              encoding: "utf8",
              timeout: 45_000,
              windowsHide: true,
              env: {
                ...process.env,
                CC_SANDBOX_STRICT: "1",
              },
            },
          );
          const parentExitContext = JSON.stringify({
            status: parentExit.status,
            signal: parentExit.signal,
            error: parentExit.error?.message,
            stdout: parentExit.stdout,
            stderr: parentExit.stderr,
          });
          expect(parentExit.error, parentExitContext).toBeUndefined();
          expect(parentExit.status, parentExitContext).toBe(0);
          const parentExitResult = JSON.parse(parentExit.stdout);
          expect(parentExitResult.wrapperPid).toBeGreaterThan(1);
          expect(parentExitResult.grandchildHostPid).toBeGreaterThan(1);
          expect(fs.readFileSync(parentExitPidMarker, "utf8")).toBe("ready");
          expect(parentExitResult.descendantHostPids).toContain(
            parentExitResult.grandchildHostPid,
          );
          trackedHostPids.add(parentExitResult.wrapperPid);
          await waitForHostProcessExit(parentExitResult.wrapperPid);
          trackedHostPids.delete(parentExitResult.wrapperPid);
          for (const pid of parentExitResult.descendantHostPids) {
            trackedHostPids.add(pid);
            await waitForHostProcessExit(pid);
            trackedHostPids.delete(pid);
          }
        } finally {
          if (
            asyncChild &&
            asyncChild.exitCode === null &&
            asyncChild.signalCode === null
          ) {
            asyncChild.kill();
          }
          if (
            treeChild &&
            treeChild.exitCode === null &&
            treeChild.signalCode === null
          ) {
            treeChild.kill();
          }
          for (const pid of trackedHostPids) {
            try {
              process.kill(pid, "SIGKILL");
            } catch {
              // The expected successful path has already reaped the process.
            }
          }
          fs.rmSync(workspace, { recursive: true, force: true });
          fs.rmSync(outsideMarker, { force: true });
          fs.rmSync(homeMarker, { force: true });
          fs.rmSync(devShmMarker, { force: true });
        }
      },
      180_000,
    );

    it.runIf(process.platform === "linux")(
      "runs an interactive controlling PTY inside the generic workspace boundary and reaps its tree",
      async () => {
        const importedPty = await import("node-pty");
        const ptyModule = importedPty.default || importedPty;
        expect(typeof ptyModule.open).toBe("function");
        expect(typeof ptyModule.spawn).toBe("function");

        const workspace = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-linux-generic-pty-"),
        );
        const outsideMarker = path.join(
          os.tmpdir(),
          `.cc-linux-generic-pty-outside-${process.pid}-${Date.now()}`,
        );
        const workspaceMarker = path.join(workspace, "pty-marker.txt");
        fs.writeFileSync(outsideMarker, "host-only", "utf8");

        const command = "/bin/bash";
        const args = ["--noprofile", "--norc", "-i"];
        const sandboxPolicy = {
          profile: "strict",
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
        };
        const options = {
          cwd: workspace,
          shell: false,
          origin: "test:linux-generic-pty-live",
          scope: "sandbox-test",
          policy: "allow",
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          env: {
            PATH: process.env.PATH,
            LANG: "C",
            LC_ALL: "C",
          },
          sandboxPolicy,
        };
        const contract =
          executionBroker.issueLinuxWorkspaceSandboxExecutionContract(
            command,
            args,
            options,
            workspace,
            { pty: true },
          );
        expect(contract).toBeTruthy();

        const hostProcessExists = (pid) => {
          try {
            process.kill(pid, 0);
            return true;
          } catch (error) {
            if (error?.code === "ESRCH") return false;
            throw error;
          }
        };
        const descendantsOf = (rootPid) => {
          const children = new Map();
          for (const entry of fs.readdirSync("/proc")) {
            if (!/^\d+$/.test(entry)) continue;
            try {
              const stat = fs.readFileSync(`/proc/${entry}/stat`, "utf8");
              const tail = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
              const parentPid = Number(tail[1]);
              const pid = Number(entry);
              if (!children.has(parentPid)) children.set(parentPid, []);
              children.get(parentPid).push(pid);
            } catch {
              // A short-lived process may disappear while /proc is scanned.
            }
          }
          const found = [];
          const queue = [rootPid];
          while (queue.length > 0) {
            const parentPid = queue.shift();
            for (const pid of children.get(parentPid) || []) {
              found.push(pid);
              queue.push(pid);
            }
          }
          return found;
        };
        const waitForExit = async (pid) => {
          const deadline = Date.now() + 10_000;
          while (hostProcessExists(pid)) {
            if (Date.now() >= deadline) {
              throw new Error(`Timed out waiting for PTY descendant ${pid}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        };

        let proc = null;
        let exited = false;
        const tracked = new Set();
        try {
          proc = executionBroker.spawnPty(ptyModule, command, args, {
            ...options,
            sandboxExecutionContract: contract,
          });
          expect(proc.pid).toBeGreaterThan(1);
          proc.resize(132, 43);

          let transcript = "";
          const ready = new Promise((resolve, reject) => {
            const timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `Timed out waiting for strong PTY output: ${transcript}`,
                  ),
                ),
              20_000,
            );
            proc.onData((data) => {
              transcript += String(data);
              if (transcript.includes("__CC_PTY_READY__")) {
                clearTimeout(timer);
                resolve();
              }
            });
          });
          const exit = new Promise((resolve) => {
            proc.onExit((event) => {
              exited = true;
              resolve(event);
            });
          });
          const socketProbe = [
            "import errno,socket,sys",
            "try:",
            " s=socket.socket(socket.AF_INET,socket.SOCK_STREAM)",
            "except OSError as e:",
            " sys.exit(0 if e.errno==errno.EPERM else 6)",
            "else:",
            " s.close()",
            " sys.exit(5)",
          ].join("\n");
          proc.write(
            [
              "test -t 0 && test -t 1 && test -t 2 || exit 31",
              `test "$(pwd)" = ${quotePosix(workspace)} || exit 32`,
              `test ! -e ${quotePosix(outsideMarker)} || exit 33`,
              `printf pty-ok > ${quotePosix(workspaceMarker)} || exit 37`,
              `/usr/bin/python3 -I -S -c ${quotePosix(socketProbe)} || exit 34`,
              "set -o | grep -E '^monitor[[:space:]]+on$' >/dev/null || exit 35",
              'test "$(stty size)" = "43 132" || exit 36',
              "sleep 120 & printf '\\n__CC_PTY_%s__\\n' READY",
            ].join("; ") + "\n",
          );
          await ready;
          expect(transcript).toContain("__CC_PTY_READY__");
          expect(fs.readFileSync(workspaceMarker, "utf8")).toBe("pty-ok");
          expect(fs.readFileSync(outsideMarker, "utf8")).toBe("host-only");

          const descendants = descendantsOf(proc.pid);
          expect(descendants.length).toBeGreaterThanOrEqual(2);
          for (const pid of descendants) tracked.add(pid);

          expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
            permissionDecision: "allow",
            operation: "pty.spawn",
            pty: true,
            sandboxed: true,
            sandboxBackend: "linux-bwrap-workspace",
            sandboxGuarantees: ["filesystem", "network", "process-tree"],
            sandboxPtyPolicy: {
              mode: "dedicated-controlling-terminal",
              launcherPath: "/usr/bin/setsid",
              launcherDescriptorBound: true,
              launcherExecutablePinned: true,
              launcherDescriptorConsumedBeforeTarget: true,
              launcherStagingPathHidden: true,
              bwrapNewSession: false,
            },
          });

          expect(proc.kill("SIGTERM")).toBe(true);
          await exit;
          for (const pid of tracked) await waitForExit(pid);
        } finally {
          if (proc && !exited) {
            try {
              proc.kill("SIGKILL");
            } catch {
              // The strong wrapper may already have exited.
            }
          }
          for (const pid of tracked) {
            try {
              process.kill(pid, "SIGKILL");
            } catch {
              // Expected after the bwrap PID namespace is reaped.
            }
          }
          fs.rmSync(workspace, { recursive: true, force: true });
          fs.rmSync(outsideMarker, { force: true });
        }
      },
      60_000,
    );

    it.runIf(process.platform === "linux")(
      "rejects a strong Linux boundary without the private contract before the target starts",
      () => {
        const nonce = `${process.pid}-${Date.now()}`;
        const markerPath = path.join(
          os.tmpdir(),
          `.cc-linux-bwrap-missing-contract-${nonce}`,
        );
        const childFixture = fileURLToPath(
          new URL(
            "../fixtures/process-broker-linux-bwrap-live-child.mjs",
            import.meta.url,
          ),
        );
        const coordinator = nativeSpawnSync(
          process.execPath,
          [childFixture, "missing-contract", markerPath],
          {
            encoding: "utf8",
            timeout: 45_000,
            windowsHide: true,
            env: {
              ...process.env,
              CC_SANDBOX_STRICT: "1",
            },
          },
        );
        const failureContext = JSON.stringify({
          status: coordinator.status,
          signal: coordinator.signal,
          error: coordinator.error?.message,
          stdout: coordinator.stdout,
          stderr: coordinator.stderr,
        });
        expect(coordinator.error, failureContext).toBeUndefined();
        expect(coordinator.status, failureContext).toBe(0);
        const envelope = JSON.parse(coordinator.stdout);
        expect(envelope.error).toMatchObject({
          code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
          sandboxCandidateBackend: "linux-bwrap",
          sandboxPolicyAttested: false,
          sandboxCandidateReason: "linux_bwrap_execution_contract_missing",
          actualGuarantees: [],
          missingBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
        });
        expect(envelope.audit).toMatchObject({
          permissionDecision: "deny",
          sandboxed: false,
          sandboxState: "denied",
          sandboxGuarantees: [],
          sandboxBackend: null,
          sandboxCandidateBackend: "linux-bwrap",
          sandboxPolicyAttested: false,
          sandboxCandidateReason: "linux_bwrap_execution_contract_missing",
          sandboxRuntimeProbe: {
            attempted: false,
            runnable: false,
            reason: "execution_contract_missing",
          },
        });
        expect(fs.existsSync(markerPath)).toBe(false);
        fs.rmSync(markerPath, { force: true });
      },
      45_000,
    );
  },
);

describe.runIf(!LIVE || !SUPPORTED)(
  "live ProcessExecutionBroker strict platform boundary (gated off)",
  () => {
    it("requires CC_SANDBOX_LIVE=1 on a supported CI platform", () => {
      expect(LIVE && SUPPORTED).toBe(false);
    });
  },
);
