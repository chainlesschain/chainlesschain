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
        timeout: 30_000,
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
    }, 45_000);

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
              timeout: 45_000,
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
          throw launchError;
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

        const helperPlan = applyWindowsSandbox(
          path.join(process.env.WINDIR, "System32", "cmd.exe"),
          ["/d", "/c", "exit 0"],
          {},
          { profileName: "default", sync: true },
          { platform: "win32" },
        );
        expect(helperPlan.applied).toBe(true);
        const absence = nativeSpawnSync(
          helperPlan.command,
          ["--assert-appcontainer-absent", report.appContainerProfile],
          {
            encoding: "utf8",
            timeout: 30_000,
            windowsHide: true,
          },
        );
        helperPlan.cleanup();
        expect(absence.error).toBeUndefined();
        expect(absence.status, absence.stderr).toBe(0);
        expect(JSON.parse(absence.stdout)).toEqual({
          absent: true,
          profileName: report.appContainerProfile,
        });
      },
      90_000,
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
