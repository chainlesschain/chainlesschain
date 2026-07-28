import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { executeTool } from "../../src/runtime/agent-core.js";
import {
  executionBroker,
  SANDBOX_BOUNDARIES,
} from "../../src/lib/process-execution-broker/index.js";

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

async function warmBrokerAsyncRuntime(cwd) {
  // The credential transport Worker and the Broker's lazy Hooks v2 import
  // intentionally keep process-lifetime libuv descriptors. Establish those
  // host-runtime descriptors before measuring per-launch FD ownership. Keep
  // the warmup explicitly unsandboxed so a first-use sandbox leak can never
  // be absorbed into the baseline.
  await executionBroker._credentialAgent.waitForTransportReady();
  const previousStrict = process.env.CC_SANDBOX_STRICT;
  const previousDisable = process.env.CC_SANDBOX_DISABLE;
  try {
    delete process.env.CC_SANDBOX_STRICT;
    process.env.CC_SANDBOX_DISABLE = "1";
    const child = executionBroker.spawn(process.execPath, ["-e", ""], {
      cwd,
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
      origin: "test:linux-live-fd-baseline-warmup",
      scope: "sandbox-test",
      policy: "allow",
    });
    const [code, signal] = await once(child, "close");
    if (code !== 0 || signal !== null) {
      throw new Error(
        `Broker FD baseline warmup failed: code=${String(code)} signal=${String(signal)}`,
      );
    }
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

  const planArgs = Array.isArray(plan.args) ? plan.args : [];
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
  const descriptorChildFds = [];
  for (let index = 0; index < planArgs.length; index += 1) {
    if (
      planArgs[index] === "--ro-bind-fd" ||
      planArgs[index] === "--ro-bind-data" ||
      planArgs[index] === "--seccomp"
    ) {
      descriptorChildFds.push(Number(planArgs[index + 1]));
    }
  }

  return {
    command: plan.command,
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
    descriptorChildFds,
  };
}

async function executeWithSupervisorPlan(execute) {
  const originalApplySandbox = executionBroker._sandboxAdapter.applySandbox;
  let supervisorPlan = null;
  executionBroker._sandboxAdapter.applySandbox = (...adapterArgs) => {
    const plan = originalApplySandbox(...adapterArgs);
    supervisorPlan = summarizeLinuxSupervisorPlan(plan) || supervisorPlan;
    return plan;
  };
  try {
    return {
      result: await execute(),
      supervisorPlan,
    };
  } finally {
    executionBroker._sandboxAdapter.applySandbox = originalApplySandbox;
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
  await new Promise((resolve) => setTimeout(resolve, 20));
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
    finalFdGrowth: positiveFdGrowth(beforeFds, fdTargetCounts()),
    supervisorPlan,
    audit: executionBroker.getAuditLog(1)[0] || null,
  });
} else if (mode === "plugin-command-snapshot-race") {
  const request = JSON.parse(extra);
  const originalApplySandbox = executionBroker._sandboxAdapter.applySandbox;
  let mutation = null;
  let entryBindings = null;
  let dependencyMutation = null;
  let dependencyBindings = null;
  let runtimeBindings = null;
  let pluginFileBindings = null;
  let supervisorPlan = null;
  let mutated = false;
  executionBroker._sandboxAdapter.applySandbox = (...adapterArgs) => {
    const plan = originalApplySandbox(...adapterArgs);
    supervisorPlan = summarizeLinuxSupervisorPlan(plan) || supervisorPlan;
    if (mutated) return plan;
    mutated = true;
    try {
      const planArgs = Array.isArray(plan?.args) ? plan.args : [];
      pluginFileBindings = summarizePluginFileBindings(planArgs);
      entryBindings = summarizeDestinationBindings(
        planArgs,
        request.destination,
      );
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

      mutation = rewriteSameInode(request.entryPath, request.replacementPath);
      if (request.dependencyPath && request.dependencyReplacementPath) {
        dependencyMutation = rewriteSameInode(
          request.dependencyPath,
          request.dependencyReplacementPath,
        );
      }
      return plan;
    } catch (error) {
      plan?.cleanup?.();
      throw error;
    }
  };
  let result;
  try {
    result = await executeTool(
      "run_shell",
      { command: request.command },
      { cwd: value },
    );
  } finally {
    executionBroker._sandboxAdapter.applySandbox = originalApplySandbox;
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
