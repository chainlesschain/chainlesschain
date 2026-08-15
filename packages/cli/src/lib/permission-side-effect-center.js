/**
 * CLI-owned projection for the Permission & Side-effect Center.
 *
 * Runtime producers persist only bounded resource identifiers: file paths,
 * network origins, executable/runtime names, and credential VARIABLE names.
 * Credential values, URL credentials/query strings, file contents, and full
 * shell commands are never copied into this projection.
 */

import { planOpRecovery } from "./side-effect-ledger.js";
import { redactSecrets } from "./secret-scan.js";

export const PERMISSION_SIDE_EFFECT_CENTER_SCHEMA =
  "cc-permission-side-effect-center/v1";

const MAX_ITEMS = 100;
const MAX_RESOURCE_ITEMS = 32;
const MAX_RESOURCE_LENGTH = 512;
const MAX_REASON_LENGTH = 500;
const COVERAGE = new Set(["full", "partial", "none"]);
const SECRET_NAME =
  /(?:^|[_-])(?:api[_-]?key|access[_-]?key|secret|token|password|passwd|credential|authorization|auth)(?:$|[_-])/i;
const FILE_KEY =
  /^(?:path|file|file_path|target_path|targetPath|notebook_path|cwd|workspace|workspacePath|repo|repository|project|projectPath)$/i;
const NETWORK_KEY = /(?:url|uri|endpoint|origin|host)$/i;
const IRREVERSIBLE_KINDS = new Set([
  "shell",
  "git-push",
  "package-install",
  "network-mutation",
  "payment",
]);

function bounded(value, limit = MAX_RESOURCE_LENGTH) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, limit) : "";
}

function addUnique(list, value, limit = MAX_RESOURCE_ITEMS) {
  const text = bounded(value);
  if (!text || list.includes(text) || list.length >= limit) return;
  list.push(text);
}

function redacted(value, limit) {
  return bounded(redactSecrets(String(value ?? "")), limit);
}

function executableFromCommand(value) {
  let command = bounded(value, 4096);
  if (!command) return "";
  // Skip simple POSIX-style leading environment assignments without retaining
  // their values. Complex shell syntax is deliberately not parsed.
  command = command.replace(
    /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*/,
    "",
  );
  const match = command.match(/^(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/);
  const token = match ? match[1] || match[2] || match[3] : "";
  return bounded(token, 160);
}

function safeNetworkOrigin(value, key) {
  const text = bounded(value, 2048);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (parsed.protocol && parsed.host) {
      return `${parsed.protocol}//${parsed.host}`;
    }
  } catch {
    // A host field is still useful when it is not a complete URL.
  }
  if (/host$/i.test(key)) {
    return bounded(text.replace(/^.*@/, "").split(/[/?#]/, 1)[0], 255);
  }
  return "";
}

function safeFileIdentifier(value) {
  const text = bounded(value);
  if (!text) return "";
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)) {
    try {
      const parsed = new URL(text);
      if (parsed.protocol !== "file:") return "";
      return bounded(
        `file://${parsed.host}${parsed.pathname}`,
        MAX_RESOURCE_LENGTH,
      );
    } catch {
      return "";
    }
  }
  return text;
}

function normalizedResources(value) {
  const out = { files: [], network: [], processes: [], credentials: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const item of Array.isArray(value.files) ? value.files : []) {
    const networkOrigin = safeNetworkOrigin(item, "url");
    if (networkOrigin) addUnique(out.network, networkOrigin);
    else addUnique(out.files, safeFileIdentifier(item));
  }
  for (const item of Array.isArray(value.network) ? value.network : []) {
    addUnique(out.network, safeNetworkOrigin(item, "origin"));
  }
  for (const item of Array.isArray(value.processes) ? value.processes : []) {
    addUnique(out.processes, executableFromCommand(item));
  }
  for (const item of Array.isArray(value.credentials)
    ? value.credentials
    : []) {
    const name = bounded(item, 128);
    if (
      /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(name) &&
      SECRET_NAME.test(name)
    ) {
      addUnique(out.credentials, name);
    }
  }
  return out;
}

/** Safely derive actual resource identifiers from one executed tool call. */
export function collectToolResourceIdentifiers(toolName, args = {}) {
  const resources = normalizedResources(null);
  const tool = bounded(toolName, 128);
  const visit = (value, key = "", depth = 0) => {
    if (depth > 4 || value == null) return;
    if (Array.isArray(value)) {
      value
        .slice(0, MAX_RESOURCE_ITEMS)
        .forEach((entry) => visit(entry, key, depth + 1));
      return;
    }
    if (typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value).slice(0, 64)) {
        if (SECRET_NAME.test(childKey)) {
          addUnique(resources.credentials, childKey, MAX_RESOURCE_ITEMS);
          continue;
        }
        visit(childValue, childKey, depth + 1);
      }
      return;
    }
    if (typeof value !== "string") return;
    if (SECRET_NAME.test(key)) {
      addUnique(resources.credentials, key, MAX_RESOURCE_ITEMS);
      return;
    }
    if (FILE_KEY.test(key)) {
      const networkOrigin = safeNetworkOrigin(value, "url");
      if (networkOrigin) addUnique(resources.network, networkOrigin);
      else addUnique(resources.files, safeFileIdentifier(value));
    }
    if (NETWORK_KEY.test(key)) {
      addUnique(resources.network, safeNetworkOrigin(value, key));
    }
  };
  visit(args && typeof args === "object" ? args : {});

  if (tool === "run_shell") {
    addUnique(resources.processes, executableFromCommand(args?.command));
  } else if (tool === "run_code") {
    addUnique(
      resources.processes,
      args?.language ? `runtime:${bounded(args.language, 80)}` : "runtime:code",
    );
  } else if (tool === "git") {
    addUnique(resources.processes, "git");
  } else if (tool === "browser_act") {
    addUnique(resources.processes, "browser");
  }
  return resources;
}

function inferLegacyResources(op) {
  const resources = normalizedResources(op?.meta?.resources);
  if (Object.values(resources).some((items) => items.length > 0)) {
    return resources;
  }
  const key = bounded(op?.key);
  if (/^file-(?:write|delete|move)/.test(String(op?.kind || "")) && key) {
    addUnique(resources.files, key);
  }
  if (op?.kind === "git-push") addUnique(resources.processes, "git");
  if (op?.kind === "shell" && key) {
    addUnique(resources.processes, executableFromCommand(key));
  }
  return resources;
}

function findTurn(turns, op) {
  const turnId = bounded(op?.meta?.turnId, 320);
  if (turnId) return turns.find((turn) => turn?.turnId === turnId) || null;
  const toolUseId = bounded(op?.meta?.toolUseId, 320);
  if (!toolUseId) return null;
  return (
    turns.find(
      (turn) =>
        Array.isArray(turn?.toolCallIds) &&
        turn.toolCallIds.includes(toolUseId),
    ) || null
  );
}

function flattenResources(resources) {
  return Object.entries(resources).flatMap(([kind, values]) =>
    values.map((value) => `${kind}:${value}`),
  );
}

function recoveryForResources({
  resources,
  turnCoverage,
  checkpointId,
  externalOwner = false,
}) {
  const allResources = flattenResources(resources);
  const coveredResources =
    !externalOwner && turnCoverage === "full" && checkpointId
      ? resources.files.map((value) => `files:${value}`)
      : [];
  const covered = new Set(coveredResources);
  const uncoveredResources = allResources.filter((item) => !covered.has(item));
  let coverage = COVERAGE.has(turnCoverage) ? turnCoverage : "unknown";
  if (allResources.length > 0) {
    if (uncoveredResources.length === 0 && coveredResources.length > 0) {
      coverage = "full";
    } else if (coveredResources.length > 0) {
      coverage = "partial";
    } else {
      coverage = "none";
    }
  }
  return { coverage, coveredResources, uncoveredResources };
}

function normalizeDecision(value, state) {
  const decision = value && typeof value === "object" ? value : null;
  if (!decision) {
    return {
      decision: ["started", "committed", "failed", "unknown"].includes(state)
        ? "executed"
        : "not-executed",
      via: "runtime-admission",
      rule: null,
      source: null,
      reason: "no discrete gate decision was emitted",
    };
  }
  return {
    decision: redacted(decision.decision, 32) || "unknown",
    via: redacted(decision.via, 120) || "policy",
    rule: redacted(decision.rule, 256) || null,
    source: redacted(decision.source, 512) || null,
    reason: redacted(decision.reason, MAX_REASON_LENGTH),
  };
}

function unresolvedResources(kind, resources) {
  const unresolved = [];
  if (
    ["network-mutation", "payment"].includes(kind) &&
    resources.network.length === 0
  ) {
    unresolved.push("network target was not present in the recorded arguments");
  }
  if (kind === "shell" && resources.processes.length === 0) {
    unresolved.push("process identity was not present in the legacy record");
  }
  return unresolved;
}

function projectMcpRecord(record, sessionId, turns) {
  const resources = normalizedResources(null);
  const unresolved = [];
  for (const scope of Array.isArray(record?.resourceScopes)
    ? record.resourceScopes
    : []) {
    const match = bounded(scope).match(/^([A-Za-z][A-Za-z0-9_-]*)[:=](.*)$/);
    if (match && /^(?:file|path|repo|project|workspace)$/i.test(match[1])) {
      const networkOrigin = safeNetworkOrigin(match[2], "url");
      if (networkOrigin) {
        addUnique(resources.network, networkOrigin);
        addUnique(
          unresolved,
          `${match[1]} MCP scope carried a URL; only its origin is shown`,
        );
      } else {
        const identifier = safeFileIdentifier(match[2]);
        if (identifier) addUnique(resources.files, `${match[1]}:${identifier}`);
      }
    } else {
      addUnique(
        unresolved,
        `untyped MCP resource scope (${match?.[1] || "unknown"}) was redacted`,
      );
    }
  }
  for (const scope of Array.isArray(record?.networkScopes)
    ? record.networkScopes
    : []) {
    addUnique(resources.network, safeNetworkOrigin(scope, "origin"));
  }
  const serverName = bounded(record?.serverName, 128) || "unknown-server";
  addUnique(resources.processes, `mcp:${serverName}`);
  const turn = findTurn(turns, {
    meta: {
      turnId: record?.turnId,
      toolUseId: record?.ledgerId,
    },
  });
  const effect = bounded(record?.effectContract?.effect, 32) || "unknown";
  const sideEffecting =
    record?.effectContract?.sideEffecting === true ||
    ["write", "destructive", "unknown"].includes(effect);
  if (
    sideEffecting &&
    resources.files.length === 0 &&
    resources.network.length === 0
  ) {
    unresolved.push("side-effect target was absent from the MCP ledger scopes");
  }
  const checkpointId = bounded(turn?.fileCheckpointId, 320) || null;
  const resourceRecovery = sideEffecting
    ? recoveryForResources({
        resources,
        turnCoverage: COVERAGE.has(turn?.coverage) ? turn.coverage : "none",
        checkpointId,
        // MCP effects are owned by the external host. A local file checkpoint
        // is evidence for the workspace, never proof that the host-owned
        // resource can be restored.
        externalOwner: true,
      })
    : { coverage: "full", coveredResources: [], uncoveredResources: [] };
  const status = bounded(record?.status, 32) || "unknown";
  const idempotent = record?.effectContract?.idempotent === true;
  const recoveryAction =
    status === "completed"
      ? "skip"
      : !sideEffecting
        ? "redo"
        : status === "started"
          ? idempotent
            ? "redo"
            : "inspect"
          : idempotent
            ? "redo"
            : "inspect";
  const startedAt = Date.parse(record?.startedAt || "") || 0;
  const settledAt = Date.parse(record?.settledAt || "") || null;
  return {
    opId: bounded(record?.ledgerId, 320),
    tool: `mcp:${serverName}/${bounded(record?.toolName, 128) || "unknown-tool"}`,
    kind: `mcp-${effect}`,
    state: status,
    idempotent,
    irreversible: sideEffecting && resourceRecovery.coverage !== "full",
    resources,
    unresolvedResources: unresolved,
    decision: {
      decision: ["started", "completed", "failed", "cancelled"].includes(status)
        ? "executed"
        : "unknown",
      via: "mcp-host-admission",
      rule: null,
      source: redacted(record?.effectContract?.source, 512) || null,
      reason:
        record?.effectContract?.trusted === true
          ? "host-authorized effect contract"
          : "untrusted or open-world MCP effect contract",
    },
    callChain: {
      sessionId: bounded(sessionId, 320),
      turnId: bounded(record?.turnId, 320) || null,
      toolUseId: bounded(record?.ledgerId, 320) || null,
      opId: bounded(record?.ledgerId, 320),
    },
    recovery: {
      coverage: resourceRecovery.coverage,
      action: recoveryAction,
      reason:
        recoveryAction === "inspect"
          ? "MCP effect outcome or rollback coverage requires inspection"
          : recoveryAction === "redo"
            ? sideEffecting
              ? "MCP effect contract declares the call idempotent"
              : "host contract records no side effect; the call may be retried"
            : "MCP ledger records a terminal result; do not replay it",
      coveredResources: resourceRecovery.coveredResources,
      uncoveredResources: resourceRecovery.uncoveredResources,
      checkpointId,
    },
    preparedAt: startedAt,
    settledAt,
  };
}

/** Join the actual side-effect ledger with its turn/checkpoint coverage. */
export function buildPermissionSideEffectCenter({
  sessionId,
  operations = [],
  mcpRecords = [],
  turns = [],
  limit = 50,
} = {}) {
  const safeLimit = Number.isSafeInteger(Number(limit))
    ? Math.max(1, Math.min(MAX_ITEMS, Number(limit)))
    : 50;
  const opList = (Array.isArray(operations) ? operations : [])
    .slice(-safeLimit)
    .reverse();
  const turnList = Array.isArray(turns) ? turns : [];
  const operationEntries = opList.map((op) => {
    const resources = inferLegacyResources(op);
    const turn = findTurn(turnList, op);
    const turnCoverage = COVERAGE.has(turn?.coverage)
      ? turn.coverage
      : "unknown";
    const checkpointId = bounded(turn?.fileCheckpointId, 320) || null;
    const resourceRecovery = recoveryForResources({
      resources,
      turnCoverage,
      checkpointId,
    });
    const recoveryPlan = planOpRecovery(op);
    const kind = bounded(op?.kind, 80) || "unknown";
    const state = bounded(op?.state, 32) || "unknown";
    const effectMayHaveApplied = ["started", "committed", "unknown"].includes(
      state,
    );
    const irreversible =
      effectMayHaveApplied &&
      (IRREVERSIBLE_KINDS.has(kind) ||
        (["file-write", "file-delete", "file-move"].includes(kind) &&
          resourceRecovery.coverage !== "full"));
    return {
      opId: bounded(op?.opId, 320),
      tool: bounded(op?.meta?.tool, 128) || "unknown",
      kind,
      state,
      idempotent: op?.idempotent === true,
      irreversible,
      resources,
      unresolvedResources: unresolvedResources(kind, resources),
      decision: normalizeDecision(op?.meta?.permissionDecision, state),
      callChain: {
        sessionId: bounded(sessionId, 320),
        turnId: bounded(turn?.turnId || op?.meta?.turnId, 320) || null,
        toolUseId: bounded(op?.meta?.toolUseId, 320) || null,
        opId: bounded(op?.opId, 320),
      },
      recovery: {
        coverage: resourceRecovery.coverage,
        action: recoveryPlan.action,
        reason: bounded(recoveryPlan.reason, MAX_REASON_LENGTH),
        coveredResources: resourceRecovery.coveredResources,
        uncoveredResources: resourceRecovery.uncoveredResources,
        checkpointId,
      },
      preparedAt: Number(op?.preparedAt) || 0,
      settledAt: op?.settledAt == null ? null : Number(op.settledAt) || 0,
    };
  });
  const mcpEntries = (Array.isArray(mcpRecords) ? mcpRecords : [])
    .slice(-safeLimit)
    .map((record) => projectMcpRecord(record, sessionId, turnList));
  const entries = [...operationEntries, ...mcpEntries]
    .sort(
      (left, right) =>
        (right.settledAt || right.preparedAt || 0) -
          (left.settledAt || left.preparedAt || 0) ||
        left.opId.localeCompare(right.opId),
    )
    .slice(0, safeLimit);

  return {
    schema: PERMISSION_SIDE_EFFECT_CENTER_SCHEMA,
    authority: "cli",
    sessionId: bounded(sessionId, 320),
    entries,
    summary: {
      total: entries.length,
      irreversible: entries.filter((entry) => entry.irreversible).length,
      inspect: entries.filter((entry) => entry.recovery.action === "inspect")
        .length,
      incompleteCoverage: entries.filter(
        (entry) => entry.recovery.coverage !== "full",
      ).length,
    },
  };
}
