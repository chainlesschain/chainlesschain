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

export const SHELL_TO_RISK = {
  allow: RISK.LOW,
  warn: RISK.MEDIUM,
  deny: RISK.HIGH,
  reroute: RISK.HIGH,
};

export async function evaluateShellCommandWithApproval({
  command,
  sessionId = null,
  approvalGate = null,
  shellPolicyOptions = {},
  installPolicy = null,
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
    installPolicy || resolveInstallPolicy({ env: process.env });
  let install = null;
  if (effectiveInstallPolicy && effectiveInstallPolicy.enabled) {
    const cls = classifyCodeAcquisition(command);
    if (cls.flagged) {
      install = cls;
      if (effectiveInstallPolicy.riskFloor) {
        riskLevel = applyRiskFloor(riskLevel, effectiveInstallPolicy.riskFloor);
      }
      if (effectiveInstallPolicy.audit) {
        recordInstallCommandAudit(
          {
            command,
            shellDecision: shellPolicy.decision,
            riskLevel,
            installs: cls.installs,
            remoteExec: cls.remoteExec,
            global: hasGlobalInstall(cls),
            sessionId,
          },
          effectiveInstallPolicy.auditOpts || {},
        );
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
    };
  }

  // No ApprovalGate wired? Preserve legacy behavior (shell policy decides).
  if (!approvalGate || typeof approvalGate.decide !== "function") {
    return {
      allowed: true,
      decision: DECISION.ALLOW,
      via: "shell-policy",
      reason: shellPolicy.reason,
      shellPolicy,
      riskLevel,
      policy: null,
      install,
    };
  }

  const gateResult = await approvalGate.decide({
    sessionId,
    riskLevel,
    tool: "run_shell",
    args: { command },
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
    // Explainability passthrough (autoMode.decisions wrapper attaches these):
    // which gate rule fired and why — surfaced in the permission chain.
    gateReason: gateResult.reason ?? null,
    gateRule: gateResult.rule ?? null,
  };
}
