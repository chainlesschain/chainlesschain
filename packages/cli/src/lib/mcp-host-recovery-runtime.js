import { McpEffect } from "./mcp-call-ledger.js";
import {
  createMcpRecoveryAdmissionController,
  createRecoveryGuardedMcpCallLedger,
  createRecoveryGuardedMcpClient,
} from "./mcp-ledger-recovery-admission.js";

// These IDE bridge operations only observe editor state. This is host-owned
// authority: server-supplied readOnlyHint metadata alone is never sufficient.
const HOST_AUTHORIZED_IDE_READS = new Set([
  "getSelection",
  "getOpenEditors",
  "getTerminalOutput",
  "getDiagnostics",
]);

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

/** Resolve a host-owned effect contract for auxiliary (non-model) MCP calls. */
export function resolveHostMcpEffect(bundle, serverName, toolName) {
  if (serverName === "ide" && HOST_AUTHORIZED_IDE_READS.has(toolName)) {
    return {
      effectContract: {
        effect: McpEffect.READ,
        trusted: true,
        source: "host:ide-context",
      },
    };
  }

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
  const admissionController =
    controller ||
    createMcpRecoveryAdmissionController(recovery, { recoveryError });
  const ledger = createRecoveryGuardedMcpCallLedger({
    sink,
    controller: admissionController,
  });
  const client = rawClient
    ? createRecoveryGuardedMcpClient({
        client: rawClient,
        ledger,
        controller: admissionController,
        resolveEffect: (serverName, toolName) =>
          resolveHostMcpEffect(bundle, serverName, toolName),
        sessionId,
      })
    : null;
  return Object.freeze({
    controller: admissionController,
    ledger,
    client,
    rawClient,
  });
}
