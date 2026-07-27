import crypto from "node:crypto";
import fs from "node:fs";
import { executeTool } from "../../src/runtime/agent-core.js";
import {
  executionBroker,
  SANDBOX_BOUNDARIES,
} from "../../src/lib/process-execution-broker/index.js";

const [mode, value, extra] = process.argv.slice(2);

function writeResult(result) {
  process.stdout.write(JSON.stringify(result));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

executionBroker.flushAuditLog();

if (mode === "positive") {
  const result = await executeTool(
    "run_shell",
    { command: "strict-live config.json" },
    { cwd: value },
  );
  writeResult({
    result,
    audit: executionBroker.getAuditLog(1)[0] || null,
  });
} else if (mode === "plugin-command") {
  const result = await executeTool(
    "run_shell",
    { command: extra },
    { cwd: value },
  );
  writeResult({
    result,
    audit: executionBroker.getAuditLog(1)[0] || null,
  });
} else if (mode === "plugin-command-snapshot-race") {
  const request = JSON.parse(extra);
  const originalApplySandbox = executionBroker._sandboxAdapter.applySandbox;
  let mutation = null;
  let entryBindings = null;
  let mutated = false;
  executionBroker._sandboxAdapter.applySandbox = (...adapterArgs) => {
    const plan = originalApplySandbox(...adapterArgs);
    if (mutated) return plan;
    mutated = true;
    try {
      const planArgs = Array.isArray(plan?.args) ? plan.args : [];
      const roBindData = [];
      const roBindFd = [];
      for (let index = 0; index < planArgs.length; index += 1) {
        if (
          planArgs[index] === "--ro-bind-data" &&
          planArgs[index + 2] === request.destination
        ) {
          roBindData.push({
            childFd: planArgs[index + 1],
            permissions:
              planArgs[index - 2] === "--perms" ? planArgs[index - 1] : null,
          });
        }
        if (
          planArgs[index] === "--ro-bind-fd" &&
          planArgs[index + 2] === request.destination
        ) {
          roBindFd.push({ childFd: planArgs[index + 1] });
        }
      }
      entryBindings = {
        destination: request.destination,
        roBindData,
        roBindFd,
      };

      const replacement = fs.readFileSync(request.replacementPath);
      const before = fs.statSync(request.entryPath, { bigint: true });
      const beforeSha256 = sha256(fs.readFileSync(request.entryPath));
      const fd = fs.openSync(request.entryPath, "r+");
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
          if (written <= 0)
            throw new Error("native race write made no progress");
          offset += written;
        }
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      const after = fs.statSync(request.entryPath, { bigint: true });
      mutation = {
        sameDevice: String(before.dev) === String(after.dev),
        sameInode: String(before.ino) === String(after.ino),
        beforeSha256,
        afterSha256: sha256(fs.readFileSync(request.entryPath)),
        replacementSha256: sha256(replacement),
      };
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
