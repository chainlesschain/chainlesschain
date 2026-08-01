import { McpEffect } from "./mcp-call-ledger.js";
import {
  createMcpRecoveryAdmissionController,
  createRecoveryGuardedMcpCallLedger,
  createRecoveryGuardedMcpClient,
} from "./mcp-ledger-recovery-admission.js";

function findMcpToolName(bundle, serverName, toolName) {
  for (const [name, executor] of Object.entries(
    bundle?.externalToolExecutors || {},
  )) {
    if (
      executor?.kind === "mcp" &&
      executor.serverName === serverName &&
      executor.toolName === toolName
    ) {
      return name;
    }
  }
  return null;
}

/**
 * Resolve a conservative effect contract for auxiliary (non-model) MCP calls.
 * Server/tool names and server-supplied read declarations are not host
 * capabilities, so they can only make a call stricter (write/destructive).
 */
export function resolveHostMcpEffect(bundle, serverName, toolName) {
  const name = findMcpToolName(bundle, serverName, toolName);
  const descriptor = name ? bundle?.externalToolDescriptors?.[name] : null;
  const declaredEffect = descriptor?.effectContract?.declaredEffect;
  const effect =
    declaredEffect === McpEffect.WRITE ||
    declaredEffect === McpEffect.DESTRUCTIVE
      ? declaredEffect
      : McpEffect.UNKNOWN;
  return {
    effectContract: {
      effect,
      trusted: false,
      source: descriptor?.source || `mcp:${serverName || "unknown"}`,
    },
  };
}

function recoveryErrorCode(recoveryError) {
  try {
    return typeof recoveryError?.code === "string" && recoveryError.code
      ? recoveryError.code
      : null;
  } catch {
    return null;
  }
}

/** Merge new verified evidence into an existing authority without lowering it. */
function tightenRecoveryController(controller, recovery, recoveryError) {
  if (!controller) {
    return createMcpRecoveryAdmissionController(recovery, { recoveryError });
  }
  if (
    typeof controller.latchUnsafe !== "function" ||
    typeof controller.latchAll !== "function" ||
    typeof controller.replaceVerifiedRecovery !== "function"
  ) {
    throw new TypeError("MCP recovery controller is invalid");
  }

  const previous = controller.admission;
  if (recovery != null) {
    // Install the complete verified projection, including exact-replay denies.
    // The controller rejects any replacement that would remove prior deny
    // authority. Re-apply the prior runtime latch below so this merge cannot
    // otherwise lower an in-process failure state.
    controller.replaceVerifiedRecovery(recovery);
  }
  if (previous?.blockMode === "all") {
    controller.latchAll(previous.reasonCode || null);
  } else if (previous?.blockMode === "unsafe") {
    controller.latchUnsafe(previous.reasonCode || null);
  }
  if (recoveryError != null) {
    controller.latchAll(recoveryErrorCode(recoveryError));
  }
  return controller;
}

/**
 * Assemble one session-scoped controller, durable ledger and host-call client.
 * Agent-core must receive rawClient + ledger; only auxiliary host calls receive
 * client, otherwise a model-originated call would be recorded twice.
 */
export function createMcpHostRecoveryRuntime({
  bundle = null,
  rawClient = bundle?.mcpClient || null,
  sessionId = null,
  sink = null,
  recovery = null,
  recoveryError = null,
  controller = null,
} = {}) {
  const admissionController = tightenRecoveryController(
    controller,
    recovery,
    recoveryError,
  );
  const ledger = createRecoveryGuardedMcpCallLedger({
    sink,
    controller: admissionController,
  });
  // Some MCP surfaces are notification/root-only facades and intentionally do
  // not expose callTool(). Keep those clients usable for their non-tool
  // methods; there is no tool call to admit or ledger-wrap in that case.
  const client =
    rawClient && typeof rawClient.callTool === "function"
      ? createRecoveryGuardedMcpClient({
          client: rawClient,
          ledger,
          controller: admissionController,
          resolveEffect: (serverName, toolName) =>
            resolveHostMcpEffect(bundle, serverName, toolName),
          sessionId,
        })
      : rawClient;
  return Object.freeze({
    controller: admissionController,
    ledger,
    client,
    rawClient,
  });
}
