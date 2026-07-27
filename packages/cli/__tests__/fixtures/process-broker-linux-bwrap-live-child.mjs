import crypto from "node:crypto";
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
