import { isProxy } from "node:util/types";
import {
  MCP_CALL_LEDGER_PROTOCOL_LIMITS,
  McpEffect,
  computeMcpExactReplayDigest,
  createMcpCallLedger,
  normalizeMcpLedgerProtocolText,
  normalizeMcpEffectContract,
  summarizeMcpPayload,
} from "./mcp-call-ledger.js";

export const McpRecoveryBlockMode = Object.freeze({
  ALL: "all",
  UNSAFE: "unsafe",
});

export const MCP_RECOVERY_INVALID_CODE = "CC_MCP_LEDGER_RECOVERY_INVALID";
export const MCP_OUTCOME_UNKNOWN_CODE = "CC_MCP_LEDGER_OUTCOME_UNKNOWN";
export const MCP_EXACT_REPLAY_DENIED_CODE = "CC_MCP_LEDGER_EXACT_REPLAY_DENIED";
export const MCP_RECOVERY_DENY_REGRESSION_CODE =
  "CC_MCP_LEDGER_REPLAY_DENY_REGRESSION";

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const REPLAY_DENY_FIELDS = new Set([
  "ledgerId",
  "serverName",
  "toolName",
  "inputBytes",
  "replayDigest",
]);

const RECOVERY_CONTROLLERS = new WeakSet();
const GUARDED_LEDGER_CONTROLLERS = new WeakMap();
const GUARDED_MCP_CLIENTS = new WeakMap();

function ownDataValue(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor)) {
    return { valid: false, value: undefined };
  }
  return { valid: true, value: descriptor.value };
}

function isPlainDataObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalReplayDenyEntry(value) {
  if (!isPlainDataObject(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const fields = Object.keys(descriptors);
  if (
    fields.length !== REPLAY_DENY_FIELDS.size ||
    fields.some((field) => !REPLAY_DENY_FIELDS.has(field)) ||
    [...REPLAY_DENY_FIELDS].some(
      (field) => !descriptors[field] || !("value" in descriptors[field]),
    )
  ) {
    return null;
  }
  const ledgerId = descriptors.ledgerId.value;
  const serverName = descriptors.serverName.value;
  const toolName = descriptors.toolName.value;
  const inputBytes = descriptors.inputBytes.value;
  const replayDigest = descriptors.replayDigest.value;
  if (
    typeof ledgerId !== "string" ||
    ledgerId !==
      normalizeMcpLedgerProtocolText(
        ledgerId,
        null,
        MCP_CALL_LEDGER_PROTOCOL_LIMITS.ledgerId,
      ) ||
    typeof serverName !== "string" ||
    serverName !==
      normalizeMcpLedgerProtocolText(
        serverName,
        null,
        MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
      ) ||
    typeof toolName !== "string" ||
    toolName !==
      normalizeMcpLedgerProtocolText(
        toolName,
        null,
        MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
      ) ||
    !Number.isInteger(inputBytes) ||
    inputBytes < 0 ||
    typeof replayDigest !== "string" ||
    !SHA256_DIGEST.test(replayDigest)
  ) {
    return null;
  }
  return Object.freeze({
    ledgerId,
    serverName,
    toolName,
    inputBytes,
    replayDigest,
  });
}

function replayDenyKey(value) {
  return JSON.stringify([
    value?.serverName || null,
    value?.toolName || null,
    Number.isInteger(value?.inputBytes) ? value.inputBytes : null,
    value?.replayDigest || null,
  ]);
}

function replayDenyAuthorityKey(value) {
  return JSON.stringify([value?.ledgerId || null, replayDenyKey(value)]);
}

function replayIdentityForCall(call = {}) {
  const serverName = normalizeMcpLedgerProtocolText(
    call.serverName || call.server,
    null,
    MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
  );
  const toolNameValue = normalizeMcpLedgerProtocolText(
    call.toolName || call.tool,
    null,
    MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
  );
  if (!serverName || !toolNameValue) return null;
  const toolName = toolNameValue;
  const input = Object.prototype.hasOwnProperty.call(call, "input")
    ? call.input
    : {};
  const summary = summarizeMcpPayload(input);
  return Object.freeze({
    serverName,
    toolName,
    inputBytes: summary.bytes,
    replayDigest: computeMcpExactReplayDigest({
      serverName,
      toolName,
      inputDigest: summary.sha256,
      inputBytes: summary.bytes,
    }),
  });
}

function findReplayDeny(replayDenied, call) {
  if (!Array.isArray(replayDenied) || replayDenied.length === 0) return null;
  const identity = replayIdentityForCall(call);
  if (!identity) return null;
  const key = replayDenyKey(identity);
  return replayDenied.find((entry) => replayDenyKey(entry) === key) || null;
}

function invalidRecoveryProjection() {
  return {
    valid: false,
    incidents: 0,
    unsettled: 0,
    explicitMode: null,
    replayDenied: Object.freeze([]),
  };
}

function inspectRecoveryProjection(recovery) {
  if (recovery == null) {
    return {
      valid: true,
      incidents: 0,
      unsettled: 0,
      explicitMode: null,
      replayDenied: Object.freeze([]),
    };
  }

  try {
    if (
      typeof recovery !== "object" ||
      isProxy(recovery) ||
      Array.isArray(recovery)
    ) {
      return invalidRecoveryProjection();
    }
    const prototype = Object.getPrototypeOf(recovery);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidRecoveryProjection();
    }

    const thenDescriptor = Object.getOwnPropertyDescriptor(recovery, "then");
    if (
      thenDescriptor &&
      (!("value" in thenDescriptor) ||
        typeof thenDescriptor.value === "function")
    ) {
      return invalidRecoveryProjection();
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
      return invalidRecoveryProjection();
    }

    const blockModeDescriptor = Object.getOwnPropertyDescriptor(
      recovery,
      "blockMode",
    );
    if (blockModeDescriptor && !("value" in blockModeDescriptor)) {
      return invalidRecoveryProjection();
    }
    const explicitMode = blockModeDescriptor?.value;
    if (
      explicitMode != null &&
      explicitMode !== McpRecoveryBlockMode.ALL &&
      explicitMode !== McpRecoveryBlockMode.UNSAFE
    ) {
      return invalidRecoveryProjection();
    }

    const replayDeniedDescriptor = Object.getOwnPropertyDescriptor(
      recovery,
      "replayDenied",
    );
    if (!replayDeniedDescriptor || !("value" in replayDeniedDescriptor)) {
      return invalidRecoveryProjection();
    }
    const replayDeniedValue = replayDeniedDescriptor.value;
    if (isProxy(replayDeniedValue) || !Array.isArray(replayDeniedValue)) {
      return invalidRecoveryProjection();
    }
    const replayDenied = replayDeniedValue.map(canonicalReplayDenyEntry);
    if (replayDenied.some((entry) => entry === null)) {
      return invalidRecoveryProjection();
    }
    const replayKeys = new Set(replayDenied.map(replayDenyKey));
    if (replayKeys.size !== replayDenied.length) {
      return invalidRecoveryProjection();
    }

    return {
      valid: true,
      incidents: incidentsValue.length,
      unsettled: unsettledValue.length,
      explicitMode: explicitMode ?? null,
      replayDenied: Object.freeze(replayDenied),
    };
  } catch {
    // Accessors/proxies are not trusted recovery evidence. Keep admission
    // synchronous and fail closed instead of allowing a malformed projection.
    return invalidRecoveryProjection();
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
  const replayDenied = projection.replayDenied.length;
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
  return Object.freeze({
    blockMode,
    incidents,
    unsettled,
    replayDenied,
    reasonCode,
  });
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
  let currentProjection = inspectRecoveryProjection(recovery);
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
      // A stricter admission must explain the stricter condition. Preserve the
      // old reason only when the escalation itself has no diagnosable cause.
      reasonCode: reasonCode || currentAdmission.reasonCode || null,
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
      const replacementProjection = inspectRecoveryProjection(nextRecovery);
      const replacement = classifyMcpRecoveryAdmission(nextRecovery);
      if (replacement.reasonCode === MCP_RECOVERY_INVALID_CODE) {
        return latch(McpRecoveryBlockMode.ALL, MCP_RECOVERY_INVALID_CODE);
      }
      const replacementAuthority = new Set(
        replacementProjection.replayDenied.map(replayDenyAuthorityKey),
      );
      const losesDeny = currentProjection.replayDenied.some(
        (entry) => !replacementAuthority.has(replayDenyAuthorityKey(entry)),
      );
      if (losesDeny) {
        return latch(
          McpRecoveryBlockMode.ALL,
          MCP_RECOVERY_DENY_REGRESSION_CODE,
        );
      }
      currentProjection = replacementProjection;
      currentAdmission = replacement;
      return currentAdmission;
    },
    findReplayDeny(call) {
      return findReplayDeny(currentProjection.replayDenied, call);
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

export class McpExactReplayDeniedError extends Error {
  constructor(effect, deny) {
    super(
      "MCP call exactly matches a prior confirmed-applied call and must not be replayed",
    );
    this.name = "McpExactReplayDeniedError";
    this.code = MCP_EXACT_REPLAY_DENIED_CODE;
    this.effect = effect;
    this.ledgerId = deny?.ledgerId || null;
    this.serverName = deny?.serverName || null;
    this.toolName = deny?.toolName || null;
    this.inputBytes = deny?.inputBytes ?? null;
    this.replayDigest = deny?.replayDigest || null;
    this.replayDenied = true;
    this.retryable = false;
  }
}

export class McpCallOutcomeUnknownError extends Error {
  constructor(
    ticket,
    settlementError,
    effect = McpEffect.UNKNOWN,
    options = {},
  ) {
    super(
      options.message ||
        "MCP call outcome is unknown; do not retry automatically until durable recovery is adjudicated",
      settlementError ? { cause: settlementError } : undefined,
    );
    this.name = "McpCallOutcomeUnknownError";
    this.code = MCP_OUTCOME_UNKNOWN_CODE;
    this.ledgerId =
      safeProperty(ticket, "ledgerId") ||
      safeProperty(settlementError, "ledgerId") ||
      null;
    this.effect = effect;
    this.phase = options.phase || "settled";
    this.outcomeUnknown = true;
    this.retryable = false;
  }
}

function safeProperty(value, property) {
  try {
    return value?.[property];
  } catch {
    return undefined;
  }
}

function failureCode(error, fallback) {
  const code = safeProperty(error, "code");
  return typeof code === "string" && code ? code : fallback;
}

function outcomeUnknown(
  controller,
  ticket,
  cause,
  effect,
  { phase = "settled", fallbackCode = "CC_MCP_LEDGER_SETTLE_FAILED" } = {},
) {
  controller?.latchUnsafe(failureCode(cause, fallbackCode));
  return new McpCallOutcomeUnknownError(ticket, cause, effect, { phase });
}

async function settleWithRecoveryLatch(controller, operation) {
  try {
    return await operation();
  } catch (error) {
    controller?.latchUnsafe(failureCode(error, "CC_MCP_LEDGER_SETTLE_FAILED"));
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

  try {
    if (isProxy(ticket)) {
      const invalid = new TypeError("MCP ledger tickets cannot be Proxies");
      invalid.code = "CC_MCP_LEDGER_TICKET_INVALID";
      throw invalid;
    }
    const descriptors = Object.getOwnPropertyDescriptors(ticket);
    for (const property of ["settle", "settleCall"]) {
      const originalDescriptor = descriptors[property];
      const method = Reflect.get(ticket, property, ticket);
      if (typeof method === "function") {
        descriptors[property] = {
          configurable: false,
          enumerable: originalDescriptor?.enumerable ?? true,
          writable: false,
          value: (...args) =>
            settleWithRecoveryLatch(controller, () =>
              Reflect.apply(method, ticket, args),
            ),
        };
      } else if (property in ticket) {
        const unavailable = new TypeError(
          `MCP ledger ticket ${property} is not callable`,
        );
        unavailable.code = "CC_MCP_LEDGER_SETTLE_UNAVAILABLE";
        throw unavailable;
      }
    }
    // Ledger tickets are commonly frozen. Clone their descriptors so
    // settlement can be wrapped without violating read-only invariants.
    return Object.freeze(
      Object.create(Object.getPrototypeOf(ticket), descriptors),
    );
  } catch (error) {
    controller.latchUnsafe(failureCode(error, "CC_MCP_LEDGER_TICKET_INVALID"));
    throw error;
  }
}

function constrainRecoveryController(controller, options = {}) {
  const constraint = classifyMcpRecoveryAdmission(null, options);
  if (constraint.blockMode === McpRecoveryBlockMode.ALL) {
    controller.latchAll(
      constraint.reasonCode ||
        (options.recoveryError != null
          ? failureCode(
              options.recoveryError,
              "CC_MCP_LEDGER_EVENT_READ_FAILED",
            )
          : null),
    );
  } else if (constraint.blockMode === McpRecoveryBlockMode.UNSAFE) {
    controller.latchUnsafe(constraint.reasonCode);
  }
  return controller;
}

/** Wrap an MCP ledger with a fail-closed recovery admission gate. */
export function guardMcpLedgerForRecovery(ledger, recovery, options = {}) {
  if (!ledger) return ledger;
  const ledgerBegin = ledger.begin;
  if (typeof ledgerBegin !== "function") return ledger;
  const controller = isRecoveryController(recovery) ? recovery : null;
  if (controller) constrainRecoveryController(controller, options);
  if (controller && GUARDED_LEDGER_CONTROLLERS.get(ledger) === controller) {
    return ledger;
  }
  const staticProjection = controller
    ? null
    : inspectRecoveryProjection(recovery);
  const staticAdmission = controller
    ? null
    : classifyMcpRecoveryAdmission(recovery, options);
  if (
    !controller &&
    !staticAdmission.blockMode &&
    staticProjection.replayDenied.length === 0
  ) {
    return ledger;
  }
  const getAdmission = () =>
    controller ? controller.getAdmission() : staticAdmission;
  const getReplayDeny = (call) =>
    controller
      ? controller.findReplayDeny(call)
      : findReplayDeny(staticProjection.replayDenied, call);

  const begin = async (call = {}) => {
    const admission = getAdmission();
    const normalizedEffect = normalizeMcpEffectContract(
      call.effectContract || call.effect || {},
    );
    const effect =
      normalizedEffect.effect === McpEffect.READ &&
      normalizedEffect.trusted !== true
        ? McpEffect.UNKNOWN
        : normalizedEffect.effect;
    const deny = getReplayDeny(call);
    if (deny) {
      throw new McpExactReplayDeniedError(effect, deny);
    }
    const blocked =
      admission.blockMode === McpRecoveryBlockMode.ALL ||
      (admission.blockMode === McpRecoveryBlockMode.UNSAFE &&
        effect !== McpEffect.READ);
    if (blocked) {
      throw new McpLedgerRecoveryBlockedError(effect, admission, options);
    }
    const ticket = await Reflect.apply(ledgerBegin, ledger, [call]);
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
    const ledgerMethod = ledger[method];
    if (typeof ledgerMethod === "function") {
      guarded[method] = (...args) =>
        controller
          ? settleWithRecoveryLatch(controller, () =>
              Reflect.apply(ledgerMethod, ledger, args),
            )
          : Reflect.apply(ledgerMethod, ledger, args);
    }
  }
  for (const method of ["get", "list"]) {
    const ledgerMethod = ledger[method];
    if (typeof ledgerMethod === "function") {
      guarded[method] = ledgerMethod.bind(ledger);
    }
  }
  if (ledger.prewriteFailurePolicy) {
    guarded.prewriteFailurePolicy = ledger.prewriteFailurePolicy;
  }
  Object.freeze(guarded);
  if (controller) GUARDED_LEDGER_CONTROLLERS.set(guarded, controller);
  return guarded;
}

/**
 * Monotonically tighten a branded dynamic ledger after an external call's
 * outcome becomes unknowable. The WeakMap is the capability boundary: callers
 * can latch a guarded ledger but cannot read, replace, or downgrade its
 * controller.
 */
export function markMcpLedgerOutcomeUnknown(
  ledger,
  reasonCode = MCP_OUTCOME_UNKNOWN_CODE,
) {
  const controller =
    ledger && (typeof ledger === "object" || typeof ledger === "function")
      ? GUARDED_LEDGER_CONTROLLERS.get(ledger)
      : null;
  if (!controller) return false;
  controller.latchUnsafe(
    typeof reasonCode === "string" && reasonCode
      ? reasonCode
      : MCP_OUTCOME_UNKNOWN_CODE,
  );
  return true;
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
  const normalizedContract = normalizeMcpEffectContract(contract);
  const effectContract =
    normalizedContract.effect === McpEffect.READ &&
    normalizedContract.trusted !== true
      ? normalizeMcpEffectContract({
          ...normalizedContract,
          effect: McpEffect.UNKNOWN,
        })
      : normalizedContract;
  return {
    effectContract,
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

  const existingGuard = GUARDED_MCP_CLIENTS.get(client);
  if (existingGuard) {
    if (
      existingGuard.ledger === ledger &&
      existingGuard.controller === controller &&
      existingGuard.resolveEffect === resolveEffect &&
      existingGuard.sessionId === sessionId
    ) {
      return client;
    }
    const error = new TypeError(
      "MCP client is already guarded by a different recovery authority",
    );
    error.code = "CC_MCP_CLIENT_ALREADY_GUARDED";
    throw error;
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
      if (effect.effectContract.effect !== McpEffect.READ) {
        throw outcomeUnknown(
          controller,
          ticket,
          callError,
          effect.effectContract.effect,
          {
            phase: "call",
            fallbackCode: "CC_MCP_TRANSPORT_OUTCOME_UNKNOWN",
          },
        );
      }
      try {
        await settleHostCall(admittedLedger, ticket, {
          status: "failed",
          error: callError,
        });
      } catch (settlementError) {
        throw outcomeUnknown(
          controller,
          ticket,
          settlementError,
          effect.effectContract.effect,
        );
      }
      throw callError;
    }

    let protocolError;
    try {
      if (
        result !== null &&
        (typeof result === "object" || typeof result === "function") &&
        isProxy(result)
      ) {
        const invalid = new TypeError("MCP result cannot be a Proxy");
        invalid.code = "CC_MCP_PROTOCOL_RESULT_INVALID";
        throw invalid;
      }
      protocolError = result?.isError === true;
    } catch (inspectionError) {
      throw outcomeUnknown(
        controller,
        ticket,
        inspectionError,
        effect.effectContract.effect,
        {
          phase: "result",
          fallbackCode: "CC_MCP_PROTOCOL_RESULT_INVALID",
        },
      );
    }
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
      throw outcomeUnknown(
        controller,
        ticket,
        settlementError,
        effect.effectContract.effect,
      );
    }
    return result;
  };

  const methodCache = new Map();
  let wrappedClient;
  // Never proxy the raw client directly: a frozen, non-configurable callTool
  // property would require the get trap to return the raw function byte-for-
  // byte, defeating the guard (and otherwise throws a Proxy invariant error).
  // An extensible facade lets reads/writes delegate to the raw instance while
  // methods still execute with the raw `this` binding.
  const facade = Object.create(Object.getPrototypeOf(client));
  wrappedClient = new Proxy(facade, {
    get(_facade, property) {
      if (property === "callTool") return callTool;
      const value = Reflect.get(client, property, client);
      if (value === client) return wrappedClient;
      if (typeof value !== "function") return value;
      const cached = methodCache.get(property);
      if (cached?.source === value) return cached.wrapper;
      const wrapper = (...args) => {
        const result = Reflect.apply(value, client, args);
        if (result === client) return wrappedClient;
        if (
          result !== null &&
          (typeof result === "object" || typeof result === "function")
        ) {
          let then;
          try {
            then = Reflect.get(result, "then", result);
          } catch (error) {
            return Promise.reject(error);
          }
          if (typeof then === "function") {
            return Promise.resolve(result).then((resolved) =>
              resolved === client ? wrappedClient : resolved,
            );
          }
        }
        return result;
      };
      methodCache.set(property, { source: value, wrapper });
      return wrapper;
    },
    set(_facade, property, value) {
      if (property === "callTool") return false;
      return Reflect.set(
        client,
        property,
        value === wrappedClient ? client : value,
        client,
      );
    },
    has(_facade, property) {
      return Reflect.has(client, property);
    },
    ownKeys() {
      return Reflect.ownKeys(client);
    },
    getOwnPropertyDescriptor(_facade, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(client, property);
      if (!descriptor) return undefined;
      if (property === "callTool") {
        return {
          configurable: true,
          enumerable: descriptor.enumerable,
          writable: false,
          value: callTool,
        };
      }
      if ("value" in descriptor) {
        return {
          configurable: true,
          enumerable: descriptor.enumerable,
          writable: descriptor.writable,
          value: Reflect.get(wrappedClient, property, wrappedClient),
        };
      }
      return {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get
          ? () => Reflect.get(wrappedClient, property, wrappedClient)
          : undefined,
        set: descriptor.set
          ? (value) =>
              Reflect.set(wrappedClient, property, value, wrappedClient)
          : undefined,
      };
    },
    defineProperty(_facade, property, descriptor) {
      // A non-configurable property on the raw object cannot be mirrored onto
      // the facade without reintroducing the get-trap invariant above.
      if (property === "callTool" || descriptor.configurable === false) {
        return false;
      }
      return Reflect.defineProperty(client, property, descriptor);
    },
    deleteProperty(_facade, property) {
      if (property === "callTool") return false;
      return Reflect.deleteProperty(client, property);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(client);
    },
    preventExtensions() {
      return false;
    },
  });
  GUARDED_MCP_CLIENTS.set(wrappedClient, {
    ledger,
    controller,
    resolveEffect,
    sessionId,
  });
  return wrappedClient;
}
