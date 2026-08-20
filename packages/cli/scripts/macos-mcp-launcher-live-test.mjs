#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import {
  applySandbox,
  consumeMacMcpCodeSnapshotPlanBinding,
  MACOS_PKG_EXECPATH_MAGIC,
  SANDBOX_BOUNDARIES,
} from "../src/lib/process-execution-broker/platform-sandbox.js";
import { MACOS_MCP_LAUNCHER_INPUTS } from "../src/lib/process-execution-broker/macos-mcp-launcher-contract.js";
import { executionBroker } from "../src/lib/process-execution-broker/index.js";
import {
  consumeMcpStdioExecutionAuthority,
  issueMcpStdioExecutionAuthority,
  materializeApprovedMcpStdioInvocation,
  resolveMcpStdioExecutionApproval,
} from "../src/lib/mcp-stdio-execution-authority.js";
import {
  MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES,
  prepareMcpStdioExecutableIdentity,
} from "../src/lib/mcp-stdio-executable-identity.js";
import { MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY } from "../src/lib/mcp-stdio-native-code-policy.js";
import {
  _deps as materializationDeps,
  materializeMcpStdioNpmPackage,
} from "../src/lib/mcp-stdio-package-materialization.js";

const protocol = MACOS_MCP_LAUNCHER_INPUTS.protocol;
const requiredBoundaries = Object.freeze([
  SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
  SANDBOX_BOUNDARIES.FILESYSTEM,
  SANDBOX_BOUNDARIES.NETWORK,
  SANDBOX_BOUNDARIES.PROCESS_TREE,
  SANDBOX_BOUNDARIES.NATIVE_ADDON_LOADING,
]);
const safeEnvironment = Object.freeze({
  PATH: "/usr/bin:/bin",
  HOME: process.env.HOME || "/tmp",
  TMPDIR: process.env.TMPDIR || "/tmp",
  LANG: "C",
  LC_ALL: "C",
});

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function installLiveMaterializedPackage({ directory }) {
  writeJson(path.join(directory, "package-lock.json"), {
    name: "chainlesschain-mcp-materialization",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "macos-launcher-live-fixture": "1.0.0" } },
      "node_modules/macos-launcher-live-fixture": {
        version: "1.0.0",
        resolved:
          "https://registry.npmjs.org/macos-launcher-live-fixture/-/macos-launcher-live-fixture-1.0.0.tgz",
        integrity: `sha512-${"A".repeat(86)}==`,
      },
    },
  });
  const packageRoot = path.join(
    directory,
    "node_modules",
    "macos-launcher-live-fixture",
  );
  writeJson(path.join(packageRoot, "package.json"), {
    name: "macos-launcher-live-fixture",
    version: "1.0.0",
    bin: { "macos-launcher-live": "server.cjs" },
  });
  fs.writeFileSync(
    path.join(packageRoot, "server.cjs"),
    'process.stdout.write(JSON.stringify({marker:"broker-issued-capsule",pid:process.pid})+"\\n");setTimeout(()=>process.exit(0),400);',
    "utf8",
  );
}

function sha256File(candidate) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(candidate))
    .digest("hex");
}

function realPath(candidate) {
  return fs.realpathSync.native(candidate);
}

function fileIdentity(candidate, { requestedPath } = {}) {
  const canonical = realPath(candidate);
  const stat = fs.lstatSync(canonical);
  assert(
    stat.isFile() && !stat.isSymbolicLink(),
    `${canonical} is not a regular file`,
  );
  return Object.freeze({
    contractVersion: 1,
    ...(requestedPath ? { requestedPath } : {}),
    realPath: canonical,
    sha256: sha256File(canonical),
    bytes: Number(stat.size),
    fileId: Object.freeze({ dev: String(stat.dev), ino: String(stat.ino) }),
    mtimeMs: Number(stat.mtimeMs),
  });
}

function normalizedCapsuleContract(
  capsuleRoot,
  entryPath,
  runtimePath = process.execPath,
) {
  const root = realPath(capsuleRoot);
  const rootStat = fs.lstatSync(root);
  assert(
    rootStat.isDirectory() && !rootStat.isSymbolicLink(),
    "capsule root is not a directory",
  );
  const entryIdentity = fileIdentity(entryPath);
  const runtimeIdentity = fileIdentity(runtimePath, {
    requestedPath: path.resolve(runtimePath),
  });
  assert(
    path.dirname(entryIdentity.realPath) === root,
    "entry must be a direct capsule child",
  );
  return Object.freeze({
    contractVersion: 1,
    kind: "strict-mcp-node-capsule",
    nativeCodePolicy: MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY,
    pluginRoot: root,
    workingDirectory: root,
    runtimePath: runtimeIdentity.realPath,
    rootIdentity: Object.freeze({
      realPath: root,
      fileId: Object.freeze({
        dev: String(rootStat.dev),
        ino: String(rootStat.ino),
      }),
    }),
    entryIdentity,
    runtimeIdentity,
  });
}

function launchOptions(capsuleRoot, extra = {}) {
  return {
    cwd: capsuleRoot,
    shell: false,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...safeEnvironment },
    ...extra,
  };
}

function mintPlan(contract, args, { sync = false, options = {} } = {}) {
  const spawnOptions = launchOptions(contract.pluginRoot, options);
  const plan = applySandbox(
    contract.runtimePath,
    args,
    spawnOptions,
    "default",
    undefined,
    {
      profile: "default",
      requiredBoundaries,
      sync,
      executionContract: contract,
    },
  );
  assert(
    plan.applied === true,
    `signed helper plan unavailable: ${plan.reason}:${plan.runtimeProbe?.reason}`,
  );
  assert(
    plan.backend === protocol.backend,
    `unexpected helper backend: ${plan.backend}`,
  );
  assert(
    plan.options?.stdio?.[8] === "pipe",
    "caller lifeline fd8 is not a pipe",
  );
  assert(
    plan.runtimeProbe?.sharedLibraryClosure === false,
    "helper must not claim shared-library closure",
  );
  assert(
    plan.runtimeProbe?.capsulePathObjectAtomic === false,
    "helper must not claim capsule pathname atomicity",
  );
  return { plan, spawnOptions };
}

function bindingExpectation(contract, args, spawnOptions, sync = false) {
  return {
    executionContract: contract,
    command: contract.runtimePath,
    args,
    cwd: contract.pluginRoot,
    shell: false,
    detached: false,
    profile: "default",
    requiredBoundaries,
    sync,
    env: spawnOptions.env,
  };
}

function spawnPlan(plan) {
  let child;
  try {
    child = spawn(plan.command, plan.args, plan.options);
  } finally {
    plan.cleanup?.();
  }
  assert(
    child?.stdio?.[8] && !child.stdio[8].destroyed,
    "spawn did not retain caller fd8",
  );
  return child;
}

function childOutcome(child, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The timeout remains the primary failure.
      }
      reject(new Error(`child ${child.pid} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal });
    });
  });
}

function capture(child) {
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  return {
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function waitForJsonLine(child, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`child ${child.pid} did not emit target evidence`));
    }, timeoutMs);
    const onData = (chunk) => {
      buffered += chunk.toString();
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      try {
        const parsed = JSON.parse(buffered.slice(0, newline));
        cleanup();
        resolve(parsed);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = (status, signal) => {
      cleanup();
      reject(
        new Error(`child exited before target evidence (${status}:${signal})`),
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.off("error", onError);
      child.off("close", onClose);
    };
    child.stdout?.on("data", onData);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessDeath(pid, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return;
    await delay(25);
  }
  fail(`target process ${pid} survived caller death`);
}

function sudoSnapshotState() {
  const result = spawnSync(
    "/usr/bin/sudo",
    [
      "-n",
      "/usr/bin/find",
      protocol.snapshotRoot,
      "-mindepth",
      "1",
      "-maxdepth",
      "1",
      "-print",
    ],
    { encoding: "utf8", env: { ...safeEnvironment } },
  );
  assert(result.status === 0, `cannot inspect snapshot root: ${result.stderr}`);
  return result.stdout.split("\n").filter(Boolean).sort();
}

function verifyInstalledModes() {
  for (const [candidate, mode, kind] of [
    [protocol.helperInstallPath, 0o4555, "file"],
    [protocol.installContractPath, 0o444, "file"],
    [protocol.snapshotRoot, 0o711, "directory"],
    [
      path.join(protocol.snapshotRoot, protocol.snapshotLockName),
      0o600,
      "file",
    ],
  ]) {
    const stat = fs.lstatSync(candidate);
    assert(!stat.isSymbolicLink(), `${candidate} is a symlink`);
    assert(
      kind === "file" ? stat.isFile() : stat.isDirectory(),
      `${candidate} has wrong kind`,
    );
    assert(stat.uid === 0 && stat.gid === 0, `${candidate} is not root:wheel`);
    assert(
      (stat.mode & 0o7777) === mode,
      `${candidate} has mode ${(stat.mode & 0o7777).toString(8)}`,
    );
    if (kind === "file")
      assert(stat.nlink === 1, `${candidate} has hard links`);
  }
}

function verifyInstalledContractBinding() {
  const contractBytes = fs.readFileSync(protocol.installContractPath);
  const contract = JSON.parse(contractBytes.toString("utf8"));
  assert(
    contract.protocolSha256 === MACOS_MCP_LAUNCHER_INPUTS.protocolSha256 &&
      contract.sourceSha256 === MACOS_MCP_LAUNCHER_INPUTS.sourceSha256 &&
      contract.gateBootstrapSha256 ===
        MACOS_MCP_LAUNCHER_INPUTS.gateBootstrapSha256 &&
      contract.helperSha256 === sha256File(protocol.helperInstallPath) &&
      contract.packageIdentifier === protocol.packageIdentifier,
    "installed helper bytes do not match the exact protocol/source contract",
  );
  return Object.freeze({
    contract,
    installContractSha256: crypto
      .createHash("sha256")
      .update(contractBytes)
      .digest("hex"),
  });
}

function verifyInstalledProbeClosesInheritedSentinelFd() {
  const nonce = crypto.randomBytes(32).toString("hex");
  const sentinelRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-macos-mcp-probe-fd-"),
  );
  const sentinelPath = path.join(sentinelRoot, "sentinel");
  let sentinelFd;
  try {
    fs.writeFileSync(sentinelPath, "fd9-sentinel", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    sentinelFd = fs.openSync(sentinelPath, "r");
    const result = spawnSync(
      protocol.helperInstallPath,
      ["--probe-v1", nonce],
      {
        encoding: "utf8",
        env: { ...safeEnvironment },
        timeout: 20_000,
        stdio: [
          "ignore",
          "pipe",
          "pipe",
          "ignore",
          "ignore",
          "ignore",
          "ignore",
          "ignore",
          "ignore",
          sentinelFd, // fd 9 must be closed by the helper's descriptor sweep.
        ],
      },
    );
    assert(
      !result.error && result.status === 0 && result.signal === null,
      `installed helper fd9 probe failed: ${result.error?.message || result.status || result.signal}:${result.stderr}`,
    );
    assert(
      result.stderr.trim() === "",
      "installed helper fd9 probe wrote stderr",
    );
    const probe = JSON.parse(result.stdout);
    assert(
      probe.schema === "chainlesschain.macos-mcp-launcher-probe.v1" &&
        probe.nonce === nonce,
      "installed helper fd9 probe returned mismatched evidence",
    );
    return true;
  } finally {
    if (sentinelFd !== undefined) fs.closeSync(sentinelFd);
    fs.rmSync(sentinelRoot, { recursive: true, force: true });
  }
}

function verifyInvalidDirectInvocationHasNoRootEffects() {
  const before = sudoSnapshotState();
  const invalid = spawnSync(protocol.helperInstallPath, ["--invalid"], {
    encoding: "utf8",
    env: { ...safeEnvironment },
  });
  assert(
    invalid.status === 64,
    `invalid direct invocation returned ${invalid.status}`,
  );
  const uid = process.getuid();
  const gidZero = spawnSync(
    "/usr/bin/sudo",
    [
      "-n",
      "-u",
      `#${uid}`,
      "-g",
      "#0",
      "--",
      protocol.helperInstallPath,
      "--launch-v1",
    ],
    { encoding: "utf8", env: { ...safeEnvironment } },
  );
  assert(
    gidZero.status === 77,
    `real gid 0 launch was not rejected: ${gidZero.status}:${gidZero.stderr}`,
  );
  assert(
    JSON.stringify(sudoSnapshotState()) === JSON.stringify(before),
    "invalid invocation changed root snapshot state",
  );
}

function exerciseBindings(contract, args) {
  {
    const { plan, spawnOptions } = mintPlan(contract, args);
    const expected = bindingExpectation(contract, args, spawnOptions);
    const forged = {
      ...plan,
      args: [...plan.args],
      options: { ...plan.options, stdio: [...plan.options.stdio] },
      runtimeProbe: { ...plan.runtimeProbe },
    };
    assert(
      consumeMacMcpCodeSnapshotPlanBinding(forged, expected) === false,
      "forged plan was admitted",
    );
    assert(
      consumeMacMcpCodeSnapshotPlanBinding(plan, expected) === true,
      "issued plan was not admitted",
    );
    assert(
      consumeMacMcpCodeSnapshotPlanBinding(plan, expected) === false,
      "issued plan replay was admitted",
    );
    plan.cleanup?.();
  }
  {
    const { plan, spawnOptions } = mintPlan(contract, args);
    const expected = bindingExpectation(contract, args, spawnOptions);
    plan.options.stdio[8] = "ignore";
    assert(
      consumeMacMcpCodeSnapshotPlanBinding(plan, expected) === false,
      "fd8 mutation was admitted",
    );
    assert(
      consumeMacMcpCodeSnapshotPlanBinding(plan, expected) === false,
      "fd8 mutation did not burn the plan",
    );
    plan.cleanup?.();
  }
  {
    const { plan, spawnOptions } = mintPlan(contract, args);
    const expected = bindingExpectation(contract, args, spawnOptions);
    plan.options.env.DYLD_INSERT_LIBRARIES = "/tmp/forged.dylib";
    assert(
      consumeMacMcpCodeSnapshotPlanBinding(plan, expected) === false,
      "environment mutation was admitted",
    );
    assert(
      consumeMacMcpCodeSnapshotPlanBinding(plan, expected) === false,
      "environment mutation did not burn the plan",
    );
    plan.cleanup?.();
  }
  {
    const { plan, spawnOptions } = mintPlan(contract, args);
    const expected = bindingExpectation(contract, args, spawnOptions);
    const helperArgsMutation = { ...plan, args: [...plan.args, "--forged"] };
    assert(
      consumeMacMcpCodeSnapshotPlanBinding(helperArgsMutation, expected) ===
        false,
      "helper args mutation was admitted",
    );
    assert(
      consumeMacMcpCodeSnapshotPlanBinding(plan, expected) === true,
      "helper args clone consumed the issued plan",
    );
    assert(Object.isFrozen(plan.args), "issued helper args are not frozen");
    plan.cleanup?.();
  }
  {
    const { plan, spawnOptions } = mintPlan(contract, args);
    const expected = bindingExpectation(contract, args, spawnOptions);
    assert(
      consumeMacMcpCodeSnapshotPlanBinding(plan, {
        ...expected,
        executionContract: { ...contract },
      }) === false,
      "execution-contract identity mutation was admitted",
    );
    assert(
      consumeMacMcpCodeSnapshotPlanBinding(plan, expected) === false,
      "contract mismatch did not burn the plan",
    );
    plan.cleanup?.();
  }
  {
    const { plan } = mintPlan(contract, args);
    const context = {
      command: contract.runtimePath,
      args,
      cwd: contract.pluginRoot,
      shell: false,
      detached: false,
      executionContract: contract,
      profile: "default",
      requiredBoundaries,
      sync: false,
      builtInSandboxAdapter: true,
    };
    const validated = executionBroker._validateSandboxPlan(plan, context);
    assert(
      validated.backend === protocol.backend,
      "Broker did not validate the issued plan",
    );
    let replayRejected = false;
    try {
      executionBroker._validateSandboxPlan(plan, context);
    } catch (error) {
      replayRejected = /binding|typed atomic MCP capsule evidence/iu.test(
        error.message,
      );
    }
    assert(replayRejected, "Broker admitted a replayed raw plan");
    validated.cleanup?.();
  }
}

async function exerciseInPlaceEntryOverwrite(capsuleRoot, entryPath) {
  const originalSource = [
    'const fs=require("node:fs");',
    'const closed=[3,4,5,6,7].every((fd)=>{try{fs.fstatSync(fd);return false}catch(error){return error.code==="EBADF"}});',
    'process.stdout.write(JSON.stringify({marker:"original",uid:process.getuid(),gid:process.getgid(),closed})+"\\n");',
  ].join("");
  const attackerSource =
    'process.stdout.write(JSON.stringify({marker:"attacker"})+"\\n");';
  fs.writeFileSync(entryPath, originalSource, { mode: 0o600 });
  const contract = normalizedCapsuleContract(capsuleRoot, entryPath);
  const args = [entryPath, "--stdio"];
  const { plan } = mintPlan(contract, args);
  const snapshotPath = plan.runtimeProbe.runtimeLaunchPath;
  const watcher = spawn(
    process.execPath,
    [
      "-e",
      [
        'const fs=require("node:fs");',
        'const path=require("node:path");',
        "const [snapshot,entry,source]=process.argv.slice(1);",
        "const deadline=Date.now()+15000;",
        "while(Date.now()<deadline){if(fs.existsSync(snapshot)){",
        "const directory=path.dirname(snapshot);const results={};",
        'const attack=(name,fn)=>{try{fn();results[name]="succeeded"}catch(error){results[name]=error.code||error.name}};',
        'attack("truncate",()=>fs.truncateSync(snapshot,0));',
        'attack("write",()=>fs.writeFileSync(snapshot,"attacker-runtime"));',
        'attack("chmod",()=>fs.chmodSync(snapshot,0o777));',
        'attack("unlink",()=>fs.unlinkSync(snapshot));',
        'attack("rename-runtime",()=>fs.renameSync(snapshot,`${snapshot}.renamed`));',
        'attack("create-sibling",()=>fs.writeFileSync(path.join(directory,"evil"),"evil"));',
        'attack("rename-directory",()=>fs.renameSync(directory,`${directory}.renamed`));',
        "fs.writeFileSync(entry,source);",
        "process.stdout.write(JSON.stringify({overwritten:true,results}));process.exit(0);}}",
        "process.exit(70);",
      ].join(""),
      snapshotPath,
      entryPath,
      attackerSource,
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...safeEnvironment } },
  );
  const watcherCapture = capture(watcher);
  const watcherOutcome = childOutcome(watcher);
  const child = spawnPlan(plan);
  const childCapture = capture(child);
  const outcome = await childOutcome(child);
  const raced = await watcherOutcome;
  try {
    assert(
      outcome.status === 0 && outcome.signal === null,
      `atomic launch failed: ${JSON.stringify(outcome)}:${childCapture.stderr()}`,
    );
    assert(
      raced.status === 0,
      `overwrite watcher missed exact snapshot window: ${JSON.stringify(raced)}:${watcherCapture.stderr()}`,
    );
    const attacks = JSON.parse(watcherCapture.stdout());
    assert(attacks.overwritten === true, "entry source was not overwritten");
    for (const [operation, result] of Object.entries(attacks.results)) {
      assert(
        result === "EACCES" || result === "EPERM",
        `caller ${operation} attack against root runtime unexpectedly returned ${result}`,
      );
    }
    const target = JSON.parse(childCapture.stdout().trim());
    assert(
      target.marker === "original",
      `mutated entry executed: ${childCapture.stdout()}`,
    );
    assert(
      target.uid === process.getuid() && target.gid === process.getgid(),
      "target credentials did not drop to caller",
    );
    assert(
      target.closed === true,
      "bootstrap leaked fd3/fd4/fd5/fd6/fd7 into entry code",
    );
    assert(
      !fs.existsSync(snapshotPath),
      "runtime snapshot remained after entry release",
    );
  } finally {
    fs.writeFileSync(entryPath, originalSource, { mode: 0o600 });
  }
  return { contract: normalizedCapsuleContract(capsuleRoot, entryPath), args };
}

async function exerciseBrokerLifecycle(capsuleRoot, entryPath) {
  assert(
    JSON.stringify(requiredBoundaries) ===
      JSON.stringify(MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES),
    "live Broker boundaries do not match the issued MCP capsule floor",
  );
  const authorityRoot = path.join(capsuleRoot, ".broker-issued-live");
  const materializationRoot = path.join(authorityRoot, "materializations");
  const materializationIndexPath = path.join(authorityRoot, "index.json");
  const storePath = path.join(authorityRoot, "identity-store.json");
  const witnessPath = path.join(authorityRoot, "identity-witness.json");
  const npmCli = path.join(authorityRoot, "npm-cli.js");
  fs.mkdirSync(authorityRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(npmCli, "// fixed live materialization npm shim\n", "utf8");
  const serverName = "macos-launcher-live";
  const sourceConfig = {
    command: "npx",
    args: ["macos-launcher-live-fixture@1.0.0"],
    sandboxPolicy: { requiredBoundaries },
    transport: "stdio",
    origin: `mcp:server:${serverName}`,
  };
  const token = issueMcpStdioExecutionAuthority({
    serverName,
    config: sourceConfig,
    approvalKind: "explicit-config",
    approvalSource: "live:macos-signed-root-launcher",
  });
  const approval = consumeMcpStdioExecutionAuthority(token, {
    serverName,
    config: sourceConfig,
  });
  const config = materializeApprovedMcpStdioInvocation(approval);
  const originalProcessBrokerRunSync = materializationDeps.processBrokerRunSync;
  const originalCredentialFiltering =
    executionBroker._credentialFilteringEnabled;
  const originalCredentialAgent = executionBroker._credentialAgentEnabled;
  let prepared;
  executionBroker._credentialFilteringEnabled = false;
  executionBroker._credentialAgentEnabled = false;
  let child;
  try {
    materializationDeps.processBrokerRunSync = spawnSync;
    await materializeMcpStdioNpmPackage({
      approvalRecord: resolveMcpStdioExecutionApproval(approval),
      config,
      packageSpec: "macos-launcher-live-fixture@1.0.0",
      binName: "macos-launcher-live",
      root: materializationRoot,
      indexPath: materializationIndexPath,
      npmCli,
      installRunner: installLiveMaterializedPackage,
      now: Date.parse("2026-08-15T00:00:00.000Z"),
    });
    prepared = prepareMcpStdioExecutableIdentity({
      serverName,
      config,
      approval,
      env: { ...safeEnvironment },
      retrust: true,
      storePath,
      witnessPath,
      materializationRoot,
      materializationIndexPath,
    });
    assert(
      prepared.sandboxExecutionContract?.runtimeIdentity?.requestedPath ===
        realPath(process.execPath),
      "issued capsule contract is not bound to the packed process.execPath",
    );
    child = executionBroker.spawn(prepared.command, prepared.args, {
      origin: `mcp:server:${serverName}`,
      policy: "allow",
      cwd: prepared.workingDirectory,
      shell: false,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: prepared.env,
      requiredBoundaries,
      sandboxExecutionContract: prepared.sandboxExecutionContract,
      mcpStdioExecutableIdentityAuthority: prepared.authority,
      mcpStdioExecutableIdentityDigest: prepared.identityDigest,
    });
    const output = capture(child);
    assert(
      child.macosMcpCallerLifeline === child.stdio[8],
      "Broker did not retain its fd8 lifeline property",
    );
    assert(
      !child.macosMcpCallerLifeline.destroyed,
      "Broker fd8 lifeline closed before target exit",
    );
    const outcome = await childOutcome(child);
    assert(
      outcome.status === 0 && outcome.signal === null,
      `Broker launch failed: ${JSON.stringify(outcome)}:${output.stderr()}`,
    );
    assert(
      JSON.parse(output.stdout().trim()).marker === "broker-issued-capsule",
      "Broker target output mismatch",
    );
  } finally {
    materializationDeps.processBrokerRunSync = originalProcessBrokerRunSync;
    executionBroker._credentialFilteringEnabled = originalCredentialFiltering;
    executionBroker._credentialAgentEnabled = originalCredentialAgent;
    if (child && child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    fs.rmSync(authorityRoot, { recursive: true, force: true });
  }
  return normalizedCapsuleContract(capsuleRoot, entryPath);
}

async function exercisePackedRuntime(capsuleRoot, entryPath, packedRuntime) {
  assert(
    realPath(packedRuntime) === realPath(process.execPath) && process.pkg,
    "packed runtime gate must execute this harness from the exact pkg runtime",
  );
  fs.writeFileSync(
    entryPath,
    'process.stdout.write(JSON.stringify({marker:"packed-fd4-entry"})+"\\n");',
    { mode: 0o600 },
  );
  const contract = normalizedCapsuleContract(capsuleRoot, entryPath);
  const { plan } = mintPlan(contract, [entryPath], {
    options: {
      env: { ...safeEnvironment, PKG_EXECPATH: MACOS_PKG_EXECPATH_MAGIC },
    },
  });
  assert(
    plan.runtimeProbe.targetRuntimeInvocationMode ===
      "pkg-copied-executable-eval-v1" &&
      plan.runtimeProbe.pkgExecPathMagicBound === true &&
      plan.options.env.PKG_EXECPATH === MACOS_PKG_EXECPATH_MAGIC,
    "production packaged-runtime plan did not bind the pkg Node-mode magic",
  );
  const child = spawnPlan(plan);
  const output = capture(child);
  const outcome = await childOutcome(child, 30_000);
  assert(
    outcome.status === 0 && outcome.signal === null,
    `packed runtime helper launch failed: ${JSON.stringify(outcome)}:${output.stderr()}`,
  );
  const stdout = output.stdout().trim();
  assert(
    JSON.parse(stdout).marker === "packed-fd4-entry" &&
      !stdout.includes("PACKED_DEFAULT_ENTRY"),
    `packed runtime executed its baked entry instead of fd4: ${stdout}`,
  );
}

function snapshotLockIdentity() {
  const lock = fs.lstatSync(
    path.join(protocol.snapshotRoot, protocol.snapshotLockName),
    { bigint: true },
  );
  return `${lock.dev}:${lock.ino}`;
}

async function expectLaunchSerialized(contract, entryPath, label) {
  const { plan } = mintPlan(contract, [entryPath]);
  const child = spawnPlan(plan);
  const outcome = await childOutcome(child);
  assert(
    outcome.status === 77 && outcome.signal === null,
    `${label} bypassed the global lock: ${JSON.stringify(outcome)}`,
  );
}

async function exerciseLockUpgrade(capsuleRoot, entryPath, signedPackage) {
  fs.writeFileSync(
    entryPath,
    'process.stdout.write(JSON.stringify({marker:"lock-holder",pid:process.pid})+"\\n");setInterval(()=>{},1000);',
    { mode: 0o600 },
  );
  let contract = normalizedCapsuleContract(capsuleRoot, entryPath);
  const { plan } = mintPlan(contract, [entryPath]);
  const snapshotPath = plan.runtimeProbe.runtimeLaunchPath;
  const holder = spawnPlan(plan);
  const holderOutcome = childOutcome(holder, 90_000);
  const target = await waitForJsonLine(holder);
  assert(target.marker === "lock-holder", "global lock holder did not start");
  const before = snapshotLockIdentity();
  try {
    await expectLaunchSerialized(contract, entryPath, "pre-upgrade launch");
    const upgrade = spawnSync(
      "/usr/bin/sudo",
      ["-n", "/usr/sbin/installer", "-pkg", signedPackage, "-target", "/"],
      { encoding: "utf8", env: { ...safeEnvironment }, timeout: 120_000 },
    );
    assert(
      upgrade.status === 0 && !upgrade.signal && !upgrade.error,
      `signed helper upgrade failed: ${upgrade.error?.message || upgrade.stderr}`,
    );
    const after = snapshotLockIdentity();
    assert(
      before === after,
      `upgrade replaced lock inode ${before} -> ${after}`,
    );
    assert(
      processAlive(holder.pid) && processAlive(target.pid),
      "upgrade killed the active serialized launch",
    );
    contract = normalizedCapsuleContract(capsuleRoot, entryPath);
    await expectLaunchSerialized(contract, entryPath, "post-upgrade launch");
  } finally {
    holder.stdio[8].destroy();
  }
  const outcome = await holderOutcome;
  assert(
    outcome.status !== 0 || outcome.signal !== null,
    "lock holder survived caller-lifeline close",
  );
  await waitForProcessDeath(target.pid);
  assert(!fs.existsSync(snapshotPath), "lock upgrade left a runtime snapshot");
}

async function exerciseProcessForkDenied(capsuleRoot, entryPath) {
  const escapedMarker = path.join(capsuleRoot, "escaped-detached-child.pid");
  fs.writeFileSync(
    entryPath,
    [
      'const {spawn}=require("node:child_process");',
      'const fs=require("node:fs");',
      `const marker=${JSON.stringify(escapedMarker)};`,
      "const evidence={spawned:false,error:null};",
      'try{const child=spawn("/bin/sh",["-c","echo $$ > \\"$1\\"; sleep 60","cc-live",marker],{detached:true,stdio:"ignore"});',
      'child.once("spawn",()=>{evidence.spawned=true;child.unref()});',
      'child.once("error",(error)=>{evidence.error=error.code||error.name})}catch(error){evidence.error=error.code||error.name}',
      'setTimeout(()=>process.stdout.write(JSON.stringify({...evidence,marker:fs.existsSync(marker)})+"\\n"),500);',
    ].join(""),
    { mode: 0o600 },
  );
  const contract = normalizedCapsuleContract(capsuleRoot, entryPath);
  const { plan } = mintPlan(contract, [entryPath]);
  const child = spawnPlan(plan);
  const output = capture(child);
  const outcome = await childOutcome(child);
  if (fs.existsSync(escapedMarker)) {
    const escapedPid = Number(fs.readFileSync(escapedMarker, "utf8").trim());
    if (Number.isSafeInteger(escapedPid) && escapedPid > 1) {
      try {
        process.kill(escapedPid, "SIGKILL");
      } catch {
        // The failure below remains authoritative if it already exited.
      }
    }
  }
  assert(
    outcome.status === 0 && outcome.signal === null,
    `fork-denial target failed: ${JSON.stringify(outcome)}:${output.stderr()}`,
  );
  const evidence = JSON.parse(output.stdout().trim());
  assert(
    evidence.spawned === false &&
      (evidence.error === "EPERM" || evidence.error === "EACCES") &&
      evidence.marker === false &&
      !fs.existsSync(escapedMarker),
    `fixed profile allowed a detached descendant: ${JSON.stringify(evidence)}`,
  );
}

async function exerciseSignalFlood(capsuleRoot, entryPath) {
  const heartbeatPath = path.join(capsuleRoot, "signal-heartbeat.json");
  fs.writeFileSync(
    entryPath,
    [
      'const fs=require("node:fs");',
      "let count=0;",
      'process.on("SIGTERM",()=>{count+=1});',
      'process.on("SIGHUP",()=>{count+=1});',
      'process.stdout.write(JSON.stringify({marker:"signal",pid:process.pid})+"\\n");',
      "setInterval(()=>fs.writeFileSync(process.argv.at(-1),JSON.stringify({count,at:Date.now()})),25);",
    ].join(""),
    { mode: 0o600 },
  );
  const contract = normalizedCapsuleContract(capsuleRoot, entryPath);
  const { plan } = mintPlan(contract, [entryPath, heartbeatPath]);
  const snapshotPath = plan.runtimeProbe.runtimeLaunchPath;
  const child = spawnPlan(plan);
  const outcomePromise = childOutcome(child, 15_000);
  const target = await waitForJsonLine(child);
  for (let index = 0; index < 4096; index += 1) {
    try {
      process.kill(child.pid, index % 2 === 0 ? "SIGTERM" : "SIGHUP");
    } catch (error) {
      if (error?.code === "ESRCH") break;
      throw error;
    }
  }
  const heartbeatDeadline = Date.now() + 10_000;
  let heartbeat = null;
  while (Date.now() < heartbeatDeadline) {
    try {
      heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, "utf8"));
      if (heartbeat.count > 0) break;
    } catch {
      // The sandboxed target publishes atomically enough for the next retry.
    }
    await delay(25);
  }
  assert(
    heartbeat?.count > 0 && processAlive(child.pid) && processAlive(target.pid),
    "signal flood blocked the helper or did not reach a responsive target",
  );
  child.stdio[8].destroy();
  const outcome = await outcomePromise;
  assert(
    outcome.status !== 0 || outcome.signal !== null,
    "caller-lifeline close did not abort helper after signal flood",
  );
  await waitForProcessDeath(target.pid);
  assert(!fs.existsSync(snapshotPath), "signal flood left a runtime snapshot");
}

async function parentFixture(capsuleRoot, entryPath, statusPath) {
  const contract = normalizedCapsuleContract(capsuleRoot, entryPath);
  const { plan } = mintPlan(contract, [entryPath]);
  const child = spawnPlan(plan);
  const target = await waitForJsonLine(child);
  fs.writeFileSync(
    statusPath,
    `${JSON.stringify({
      helperPid: child.pid,
      targetPid: target.pid,
      snapshotPath: plan.runtimeProbe.runtimeLaunchPath,
    })}\n`,
    { mode: 0o600 },
  );
  await new Promise(() => {});
}

async function exerciseParentDeath(capsuleRoot, entryPath) {
  fs.writeFileSync(
    entryPath,
    'process.stdout.write(JSON.stringify({marker:"parent-death",pid:process.pid})+"\\n");setInterval(()=>{},1000);',
    { mode: 0o600 },
  );
  const statusPath = path.join(capsuleRoot, "parent-death-status.json");
  const parent = spawn(
    process.execPath,
    [process.argv[1], "--parent-fixture", capsuleRoot, entryPath, statusPath],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...safeEnvironment },
    },
  );
  const parentOutcome = childOutcome(parent, 30_000);
  const deadline = Date.now() + 20_000;
  while (!fs.existsSync(statusPath) && Date.now() < deadline) {
    if (parent.exitCode !== null || parent.signalCode !== null) {
      fail(
        `parent fixture exited before status: ${parent.exitCode}:${parent.signalCode}`,
      );
    }
    await delay(25);
  }
  assert(
    fs.existsSync(statusPath),
    "parent fixture never reached a live target",
  );
  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  parent.kill("SIGKILL");
  const killed = await parentOutcome;
  assert(
    killed.signal === "SIGKILL",
    `parent fixture was not killed: ${JSON.stringify(killed)}`,
  );
  await waitForProcessDeath(status.targetPid);
  await waitForProcessDeath(status.helperPid);
  assert(
    !fs.existsSync(status.snapshotPath),
    "caller death left a runtime snapshot",
  );
}

async function main({ signedPackage, packedRuntime }) {
  assert(
    process.platform === "darwin",
    "macOS MCP launcher live gate requires Darwin",
  );
  assert(
    process.getuid() > 0 && process.getgid() > 0,
    "live gate must run as a non-root caller",
  );
  assert(
    fs.existsSync(protocol.sandboxExecutable),
    "sandbox-exec is unavailable",
  );
  assert(
    signedPackage && fs.lstatSync(signedPackage).isFile(),
    "signed installer package is required for the lock-upgrade gate",
  );
  assert(
    packedRuntime && fs.lstatSync(packedRuntime).isFile(),
    "packed runtime fixture is required for the copied-executable gate",
  );
  verifyInstalledModes();
  const installation = verifyInstalledContractBinding();
  const probeSentinelFd9ClosedAndNoResidual =
    verifyInstalledProbeClosesInheritedSentinelFd();
  verifyInvalidDirectInvocationHasNoRootEffects();

  const createdRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-macos-mcp-live-"),
  );
  const capsuleRoot = realPath(createdRoot);
  fs.chmodSync(capsuleRoot, 0o700);
  const entryPath = path.join(capsuleRoot, "server.cjs");
  try {
    const raced = await exerciseInPlaceEntryOverwrite(capsuleRoot, entryPath);
    exerciseBindings(raced.contract, raced.args);
    await exercisePackedRuntime(capsuleRoot, entryPath, packedRuntime);
    const brokerContract = await exerciseBrokerLifecycle(
      capsuleRoot,
      entryPath,
    );
    await exerciseProcessForkDenied(brokerContract.pluginRoot, entryPath);
    await exerciseSignalFlood(brokerContract.pluginRoot, entryPath);
    await exerciseParentDeath(brokerContract.pluginRoot, entryPath);
    await exerciseLockUpgrade(
      brokerContract.pluginRoot,
      entryPath,
      signedPackage,
    );
    verifyInstalledModes();
    const installationAfterUpgrade = verifyInstalledContractBinding();
    assert(
      installationAfterUpgrade.installContractSha256 ===
        installation.installContractSha256,
      "upgrade changed the version-bound install contract",
    );
    const finalSnapshotState = sudoSnapshotState();
    assert(
      finalSnapshotState.length === 1 &&
        finalSnapshotState[0] ===
          path.join(protocol.snapshotRoot, protocol.snapshotLockName),
      "live tests left root snapshot residue",
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "chainlesschain.macos-mcp-launcher-live.v1",
          platform: process.platform,
          arch: process.arch,
          protocolSha256: MACOS_MCP_LAUNCHER_INPUTS.protocolSha256,
          sourceSha256: MACOS_MCP_LAUNCHER_INPUTS.sourceSha256,
          gateBootstrapSha256: MACOS_MCP_LAUNCHER_INPUTS.gateBootstrapSha256,
          helperSha256: sha256File(protocol.helperInstallPath),
          installContractSha256: installation.installContractSha256,
          packageIdentifier: installation.contract.packageIdentifier,
          packageVersion: installation.contract.packageVersion,
          packedRuntimeSha256: sha256File(packedRuntime),
          sandboxExecutable: protocol.sandboxExecutable,
          signedRootInstall: true,
          probeSentinelFd9ClosedAndNoResidual,
          brokerOneShotAdmission: true,
          brokerCallerLifelineRetained: true,
          parentDeathKillsTarget: true,
          processForkAndSetsidDenied: true,
          inPlaceEntryOverwriteSnapshotBound: true,
          runtimeSnapshotMutationDenied: true,
          signalFloodNonblocking: true,
          packedRuntimeNodeModeVerified: true,
          snapshotLockInodeStableAcrossUpgrade: true,
          globalSerializationStableAcrossUpgrade: true,
          gidZeroRejected: true,
          targetCredentialsDropped: true,
          targetInheritedDescriptorClosure: true,
          rootSnapshotResidue: false,
          sharedLibraryClosure: false,
          capsulePathObjectAtomic: false,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    fs.rmSync(capsuleRoot, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--parent-fixture") {
  await parentFixture(process.argv[3], process.argv[4], process.argv[5]);
} else {
  const signedPackageIndex = process.argv.indexOf("--signed-pkg");
  const packedRuntimeIndex = process.argv.indexOf("--packed-runtime");
  await main({
    signedPackage:
      signedPackageIndex >= 0 ? process.argv[signedPackageIndex + 1] : null,
    packedRuntime:
      packedRuntimeIndex >= 0 ? process.argv[packedRuntimeIndex + 1] : null,
  });
}
