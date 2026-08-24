/**
 * shell-approval — compose the existing shell policy ruleset with session-core
 * ApprovalGate.
 *
 * Managed Agents parity Phase G item #3: `evaluateShellCommandPolicy` returns a
 * hard allow/deny/warn on rule patterns, but we also want per-session policy
 * tiers (strict / trusted / autopilot) and a confirm() hook before medium/high
 * risk commands actually run.
 *
 * Mapping:
 *   shell decision DENY  → risk HIGH  (still rejected outright even before
 *                                      policy — hard-denied rules are always
 *                                      unsafe)
 *   shell decision WARN  → risk MEDIUM
 *   shell decision ALLOW → risk LOW
 *   shell decision REROUTE → risk HIGH (rerouted, never actually executed)
 *
 * Returns a uniform shape `{ allowed, decision, via, reason, shellPolicy,
 * riskLevel, policy }` so callers don't have to juggle two decision types.
 */

import sharedShellPolicy from "../runtime/coding-agent-shell-policy.cjs";
import {
  APPROVAL_RISK as RISK,
  APPROVAL_DECISION as DECISION,
} from "@chainlesschain/session-core";
import {
  classifyCodeAcquisition,
  hasGlobalInstall,
  applyRiskFloor,
  recordInstallCommandAudit,
  resolveInstallPolicy,
} from "./install-command-policy.js";

const SHELL_EXECUTION_DESCRIPTOR_VERSION =
  "chainlesschain.shell-execution-descriptor/v1";

function deepFreezeData(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreezeData(child, seen);
  return Object.freeze(value);
}

function cloneData(value, label) {
  try {
    return structuredClone(value);
  } catch (cause) {
    throw new Error(`${label} must be structured-cloneable`, { cause });
  }
}

/** Capture only the declared run_shell data contract and freeze it. */
export function snapshotShellExecutionArgs(args = {}, fallbackCommand = null) {
  const source = args && typeof args === "object" ? args : {};
  const snapshot = {
    command:
      source.command !== undefined
        ? cloneData(source.command, "command")
        : cloneData(fallbackCommand ?? null, "command"),
  };
  for (const key of ["cwd", "shell", "run_in_background", "timeout"]) {
    if (source[key] !== undefined) snapshot[key] = cloneData(source[key], key);
  }
  return deepFreezeData(snapshot);
}

/**
 * Build the bounded, secret-free data tuple shown to ApprovalGate and later
 * consumed at dispatch. Runtime objects/callbacks never enter this descriptor.
 */
export function createShellExecutionDescriptor({
  args,
  workspace = null,
  shellInvocation = null,
  pluginInvocation = null,
  pluginSandboxPolicy = null,
  pluginSandboxExecutionContract = null,
  sandbox = null,
  environmentRef = null,
} = {}) {
  const shellArgs = snapshotShellExecutionArgs(args);
  const descriptor = {
    ...shellArgs,
    execution: {
      version: SHELL_EXECUTION_DESCRIPTOR_VERSION,
      mode: shellArgs.run_in_background === true ? "background" : "foreground",
      workspace: workspace || null,
      shell: shellInvocation
        ? {
            kind: shellInvocation.kind || null,
            useDefaultShell: shellInvocation.useDefaultShell === true,
            file: shellInvocation.file || null,
            argv: Array.isArray(shellInvocation.argv)
              ? [...shellInvocation.argv]
              : [],
          }
        : null,
      plugin: pluginInvocation
        ? {
            command: pluginInvocation.command || null,
            id: pluginInvocation.pluginId || null,
            version: pluginInvocation.pluginVersion || null,
            source: pluginInvocation.pluginSource || null,
            bin: pluginInvocation.binName || null,
            path: pluginInvocation.binPath || null,
            runtime: pluginInvocation.runtime || null,
            argv: Array.isArray(pluginInvocation.args)
              ? [...pluginInvocation.args]
              : [],
            executableSha256:
              pluginInvocation.executableIdentity?.sha256 || null,
            sandboxPolicy: pluginSandboxPolicy
              ? cloneData(pluginSandboxPolicy, "pluginSandboxPolicy")
              : null,
            sandboxExecution: pluginSandboxExecutionContract
              ? {
                  version:
                    pluginSandboxExecutionContract.contractVersion || null,
                  kind: pluginSandboxExecutionContract.kind || null,
                  pluginRoot: pluginSandboxExecutionContract.pluginRoot || null,
                  workingDirectory:
                    pluginSandboxExecutionContract.workingDirectory || null,
                  runtimePath:
                    pluginSandboxExecutionContract.runtimePath || null,
                  entrySha256:
                    pluginSandboxExecutionContract.entryIdentity?.sha256 ||
                    null,
                  runtimeSha256:
                    pluginSandboxExecutionContract.runtimeIdentity?.sha256 ||
                    null,
                }
              : null,
          }
        : null,
      sandbox: sandbox ? cloneData(sandbox, "sandbox") : null,
      environment: environmentRef
        ? cloneData(environmentRef, "environmentRef")
        : null,
    },
  };
  return deepFreezeData(descriptor);
}

export function shellApprovalAction(riskLevel) {
  return riskLevel ? `${riskLevel}-risk` : null;
}

export function commitShellApprovalSideEffects(result) {
  const audit = result?.installAudit || null;
  if (!audit) return false;
  recordInstallCommandAudit(audit.entry, audit.options || {});
  return true;
}

export const SHELL_TO_RISK = {
  allow: RISK.LOW,
  warn: RISK.MEDIUM,
  deny: RISK.HIGH,
  reroute: RISK.HIGH,
};

export async function evaluateShellCommandWithApproval({
  command,
  args = null,
  sessionId = null,
  approvalGate = null,
  shellPolicyOptions = {},
  installPolicy = null,
  workspace = null,
  targetEnv = null,
  policyEnv = process.env,
  policyVersion = null,
  deferSideEffects = false,
} = {}) {
  const shellPolicy = sharedShellPolicy.evaluateShellCommandPolicy(
    command,
    shellPolicyOptions,
  );

  let riskLevel = SHELL_TO_RISK[shellPolicy.decision] || RISK.MEDIUM;

  // Unified install-command classification (OPT-IN via installPolicy). A package
  // install (npm/pip/winget/brew/…) fetches and runs third-party code, so it is
  // a distinct, auditable permission type regardless of which tool does it. When
  // a riskFloor is configured it RAISES (never lowers) the risk before gating;
  // audit records the attempt. Absent/disabled → nothing runs, byte-unchanged.
  // Explicit policy wins; otherwise self-activate from env (CC_INSTALL_AUDIT /
  // CC_INSTALL_RISK_FLOOR) so the real run_shell path picks it up with no extra
  // wiring. Both unset → disabled → the block below is skipped, byte-unchanged.
  const effectiveInstallPolicy =
    installPolicy || resolveInstallPolicy({ env: policyEnv });
  let install = null;
  let installAudit = null;
  if (effectiveInstallPolicy && effectiveInstallPolicy.enabled) {
    const cls = classifyCodeAcquisition(command);
    if (cls.flagged) {
      install = cls;
      if (effectiveInstallPolicy.riskFloor) {
        riskLevel = applyRiskFloor(riskLevel, effectiveInstallPolicy.riskFloor);
      }
      if (effectiveInstallPolicy.audit) {
        installAudit = {
          entry: {
            command,
            shellDecision: shellPolicy.decision,
            riskLevel,
            installs: cls.installs,
            remoteExec: cls.remoteExec,
            global: hasGlobalInstall(cls),
            sessionId,
          },
          options: effectiveInstallPolicy.auditOpts || {},
        };
        if (!deferSideEffects) {
          recordInstallCommandAudit(installAudit.entry, installAudit.options);
          installAudit = null;
        }
      }
    }
  }

  // Hard-blocked rules bypass the gate entirely — the gate tier cannot
  // up-authorize them.
  if (!shellPolicy.allowed) {
    return {
      allowed: false,
      decision: DECISION.DENY,
      via: "shell-policy",
      reason: shellPolicy.reason,
      shellPolicy,
      riskLevel,
      policy: null,
      install,
      installAudit,
    };
  }

  // A missing gate is an unavailable security boundary, not an implicit
  // authorization. Explicit bypass modes must provide their own auditable
  // gate implementation instead of omitting the gate.
  if (!approvalGate || typeof approvalGate.decide !== "function") {
    return {
      allowed: false,
      decision: DECISION.DENY,
      via: "approval-gate-unavailable",
      reason: "Approval gate is unavailable",
      shellPolicy,
      riskLevel,
      policy: null,
      install,
      installAudit,
    };
  }

  const operationArgs = args
    ? Object.isFrozen(args)
      ? args
      : deepFreezeData(cloneData(args, "run_shell approval args"))
    : snapshotShellExecutionArgs({ command });
  const effectivePolicyVersion =
    typeof policyVersion === "string" && policyVersion
      ? policyVersion
      : `shell-policy:${shellPolicy.decision}:${shellPolicy.ruleId || "none"}`;
  const action = shellApprovalAction(riskLevel);
  const gateResult = await approvalGate.decide({
    sessionId,
    riskLevel,
    tool: "run_shell",
    args: operationArgs,
    cwd: workspace,
    targetEnv,
    policyVersion: effectivePolicyVersion,
    action,
  });

  return {
    allowed: gateResult.decision === DECISION.ALLOW,
    decision: gateResult.decision,
    via: gateResult.via,
    reason: shellPolicy.reason,
    shellPolicy,
    riskLevel,
    policy: gateResult.policy,
    install,
    installAudit,
    authorization: gateResult.authorization || null,
    authorizationContext: gateResult.authorization
      ? {
          tool: "run_shell",
          action,
          args: operationArgs,
          workspace,
          session: sessionId,
          targetEnv,
          policyVersion: effectivePolicyVersion,
        }
      : null,
    // Explainability passthrough (autoMode.decisions wrapper attaches these):
    // which gate rule fired and why — surfaced in the permission chain.
    gateReason: gateResult.reason ?? null,
    gateRule: gateResult.rule ?? null,
  };
}
