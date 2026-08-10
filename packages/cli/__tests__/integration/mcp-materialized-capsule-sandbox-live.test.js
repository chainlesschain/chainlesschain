/**
 * Real materialized npm capsule -> MCPClient -> ProcessExecutionBroker -> OS
 * sandbox evidence. This file is live-gated because its assertions are about
 * native kernel/AppContainer effects, not adapter-shaped mocks.
 */

import {
  spawn as nativeSpawn,
  spawnSync as nativeSpawnSync,
} from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MCPClient } from "../../src/harness/mcp-client.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import {
  consumeMcpStdioExecutionAuthority,
  issueMcpStdioExecutionAuthority,
  materializeApprovedMcpStdioInvocation,
  resolveMcpStdioExecutionApproval,
} from "../../src/lib/mcp-stdio-execution-authority.js";
import { MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES } from "../../src/lib/mcp-stdio-executable-identity.js";
import {
  materializeMcpStdioNpmPackage,
  MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE,
} from "../../src/lib/mcp-stdio-package-materialization.js";
import { resetWindowsSandboxAdapterCache } from "../../src/lib/process-execution-broker/platform-sandbox.js";

const LIVE = process.env.CC_SANDBOX_LIVE === "1";
const SUPPORTED = ["linux", "darwin", "win32"].includes(process.platform);
const PACKAGE_SPEC = "@chainlesschain/mcp-live-probe@1.0.0";
const SERVER_NAME = "materialized-capsule-live";
const HOST_DESCENDANT_MARKER_PREFIX = "--cc-mcp-live-descendant=";
const PROCESS_OBSERVER_TIMEOUT_MS = 20_000;
const WINDOWS_PROCESS_START_DRAIN_MS = 2_000;
const ALLOWED_OS_SPAWN_DENIAL_CODES = new Set(["EACCES", "EPERM"]);
const WINDOWS_INDETERMINATE_NETWORK_ERRORS = new Set(["ETIMEDOUT", "timeout"]);
const fixturePath = fileURLToPath(
  new URL(
    "../fixtures/mcp-materialized-capsule-live-server.cjs",
    import.meta.url,
  ),
);
const childContractFixturePath = fileURLToPath(
  new URL(
    "../fixtures/mcp-materialized-capsule-child-contract.cjs",
    import.meta.url,
  ),
);
const loadFixtureModule = createRequire(import.meta.url);
const {
  LINUX_CHILD_RUNTIME_PATH,
  resolveChildRuntimePath,
  successfulChildReport,
} = loadFixtureModule(childContractFixturePath);

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function commandDigest(commandLine) {
  return crypto
    .createHash("sha256")
    .update(String(commandLine || ""), "utf8")
    .digest("hex");
}

function hostProcessIdentity(row) {
  if (
    !Number.isSafeInteger(row?.pid) ||
    row.pid <= 0 ||
    typeof row?.creationMarker !== "string" ||
    row.creationMarker.length === 0 ||
    typeof row?.commandLine !== "string"
  ) {
    return null;
  }
  return {
    platform: row.platform,
    pid: row.pid,
    parentPid: row.parentPid,
    creationMarker: row.creationMarker,
    commandDigest: commandDigest(row.commandLine),
  };
}

function sameHostProcessIdentity(left, right) {
  return Boolean(
    left &&
    right &&
    left.platform === right.platform &&
    left.pid === right.pid &&
    left.creationMarker === right.creationMarker &&
    left.commandDigest === right.commandDigest,
  );
}

function isTypedOsSpawnDenial(child, platform = process.platform) {
  return Boolean(
    platform === "win32" &&
    child?.spawnDenied === true &&
    child.reportReceived === false &&
    child.errorType === "os-error-code" &&
    ALLOWED_OS_SPAWN_DENIAL_CODES.has(child.errorCode) &&
    child.error === child.errorCode &&
    child.error !== "child-report-timeout",
  );
}

function isHostAttestedWindowsSpawnDenial(
  child,
  observedChildStarts,
  platform = process.platform,
) {
  return Boolean(
    platform === "win32" &&
    isTypedOsSpawnDenial(child, platform) &&
    Array.isArray(observedChildStarts) &&
    observedChildStarts.length === 0,
  );
}

function isWindowsNetworkProbeIndeterminate(
  result,
  platform = process.platform,
) {
  return Boolean(
    platform === "win32" &&
    result?.state === "indeterminate" &&
    result.networkDenied === false &&
    WINDOWS_INDETERMINATE_NETWORK_ERRORS.has(result.networkError) &&
    result.canaryPayloadAttempted === false,
  );
}

function selectObservedDescendantStarts(events, rootPid) {
  const descendants = new Set([rootPid]);
  const selected = [];
  const pending = [...events];
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const event = pending[index];
      if (
        !Number.isSafeInteger(event?.pid) ||
        event.pid <= 0 ||
        !Number.isSafeInteger(event?.parentPid) ||
        event.parentPid <= 0 ||
        !descendants.has(event.parentPid)
      ) {
        continue;
      }
      descendants.add(event.pid);
      selected.push(event);
      pending.splice(index, 1);
      changed = true;
    }
  }
  return selected.sort((left, right) => left.sequence - right.sequence);
}

function isTransitiveDescendant(row, rootPid, rowsByPid) {
  const visited = new Set([row.pid]);
  let parentPid = row.parentPid;
  while (Number.isSafeInteger(parentPid) && parentPid > 0) {
    if (parentPid === rootPid) return true;
    if (visited.has(parentPid)) return false;
    visited.add(parentPid);
    const parent = rowsByPid.get(parentPid);
    if (!parent) return false;
    parentPid = parent.parentPid;
  }
  return false;
}

function markerForNonce(nonce) {
  return `${HOST_DESCENDANT_MARKER_PREFIX}${nonce}`;
}

function nonceProcessRows(rows, nonce) {
  const marker = markerForNonce(nonce);
  return rows.filter((row) => row.commandLine.includes(marker));
}

function selectNonceDescendants(rows, rootPid, nonce) {
  const rowsByPid = new Map(rows.map((row) => [row.pid, row]));
  return nonceProcessRows(rows, nonce).filter((row) =>
    isTransitiveDescendant(row, rootPid, rowsByPid),
  );
}

function readLinuxProcess(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const parentMatch = status.match(/^PPid:\s+(\d+)$/m);
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    if (!parentMatch || commandEnd < 0) return null;
    const fieldsAfterCommand = stat
      .slice(commandEnd + 2)
      .trim()
      .split(/\s+/);
    const startTime = fieldsAfterCommand[19];
    if (!/^\d+$/.test(startTime || "")) return null;
    const commandLine = fs
      .readFileSync(`/proc/${pid}/cmdline`)
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .join(" ");
    return {
      platform: "linux",
      pid,
      parentPid: Number(parentMatch[1]),
      creationMarker: `proc-start:${startTime}`,
      commandLine,
    };
  } catch {
    return null;
  }
}

function enumerateLinuxProcesses() {
  return fs
    .readdirSync("/proc", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => readLinuxProcess(Number(entry.name)))
    .filter(Boolean);
}

function enumerateWindowsProcesses() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$rows = @(Get-CimInstance Win32_Process | ForEach-Object {",
    "  [pscustomobject]@{",
    "    platform = 'win32'",
    "    pid = [int]$_.ProcessId",
    "    parentPid = [int]$_.ParentProcessId",
    "    creationMarker = if ($null -eq $_.CreationDate) { '' } else { ([DateTime]$_.CreationDate).ToUniversalTime().ToString('o') }",
    "    commandLine = [string]$_.CommandLine",
    "  }",
    "})",
    "$rows | ConvertTo-Json -Compress",
  ].join("\n");
  const result = nativeSpawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Windows host process observer failed");
  }
  const parsed = result.stdout.trim() ? JSON.parse(result.stdout) : [];
  return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
    platform: "win32",
    pid: Number(row.pid),
    parentPid: Number(row.parentPid),
    creationMarker: String(row.creationMarker || ""),
    commandLine: String(row.commandLine || ""),
  }));
}

function parseWindowsLoopbackExemptSids(output) {
  return new Set(
    [...String(output || "").matchAll(/\bS-1-15-2(?:-\d+){7}\b/gi)].map(
      (match) => match[0].toUpperCase(),
    ),
  );
}

function queryWindowsLoopbackExemptSids() {
  if (process.platform !== "win32") {
    throw new Error("Windows loopback exemption query requires Windows");
  }
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!windowsRoot || !path.win32.isAbsolute(windowsRoot)) {
    throw new Error("Windows loopback exemption query has no trusted root");
  }
  const result = nativeSpawnSync(
    path.win32.join(
      path.win32.resolve(windowsRoot),
      "System32",
      "CheckNetIsolation.exe",
    ),
    ["LoopbackExempt", "-s"],
    {
      encoding: "utf8",
      timeout: PROCESS_OBSERVER_TIMEOUT_MS,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Windows loopback exemption query failed: status=${result.status}; stderr=${String(result.stderr || "").trim()}`,
    );
  }
  return parseWindowsLoopbackExemptSids(
    `${String(result.stdout || "")}\n${String(result.stderr || "")}`,
  );
}

function windowsProcessStartObserverScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Management",
    "$stopPath = $env:CC_MCP_PROCESS_OBSERVER_STOP",
    "$drainMs = [int]$env:CC_MCP_PROCESS_OBSERVER_DRAIN_MS",
    "$scope = [System.Management.ManagementScope]::new('\\\\.\\root\\cimv2')",
    "$query = [System.Management.WqlEventQuery]::new('SELECT * FROM Win32_ProcessStartTrace')",
    "$options = [System.Management.EventWatcherOptions]::new()",
    "$options.Timeout = [TimeSpan]::FromMilliseconds(100)",
    "$watcher = [System.Management.ManagementEventWatcher]::new($scope, $query, $options)",
    "$sequence = [long]0",
    "function Write-NextObservedStart {",
    "  param([System.Management.ManagementEventWatcher]$Watcher, [ref]$Sequence)",
    "  try {",
    "    $started = $Watcher.WaitForNextEvent()",
    "  } catch [System.Management.ManagementException] {",
    "    if ($_.Exception.ErrorCode -eq [System.Management.ManagementStatus]::Timedout) { return $false }",
    "    throw",
    "  }",
    "  try {",
    "    $json = [pscustomobject]@{",
    "      event = 'process-start'",
    "      pid = [int]$started['ProcessID']",
    "      parentPid = [int]$started['ParentProcessID']",
    "      processName = [string]$started['ProcessName']",
    "      creationMarker = 'wmi-time-created:' + [string]$started['TIME_CREATED']",
    "      sequence = [long]$Sequence.Value",
    "    } | ConvertTo-Json -Compress",
    "    [Console]::Out.WriteLine($json)",
    "    [Console]::Out.Flush()",
    "    $Sequence.Value = [long]$Sequence.Value + 1",
    "    return $true",
    "  } finally {",
    "    $started.Dispose()",
    "  }",
    "}",
    "$watcher.Start()",
    "try {",
    '  [Console]::Out.WriteLine(\'{"event":"observer-ready"}\')',
    "  [Console]::Out.Flush()",
    "  while (-not [IO.File]::Exists($stopPath)) {",
    "    [void](Write-NextObservedStart -Watcher $watcher -Sequence ([ref]$sequence))",
    "  }",
    "  $drainUntil = [DateTime]::UtcNow.AddMilliseconds($drainMs)",
    "  while ([DateTime]::UtcNow -lt $drainUntil) {",
    "    [void](Write-NextObservedStart -Watcher $watcher -Sequence ([ref]$sequence))",
    "  }",
    "} finally {",
    "  $watcher.Stop()",
    "  $watcher.Dispose()",
    "}",
  ].join("\n");
}

async function startWindowsProcessStartObserver() {
  if (process.platform !== "win32") {
    throw new Error("Windows process-start observer requires Windows");
  }
  const stopPath = path.join(
    os.tmpdir(),
    `cc-mcp-process-start-${crypto.randomUUID()}.stop`,
  );
  fs.rmSync(stopPath, { force: true });
  const script = windowsProcessStartObserverScript();
  const observer = nativeSpawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: {
        ...process.env,
        CC_MCP_PROCESS_OBSERVER_DRAIN_MS: String(
          WINDOWS_PROCESS_START_DRAIN_MS,
        ),
        CC_MCP_PROCESS_OBSERVER_STOP: stopPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const events = [];
  let stderr = "";
  let stdout = "";
  let ready = false;
  let protocolError = null;
  let nextSequence = 0;
  let readyResolve;
  let readyReject;
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const closePromise = new Promise((resolve) => {
    observer.once("close", (code, signal) => resolve({ code, signal }));
  });
  const consumeLine = (rawLine) => {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    if (!line) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      protocolError ||= new Error(
        `Windows process-start observer emitted invalid JSON: ${line}`,
      );
      if (!ready) readyReject(protocolError);
      return;
    }
    if (message?.event === "observer-ready") {
      if (ready || events.length > 0) {
        protocolError ||= new Error(
          "Windows process-start observer emitted duplicate readiness",
        );
        return;
      }
      ready = true;
      readyResolve();
      return;
    }
    if (
      message?.event === "process-start" &&
      Number.isSafeInteger(Number(message.pid)) &&
      Number(message.pid) > 0 &&
      Number.isSafeInteger(Number(message.parentPid)) &&
      Number(message.parentPid) >= 0 &&
      typeof message.creationMarker === "string" &&
      /^wmi-time-created:\d+$/.test(message.creationMarker) &&
      Number.isSafeInteger(Number(message.sequence)) &&
      Number(message.sequence) === nextSequence
    ) {
      events.push({
        sequence: nextSequence,
        pid: Number(message.pid),
        parentPid: Number(message.parentPid),
        processName: String(message.processName || ""),
        creationMarker: message.creationMarker,
      });
      nextSequence += 1;
      return;
    }
    protocolError ||= new Error(
      `Windows process-start observer emitted an invalid event: ${line}`,
    );
    if (!ready) readyReject(protocolError);
  };
  observer.stdout.setEncoding("utf8");
  observer.stdout.on("data", (chunk) => {
    stdout += chunk;
    let newline = stdout.indexOf("\n");
    while (newline >= 0) {
      consumeLine(stdout.slice(0, newline));
      stdout = stdout.slice(newline + 1);
      newline = stdout.indexOf("\n");
    }
  });
  observer.stderr.setEncoding("utf8");
  observer.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  observer.once("error", (error) => {
    if (!ready) readyReject(error);
  });
  closePromise.then(({ code, signal }) => {
    if (!ready) {
      readyReject(
        new Error(
          `Windows process-start observer exited before readiness: code=${code}; signal=${signal}; stderr=${stderr.trim()}`,
        ),
      );
    }
  });

  const readinessTimer = setTimeout(
    () =>
      readyReject(
        new Error(
          `Timed out waiting for Windows process-start observer: ${stderr.trim()}`,
        ),
      ),
    PROCESS_OBSERVER_TIMEOUT_MS,
  );
  try {
    await readyPromise;
  } catch (error) {
    observer.kill();
    fs.rmSync(stopPath, { force: true });
    throw error;
  } finally {
    clearTimeout(readinessTimer);
  }

  let stopped = false;
  return {
    events,
    async stop() {
      if (stopped) return [...events];
      stopped = true;
      fs.writeFileSync(stopPath, "stop\n", "utf8");
      let timeout;
      try {
        const outcome = await Promise.race([
          closePromise,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error(
                    "Timed out stopping Windows process-start observer",
                  ),
                ),
              PROCESS_OBSERVER_TIMEOUT_MS,
            );
          }),
        ]);
        if (outcome.code !== 0) {
          throw new Error(
            `Windows process-start observer failed: code=${outcome.code}; signal=${outcome.signal}; stderr=${stderr.trim()}`,
          );
        }
        if (protocolError) throw protocolError;
        return [...events];
      } catch (error) {
        observer.kill();
        throw error;
      } finally {
        clearTimeout(timeout);
        fs.rmSync(stopPath, { force: true });
      }
    },
  };
}

function enumerateDarwinProcesses() {
  const result = nativeSpawnSync(
    "/bin/ps",
    ["-axo", "pid=,ppid=,lstart=,command="],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("macOS host process observer failed");
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) =>
      line.match(
        /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.*)$/,
      ),
    )
    .filter(Boolean)
    .map((match) => ({
      platform: "darwin",
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      creationMarker: `ps-start:${match[3]}`,
      commandLine: match[4],
    }));
}

function enumerateHostProcesses() {
  if (process.platform === "linux") return enumerateLinuxProcesses();
  if (process.platform === "win32") return enumerateWindowsProcesses();
  if (process.platform === "darwin") return enumerateDarwinProcesses();
  throw new Error(`Unsupported host process observer: ${process.platform}`);
}

async function waitForValue(factory, description, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await factory();
    if (value) return value;
    await delay(process.platform === "win32" ? 300 : 100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function captureHostProcessIdentity(pid) {
  return waitForValue(
    () => {
      const row = enumerateHostProcesses().find((item) => item.pid === pid);
      return hostProcessIdentity(row);
    },
    "a host process identity",
    PROCESS_OBSERVER_TIMEOUT_MS,
  );
}

async function captureNonceDescendantIdentities(rootPid, nonce) {
  return waitForValue(
    () => {
      const matches = selectNonceDescendants(
        enumerateHostProcesses(),
        rootPid,
        nonce,
      );
      if (matches.length === 0) return null;
      const identities = matches.map(hostProcessIdentity);
      if (identities.some((identity) => !identity)) {
        throw new Error("Host observer could not bind a descendant identity");
      }
      return identities;
    },
    "a nonce-bound transitive sandbox descendant",
    PROCESS_OBSERVER_TIMEOUT_MS,
  );
}

function identityIsAlive(identity, rows = enumerateHostProcesses()) {
  const row = rows.find((item) => item.pid === identity.pid);
  return sameHostProcessIdentity(identity, hostProcessIdentity(row));
}

async function waitForIdentitiesGone(identities) {
  return waitForValue(
    () => {
      const rows = enumerateHostProcesses();
      return identities.every((identity) => !identityIsAlive(identity, rows));
    },
    "the exact host process identities to disappear",
    PROCESS_OBSERVER_TIMEOUT_MS,
  );
}

async function waitForNonceProcessesGone(nonce) {
  return waitForValue(
    () => nonceProcessRows(enumerateHostProcesses(), nonce).length === 0,
    "all nonce-bound test descendants to disappear",
    PROCESS_OBSERVER_TIMEOUT_MS,
  );
}

function terminateExactHostIdentity(identity) {
  if (!identity || identity.pid === process.pid) return;
  const rows = enumerateHostProcesses();
  if (!identityIsAlive(identity, rows)) return;
  if (process.platform === "win32") {
    const result = nativeSpawnSync(
      "taskkill.exe",
      ["/PID", String(identity.pid), "/T", "/F"],
      { encoding: "utf8", timeout: 15_000, windowsHide: true },
    );
    if (result.error) throw result.error;
    if (result.status !== 0 && identityIsAlive(identity)) {
      throw new Error("Emergency Windows process-tree reaper failed");
    }
    return;
  }
  try {
    process.kill(identity.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function emergencyReapTestProcesses({ nonce, identities }) {
  if (!nonce) return;
  const rows = enumerateHostProcesses();
  const nonceIdentities = nonceProcessRows(rows, nonce).map(
    hostProcessIdentity,
  );
  if (nonceIdentities.some((identity) => !identity)) {
    throw new Error("Emergency reaper could not bind a nonce process identity");
  }
  const unique = new Map();
  for (const identity of [...(identities || []), ...nonceIdentities]) {
    if (!identity) continue;
    unique.set(
      `${identity.platform}:${identity.pid}:${identity.creationMarker}:${identity.commandDigest}`,
      identity,
    );
  }
  for (const identity of unique.values()) {
    terminateExactHostIdentity(identity);
  }
  await waitForIdentitiesGone([...unique.values()]);
  await waitForNonceProcessesGone(nonce);
}

function containsCanary(value, canary) {
  const pending = [value];
  const seen = new WeakSet();
  const needle = Buffer.from(canary, "utf8");
  let inspected = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (current.includes(canary)) return true;
      continue;
    }
    if (Buffer.isBuffer(current)) {
      if (current.includes(needle)) return true;
      continue;
    }
    if (
      current === null ||
      (typeof current !== "object" && typeof current !== "function")
    ) {
      continue;
    }
    if (seen.has(current)) continue;
    seen.add(current);
    inspected += 1;
    if (inspected > 100_000) {
      throw new Error("Canary scanner exceeded its bounded object budget");
    }
    if (current instanceof Map) {
      for (const [key, item] of current) pending.push(key, item);
    }
    if (current instanceof Set) {
      for (const item of current) pending.push(item);
    }
    for (const key of Reflect.ownKeys(current)) {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key);
      } catch {
        continue;
      }
      if (descriptor && "value" in descriptor) pending.push(descriptor.value);
    }
  }
  return false;
}

function selectNonLoopbackIpv4() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      const ipv4 = address.family === "IPv4" || address.family === 4;
      if (ipv4 && !address.internal && address.address !== "0.0.0.0") {
        return address.address;
      }
    }
  }
  throw new Error(
    "No non-loopback IPv4 address is available for the live gate",
  );
}

async function listenOnHostInterfaces(server) {
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("Host test server did not expose an address");
  }
  return address.port;
}

async function proveHostTarget(target) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: target.host, port: target.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Host control connection timed out: ${target.label}`));
    }, 5_000);
    socket.on("data", () => {});
    socket.once("connect", () => {
      socket.end(`host-control:${target.label}`);
    });
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeAllConnections?.();
  await closed;
}

function expectNetworkProbeResults(networks, networkTargets) {
  expect(networks.map((item) => item.label).sort()).toEqual(
    networkTargets.map((item) => item.label).sort(),
  );
  const indeterminate = [];
  for (const result of networks) {
    const explicitlyDenied =
      result.state === "denied" &&
      result.networkDenied === true &&
      result.canaryPayloadAttempted === false &&
      result.networkError !== "timeout";
    if (explicitlyDenied) continue;
    // Any Windows timeout/error that lacks an explicit denial code remains
    // indeterminate. It is never relabelled as an OS denial; the Windows branch
    // separately requires native zero-capability target attestation and no
    // host-visible connection.
    expect(
      isWindowsNetworkProbeIndeterminate(result),
      JSON.stringify(result),
    ).toBe(true);
    indeterminate.push(result);
  }
  return { indeterminate };
}

function issueApproval(config) {
  const token = issueMcpStdioExecutionAuthority({
    serverName: SERVER_NAME,
    config,
    approvalKind: "explicit-config",
    approvalSource: "test:materialized-capsule-live",
  });
  const approval = consumeMcpStdioExecutionAuthority(token, {
    serverName: SERVER_NAME,
    config,
  });
  return {
    approvalRecord: resolveMcpStdioExecutionApproval(approval),
    invocation: materializeApprovedMcpStdioInvocation(approval),
  };
}

function issueConnectAuthority(config) {
  return issueMcpStdioExecutionAuthority({
    serverName: SERVER_NAME,
    config,
    approvalKind: "explicit-config",
    approvalSource: "test:materialized-capsule-live",
  });
}

function installProbePackage({
  directory,
  packageSpec,
  secretPath,
  markerPath,
  childMarkerPath,
  networkTargets,
  nonce,
}) {
  expect(packageSpec).toBe(PACKAGE_SPEC);
  writeJson(path.join(directory, "package-lock.json"), {
    name: "chainlesschain-mcp-materialization",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": {
        dependencies: { "@chainlesschain/mcp-live-probe": "1.0.0" },
      },
      "node_modules/@chainlesschain/mcp-live-probe": {
        version: "1.0.0",
        resolved:
          "https://registry.npmjs.org/@chainlesschain/mcp-live-probe/-/mcp-live-probe-1.0.0.tgz",
        integrity: `sha512-${"A".repeat(86)}==`,
      },
    },
  });
  const packageRoot = path.join(
    directory,
    "node_modules",
    "@chainlesschain",
    "mcp-live-probe",
  );
  writeJson(path.join(packageRoot, "package.json"), {
    name: "@chainlesschain/mcp-live-probe",
    version: "1.0.0",
    bin: { "mcp-live-probe": "bin/server.cjs" },
  });
  writeJson(path.join(packageRoot, "probe-config.json"), {
    secretPath,
    markerPath,
    childMarkerPath,
    networkTargets,
    nonce,
  });
  fs.mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
  fs.copyFileSync(fixturePath, path.join(packageRoot, "bin", "server.cjs"));
  fs.copyFileSync(
    childContractFixturePath,
    path.join(
      packageRoot,
      "bin",
      "mcp-materialized-capsule-child-contract.cjs",
    ),
  );
}

function materializeProbe({
  config,
  materializationRoot,
  indexPath,
  npmCli,
  secretPath,
  markerPath,
  childMarkerPath,
  networkTargets,
  nonce,
}) {
  const approved = issueApproval(config);
  return materializeMcpStdioNpmPackage({
    approvalRecord: approved.approvalRecord,
    config: approved.invocation,
    packageSpec: PACKAGE_SPEC,
    binName: "mcp-live-probe",
    root: materializationRoot,
    indexPath,
    npmCli,
    installRunner: (input) =>
      installProbePackage({
        ...input,
        secretPath,
        markerPath,
        childMarkerPath,
        networkTargets,
        nonce,
      }),
    // Materialization itself is not the subject of the live sandbox launch.
    // It still performs the real esbuild capsule construction; using the
    // native runner keeps the audit log scoped to Client -> Broker -> OS.
    processBrokerRunSync: nativeSpawnSync,
  });
}

describe("materialized MCP capsule host observer helpers", () => {
  it("re-executes Linux children through the live runtime image", () => {
    expect(resolveChildRuntimePath("linux", "/proc/self/fd/3")).toBe(
      LINUX_CHILD_RUNTIME_PATH,
    );
    expect(resolveChildRuntimePath("darwin", "/usr/local/bin/node")).toBe(
      "/usr/local/bin/node",
    );
    expect(resolveChildRuntimePath("win32", "C:\\nodejs\\node.exe")).toBe(
      "C:\\nodejs\\node.exe",
    );
  });

  it("keeps child-report envelope fields parent-owned", () => {
    expect(
      successfulChildReport(
        {
          event: "child-ready",
          namespacePid: 707,
          spawnPid: 999,
          spawnDenied: true,
          reportReceived: false,
          detachedRequested: false,
        },
        707,
      ),
    ).toEqual({
      event: "child-ready",
      namespacePid: 707,
      spawnPid: 707,
      spawnDenied: false,
      reportReceived: true,
      detachedRequested: true,
    });
    expect(() => successfulChildReport({ namespacePid: 706 }, 707)).toThrow(
      "MCP capsule child report PID does not match its spawn",
    );
  });

  it("does not confuse a reused PID with the original process identity", () => {
    const original = {
      platform: "win32",
      pid: 701,
      parentPid: 500,
      creationMarker: "2026-08-10T01:00:00.0000000Z",
      commandDigest: commandDigest("node child.js --nonce=one"),
    };
    expect(
      sameHostProcessIdentity(original, {
        ...original,
        creationMarker: "2026-08-10T01:00:01.0000000Z",
      }),
    ).toBe(false);
    expect(
      sameHostProcessIdentity(original, {
        ...original,
        commandDigest: commandDigest("node unrelated.js"),
      }),
    ).toBe(false);
  });

  it("selects only nonce-bearing transitive descendants", () => {
    const nonce = "nonce-123";
    const rows = [
      { pid: 100, parentPid: 1, commandLine: "sandbox-root" },
      { pid: 110, parentPid: 100, commandLine: "capsule-server" },
      {
        pid: 120,
        parentPid: 110,
        commandLine: `node -e probe ${markerForNonce(nonce)}`,
      },
      {
        pid: 130,
        parentPid: 999,
        commandLine: `unrelated ${markerForNonce(nonce)}`,
      },
      {
        pid: 140,
        parentPid: 110,
        commandLine: `${HOST_DESCENDANT_MARKER_PREFIX}different-nonce`,
      },
    ];
    expect(
      selectNonceDescendants(rows, 100, nonce).map((row) => row.pid),
    ).toEqual([120]);
  });

  it("accepts only explicit permission child-spawn denials", () => {
    const permissionDenial = {
      spawnDenied: true,
      reportReceived: false,
      errorType: "os-error-code",
      errorCode: "EPERM",
      error: "EPERM",
    };
    expect(isTypedOsSpawnDenial(permissionDenial, "win32")).toBe(true);
    expect(
      isTypedOsSpawnDenial(
        {
          spawnDenied: true,
          reportReceived: false,
          errorType: "os-error-code",
          errorCode: "EACCES",
          error: "EACCES",
        },
        "win32",
      ),
    ).toBe(true);
    for (const errorCode of ["ENOENT", "ENOMEM", "EINVAL"]) {
      expect(
        isTypedOsSpawnDenial(
          {
            spawnDenied: true,
            reportReceived: false,
            errorType: "os-error-code",
            errorCode,
            error: errorCode,
          },
          "win32",
        ),
      ).toBe(false);
    }
    expect(
      isTypedOsSpawnDenial(
        {
          spawnDenied: false,
          reportReceived: false,
          errorType: "timeout",
          errorCode: null,
          error: "child-report-timeout",
        },
        "win32",
      ),
    ).toBe(false);
    expect(
      isTypedOsSpawnDenial(
        {
          spawnDenied: true,
          reportReceived: false,
          errorType: "untyped-error",
          errorCode: null,
          error: "spawn-blocked-without-code",
        },
        "win32",
      ),
    ).toBe(false);
    expect(isTypedOsSpawnDenial(permissionDenial, "linux")).toBe(false);

    expect(
      isHostAttestedWindowsSpawnDenial(permissionDenial, [], "win32"),
    ).toBe(true);
    expect(
      isHostAttestedWindowsSpawnDenial(
        permissionDenial,
        [{ pid: 707, parentPid: 606 }],
        "win32",
      ),
    ).toBe(false);
    expect(
      isHostAttestedWindowsSpawnDenial(
        {
          spawnDenied: false,
          reportReceived: false,
          errorType: "timeout",
          errorCode: null,
          error: "child-report-timeout",
        },
        [],
        "win32",
      ),
    ).toBe(false);
    expect(
      isHostAttestedWindowsSpawnDenial(permissionDenial, [], "linux"),
    ).toBe(false);
  });

  it("never relabels Windows ETIMEDOUT or a harness timeout as denied", () => {
    for (const networkError of ["ETIMEDOUT", "timeout"]) {
      const result = {
        state: "indeterminate",
        networkDenied: false,
        networkError,
        canaryPayloadAttempted: false,
      };
      expect(isWindowsNetworkProbeIndeterminate(result, "win32")).toBe(true);
      expect(result).toMatchObject({
        state: "indeterminate",
        networkDenied: false,
      });
    }
  });

  it("selects short-lived descendant starts even when events arrive out of order", () => {
    const events = [
      { sequence: 0, pid: 303, parentPid: 202 },
      { sequence: 1, pid: 404, parentPid: 999 },
      { sequence: 2, pid: 202, parentPid: 101 },
    ];
    expect(
      selectObservedDescendantStarts(events, 101).map((event) => event.pid),
    ).toEqual([303, 202]);
  });

  it("parses only AppContainer package SIDs from loopback exemptions", () => {
    const first = "S-1-15-2-1-2-3-4-5-6-7";
    const second = "S-1-15-2-11-12-13-14-15-16-17";
    expect([
      ...parseWindowsLoopbackExemptSids(`
        Name: first
        SID: ${first}
        Capability: S-1-15-3-1
        SID: ${second}
        malformed: S-1-15-2-1-2-3
        duplicate: ${first}
      `),
    ]).toEqual([first, second]);
  });

  it("starts the Windows WMI event source before ready and drains before stop", () => {
    const script = windowsProcessStartObserverScript();
    expect(script).toContain("Add-Type -AssemblyName System.Management");
    expect(script).toContain("System.Management.ManagementEventWatcher");
    expect(script).toContain("Win32_ProcessStartTrace");
    expect(script).toContain("WaitForNextEvent()");
    expect(script).toContain("TIME_CREATED");
    expect(script).toContain("sequence = [long]$Sequence.Value");
    expect(script).not.toContain("CreateToolhelp32Snapshot");
    const started = script.indexOf("$watcher.Start()");
    const ready = script.indexOf('{"event":"observer-ready"}');
    const stopObserved = script.indexOf(
      "while (-not [IO.File]::Exists($stopPath))",
    );
    const drained = script.indexOf("$drainUntil =");
    const stopped = script.indexOf("$watcher.Stop()");
    expect(started).toBeGreaterThanOrEqual(0);
    expect(ready).toBeGreaterThan(started);
    expect(stopObserved).toBeGreaterThan(ready);
    expect(drained).toBeGreaterThan(stopObserved);
    expect(stopped).toBeGreaterThan(drained);
  });

  it.runIf(LIVE && process.platform === "win32")(
    "binds a nonce-bearing short-lived child start to its PID and parent",
    async () => {
      const observer = await startWindowsProcessStartObserver();
      let stopped = false;
      const nonce = crypto.randomBytes(16).toString("hex");
      const child = nativeSpawn(
        process.execPath,
        ["-e", "", "--", markerForNonce(nonce)],
        { stdio: "ignore", windowsHide: true },
      );
      const childPid = child.pid;
      try {
        const [code, signal] = await once(child, "close");
        expect({ code, signal }).toEqual({ code: 0, signal: null });
        await waitForValue(
          () =>
            observer.events.some(
              (event) =>
                event.pid === childPid && event.parentPid === process.pid,
            ),
          "a short-lived Windows process-start event",
          PROCESS_OBSERVER_TIMEOUT_MS,
        );
        const events = await observer.stop();
        stopped = true;
        const matchingStarts = selectObservedDescendantStarts(
          events,
          process.pid,
        ).filter((event) => event.pid === childPid);
        expect(matchingStarts).toHaveLength(1);
        expect(matchingStarts[0]).toMatchObject({
          pid: childPid,
          parentPid: process.pid,
          creationMarker: expect.stringMatching(/^wmi-time-created:\d+$/),
        });
      } finally {
        if (!stopped) await observer.stop();
      }
    },
    40_000,
  );
});

describe.runIf(LIVE && SUPPORTED)(
  "live materialized MCP capsule sandbox chain",
  () => {
    let root;
    let materializationRoot;
    let indexPath;
    let npmCli;
    let secretPath;
    let markerPath;
    let childMarkerPath;
    let secretCanary;
    let probeNonce;
    let previousEnvironment;
    let previousSandboxEnabled;
    let previousPlatformEnabled;
    let client;
    let clientErrors;
    let server;
    let networkRecords;
    let observedSandboxRootIdentity;
    let observedDescendantIdentities;
    let windowsProcessStartObserver;

    beforeEach(() => {
      root = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-capsule-live-e2e-")),
      );
      materializationRoot = path.join(root, "materializations");
      indexPath = path.join(root, "security", "materializations.json");
      npmCli = path.join(root, "npm-cli.js");
      secretPath = path.join(root, "host-secret.txt");
      markerPath = path.join(root, "root-escape.txt");
      childMarkerPath = path.join(root, "child-escape.txt");
      secretCanary = crypto.randomBytes(32).toString("hex");
      probeNonce = crypto.randomBytes(24).toString("hex");
      fs.writeFileSync(npmCli, "// live fixture npm cli\n", "utf8");
      fs.writeFileSync(secretPath, secretCanary, { mode: 0o600 });
      fs.rmSync(markerPath, { force: true });
      fs.rmSync(childMarkerPath, { force: true });

      const keys = [
        "CC_SANDBOX_STRICT",
        "CC_SANDBOX_DISABLE",
        "CC_MCP_PACKAGE_MATERIALIZATION_ROOT",
        "CC_MCP_PACKAGE_MATERIALIZATION_INDEX",
        "CC_MCP_EXECUTABLE_TRUST",
        "CC_MCP_EXECUTABLE_TRUST_STORE",
        "CC_MCP_EXECUTABLE_TRUST_WITNESS",
      ];
      previousEnvironment = Object.fromEntries(
        keys.map((key) => [key, process.env[key]]),
      );
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      process.env.CC_MCP_PACKAGE_MATERIALIZATION_ROOT = materializationRoot;
      process.env.CC_MCP_PACKAGE_MATERIALIZATION_INDEX = indexPath;
      process.env.CC_MCP_EXECUTABLE_TRUST = "1";
      process.env.CC_MCP_EXECUTABLE_TRUST_STORE = path.join(
        root,
        "security",
        "executable-identities.json",
      );
      process.env.CC_MCP_EXECUTABLE_TRUST_WITNESS = path.join(
        root,
        "security",
        "executable-identities.witness.json",
      );

      previousSandboxEnabled = executionBroker._sandboxEnabled;
      previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      executionBroker.flushAuditLog();
      client = new MCPClient();
      clientErrors = [];
      client.on("server-error", (event) => clientErrors.push(event));
      server = null;
      networkRecords = [];
      observedSandboxRootIdentity = null;
      observedDescendantIdentities = [];
      windowsProcessStartObserver = null;
    });

    afterEach(async () => {
      let cleanupError;
      try {
        await windowsProcessStartObserver?.stop();
        windowsProcessStartObserver = null;
      } catch (error) {
        cleanupError = error;
      }
      try {
        await client?.disconnectAll();
      } catch (error) {
        cleanupError ||= error;
      }
      try {
        // This nonce-scoped reaper is only a test-harness safety net. Every
        // product cleanup assertion is completed before it can run.
        await emergencyReapTestProcesses({
          nonce: probeNonce,
          identities: [
            observedSandboxRootIdentity,
            ...observedDescendantIdentities,
          ].filter(Boolean),
        });
      } catch (error) {
        cleanupError ||= error;
      }
      try {
        await closeServer(server);
      } finally {
        executionBroker._sandboxEnabled = previousSandboxEnabled;
        executionBroker._platformSandboxEnabled = previousPlatformEnabled;
        executionBroker.flushAuditLog();
        for (const [key, value] of Object.entries(previousEnvironment || {})) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        resetWindowsSandboxAdapterCache();
        if (root) fs.rmSync(root, { recursive: true, force: true });
      }
      if (cleanupError) throw cleanupError;
    }, 60_000);

    async function createControlledNetworkTargets() {
      server = net.createServer((socket) => {
        const record = { remoteAddress: socket.remoteAddress, chunks: [] };
        networkRecords.push(record);
        socket.on("data", (chunk) => record.chunks.push(Buffer.from(chunk)));
        socket.on("error", () => {});
        socket.on("end", () => socket.end("host-visible"));
      });
      const port = await listenOnHostInterfaces(server);
      const targets = [
        { label: "host-loopback", host: "127.0.0.1", port },
        { label: "host-interface", host: selectNonLoopbackIpv4(), port },
      ];
      for (const target of targets) await proveHostTarget(target);
      expect(networkRecords).toHaveLength(targets.length);
      return targets;
    }

    it("denies host effects through the real Client -> Broker -> OS path or fails closed on macOS", async () => {
      const networkTargets = await createControlledNetworkTargets();
      const hostControlConnectionCount = networkRecords.length;
      const config = {
        command: "npx",
        args: ["--yes", PACKAGE_SPEC, "--stdio"],
        transport: "stdio",
        policy: "allow",
        // Deliberately weak source input: the trusted client must still add
        // the immutable four-boundary capsule floor.
        sandboxPolicy: { requiredBoundaries: [] },
      };
      const materialized = materializeProbe({
        config,
        materializationRoot,
        indexPath,
        npmCli,
        secretPath,
        markerPath,
        childMarkerPath,
        networkTargets,
        nonce: probeNonce,
      });
      expect(materialized.identity.capsule).toMatchObject({
        schema: "chainlesschain.mcp-stdio-node-capsule/v1",
        builder: "esbuild",
        builderVersion: "0.28.1",
      });

      const connectConfig = {
        ...config,
        mcpStdioExecutionAuthority: issueConnectAuthority(config),
      };
      if (process.platform === "darwin") {
        let error;
        try {
          await client.connect(SERVER_NAME, connectConfig);
        } catch (caught) {
          error = caught;
        }
        expect(error).toMatchObject({
          code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
          sandboxCandidateBackend: "macos-fd-code-snapshot",
          sandboxCandidateReason: "macos_atomic_runtime_exec_unavailable",
          sandboxRuntimeProbe: {
            attempted: true,
            runnable: false,
            reason: "public_api_has_no_descriptor_bound_exec",
            entrySnapshotAtomic: false,
            runtimeLaunchAtomic: false,
            sharedLibraryClosure: false,
          },
        });
        const auditLog = executionBroker.getAuditLog();
        const audit = auditLog.at(-1);
        expect(audit).toMatchObject({
          origin: `mcp:server:${SERVER_NAME}`,
          permissionDecision: "deny",
          sandboxState: "denied",
          sandboxBackend: null,
          sandboxCandidateBackend: "macos-fd-code-snapshot",
          sandboxCandidateReason: "macos_atomic_runtime_exec_unavailable",
          sandboxGuarantees: [],
        });
        expect([...audit.sandboxRequired].sort()).toEqual(
          [...MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES].sort(),
        );
        expect(networkRecords).toHaveLength(hostControlConnectionCount);
        expect(nonceProcessRows(enumerateHostProcesses(), probeNonce)).toEqual(
          [],
        );
        expect(fs.readFileSync(secretPath, "utf8") === secretCanary).toBe(true);
        expect(
          containsCanary(
            { error, auditLog, clientErrors, networkRecords },
            secretCanary,
          ),
        ).toBe(false);
        expect(fs.existsSync(markerPath)).toBe(false);
        expect(fs.existsSync(childMarkerPath)).toBe(false);
        return;
      }

      const connected = await client.connect(SERVER_NAME, connectConfig);
      expect(connected.tools.map((tool) => tool.name)).toContain(
        "probe_sandbox_effects",
      );
      const entry = client.servers.get(SERVER_NAME);
      expect(entry?._stdioTreeMode).toBe("sandbox");
      observedSandboxRootIdentity = await captureHostProcessIdentity(
        entry.process.pid,
      );

      let processStartEvents = [];
      if (process.platform === "win32") {
        windowsProcessStartObserver = await startWindowsProcessStartObserver();
      }
      let toolResult;
      try {
        toolResult = await client.callTool(
          SERVER_NAME,
          "probe_sandbox_effects",
          {},
        );
      } finally {
        if (windowsProcessStartObserver) {
          processStartEvents = await windowsProcessStartObserver.stop();
          windowsProcessStartObserver = null;
        }
      }
      const observedChildStarts = selectObservedDescendantStarts(
        processStartEvents,
        entry.process.pid,
      );
      const text = toolResult?.content?.find(
        (item) => item?.type === "text",
      )?.text;
      const report = JSON.parse(text);
      expect(report.root.filesystem).toMatchObject({
        readDenied: true,
        canaryCandidate: null,
        writeDenied: true,
      });
      const networkProbeEvidence = [
        expectNetworkProbeResults(report.root.networks, networkTargets),
      ];
      if (process.platform === "linux") {
        expect(report.child).toMatchObject({
          spawnDenied: false,
          reportReceived: true,
        });
      }
      if (report.child.spawnDenied) {
        // A zero-capability Windows AppContainer may reject child creation at
        // the OS boundary. Linux must execute the probe through the capsule's
        // live /proc/self/exe runtime and cannot use denial here.
        expect(process.platform).toBe("win32");
        expect(report.child).toMatchObject({
          spawnDenied: true,
          reportReceived: false,
          errorType: "os-error-code",
          errorCode: expect.stringMatching(/^(?:EACCES|EPERM)$/),
          error: expect.any(String),
        });
        expect(isTypedOsSpawnDenial(report.child)).toBe(true);
        expect(
          isHostAttestedWindowsSpawnDenial(report.child, observedChildStarts),
        ).toBe(true);
        expect(nonceProcessRows(enumerateHostProcesses(), probeNonce)).toEqual(
          [],
        );
      } else {
        expect(report.child).toMatchObject({
          spawnDenied: false,
          reportReceived: true,
          detachedRequested: true,
          event: "child-ready",
          filesystem: {
            readDenied: true,
            canaryCandidate: null,
            writeDenied: true,
          },
        });
        expect(report.child.namespacePid).toBeGreaterThan(0);
        expect(report.child.spawnPid).toBe(report.child.namespacePid);
        networkProbeEvidence.push(
          expectNetworkProbeResults(report.child.networks, networkTargets),
        );
        if (process.platform === "win32") {
          const matchingStarts = observedChildStarts.filter(
            (event) => event.pid === report.child.spawnPid,
          );
          expect(matchingStarts).toHaveLength(1);
          expect(matchingStarts[0]).toMatchObject({
            pid: report.child.spawnPid,
            parentPid: entry.process.pid,
            creationMarker: expect.stringMatching(/^wmi-time-created:\d+$/),
          });
        }
        observedDescendantIdentities = await captureNonceDescendantIdentities(
          entry.process.pid,
          probeNonce,
        );
        if (process.platform === "win32") {
          expect(observedDescendantIdentities).toHaveLength(1);
          expect(observedDescendantIdentities[0]).toMatchObject({
            pid: report.child.spawnPid,
            parentPid: entry.process.pid,
          });
        }
        const liveRows = enumerateHostProcesses();
        expect(
          observedDescendantIdentities.every((identity) =>
            identityIsAlive(identity, liveRows),
          ),
        ).toBe(true);
      }
      await delay(250);
      expect(networkRecords).toHaveLength(hostControlConnectionCount);
      expect(fs.readFileSync(secretPath, "utf8") === secretCanary).toBe(true);
      expect(fs.existsSync(markerPath)).toBe(false);
      expect(fs.existsSync(childMarkerPath)).toBe(false);

      const auditLog = executionBroker.getAuditLog();
      const audit = auditLog.find(
        (record) => record.origin === `mcp:server:${SERVER_NAME}`,
      );
      expect(audit).toBeTruthy();
      expect([...audit.sandboxRequired].sort()).toEqual(
        [...MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES].sort(),
      );
      expect(audit).toMatchObject({
        permissionDecision: "allow",
        sandboxed: true,
        sandboxState: "ready",
        sandboxPolicyAttested: true,
        mcpStdioExecutableIdentityDigest:
          expect.stringMatching(/^[a-f0-9]{64}$/),
        sandboxRuntimeProbe: {
          runnable: true,
          entrySnapshotAtomic: true,
          runtimeLaunchAtomic: true,
          sharedLibraryClosure: false,
        },
      });
      expect(audit.sandboxGuarantees).toEqual(
        expect.arrayContaining(MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES),
      );
      expect(audit.sandboxBackend).toBe(
        process.platform === "linux"
          ? "linux-bwrap"
          : "windows-appcontainer-job-restricted-token",
      );
      if (process.platform === "win32") {
        expect(audit.sandboxRuntimeProbe).toMatchObject({
          kind: "windows-appcontainer-launch-attestation-v1",
          runnable: true,
          capabilityCount: 0,
        });
        expect(entry.process).toMatchObject({
          sandboxAppContainerSid: expect.stringMatching(
            /^S-1-15-2(?:-\d+){7}$/,
          ),
          sandboxAppContainerCapabilityCount: 0,
        });
        const targetAppContainerSid =
          entry.process.sandboxAppContainerSid.toUpperCase();
        expect(
          queryWindowsLoopbackExemptSids().has(targetAppContainerSid),
        ).toBe(false);
        // ETIMEDOUT remains nondiagnostic probe output. Isolation authority is
        // the native zero-capability readiness + actual-target attestations,
        // the required network guarantee, and the unchanged controlled host
        // endpoint record set. Harness `timeout` stays indeterminate here.
        for (const result of networkProbeEvidence.flatMap(
          (evidence) => evidence.indeterminate,
        )) {
          expect(result).toMatchObject({
            state: "indeterminate",
            networkDenied: false,
            canaryPayloadAttempted: false,
          });
        }
        expect(networkRecords).toHaveLength(hostControlConnectionCount);
      }
      // This is an explicit read -> MCP result / socket-payload probe. It is
      // evidence for these paths, not a claim of generic noninterference.
      expect(
        containsCanary(
          { report, toolResult, auditLog, clientErrors, networkRecords },
          secretCanary,
        ),
      ).toBe(false);

      await client.disconnect(SERVER_NAME);
      // Product telemetry is secondary evidence; the host observer below is
      // the independent authority for exact process identity retirement.
      expect(entry._stdioTreeCleanup).toMatchObject({
        treeMode: "sandbox",
        verifiable: true,
        treeRequested: true,
        closed: true,
        treeTerminated: true,
        confirmed: true,
        deadlineExceeded: false,
      });
      await waitForIdentitiesGone([
        observedSandboxRootIdentity,
        ...observedDescendantIdentities,
      ]);
      await waitForNonceProcessesGone(probeNonce);
      expect(fs.existsSync(markerPath)).toBe(false);
      expect(fs.existsSync(childMarkerPath)).toBe(false);
    }, 360_000);

    it("rejects a materialized capsule byte replacement before Broker spawn", async () => {
      const networkTargets = await createControlledNetworkTargets();
      const config = {
        command: "npx",
        args: ["--yes", PACKAGE_SPEC, "--stdio"],
        transport: "stdio",
        policy: "allow",
      };
      const materialized = materializeProbe({
        config,
        materializationRoot,
        indexPath,
        npmCli,
        secretPath,
        markerPath,
        childMarkerPath,
        networkTargets,
        nonce: probeNonce,
      });
      const capsulePath = path.join(materialized.root, "capsule", "server.cjs");
      fs.appendFileSync(
        capsulePath,
        `\nrequire("node:fs").writeFileSync(${JSON.stringify(
          markerPath,
        )}, "identity-bypass");\n`,
        "utf8",
      );
      executionBroker.flushAuditLog();

      const connectConfig = {
        ...config,
        mcpStdioExecutionAuthority: issueConnectAuthority(config),
      };
      let error;
      try {
        await client.connect(SERVER_NAME, connectConfig);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({
        code: MCP_STDIO_PACKAGE_MATERIALIZATION_CHANGED_CODE,
      });
      const auditLog = executionBroker.getAuditLog();
      expect(client.servers.has(SERVER_NAME)).toBe(false);
      expect(
        auditLog.some(
          (record) => record.origin === `mcp:server:${SERVER_NAME}`,
        ),
      ).toBe(false);
      expect(nonceProcessRows(enumerateHostProcesses(), probeNonce)).toEqual(
        [],
      );
      expect(networkRecords).toHaveLength(networkTargets.length);
      expect(fs.readFileSync(secretPath, "utf8") === secretCanary).toBe(true);
      expect(
        containsCanary(
          { error, auditLog, clientErrors, networkRecords },
          secretCanary,
        ),
      ).toBe(false);
      expect(fs.existsSync(markerPath)).toBe(false);
      expect(fs.existsSync(childMarkerPath)).toBe(false);
    }, 180_000);
  },
);

describe.skipIf(LIVE && SUPPORTED)(
  "live materialized MCP capsule sandbox chain gate",
  () => {
    it("requires CC_SANDBOX_LIVE=1 on a supported platform", () => {
      expect(LIVE && SUPPORTED).toBe(false);
    });
  },
);
