import crypto from "node:crypto";
import {
  spawn as nativeSpawn,
  spawnSync as nativeSpawnSync,
} from "node:child_process";
import fs from "node:fs";
import { executeTool } from "../../src/runtime/agent-core.js";
import {
  executionBroker,
  SANDBOX_BOUNDARIES,
} from "../../src/lib/process-execution-broker/index.js";
import { parseLinuxBwrapDescriptorScrubbedLaunch } from "../../src/lib/process-execution-broker/linux-bwrap-descriptor-launch.js";

const [mode, value, extra] = process.argv.slice(2);
const BWRAP_SUPERVISOR_CHILD_FD = 3;
const BWRAP_SUPERVISOR_STAGING_PATH = "/run/.chainless-bwrap-supervisor";

function writeResult(result) {
  process.stdout.write(JSON.stringify(result));
}

function fdTargetCounts() {
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
}

function positiveFdGrowth(before, after) {
  return [...after.entries()]
    .filter(([, count]) => count > 0)
    .map(([target, count]) => ({
      target,
      count: count - (before.get(target) || 0),
    }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => left.target.localeCompare(right.target));
}

async function waitForFdGrowthToClear(before, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let growth = positiveFdGrowth(before, fdTargetCounts());
  while (growth.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    growth = positiveFdGrowth(before, fdTargetCounts());
  }
  return growth;
}

async function warmBrokerAsyncRuntime(cwd) {
  // The credential transport Worker, the Broker's lazy Hooks v2 import, and
  // the first piped async child intentionally establish process-lifetime
  // libuv descriptors. Establish those host-runtime descriptors before
  // measuring per-launch FD ownership. Keep the warmup explicitly unsandboxed
  // so a first-use sandbox leak can never be absorbed into the baseline.
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function ambientDescriptorEvidence() {
  const rawFd = process.env.CC_TEST_AMBIENT_SENTINEL_FD;
  const expectedPath = process.env.CC_TEST_AMBIENT_SENTINEL_PATH;
  if (rawFd === undefined && expectedPath === undefined) return null;
  const childFd = Number(rawFd);
  if (
    !/^[1-9]\d*$/.test(rawFd || "") ||
    !Number.isSafeInteger(childFd) ||
    childFd < 3 ||
    typeof expectedPath !== "string" ||
    !pathIsAbsolute(expectedPath)
  ) {
    return {
      childFd: Number.isSafeInteger(childFd) ? childFd : null,
      openBeforeLaunch: false,
      targetMatchesSentinel: false,
      reason: "ambient_descriptor_contract_invalid",
    };
  }
  try {
    const expectedTarget = fs.realpathSync(expectedPath);
    const target = fs.readlinkSync(`/proc/self/fd/${childFd}`);
    const stat = fs.fstatSync(childFd);
    return {
      childFd,
      openBeforeLaunch: true,
      target,
      expectedTarget,
      targetMatchesSentinel: target === expectedTarget,
      isFifo: stat.isFIFO(),
      reason: null,
    };
  } catch (error) {
    return {
      childFd,
      openBeforeLaunch: false,
      targetMatchesSentinel: false,
      reason: error?.code || error?.message || "ambient_descriptor_unavailable",
    };
  }
}

function pathIsAbsolute(value) {
  return typeof value === "string" && value.startsWith("/");
}

function hostDescendants(rootPid) {
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
}

function hostProcessExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForHostProcessExit(pid, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (hostProcessExists(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

async function waitForGenericGrandchild(wrapperPid, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const descendants = hostDescendants(wrapperPid);
    for (const pid of descendants) {
      try {
        const commandLine = fs
          .readFileSync(`/proc/${pid}/cmdline`)
          .toString("utf8")
          .replaceAll("\0", " ");
        if (
          commandLine.includes("verify-tree-termination.sh") &&
          commandLine.includes("grandchild")
        ) {
          return { grandchildHostPid: pid, descendantHostPids: descendants };
        }
      } catch {
        // Retry while the sandbox process tree is stabilizing.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("generic grandchild host process was not found");
}

function summarizeDestinationBindings(planArgs, destination) {
  const roBindData = [];
  const roBindFd = [];
  for (let index = 0; index < planArgs.length; index += 1) {
    if (
      planArgs[index] === "--ro-bind-data" &&
      planArgs[index + 2] === destination
    ) {
      roBindData.push({
        childFd: planArgs[index + 1],
        permissions:
          planArgs[index - 2] === "--perms" ? planArgs[index - 1] : null,
      });
    }
    if (
      planArgs[index] === "--ro-bind-fd" &&
      planArgs[index + 2] === destination
    ) {
      roBindFd.push({ childFd: planArgs[index + 1] });
    }
  }
  return { destination, roBindData, roBindFd };
}

function summarizePluginFileBindings(planArgs) {
  const destinations = new Set();
  for (let index = 0; index < planArgs.length; index += 1) {
    if (
      (planArgs[index] === "--ro-bind-data" ||
        planArgs[index] === "--ro-bind-fd") &&
      typeof planArgs[index + 2] === "string" &&
      planArgs[index + 2].startsWith("/opt/chainless/plugin/")
    ) {
      destinations.add(planArgs[index + 2]);
    }
  }
  return [...destinations]
    .sort((left, right) => left.localeCompare(right))
    .map((destination) => summarizeDestinationBindings(planArgs, destination));
}

function rewriteSameInode(filePath, replacementPath) {
  const replacement = fs.readFileSync(replacementPath);
  const before = fs.statSync(filePath, { bigint: true });
  const beforeSha256 = sha256(fs.readFileSync(filePath));
  const fd = fs.openSync(filePath, "r+");
  try {
    fs.ftruncateSync(fd, 0);
    let offset = 0;
    while (offset < replacement.length) {
      const written = fs.writeSync(
        fd,
        replacement,
        offset,
        replacement.length - offset,
        offset,
      );
      if (written <= 0) throw new Error("snapshot race write made no progress");
      offset += written;
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const after = fs.statSync(filePath, { bigint: true });
  return {
    sameDevice: String(before.dev) === String(after.dev),
    sameInode: String(before.ino) === String(after.ino),
    beforeSha256,
    afterSha256: sha256(fs.readFileSync(filePath)),
    replacementSha256: sha256(replacement),
  };
}

function summarizeLinuxSupervisorPlan(plan) {
  if (plan?.backend !== "linux-bwrap") return null;

  const descriptorLaunch = parseLinuxBwrapDescriptorScrubbedLaunch(
    plan.command,
    plan.args,
    plan.options,
  );
  if (!descriptorLaunch) return null;
  const planArgs = descriptorLaunch.executableArgs;
  const stdio = Array.isArray(plan.options?.stdio) ? plan.options.stdio : [];
  const supervisorFileIndex = planArgs.findIndex(
    (argument, index) =>
      argument === "--file" &&
      planArgs[index + 1] === String(BWRAP_SUPERVISOR_CHILD_FD) &&
      planArgs[index + 2] === BWRAP_SUPERVISOR_STAGING_PATH,
  );
  const runDirectoryIndex = planArgs.findIndex(
    (argument, index) => argument === "--dir" && planArgs[index + 1] === "/run",
  );
  const runTmpfsIndex = planArgs.findIndex(
    (argument, index) =>
      argument === "--tmpfs" && planArgs[index + 1] === "/run",
  );
  const tmpfsTargets = [];
  const remountReadOnlyTargets = [];
  const descriptorChildFds = [];
  for (let index = 0; index < planArgs.length; index += 1) {
    if (planArgs[index] === "--tmpfs") {
      tmpfsTargets.push(planArgs[index + 1]);
    }
    if (planArgs[index] === "--remount-ro") {
      remountReadOnlyTargets.push(planArgs[index + 1]);
    }
    if (
      planArgs[index] === "--ro-bind-fd" ||
      planArgs[index] === "--ro-bind-data" ||
      planArgs[index] === "--seccomp"
    ) {
      descriptorChildFds.push(Number(planArgs[index + 1]));
    }
  }

  return {
    rawScrubberCommand: plan.command,
    logicalBwrapCommand: descriptorLaunch
      ? `/proc/self/fd/${descriptorLaunch.executableChildFd}`
      : null,
    descriptorScrubberLayout: descriptorLaunch
      ? {
          scrubberChildFd: descriptorLaunch.scrubberChildFd,
          preservedMaxFd: descriptorLaunch.preservedMaxFd,
          activeStdioThrough: descriptorLaunch.activeStdioThrough,
          executableChildFd: descriptorLaunch.executableChildFd,
          rawCommandMatchesLayout:
            plan.command ===
            `/proc/self/fd/${descriptorLaunch.scrubberChildFd}`,
          scrubberChildFdMapped: Number.isInteger(
            stdio[descriptorLaunch.scrubberChildFd],
          ),
        }
      : null,
    childFd3Mapped: Number.isInteger(stdio[BWRAP_SUPERVISOR_CHILD_FD]),
    supervisorFile: {
      index: supervisorFileIndex,
      childFd:
        supervisorFileIndex >= 0 ? planArgs[supervisorFileIndex + 1] : null,
      destination:
        supervisorFileIndex >= 0 ? planArgs[supervisorFileIndex + 2] : null,
      permissions:
        supervisorFileIndex >= 2 &&
        planArgs[supervisorFileIndex - 2] === "--perms"
          ? planArgs[supervisorFileIndex - 1]
          : null,
    },
    runDirectoryIndex,
    runTmpfsIndex,
    tmpfsTargets,
    remountReadOnlyTargets,
    procMounted: planArgs.includes("--proc"),
    devMounted: planArgs.includes("--dev"),
    descriptorChildFds,
    maxDescriptorChildFd:
      descriptorChildFds.length > 0 ? Math.max(...descriptorChildFds) : null,
  };
}

async function executeWithSupervisorPlan(execute) {
  const originalNative = executionBroker._native;
  const underlyingSpawn = originalNative?.spawn || nativeSpawn;
  const underlyingSpawnSync = originalNative?.spawnSync || nativeSpawnSync;
  let supervisorPlan = null;
  const capturePlan = (command, args, options) => {
    const summary = summarizeLinuxSupervisorPlan({
      backend: "linux-bwrap",
      command,
      args,
      options,
    });
    if (!summary) throw new Error("final_descriptor_launch_unparseable");
    supervisorPlan = summary;
  };
  executionBroker._native = {
    ...(originalNative || {}),
    spawn(command, args, options) {
      capturePlan(command, args, options);
      return underlyingSpawn(command, args, options);
    },
    spawnSync(command, args, options) {
      capturePlan(command, args, options);
      return underlyingSpawnSync(command, args, options);
    },
  };
  try {
    return {
      result: await execute(),
      supervisorPlan,
    };
  } finally {
    executionBroker._native = originalNative;
  }
}

executionBroker.flushAuditLog();

if (mode === "positive") {
  const { result, supervisorPlan } = await executeWithSupervisorPlan(() =>
    executeTool(
      "run_shell",
      { command: "strict-live config.json" },
      { cwd: value },
    ),
  );
  writeResult({
    result,
    supervisorPlan,
    audit: executionBroker.getAuditLog(1)[0] || null,
  });
} else if (mode === "plugin-command") {
  const { result, supervisorPlan } = await executeWithSupervisorPlan(() =>
    executeTool("run_shell", { command: extra }, { cwd: value }),
  );
  writeResult({
    result,
    supervisorPlan,
    audit: executionBroker.getAuditLog(1)[0] || null,
  });
} else if (mode === "plugin-command-background") {
  await warmBrokerAsyncRuntime(value);
  const beforeFds = fdTargetCounts();
  const { result: launch, supervisorPlan } = await executeWithSupervisorPlan(
    () =>
      executeTool(
        "run_shell",
        { command: extra, run_in_background: true },
        { cwd: value },
      ),
  );
  let completion = null;
  let stdout = "";
  let stderr = "";
  let activeStatus = null;
  let activeFdGrowth = null;
  let activeDescendantHostPids = [];
  let killRequested = false;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    completion = await executeTool(
      "check_shell",
      { task_id: launch.task_id },
      {},
    );
    stdout += completion.stdout || "";
    stderr += completion.stderr || "";
    if (
      activeFdGrowth === null &&
      completion.status === "running" &&
      stdout.length > 0
    ) {
      activeStatus = completion.status;
      activeFdGrowth = positiveFdGrowth(beforeFds, fdTargetCounts());
      const activeAudit = executionBroker.getAuditLog(1)[0] || null;
      activeDescendantHostPids = Number.isSafeInteger(activeAudit?.pid)
        ? hostDescendants(activeAudit.pid)
        : [];
      const killed = await executeTool(
        "check_shell",
        { task_id: launch.task_id, kill: true },
        {},
      );
      stdout += killed.stdout || "";
      stderr += killed.stderr || "";
      completion = killed;
      killRequested = killed.killed === true;
    }
    if (completion.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const descendantExitResults = await Promise.all(
    activeDescendantHostPids.map((pid) => waitForHostProcessExit(pid)),
  );
  const finalFdGrowth = await waitForFdGrowthToClear(beforeFds);
  writeResult({
    launch,
    completion: completion ? { ...completion, stdout, stderr } : null,
    activeStatus,
    activeFdGrowth,
    activeDescendantHostPids,
    killRequested,
    survivingDescendantHostPids: activeDescendantHostPids.filter(
      (_pid, index) => descendantExitResults[index] !== true,
    ),
    finalFdGrowth,
    supervisorPlan,
    audit: executionBroker.getAuditLog(1)[0] || null,
  });
} else if (mode === "plugin-command-snapshot-race") {
  const request = JSON.parse(extra);
  const ambientDescriptorBeforeLaunch = ambientDescriptorEvidence();
  const originalNative = executionBroker._native;
  const underlyingSpawn = originalNative?.spawn || nativeSpawn;
  const underlyingSpawnSync = originalNative?.spawnSync || nativeSpawnSync;
  let mutation = null;
  let entryBindings = null;
  let dependencyMutation = null;
  let dependencyBindings = null;
  let runtimeBindings = null;
  let pluginFileBindings = null;
  let supervisorPlan = null;
  let mutationPhase = null;
  let mutationLaunchBinding = null;
  let mutated = false;
  const captureFinalLaunchAndMutate = (command, args, options) => {
    const observedPlan = {
      backend: "linux-bwrap",
      command,
      args,
      options,
    };
    const observedSupervisorPlan = summarizeLinuxSupervisorPlan(observedPlan);
    if (!observedSupervisorPlan) {
      throw new Error("final_descriptor_launch_unparseable");
    }
    supervisorPlan = observedSupervisorPlan;
    const descriptorLaunch = parseLinuxBwrapDescriptorScrubbedLaunch(
      command,
      args,
      options,
    );
    const planArgs = descriptorLaunch?.executableArgs || [];
    pluginFileBindings = summarizePluginFileBindings(planArgs);
    entryBindings = summarizeDestinationBindings(planArgs, request.destination);
    if (request.dependencyDestination) {
      dependencyBindings = summarizeDestinationBindings(
        planArgs,
        request.dependencyDestination,
      );
    }
    if (request.runtimeDestination) {
      runtimeBindings = summarizeDestinationBindings(
        planArgs,
        request.runtimeDestination,
      );
    }
    const launchArgs = Array.isArray(args) ? args : [];
    if (!mutated) {
      mutated = true;
      mutationPhase = "after-broker-plan-admission-before-native-spawn";
      mutationLaunchBinding = {
        commandMatchesPlan: true,
        argsMatchPlan: true,
      };
      // ProcessExecutionBroker invokes its native launch only after
      // _prepareSandboxPlan has validated the adapter plan. Mutating here
      // therefore proves that both the entry and dependency bytes remain
      // descriptor-pinned across the final admission-to-launch window.
      mutation = rewriteSameInode(request.entryPath, request.replacementPath);
      if (request.dependencyPath && request.dependencyReplacementPath) {
        dependencyMutation = rewriteSameInode(
          request.dependencyPath,
          request.dependencyReplacementPath,
        );
      }
    }
    return launchArgs;
  };
  executionBroker._native = {
    ...(originalNative || {}),
    spawn(command, args, options) {
      return underlyingSpawn(
        command,
        captureFinalLaunchAndMutate(command, args, options),
        options,
      );
    },
    spawnSync(command, args, options) {
      return underlyingSpawnSync(
        command,
        captureFinalLaunchAndMutate(command, args, options),
        options,
      );
    },
  };
  let result;
  try {
    result = await executeTool(
      "run_shell",
      { command: request.command },
      { cwd: value },
    );
  } finally {
    executionBroker._native = originalNative;
  }
  writeResult({
    result,
    mutation,
    entryBindings,
    dependencyMutation,
    dependencyBindings,
    runtimeBindings,
    pluginFileBindings,
    supervisorPlan,
    ambientDescriptorBeforeLaunch,
    mutationPhase,
    mutationLaunchBinding,
    audit: executionBroker.getAuditLog(1)[0] || null,
  });
} else if (mode === "generic-fd-scrub") {
  const ambientDescriptorBeforeLaunch = ambientDescriptorEvidence();
  const command = "/usr/bin/python3";
  const args = [
    "-I",
    "-S",
    "-c",
    [
      "import json, os",
      "fds = []",
      "for entry in os.listdir('/proc/self/fd'):",
      " try:",
      "  fd = int(entry)",
      "  if fd <= 2: continue",
      "  os.fstat(fd)",
      " except (OSError, ValueError):",
      "  continue",
      " fds.append(fd)",
      "print(json.dumps({'fds': sorted(fds), 'nonStdioOpenFds': len(fds)}, sort_keys=True), end='')",
    ].join("\n"),
  ];
  const options = {
    cwd: value,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    origin: "test:linux-generic-fd-scrub-live",
    scope: "sandbox-test",
    policy: "allow",
    timeout: 120_000,
    sandboxPolicy: {
      profile: "strict",
      requiredBoundaries: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
    },
  };
  const contract = executionBroker.issueLinuxWorkspaceSandboxExecutionContract(
    command,
    args,
    options,
    value,
    { sync: true },
  );
  const originalNative = executionBroker._native;
  const underlyingSpawnSync = originalNative?.spawnSync || nativeSpawnSync;
  let descriptorPlan = null;
  executionBroker._native = {
    ...(originalNative || {}),
    spawnSync(command, launchArgs, launchOptions) {
      const launch = parseLinuxBwrapDescriptorScrubbedLaunch(
        command,
        launchArgs,
        launchOptions,
        { activeStdioThrough: 2 },
      );
      if (!launch) throw new Error("final_descriptor_launch_unparseable");
      descriptorPlan = {
        rawScrubberCommand: command,
        logicalBwrapCommand: `/proc/self/fd/${launch.executableChildFd}`,
        scrubberChildFd: launch.scrubberChildFd,
        preservedMaxFd: launch.preservedMaxFd,
        activeStdioThrough: launch.activeStdioThrough,
        executableChildFd: launch.executableChildFd,
        rawCommandMatchesLayout:
          command === `/proc/self/fd/${launch.scrubberChildFd}`,
      };
      return underlyingSpawnSync(command, launchArgs, launchOptions);
    },
  };
  let result;
  try {
    result = executionBroker.spawnSync(command, args, {
      ...options,
      sandboxExecutionContract: contract,
    });
  } finally {
    executionBroker._native = originalNative;
  }
  writeResult({
    ambientDescriptorBeforeLaunch,
    descriptorPlan,
    result: {
      status: result?.status ?? null,
      signal: result?.signal ?? null,
      error: result?.error?.message || null,
      stdout: String(result?.stdout || ""),
      stderr: String(result?.stderr || ""),
    },
    audit: executionBroker.getAuditLog(1)[0] || null,
  });
} else if (mode === "generic-parent-exit") {
  const request = JSON.parse(extra);
  const command = "/bin/sh";
  const args = [request.scriptPath, request.pidMarker];
  const options = {
    cwd: value,
    shell: false,
    stdio: ["ignore", "ignore", "ignore"],
    origin: "test:linux-generic-parent-exit-live",
    scope: "sandbox-test",
    policy: "allow",
    timeout: 120_000,
    sandboxPolicy: {
      profile: "strict",
      requiredBoundaries: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
    },
  };
  const contract = executionBroker.issueLinuxWorkspaceSandboxExecutionContract(
    command,
    args,
    options,
    value,
  );
  const child = executionBroker.spawn(command, args, {
    ...options,
    sandboxExecutionContract: contract,
  });
  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(request.pidMarker)) {
    if (Date.now() >= deadline) {
      throw new Error("generic grandchild did not publish its host pid");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const { grandchildHostPid, descendantHostPids } =
    await waitForGenericGrandchild(child.pid);
  fs.writeSync(
    1,
    JSON.stringify({
      wrapperPid: child.pid,
      grandchildHostPid,
      descendantHostPids,
    }),
  );
  process.exit(0);
} else if (mode === "missing-contract") {
  let error = null;
  try {
    executionBroker.spawnSync(
      process.execPath,
      [
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(
          value,
        )}, "target-started")`,
      ],
      {
        origin: "test:linux-bwrap-missing-contract-live",
        scope: "sandbox-test",
        policy: "allow",
        shell: false,
        timeout: 30_000,
        sandboxPolicy: {
          profile: "strict",
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
        },
      },
    );
  } catch (caught) {
    error = {
      code: caught?.code || null,
      sandboxReason: caught?.sandboxReason || null,
      sandboxCandidateBackend: caught?.sandboxCandidateBackend || null,
      sandboxCandidateReason: caught?.sandboxCandidateReason || null,
      sandboxPolicyAttested: caught?.sandboxPolicyAttested ?? null,
      actualGuarantees: caught?.actualGuarantees || [],
      missingBoundaries: caught?.missingBoundaries || [],
    };
  }
  writeResult({
    error,
    audit: executionBroker.getAuditLog(1)[0] || null,
  });
} else {
  throw new Error(`unknown live child mode: ${String(mode)}`);
}
