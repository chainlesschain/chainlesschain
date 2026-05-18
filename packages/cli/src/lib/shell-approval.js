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

const sharedShellPolicy = require("../runtime/coding-agent-shell-policy.cjs");
const {
  APPROVAL_RISK: RISK,
  APPROVAL_DECISION: DECISION,
} = require("@chainlesschain/session-core");

const SHELL_TO_RISK = {
  allow: RISK.LOW,
  warn: RISK.MEDIUM,
  deny: RISK.HIGH,
  reroute: RISK.HIGH,
};

async function evaluateShellCommandWithApproval({
  command,
  sessionId = null,
  approvalGate = null,
  shellPolicyOptions = {},
} = {}) {
  const shellPolicy = sharedShellPolicy.evaluateShellCommandPolicy(
    command,
    shellPolicyOptions,
  );

  const riskLevel = SHELL_TO_RISK[shellPolicy.decision] || RISK.MEDIUM;

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
  };
}

module.exports = {
  evaluateShellCommandWithApproval,
  SHELL_TO_RISK,
};
