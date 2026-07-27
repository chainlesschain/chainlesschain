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
import {
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

afterAll(() => {
  expect(resetWindowsSandboxAdapterCache()).toBe(true);
});

function quotePosix(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function fileSha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function fileIdentity(filePath) {
  const realPath = fs.realpathSync.native(filePath);
  const stat = fs.statSync(realPath, { bigint: true });
  return {
    realPath,
    sha256: fileSha256(realPath),
    bytes: Number(stat.size),
    fileId: {
      dev: String(stat.dev),
      ino: String(stat.ino),
    },
  };
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
          expect(plan).toMatchObject({
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

    it.runIf(process.platform === "linux")(
      "runs an attested Plugin Node bin in an empty-root bwrap filesystem and network namespace",
      async () => {
        const nonce = `${process.pid}-${Date.now()}`;
        const workspace = fs.mkdtempSync(
          path.join(os.tmpdir(), "cc-linux-bwrap-live-"),
        );
        const pluginRoot = pluginVersionDir("local", "strict-live", "1.0.0", {
          cwd: workspace,
        });
        const pluginEntry = path.join(pluginRoot, "bin", "strict-live.cjs");
        const dependencyPath = path.join(pluginRoot, "lib", "value.cjs");
        const configPath = path.join(pluginRoot, "config.json");
        const allowedPath = path.join(pluginRoot, "allowed.txt");
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
        const childFixture = fileURLToPath(
          new URL(
            "../fixtures/process-broker-linux-bwrap-live-child.mjs",
            import.meta.url,
          ),
        );
        let serverChild = null;
        let serverShutdown = false;
        try {
          fs.mkdirSync(path.dirname(pluginEntry), { recursive: true });
          fs.mkdirSync(path.dirname(dependencyPath), { recursive: true });
          fs.writeFileSync(secretPath, "host-only-secret", { mode: 0o600 });
          expect(fs.readFileSync(secretPath, "utf8")).toBe("host-only-secret");
          fs.writeFileSync(allowedPath, "allowed-plugin-data", "utf8");
          fs.writeFileSync(
            dependencyPath,
            "module.exports = Object.freeze({ value: 'local-dependency-ok' });\n",
            "utf8",
          );
          fs.writeFileSync(
            path.join(pluginRoot, "plugin.json"),
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
              "const report = {",
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
              }),
              "utf8",
            );
            coordinator = nativeSpawnSync(
              process.execPath,
              [childFixture, "positive", workspace],
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
            dependency: "local-dependency-ok",
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
          });
          expect(report.networkError).toBe("EPERM");
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
            ],
            sandboxRuntimeProbe: {
              kind: "linux-bwrap-plugin-node-policy-v1",
              attempted: true,
              runnable: true,
              reason: null,
            },
          });
          expect(envelope.audit.sandboxPolicyDigest).toMatch(/^[a-f0-9]{64}$/);
          expect(fs.readFileSync(secretPath, "utf8")).toBe("host-only-secret");
          expect(fs.existsSync(pluginMarker)).toBe(false);
          expect(fs.existsSync(hostMarker)).toBe(false);
          expect(fs.existsSync(sandboxTmpPath)).toBe(false);
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
      "runs attested static ET_EXEC and static PIE Plugin native ELFs and rejects interpreted or scripted entries",
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
        const allowedPath = path.join(pluginRoot, "allowed.txt");
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
        const commandArgs = [
          "allowed.txt",
          secretPath,
          sandboxPluginMarker,
          hostMarker,
          sandboxTmpPath,
        ];

        try {
          fs.mkdirSync(binDirectory, { recursive: true });
          fs.writeFileSync(allowedPath, "allowed-native-data", "utf8");
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

          const dynamicBuild = nativeSpawnSync(
            "/usr/bin/cc",
            ["-no-pie", "-O2", "-o", dynamicEntry, nativeSource],
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
              "-fPIE",
              "-pie",
              "-Wl,-z,noexecstack",
              "-O2",
              "-o",
              dynamicPieEntry,
              nativeSource,
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
          fs.writeFileSync(
            scriptEntry,
            `#!/bin/sh\nprintf launched > ${quotePosix(scriptMarker)}\n`,
            { mode: 0o700 },
          );

          for (const alias of ["strict-native", "strict-native-static-pie"]) {
            const positive = runPluginCommand(
              [alias, ...commandArgs].join(" "),
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
            expect(JSON.parse(envelope.result.stdout)).toMatchObject({
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
              tmpWritable: true,
              networkErrno: 1,
            });
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
              ],
              sandboxRuntimeProbe: {
                kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
                attempted: true,
                runnable: true,
                reason: null,
                probeRuntime: "node",
                targetRuntime: "native-static-elf",
                contentSnapshot: false,
                handleAtomic: false,
              },
            });
            expect(envelope.audit.sandboxPolicyDigest).toMatch(
              /^[a-f0-9]{64}$/,
            );
          }

          for (const [alias, reason] of [
            ["dynamic-native", "native_entry_interpreter_unsupported"],
            ["dynamic-pie-native", "native_entry_interpreter_unsupported"],
            ["script-native", "native_entry_not_elf"],
          ]) {
            const negative = runPluginCommand(
              [alias, ...commandArgs].join(" "),
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
                kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
                attempted: false,
                runnable: false,
                reason,
                probeRuntime: "node",
                targetRuntime: "native-static-elf",
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
