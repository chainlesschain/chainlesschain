import { isProxy } from "node:util/types";
import {
  McpEffect,
  createMcpCallLedger,
  normalizeMcpEffectContract,
} from "./mcp-call-ledger.js";

export const McpRecoveryBlockMode = Object.freeze({
  ALL: "all",
  UNSAFE: "unsafe",
});

export const MCP_RECOVERY_INVALID_CODE = "CC_MCP_LEDGER_RECOVERY_INVALID";
export const MCP_OUTCOME_UNKNOWN_CODE = "CC_MCP_LEDGER_OUTCOME_UNKNOWN";

const RECOVERY_CONTROLLERS = new WeakSet();
const GUARDED_LEDGER_CONTROLLERS = new WeakMap();

function ownDataValue(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor)) {
    return { valid: false, value: undefined };
  }
  return { valid: true, value: descriptor.value };
}

function inspectRecoveryProjection(recovery) {
  if (recovery == null) {
    return { valid: true, incidents: 0, unsettled: 0, explicitMode: null };
  }

  try {
    if (
      typeof recovery !== "object" ||
      isProxy(recovery) ||
      Array.isArray(recovery)
    ) {
      return { valid: false, incidents: 0, unsettled: 0, explicitMode: null };
    }
    const prototype = Object.getPrototypeOf(recovery);
    if (prototype !== Object.prototype && prototype !== null) {
      return { valid: false, incidents: 0, unsettled: 0, explicitMode: null };
    }

    const thenDescriptor = Object.getOwnPropertyDescriptor(recovery, "then");
    if (
      thenDescriptor &&
      (!("value" in thenDescriptor) ||
        typeof thenDescriptor.value === "function")
    ) {
      return { valid: false, incidents: 0, unsettled: 0, explicitMode: null };
    }

    const incidentsProperty = ownDataValue(recovery, "incidents");
    const unsettledProperty = ownDataValue(recovery, "unsettled");
    const incidentsValue = incidentsProperty.value;
    const unsettledValue = unsettledProperty.value;
    if (
      !incidentsProperty.valid ||
      !unsettledProperty.valid ||
      isProxy(incidentsValue) ||
      isProxy(unsettledValue) ||
      !Array.isArray(incidentsValue) ||
      !Array.isArray(unsettledValue)
    ) {
      return { valid: false, incidents: 0, unsettled: 0, explicitMode: null };
    }

    const blockModeDescriptor = Object.getOwnPropertyDescriptor(
      recovery,
      "blockMode",
    );
    if (blockModeDescriptor && !("value" in blockModeDescriptor)) {
      return { valid: false, incidents: 0, unsettled: 0, explicitMode: null };
    }
    const explicitMode = blockModeDescriptor?.value;
    if (
      explicitMode != null &&
      explicitMode !== McpRecoveryBlockMode.ALL &&
      explicitMode !== McpRecoveryBlockMode.UNSAFE
    ) {
      return { valid: false, incidents: 0, unsettled: 0, explicitMode: null };
    }

    return {
      valid: true,
      incidents: incidentsValue.length,
      unsettled: unsettledValue.length,
      explicitMode: explicitMode ?? null,
    };
  } catch {
    // Accessors/proxies are not trusted recovery evidence. Keep admission
    // synchronous and fail closed instead of allowing a malformed projection.
    return { valid: false, incidents: 0, unsettled: 0, explicitMode: null };
  }
}

/**
 * Reduce a content-free recovery projection to one admission decision. A
 * present projection must contain synchronous incidents/unsettled arrays;
 * malformed or asynchronous values are not evidence of a clean recovery.
 * Incidents and verified-read failures block every MCP call. A surviving
 * started record blocks non-read effects until a caller explicitly
 * adjudicates the prior outcome.
 */
export function classifyMcpRecoveryAdmission(
  recovery,
  { recoveryError = null, blockMode: requestedMode = null } = {},
) {
  const projection = inspectRecoveryProjection(recovery);
  const { incidents, unsettled, explicitMode } = projection;
  const requestedModeValid =
    requestedMode == null ||
    requestedMode === McpRecoveryBlockMode.ALL ||
    requestedMode === McpRecoveryBlockMode.UNSAFE;
  const reasonCode =
    projection.valid && requestedModeValid ? null : MCP_RECOVERY_INVALID_CODE;
  let blockMode = null;
  if (
    !projection.valid ||
    !requestedModeValid ||
    recoveryError != null ||
    incidents > 0
  ) {
    blockMode = McpRecoveryBlockMode.ALL;
  } else if (requestedMode || explicitMode) {
    blockMode = requestedMode || explicitMode;
  } else if (unsettled > 0) {
    blockMode = McpRecoveryBlockMode.UNSAFE;
  }
  return Object.freeze({ blockMode, incidents, unsettled, reasonCode });
}

function admissionRank(blockMode) {
  if (blockMode === McpRecoveryBlockMode.ALL) return 2;
  if (blockMode === McpRecoveryBlockMode.UNSAFE) return 1;
  return 0;
}

/**
 * Mutable-by-method, immutable-by-reference recovery admission authority.
 * Only a new verified projection may replace (and therefore lower) the current
 * admission. Runtime latches are monotonic until that explicit replacement.
 */
export function createMcpRecoveryAdmissionController(
  recovery = null,
  options = {},
) {
  let currentAdmission = classifyMcpRecoveryAdmission(recovery, options);

  const latch = (blockMode, reasonCode = null) => {
    const requestedRank = admissionRank(blockMode);
    const currentRank = admissionRank(currentAdmission.blockMode);
    if (requestedRank < currentRank) return currentAdmission;
    if (requestedRank === currentRank) {
      if (currentAdmission.reasonCode || !reasonCode) return currentAdmission;
      currentAdmission = Object.freeze({
        ...currentAdmission,
        reasonCode,
      });
      return currentAdmission;
    }
    currentAdmission = Object.freeze({
      ...currentAdmission,
      blockMode,
      reasonCode: currentAdmission.reasonCode || reasonCode || null,
    });
    return currentAdmission;
  };

  const controller = {
    get admission() {
      return currentAdmission;
    },
    getAdmission() {
      return currentAdmission;
    },
    replaceVerifiedRecovery(nextRecovery) {
      const replacement = classifyMcpRecoveryAdmission(nextRecovery);
      if (replacement.reasonCode === MCP_RECOVERY_INVALID_CODE) {
        return latch(McpRecoveryBlockMode.ALL, MCP_RECOVERY_INVALID_CODE);
      }
      currentAdmission = replacement;
      return currentAdmission;
    },
    latchUnsafe(reasonCode = null) {
      return latch(McpRecoveryBlockMode.UNSAFE, reasonCode);
    },
    latchAll(reasonCode = null) {
      return latch(McpRecoveryBlockMode.ALL, reasonCode);
    },
  };
  Object.freeze(controller);
  RECOVERY_CONTROLLERS.add(controller);
  return controller;
}

function isRecoveryController(value) {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    RECOVERY_CONTROLLERS.has(value)
  );
}

export class McpLedgerRecoveryBlockedError extends Error {
  constructor(effect, admission, options = {}) {
    super(
      options.message ||
        `MCP ${effect} call blocked until durable recovery incidents are explicitly adjudicated`,
    );
    this.name = "McpLedgerRecoveryBlockedError";
    this.code =
      options.code || admission.reasonCode || "CC_MCP_LEDGER_RECOVERY_BLOCKED";
    this.effect = effect;
    this.blockMode = admission.blockMode;
  }
}

export class McpCallOutcomeUnknownError extends Error {
  constructor(ticket, settlementError, effect = McpEffect.UNKNOWN) {
    super(
      "MCP call outcome is unknown because its durable ledger settlement failed; do not retry automatically",
      settlementError ? { cause: settlementError } : undefined,
    );
    this.name = "McpCallOutcomeUnknownError";
    this.code = MCP_OUTCOME_UNKNOWN_CODE;
    this.ledgerId = ticket?.ledgerId || settlementError?.ledgerId || null;
    this.effect = effect;
    this.phase = "settled";
    this.outcomeUnknown = true;
    this.retryable = false;
  }
}

async function settleWithRecoveryLatch(controller, operation) {
  try {
    return await operation();
  } catch (error) {
    controller?.latchUnsafe(error?.code || "CC_MCP_LEDGER_SETTLE_FAILED");
    throw error;
  }
}

function wrapLedgerTicketForRecovery(ticket, controller) {
  if (
    !controller ||
    (typeof ticket !== "object" && typeof ticket !== "function") ||
    ticket === null
  ) {
    return ticket;
  }

  const descriptors = Object.getOwnPropertyDescriptors(ticket);
  for (const property of ["settle", "settleCall"]) {
    let method;
    try {
      method = Reflect.get(ticket, property, ticket);
    } catch {
      method = null;
    }
    if (typeof method !== "function") continue;
    descriptors[property] = {
      configurable: false,
      enumerable: descriptors[property]?.enumerable ?? true,
      writable: false,
      value: (...args) =>
        settleWithRecoveryLatch(controller, () =>
          Reflect.apply(method, ticket, args),
        ),
    };
  }
  // Ledger tickets are commonly frozen. Clone their descriptors so settlement
  // can be wrapped without violating Proxy invariants for read-only methods.
  return Object.freeze(
    Object.create(Object.getPrototypeOf(ticket), descriptors),
  );
}

/** Wrap an MCP ledger with a fail-closed recovery admission gate. */
export function guardMcpLedgerForRecovery(ledger, recovery, options = {}) {
  if (!ledger || typeof ledger.begin !== "function") return ledger;
  const controller = isRecoveryController(recovery) ? recovery : null;
  if (controller && GUARDED_LEDGER_CONTROLLERS.get(ledger) === controller) {
    return ledger;
  }
  const staticAdmission = controller
    ? null
    : classifyMcpRecoveryAdmission(recovery, options);
  if (!controller && !staticAdmission.blockMode) return ledger;
  const getAdmission = () =>
    controller ? controller.getAdmission() : staticAdmission;

  const begin = async (call = {}) => {
    const admission = getAdmission();
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
    const ticket = await Reflect.apply(ledger.begin, ledger, [call]);
    return wrapLedgerTicketForRecovery(ticket, controller);
  };

  const guarded = {
    begin,
    beginCall: begin,
  };
  Object.defineProperty(guarded, "recoveryAdmission", {
    enumerable: true,
    get: getAdmission,
  });
  for (const method of ["settle", "settleCall"]) {
    if (typeof ledger[method] === "function") {
      guarded[method] = (...args) =>
        controller
          ? settleWithRecoveryLatch(controller, () =>
              Reflect.apply(ledger[method], ledger, args),
            )
          : Reflect.apply(ledger[method], ledger, args);
    }
  }
  for (const method of ["get", "list"]) {
    if (typeof ledger[method] === "function") {
      guarded[method] = ledger[method].bind(ledger);
    }
  }
  if (ledger.prewriteFailurePolicy) {
    guarded.prewriteFailurePolicy = ledger.prewriteFailurePolicy;
  }
  Object.freeze(guarded);
  if (controller) GUARDED_LEDGER_CONTROLLERS.set(guarded, controller);
  return guarded;
}

/** Build the normal call ledger, then apply the shared recovery admission. */
export function createRecoveryGuardedMcpCallLedger(options = {}) {
  const {
    sink = null,
    recovery = null,
    recoveryError = null,
    blockMode = null,
    controller = null,
    code,
    message,
    ...ledgerOptions
  } = options;
  return guardMcpLedgerForRecovery(
    createMcpCallLedger({ ...ledgerOptions, sink }),
    controller || recovery,
    { recoveryError, blockMode, code, message },
  );
}

async function resolveHostEffectContract(
  resolveEffect,
  client,
  serverName,
  toolName,
  input,
) {
  let resolved = null;
  if (resolveEffect) {
    try {
      resolved = await Reflect.apply(resolveEffect, client, [
        serverName,
        toolName,
        input,
      ]);
    } catch {
      // A failed host classification is not evidence that a tool is read-only.
      resolved = null;
    }
  }
  const contract =
    resolved && typeof resolved === "object" && resolved.effectContract
      ? resolved.effectContract
      : resolved || {};
  return {
    effectContract: normalizeMcpEffectContract(contract),
    resourceScopes:
      resolved && typeof resolved === "object"
        ? resolved.resourceScopes
        : undefined,
    networkScopes:
      resolved && typeof resolved === "object"
        ? resolved.networkScopes
        : undefined,
  };
}

async function settleHostCall(ledger, ticket, outcome) {
  if (typeof ticket?.settle === "function") {
    return Reflect.apply(ticket.settle, ticket, [outcome]);
  }
  if (typeof ticket?.settleCall === "function") {
    return Reflect.apply(ticket.settleCall, ticket, [outcome]);
  }
  if (typeof ledger.settleCall === "function") {
    return Reflect.apply(ledger.settleCall, ledger, [ticket, outcome]);
  }
  if (typeof ledger.settle === "function") {
    return Reflect.apply(ledger.settle, ledger, [ticket, outcome]);
  }
  const error = new Error("MCP ledger ticket has no settlement method");
  error.code = "CC_MCP_LEDGER_SETTLE_UNAVAILABLE";
  throw error;
}

/**
 * Wrap host-owned auxiliary MCP calls with the same dynamic recovery admission
 * and durable begin/settle protocol used by agent-core. Agent-core dispatch
 * must continue to receive the raw client plus the shared guarded ledger so a
 * model-originated call is recorded exactly once.
 */
export function createRecoveryGuardedMcpClient({
  client,
  ledger,
  controller,
  resolveEffect = null,
  sessionId = null,
} = {}) {
  if (!client || typeof client.callTool !== "function") {
    throw new TypeError("MCP client wrapper requires client.callTool()");
  }
  if (!ledger || typeof ledger.begin !== "function") {
    throw new TypeError("MCP client wrapper requires a call ledger");
  }
  if (!isRecoveryController(controller)) {
    throw new TypeError("MCP client wrapper requires a recovery controller");
  }
  if (resolveEffect != null && typeof resolveEffect !== "function") {
    throw new TypeError("MCP client effect resolver must be a function");
  }

  const admittedLedger = guardMcpLedgerForRecovery(ledger, controller);
  const rawCallTool = client.callTool;
  const callTool = async (serverName, toolName, input = {}, ...rest) => {
    const effect = await resolveHostEffectContract(
      resolveEffect,
      client,
      serverName,
      toolName,
      input,
    );
    const ticket = await admittedLedger.begin({
      sessionId,
      serverName,
      toolName,
      input,
      ...effect,
    });

    let result;
    try {
      result = await Reflect.apply(rawCallTool, client, [
        serverName,
        toolName,
        input,
        ...rest,
      ]);
    } catch (callError) {
      try {
        await settleHostCall(admittedLedger, ticket, {
          status: "failed",
          error: callError,
        });
      } catch (settlementError) {
        controller.latchUnsafe(
          settlementError?.code || "CC_MCP_LEDGER_SETTLE_FAILED",
        );
        throw new McpCallOutcomeUnknownError(
          ticket,
          settlementError,
          effect.effectContract.effect,
        );
      }
      throw callError;
    }

    const protocolError = result?.isError === true;
    try {
      const error = protocolError
        ? Object.assign(new Error("MCP server returned isError=true"), {
            code: "CC_MCP_PROTOCOL_TOOL_ERROR",
          })
        : null;
      await settleHostCall(
        admittedLedger,
        ticket,
        protocolError
          ? { status: "failed", output: result, error }
          : { status: "completed", output: result },
      );
    } catch (settlementError) {
      controller.latchUnsafe(
        settlementError?.code || "CC_MCP_LEDGER_SETTLE_FAILED",
      );
      throw new McpCallOutcomeUnknownError(
        ticket,
        settlementError,
        effect.effectContract.effect,
      );
    }
    return result;
  };

  const methodCache = new Map();
  let wrappedClient;
  wrappedClient = new Proxy(client, {
    get(target, property) {
      if (property === "callTool") return callTool;
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const cached = methodCache.get(property);
      if (cached?.source === value) return cached.wrapper;
      const wrapper = (...args) => {
        const result = Reflect.apply(value, target, args);
        return result === target ? wrappedClient : result;
      };
      methodCache.set(property, { source: value, wrapper });
      return wrapper;
    },
  });
  return wrappedClient;
}
