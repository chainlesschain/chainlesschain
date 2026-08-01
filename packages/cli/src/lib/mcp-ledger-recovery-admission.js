import {
  McpEffect,
  createMcpCallLedger,
  normalizeMcpEffectContract,
} from "./mcp-call-ledger.js";

export const McpRecoveryBlockMode = Object.freeze({
  ALL: "all",
  UNSAFE: "unsafe",
});

/**
 * Reduce a content-free recovery projection to one admission decision.
 * Incidents and verified-read failures block every MCP call. A surviving
 * started record blocks non-read effects until a caller explicitly
 * adjudicates the prior outcome.
 */
export function classifyMcpRecoveryAdmission(
  recovery,
  { recoveryError = null } = {},
) {
  const incidents = Array.isArray(recovery?.incidents)
    ? recovery.incidents.length
    : 0;
  const unsettled = Array.isArray(recovery?.unsettled)
    ? recovery.unsettled.length
    : 0;
  const explicitMode = recovery?.blockMode;
  let blockMode = null;
  if (recoveryError || incidents > 0) {
    blockMode = McpRecoveryBlockMode.ALL;
  } else if (explicitMode != null) {
    blockMode = Object.values(McpRecoveryBlockMode).includes(explicitMode)
      ? explicitMode
      : McpRecoveryBlockMode.ALL;
  } else if (unsettled > 0) {
    blockMode = McpRecoveryBlockMode.UNSAFE;
  }
  return Object.freeze({ blockMode, incidents, unsettled });
}

export class McpLedgerRecoveryBlockedError extends Error {
  constructor(effect, admission, options = {}) {
    super(
      options.message ||
        `MCP ${effect} call blocked until durable recovery incidents are explicitly adjudicated`,
    );
    this.name = "McpLedgerRecoveryBlockedError";
    this.code = options.code || "CC_MCP_LEDGER_RECOVERY_BLOCKED";
    this.effect = effect;
    this.blockMode = admission.blockMode;
  }
}

/** Wrap an MCP ledger with a fail-closed recovery admission gate. */
export function guardMcpLedgerForRecovery(ledger, recovery, options = {}) {
  if (!ledger || typeof ledger.begin !== "function") return ledger;
  const admission = classifyMcpRecoveryAdmission(recovery, options);
  if (!admission.blockMode) return ledger;

  const begin = async (call = {}) => {
    const effect = normalizeMcpEffectContract(
      call.effectContract || call.effect || {},
    ).effect;
    const blocked =
      admission.blockMode === McpRecoveryBlockMode.ALL ||
      (admission.blockMode === McpRecoveryBlockMode.UNSAFE &&
        effect !== McpEffect.READ);
    if (blocked) {
      throw new McpLedgerRecoveryBlockedError(effect, admission, options);
    }
    return ledger.begin(call);
  };

  const guarded = {
    begin,
    beginCall: begin,
    recoveryAdmission: admission,
  };
  for (const method of ["settle", "settleCall", "get", "list"]) {
    if (typeof ledger[method] === "function") {
      guarded[method] = ledger[method].bind(ledger);
    }
  }
  if (ledger.prewriteFailurePolicy) {
    guarded.prewriteFailurePolicy = ledger.prewriteFailurePolicy;
  }
  return Object.freeze(guarded);
}

/** Build the normal call ledger, then apply the shared recovery admission. */
export function createRecoveryGuardedMcpCallLedger(options = {}) {
  const {
    sink = null,
    recovery = null,
    recoveryError = null,
    blockMode = null,
    code,
    message,
    ...ledgerOptions
  } = options;
  const recoveryState = blockMode
    ? { ...(recovery || {}), blockMode }
    : recovery;
  return guardMcpLedgerForRecovery(
    createMcpCallLedger({ ...ledgerOptions, sink }),
    recoveryState,
    { recoveryError, code, message },
  );
}
