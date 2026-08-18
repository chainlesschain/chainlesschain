/**
 * Cowork Task Runner — executes daily tasks using SubAgentContext.
 *
 * Creates an isolated sub-agent with a template-specific system prompt,
 * runs the agent loop, and yields progress events for WS consumers.
 *
 * @module cowork-task-runner
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SubAgentContext } from "./sub-agent-context.js";
import { getTemplate, setUserTemplates } from "./cowork-task-templates.js";
import { mountTemplateMcpTools } from "./cowork-mcp-tools.js";
import { listUserTemplates } from "./cowork-template-marketplace.js";
import {
  createMcpCallLedger,
  McpEffect,
  snapshotMcpJsonRpcInput,
} from "./mcp-call-ledger.js";
import {
  createMcpRecoveryAdmissionController,
  guardMcpLedgerForRecovery,
} from "./mcp-ledger-recovery-admission.js";
import {
  assertMcpVerifiedProjectionAuthority,
  createSessionMcpLedgerSink,
  createMcpLedgerEventReducer,
  formatMcpLedgerRecoveryNotice,
  snapshotMcpLedgerRecoveryProjection,
} from "./mcp-call-ledger-store.js";
import {
  appendAuthorityEvent as appendSessionEvent,
  appendAuthorityEventIfHead as appendSessionEventIfHead,
  isUnsafeSessionId,
  readVerifiedEvents as readVerifiedSessionEvents,
  readVerifiedProjection as readVerifiedSessionProjection,
  sessionHasPersistedEvidence,
} from "../harness/jsonl-session-store.js";

// ─── Dependencies (overridable for testing) ──────────────────────────────────

export const _deps = {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  appendSessionEvent,
  appendSessionEventIfHead,
  readVerifiedSessionEvents,
  readVerifiedSessionProjection,
  sessionHasPersistedEvidence,
  randomUUID,
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 50;
const DEFAULT_TOKEN_BUDGET = 100_000;
const WORKFLOW_EFFECT_ID_RE = /^sha256:[a-f0-9]{64}$/;
const COWORK_MCP_CALL_LEDGER_UNSUPPORTED =
  "CC_COWORK_MCP_CALL_LEDGER_UNSUPPORTED";
const COWORK_MCP_SESSION_UNVERIFIED = "CC_COWORK_MCP_SESSION_UNVERIFIED";
const PROTECTED_USAGE_FIELDS = Object.freeze([
  "observabilityScope",
  "usageTelemetryProtocol",
  "usageTelemetryVersion",
]);

function coworkMcpAdmissionError(code, message, sessionId, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.sessionId = sessionId;
  return error;
}

function assertWorkflowEffectId(value) {
  if (value == null) return;
  if (typeof value !== "string" || !WORKFLOW_EFFECT_ID_RE.test(value)) {
    const error = new TypeError(
      "workflowEffectId must be a canonical sha256 identity",
    );
    error.code = "CC_COWORK_WORKFLOW_EFFECT_ID_INVALID";
    throw error;
  }
}

function workflowEffectEvidence(subAgent, workflowEffectId) {
  if (!workflowEffectId) return {};
  const attempts =
    typeof subAgent?.providerRequestAttempts === "function"
      ? subAgent.providerRequestAttempts()
      : [];
  const receipts =
    typeof subAgent?.providerRequestReceipts === "function"
      ? subAgent.providerRequestReceipts()
      : [];
  return {
    workflowEffectId,
    providerRequestAttempts: attempts,
    providerRequestReceipts: receipts,
  };
}

function assertCoworkMcpEventUsageAdmission(event, sessionId) {
  if (event?.type !== "session_start") return;
  const data =
    event.data && typeof event.data === "object" && !Array.isArray(event.data)
      ? event.data
      : {};
  if (!PROTECTED_USAGE_FIELDS.some((field) => Object.hasOwn(data, field))) {
    return;
  }
  throw coworkMcpAdmissionError(
    COWORK_MCP_CALL_LEDGER_UNSUPPORTED,
    "Scoped call-ledger sessions are not supported by Cowork MCP tasks; use agent mode or an IDE host with usage-ledger support",
    sessionId,
  );
}

function readCoworkMcpUsageAdmission(sessionId) {
  return _deps.readVerifiedSessionProjection(sessionId, () => ({
    accept(event) {
      assertCoworkMcpEventUsageAdmission(event, sessionId);
    },
    finish() {
      return true;
    },
  }));
}

/**
 * An explicitly supplied MCP session can name an existing canonical JSONL
 * authority. Verify it before mounting servers or starting a child model, and
 * refuse protected usage transcripts until Cowork persists the call ledger.
 */
export function assertCoworkMcpSessionUsageAdmission(sessionId) {
  if (sessionId == null) return;
  if (typeof sessionId !== "string" || isUnsafeSessionId(sessionId)) {
    throw coworkMcpAdmissionError(
      "CC_COWORK_MCP_SESSION_INVALID",
      "Cowork MCP session id is invalid",
      sessionId,
    );
  }

  let hasEvidence;
  try {
    hasEvidence = _deps.sessionHasPersistedEvidence(sessionId);
  } catch (cause) {
    throw coworkMcpAdmissionError(
      COWORK_MCP_SESSION_UNVERIFIED,
      "Cowork MCP session authority could not be inspected; refusing to start a model or tool",
      sessionId,
      cause,
    );
  }
  if (!hasEvidence) return;

  try {
    if (readCoworkMcpUsageAdmission(sessionId) !== true) {
      throw new Error("verified usage-admission projection was bypassed");
    }
  } catch (cause) {
    if (cause?.code === COWORK_MCP_CALL_LEDGER_UNSUPPORTED) throw cause;
    throw coworkMcpAdmissionError(
      COWORK_MCP_SESSION_UNVERIFIED,
      "Cowork MCP session authority could not be verified; refusing to start a model or tool",
      sessionId,
      cause,
    );
  }
}

function resolveCoworkMcpSessionId(requested) {
  if (requested != null) {
    if (typeof requested !== "string" || isUnsafeSessionId(requested)) {
      const error = new Error("Cowork MCP session id is invalid");
      error.code = "CC_COWORK_MCP_SESSION_INVALID";
      throw error;
    }
    return requested;
  }
  return `cowork-mcp-${_deps.randomUUID()}`;
}

function publicMcpRecoveryState(recovery, blockMode, readErrorCode = null) {
  const unsettled = Array.isArray(recovery?.unsettled)
    ? recovery.unsettled.slice(0, 20).map((record) =>
        Object.freeze({
          ledgerId: record.ledgerId,
          serverName: record.serverName,
          toolName: record.toolName,
          effect: record.effectContract?.effect || McpEffect.UNKNOWN,
        }),
      )
    : [];
  const incidents = Array.isArray(recovery?.incidents)
    ? recovery.incidents.slice(0, 20).map((incident) =>
        Object.freeze({
          code: incident.code,
          ledgerId: incident.ledgerId || null,
        }),
      )
    : [];
  // Exact replay denies are active admission authority, not display samples.
  // Never truncate this list: dropping one entry would re-enable that call.
  const replayDenied = Array.isArray(recovery?.replayDenied)
    ? recovery.replayDenied.map((entry) =>
        Object.freeze({
          ledgerId: entry.ledgerId,
          serverName: entry.serverName,
          toolName: entry.toolName,
          inputBytes: entry.inputBytes,
          replayDigest: entry.replayDigest,
        }),
      )
    : [];
  if (readErrorCode) {
    incidents.push(Object.freeze({ code: readErrorCode, ledgerId: null }));
  }
  return Object.freeze({
    blockMode,
    unsettled: Object.freeze(unsettled),
    incidents: Object.freeze(incidents),
    replayDenied: Object.freeze(replayDenied),
    headHash: recovery?.headHash || null,
    recoveryDigest: recovery?.recoveryDigest || null,
    remediation:
      recovery?.remediation || (readErrorCode ? "inspect_transcript" : null),
  });
}

function assertCoworkMcpSessionBindingEvent(event, templateId) {
  if (event?.type !== "cowork_mcp_session") return;
  const binding = event.data;
  if (
    binding?.schemaVersion !== 1 ||
    typeof binding.taskId !== "string" ||
    typeof binding.templateId !== "string"
  ) {
    const error = new Error("Cowork MCP session binding is malformed");
    error.code = "CC_COWORK_MCP_SESSION_BIND_INVALID";
    throw error;
  }
  if (binding.templateId !== templateId) {
    const error = new Error(
      `Cowork MCP session is already bound to template ${binding.templateId}`,
    );
    error.code = "CC_COWORK_MCP_SESSION_BIND_CONFLICT";
    throw error;
  }
}

function createCoworkMcpRecoveryProjection(sessionId, templateId, onFinish) {
  const ledger = createMcpLedgerEventReducer({
    sessionId,
    verified: true,
  });
  let acceptedCount = 0;
  let finished = false;
  return Object.freeze({
    accept(event) {
      if (finished) {
        const error = new Error("Cowork MCP projection accepted after finish");
        error.code = "CC_COWORK_MCP_RECOVERY_PROJECTION_INVALID";
        throw error;
      }
      acceptedCount += 1;
      assertCoworkMcpEventUsageAdmission(event, sessionId);
      assertCoworkMcpSessionBindingEvent(event, templateId);
      ledger.accept(event);
    },
    finish(authority) {
      if (finished) {
        const error = new Error("Cowork MCP projection finished twice");
        error.code = "CC_COWORK_MCP_RECOVERY_PROJECTION_INVALID";
        throw error;
      }
      finished = true;
      const recovery = ledger.finish();
      assertMcpVerifiedProjectionAuthority(authority, {
        acceptedCount,
        headHash: recovery.headHash,
      });
      const projected = Object.freeze({
        schemaVersion: 1,
        bindingAllowed: true,
        expectedHeadHash: recovery.headHash,
        recovery,
      });
      onFinish(projected);
      return projected;
    },
  });
}

function snapshotCoworkMcpRecoveryProjection(sessionId, value) {
  const snapshot = snapshotMcpJsonRpcInput(value);
  const fields = Object.keys(snapshot || {})
    .sort()
    .join(",");
  if (
    fields !== "bindingAllowed,expectedHeadHash,recovery,schemaVersion" ||
    snapshot.schemaVersion !== 1 ||
    snapshot.bindingAllowed !== true
  ) {
    const error = new TypeError("Cowork MCP recovery projection is malformed");
    error.code = "CC_COWORK_MCP_RECOVERY_PROJECTION_INVALID";
    throw error;
  }
  const recovery = snapshotMcpLedgerRecoveryProjection(
    sessionId,
    snapshot.recovery,
  );
  if (snapshot.expectedHeadHash !== recovery.headHash) {
    const error = new TypeError(
      "Cowork MCP recovery projection head is inconsistent",
    );
    error.code = "CC_COWORK_MCP_RECOVERY_PROJECTION_INVALID";
    throw error;
  }
  return Object.freeze({ ...snapshot, recovery });
}

function readCoworkMcpRecoveryProjection(sessionId, templateId) {
  const hasCustomLegacyReader =
    typeof _deps.readVerifiedSessionEvents === "function" &&
    _deps.readVerifiedSessionEvents !== readVerifiedSessionEvents;
  const readProjection = _deps.readVerifiedSessionProjection;
  if (
    typeof readProjection === "function" &&
    (readProjection !== readVerifiedSessionProjection || !hasCustomLegacyReader)
  ) {
    let projectionCreated = false;
    let finishedProjection;
    const returnedProjection = readProjection(sessionId, () => {
      if (projectionCreated) {
        const error = new Error("Cowork MCP projection factory was reused");
        error.code = "CC_COWORK_MCP_RECOVERY_PROJECTION_INVALID";
        throw error;
      }
      projectionCreated = true;
      return createCoworkMcpRecoveryProjection(
        sessionId,
        templateId,
        (value) => {
          finishedProjection = value;
        },
      );
    });
    if (
      !projectionCreated ||
      finishedProjection === undefined ||
      returnedProjection !== finishedProjection
    ) {
      const error = new Error(
        "Cowork MCP projection reader bypassed its verified factory",
      );
      error.code = "CC_COWORK_MCP_RECOVERY_PROJECTION_INVALID";
      throw error;
    }
    return snapshotCoworkMcpRecoveryProjection(sessionId, returnedProjection);
  }
  if (!hasCustomLegacyReader) {
    const error = new TypeError(
      "Verified Cowork MCP projection reader is unavailable",
    );
    error.code = "CC_COWORK_MCP_RECOVERY_PROJECTION_INVALID";
    throw error;
  }

  const verifiedEvents = snapshotMcpJsonRpcInput(
    _deps.readVerifiedSessionEvents(sessionId),
  );
  if (!Array.isArray(verifiedEvents)) {
    const invalid = new TypeError(
      "Verified Cowork MCP events must be returned synchronously as an array",
    );
    invalid.code = "CC_MCP_LEDGER_VERIFIED_EVENTS_INVALID";
    throw invalid;
  }
  let finishedProjection;
  const projection = createCoworkMcpRecoveryProjection(
    sessionId,
    templateId,
    (value) => {
      finishedProjection = value;
    },
  );
  for (const event of verifiedEvents) projection.accept(event);
  const returnedProjection = projection.finish(
    Object.freeze({
      headHash: verifiedEvents.at(-1)?.hash || null,
      eventCount: verifiedEvents.length,
      readMessages: () => [],
    }),
  );
  if (returnedProjection !== finishedProjection) {
    const error = new Error("Cowork MCP legacy projection did not finish");
    error.code = "CC_COWORK_MCP_RECOVERY_PROJECTION_INVALID";
    throw error;
  }
  return snapshotCoworkMcpRecoveryProjection(sessionId, returnedProjection);
}

/**
 * Build one session-scoped durable ledger for every template MCP call. The
 * returned ledger is handed to SubAgentContext, so agent-core must complete a
 * durable started prewrite before invoking unknown/write/destructive tools.
 */
export function prepareCoworkMcpRuntime(mcp, options = {}) {
  if (
    !mcp?.mcpClient ||
    !Array.isArray(mcp.extraToolDefinitions) ||
    mcp.extraToolDefinitions.length === 0
  ) {
    return {
      sessionId: null,
      ledger: null,
      recoveryNotice: null,
      recoveryState: null,
    };
  }

  const sessionId = resolveCoworkMcpSessionId(options.mcpSessionId);
  if (typeof options.onProgress === "function") {
    options.onProgress({ type: "mcp-session", sessionId });
  }
  let recoveryNotice = null;
  let recoveryState = null;
  let recoveryAuthority = null;
  let bindingAllowed = false;
  let expectedHeadHash = null;
  try {
    const projected = readCoworkMcpRecoveryProjection(
      sessionId,
      String(options.templateId || "free"),
    );
    const recovery = projected.recovery;
    recoveryAuthority = recovery;
    expectedHeadHash = projected.expectedHeadHash;
    bindingAllowed = projected.bindingAllowed;
    recoveryNotice = formatMcpLedgerRecoveryNotice(recovery);
    const blockMode =
      recovery.incidents.length > 0
        ? "all"
        : recovery.unsettled.length > 0
          ? "unsafe"
          : null;
    recoveryState = publicMcpRecoveryState(recovery, blockMode);
    if (recoveryNotice && typeof options.onProgress === "function") {
      options.onProgress({
        type: "mcp-recovery",
        sessionId,
        unsettled: recovery.unsettled.length,
        incidents: recovery.incidents.length,
        recovery: recoveryState,
      });
    }
  } catch (error) {
    if (error?.code === COWORK_MCP_CALL_LEDGER_UNSUPPORTED) throw error;
    throw coworkMcpAdmissionError(
      COWORK_MCP_SESSION_UNVERIFIED,
      "Cowork MCP session authority could not be verified; refusing to start a model or tool",
      sessionId,
      error,
    );
  }

  const sink = createSessionMcpLedgerSink(
    sessionId,
    _deps.appendSessionEvent === appendSessionEvent
      ? { recovery: recoveryAuthority }
      : { appendEvent: _deps.appendSessionEvent },
  );
  const recoveryController =
    createMcpRecoveryAdmissionController(recoveryState);
  return {
    sessionId,
    recoveryNotice,
    recoveryState,
    bindingAllowed,
    expectedHeadHash,
    ledger: guardMcpLedgerForRecovery(
      createMcpCallLedger({ sink }),
      recoveryController,
      { code: "CC_COWORK_MCP_RECOVERY_BLOCKED" },
    ),
  };
}

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Run a cowork task using SubAgentContext.
 *
 * @param {object} options
 * @param {string|null} options.templateId - Template ID (null = free mode)
 * @param {string} options.userMessage - User's task description
 * @param {string[]} [options.files] - File paths provided by user
 * @param {string} [options.cwd] - Working directory
 * @param {object} [options.db] - Database instance
 * @param {object} [options.llmOptions] - LLM provider/model/key
 * @param {number} [options.maxIterations] - Override iteration limit
 * @param {number} [options.tokenBudget] - Override token budget
 * @param {string} [options.mcpSessionId] - Stable MCP ledger session for resume
 * @param {string} [options.workflowEffectId] - Canonical durable workflow effect
 * @param {(request: object) => boolean|Promise<boolean>} [options.approveMcpLocalCodeExecution]
 * @returns {Promise<{ taskId: string, status: string, result: object }>}
 */
export async function runCoworkTask(options = {}) {
  const {
    templateId = null,
    userMessage,
    files = [],
    cwd = process.cwd(),
    db = null,
    llmOptions = {},
    maxIterations = DEFAULT_MAX_ITERATIONS,
    tokenBudget = DEFAULT_TOKEN_BUDGET,
    onProgress = null,
    signal = null,
    mcpSessionId = null,
    workflowEffectId = null,
    approveMcpLocalCodeExecution = null,
  } = options;

  if (!userMessage || typeof userMessage !== "string") {
    throw new Error("userMessage is required");
  }
  assertWorkflowEffectId(workflowEffectId);

  // An explicit canonical authority must be admitted before mounting local MCP
  // servers, constructing a child context, or making any provider call.
  assertCoworkMcpSessionUsageAdmission(mcpSessionId);

  // Validate file paths before starting
  if (files.length > 0) {
    const missing = files.filter((f) => !_deps.existsSync(f));
    if (missing.length > 0) {
      throw new Error(`File(s) not found: ${missing.join(", ")}`);
    }
  }

  // Merge user-installed templates (marketplace) into the registry before resolving
  try {
    setUserTemplates(listUserTemplates(cwd));
  } catch (_e) {
    // Non-fatal — marketplace absence should not break task execution
  }

  // Resolve template
  const template = getTemplate(templateId);

  // Build the task prompt with template context + files
  const taskParts = [template.systemPromptExtension];

  // N2: apply learning-layer patch for this template if one exists
  try {
    const { loadUserTemplate } = await import("./cowork-learning.js");
    const override = loadUserTemplate(cwd, template.id);
    if (override?.systemPromptExtension) {
      taskParts.push(
        `\n## 历史学习补丁 (learning patch)\n${override.systemPromptExtension}`,
      );
    }
  } catch (_e) {
    // Non-fatal — learning overrides are optional
  }

  if (files.length > 0) {
    taskParts.push(`\n## 用户提供的文件\n${files.join("\n")}`);
  }

  let task = taskParts.join("\n");

  // Mount template-declared MCP servers (best-effort, failures are tolerated)
  const mcp = await mountTemplateMcpTools(template, {
    workspaceRoot: cwd,
    approveLocalCodeExecution: approveMcpLocalCodeExecution,
    onWarn: (msg) => {
      if (onProgress) onProgress({ type: "mcp-warning", message: msg });
    },
  });
  try {
    if (onProgress && (mcp.mounted.length > 0 || mcp.skipped.length > 0)) {
      onProgress({
        type: "mcp-mounted",
        mounted: mcp.mounted,
        skipped: mcp.skipped.map((s) => s.name),
        toolCount: mcp.extraToolDefinitions.length,
      });
    }
    const mcpRuntime = prepareCoworkMcpRuntime(mcp, {
      mcpSessionId,
      onProgress,
      templateId: template.id,
    });
    if (mcpRuntime.recoveryNotice) {
      task += `\n\n## MCP Recovery Authority\n${mcpRuntime.recoveryNotice}`;
    }

    // Create isolated sub-agent context
    const subAgent = SubAgentContext.create({
      role: `cowork-${template.id}`,
      task,
      inheritedContext: null,
      maxIterations,
      tokenBudget,
      db,
      llmOptions,
      cwd,
      onProgress,
      signal,
      ...(workflowEffectId ? { workflowEffectId } : {}),
      extraToolDefinitions: mcp.extraToolDefinitions,
      externalToolDescriptors: mcp.externalToolDescriptors,
      externalToolExecutors: mcp.externalToolExecutors,
      mcpClient: mcp.mcpClient,
      ...(mcpRuntime.ledger ? { mcpCallLedger: mcpRuntime.ledger } : {}),
    });

    const taskId = subAgent.id;

    if (mcpRuntime.sessionId && mcpRuntime.bindingAllowed) {
      const mapped = await _deps.appendSessionEventIfHead(
        mcpRuntime.sessionId,
        "cowork_mcp_session",
        {
          schemaVersion: 1,
          taskId,
          templateId: template.id,
        },
        mcpRuntime.expectedHeadHash,
      );
      if (mapped === false) {
        const error = new Error(
          "Cowork MCP task/session binding was not persisted",
        );
        error.code = "CC_COWORK_MCP_SESSION_BIND_FAILED";
        throw error;
      }
    }

    // Build loop options — pass shell policy overrides if template declares them
    const loopOptions =
      mcpRuntime.sessionId && mcpRuntime.bindingAllowed
        ? { sessionId: mcpRuntime.sessionId }
        : {};
    if (
      Array.isArray(template.shellPolicyOverrides) &&
      template.shellPolicyOverrides.length
    ) {
      loopOptions.shellPolicyOverrides = template.shellPolicyOverrides;
    }

    // Run the agent with the user's message
    try {
      const result = await subAgent.run(userMessage, loopOptions);
      const entry = {
        taskId,
        status: subAgent.status,
        templateId: template.id,
        templateName: template.name,
        ...(mcpRuntime.sessionId ? { mcpSessionId: mcpRuntime.sessionId } : {}),
        ...workflowEffectEvidence(subAgent, workflowEffectId),
        result,
      };
      _appendHistory(cwd, entry, userMessage);
      return entry;
    } catch (err) {
      // A durable workflow already marked this outer effect as dispatched.
      // Converting a child/provider exception into an ordinary failed result
      // would authorize the step retry path even though the physical provider
      // outcome may be unknown. Propagate so the runtime keeps it pending and
      // requires reconciliation.
      if (workflowEffectId) throw err;
      const entry = {
        taskId,
        status: "failed",
        templateId: template.id,
        templateName: template.name,
        ...(mcpRuntime.sessionId ? { mcpSessionId: mcpRuntime.sessionId } : {}),
        ...workflowEffectEvidence(subAgent, workflowEffectId),
        result: {
          summary: `Task failed: ${err.message}`,
          artifacts: [],
          tokenCount: 0,
          toolsUsed: [],
          iterationCount: 0,
        },
      };
      _appendHistory(cwd, entry, userMessage);
      return entry;
    }
  } finally {
    await mcp.cleanup();
  }
}

// ─── Parallel Runner (Orchestrator) ──────────────────────────────────────────

/**
 * Run a cowork task using the Orchestrator for multi-agent parallel execution.
 *
 * @param {object} options - Same as runCoworkTask, plus:
 * @param {number} [options.agents] - Number of parallel agents (default 3, max 10)
 * @param {string} [options.strategy] - Routing strategy (default "round-robin")
 * @param {string} [options.mcpSessionId] - Canonical session authority to admit
 * @param {function} [options.onProgress] - Progress callback
 * @param {AbortSignal} [options.signal] - Cancellation signal
 * @returns {Promise<{ taskId: string, status: string, result: object }>}
 */
export async function runCoworkTaskParallel(options = {}) {
  const {
    templateId = null,
    userMessage,
    files = [],
    cwd = process.cwd(),
    agents = 3,
    strategy,
    onProgress = null,
    signal = null,
    mcpSessionId = null,
  } = options;

  if (!userMessage || typeof userMessage !== "string") {
    throw new Error("userMessage is required");
  }

  // Parallel orchestration can make provider calls while decomposing and
  // dispatching work. Apply the same canonical authority gate as sequential
  // Cowork before constructing the orchestrator or starting any provider.
  assertCoworkMcpSessionUsageAdmission(mcpSessionId);

  if (files.length > 0) {
    const missing = files.filter((f) => !_deps.existsSync(f));
    if (missing.length > 0) {
      throw new Error(`File(s) not found: ${missing.join(", ")}`);
    }
  }

  const template = getTemplate(templateId);

  // Build full task description for the orchestrator
  const taskParts = [
    `[Cowork Template: ${template.name}]`,
    template.systemPromptExtension,
    `\n## 用户需求\n${userMessage}`,
  ];
  if (files.length > 0) {
    taskParts.push(`\n## 用户提供的文件\n${files.join("\n")}`);
  }
  const fullTask = taskParts.join("\n");

  try {
    const { Orchestrator, TASK_SOURCE } = await import("./orchestrator.js");

    const orch = new Orchestrator({
      cwd,
      maxParallel: Math.min(parseInt(agents, 10) || 3, 10),
      ciCommand: "echo ok",
      agents: strategy ? { strategy } : undefined,
      verbose: false,
    });

    // Wire progress events
    if (onProgress) {
      orch.on("task:added", (t) =>
        onProgress({
          type: "orchestrator-started",
          taskId: t.id,
          subtaskCount: 0,
        }),
      );
      orch.on("task:decomposed", (t) =>
        onProgress({
          type: "orchestrator-decomposed",
          taskId: t.id,
          subtaskCount: t.subtasks?.length || 0,
        }),
      );
      orch.on("agents:dispatched", (ev) =>
        onProgress({
          type: "agents-dispatched",
          agentCount: ev.agents?.length || 0,
        }),
      );
      orch.on("agent:output", (ev) =>
        onProgress({
          type: "agent-progress",
          agentIndex: ev.agentIndex,
          status: ev.status,
          output: ev.output?.slice(0, 200),
        }),
      );
    }

    // Handle cancellation
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          orch.stopCronWatch();
        },
        { once: true },
      );
    }

    const orchResult = await orch.addTask(fullTask, {
      source: TASK_SOURCE.CLI,
      cwd,
      runCI: false,
      notify: false,
    });

    const entry = {
      taskId: orchResult.id,
      status: orchResult.status === "completed" ? "completed" : "failed",
      templateId: template.id,
      templateName: template.name,
      parallel: true,
      agentCount: agents,
      result: {
        summary:
          orchResult.agentResults
            ?.map((r) => r.output?.slice(0, 500))
            .join("\n---\n") || "Parallel execution completed",
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: orchResult.retries || 0,
        subtaskCount: orchResult.subtasks?.length || 0,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  } catch (err) {
    const entry = {
      taskId: `cowork-parallel-${Date.now()}`,
      status: "failed",
      templateId: template.id,
      templateName: template.name,
      parallel: true,
      result: {
        summary: `Parallel task failed: ${err.message}`,
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: 0,
        subtaskCount: 0,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  }
}

// ─── Debate Runner (Multi-perspective Review) ───────────────────────────────

/**
 * Run a cowork task in debate mode — multiple reviewer perspectives converge
 * into a final verdict via moderator synthesis.
 *
 * @param {object} options
 * @param {string|null} options.templateId - Should be "code-review" or null
 * @param {string} options.userMessage - Target description / review instructions
 * @param {string[]} [options.files] - File paths to review (concatenated as code body)
 * @param {string[]} [options.perspectives] - Override template perspectives
 * @param {string} [options.cwd] - Working directory for history
 * @param {object} [options.llmOptions] - LLM provider/model/key
 * @param {string} [options.mcpSessionId] - Canonical session authority to admit
 * @param {function} [options.onProgress] - Progress callback
 * @returns {Promise<{ taskId, status, result }>}
 */
export async function runCoworkDebate(options = {}) {
  const {
    templateId = "code-review",
    userMessage,
    files = [],
    perspectives,
    cwd = process.cwd(),
    llmOptions = {},
    onProgress = null,
    mcpSessionId = null,
  } = options;

  if (!userMessage || typeof userMessage !== "string") {
    throw new Error("userMessage is required");
  }

  // Debate performs multiple reviewer calls plus moderator synthesis. Refuse a
  // protected or unverifiable authority before emitting progress or invoking
  // the first reviewer, matching sequential and parallel Cowork admission.
  assertCoworkMcpSessionUsageAdmission(mcpSessionId);

  if (files.length > 0) {
    const missing = files.filter((f) => !_deps.existsSync(f));
    if (missing.length > 0) {
      throw new Error(`File(s) not found: ${missing.join(", ")}`);
    }
  }

  const template = getTemplate(templateId);
  const reviewPerspectives = perspectives ||
    template.debatePerspectives || [
      "performance",
      "security",
      "maintainability",
    ];

  // Build code body from files (or from userMessage if no files provided)
  let code = "";
  if (files.length > 0) {
    const chunks = files.map((f) => {
      try {
        return `// ===== ${f} =====\n${_deps.readFileSync(f, "utf-8")}`;
      } catch (err) {
        return `// ===== ${f} (read error: ${err.message}) =====`;
      }
    });
    code = chunks.join("\n\n");
  } else {
    code = userMessage;
  }

  const taskId = `cowork-debate-${Date.now()}`;

  if (onProgress) {
    onProgress({ type: "debate-started", perspectives: reviewPerspectives });
  }

  try {
    const { startDebate } = await import("./cowork/debate-review-cli.js");
    const debateResult = await startDebate({
      target: userMessage,
      code,
      perspectives: reviewPerspectives,
      llmOptions,
    });

    if (onProgress) {
      onProgress({ type: "debate-completed", verdict: debateResult.verdict });
    }

    const entry = {
      taskId,
      status: "completed",
      templateId: template.id,
      templateName: template.name,
      mode: "debate",
      result: {
        summary: debateResult.summary,
        verdict: debateResult.verdict,
        consensusScore: debateResult.consensusScore,
        reviews: debateResult.reviews,
        perspectives: debateResult.perspectives,
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: debateResult.reviews.length + 1,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  } catch (err) {
    const entry = {
      taskId,
      status: "failed",
      templateId: template.id,
      templateName: template.name,
      mode: "debate",
      result: {
        summary: `Debate failed: ${err.message}`,
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: 0,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  }
}

// ─── History Persistence ─────────────────────────────────────────────────────

function _appendHistory(cwd, entry, userMessage) {
  try {
    const histDir = join(cwd, ".chainlesschain", "cowork");
    _deps.mkdirSync(histDir, { recursive: true });
    const record = {
      ...entry,
      userMessage,
      timestamp: new Date().toISOString(),
    };
    _deps.appendFileSync(
      join(histDir, "history.jsonl"),
      JSON.stringify(record) + "\n",
      "utf-8",
    );
  } catch (_e) {
    // Best-effort — don't fail the task for history write errors
  }
}

// ===== V2 Surface: Cowork Task Runner governance overlay (CLI v0.139.0) =====
export const RUNNER_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  RETIRED: "retired",
});
export const RUNNER_EXEC_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _rpTrans = new Map([
  [
    RUNNER_PROFILE_MATURITY_V2.PENDING,
    new Set([
      RUNNER_PROFILE_MATURITY_V2.ACTIVE,
      RUNNER_PROFILE_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    RUNNER_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      RUNNER_PROFILE_MATURITY_V2.PAUSED,
      RUNNER_PROFILE_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    RUNNER_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      RUNNER_PROFILE_MATURITY_V2.ACTIVE,
      RUNNER_PROFILE_MATURITY_V2.RETIRED,
    ]),
  ],
  [RUNNER_PROFILE_MATURITY_V2.RETIRED, new Set()],
]);
const _rpTerminal = new Set([RUNNER_PROFILE_MATURITY_V2.RETIRED]);
const _reTrans = new Map([
  [
    RUNNER_EXEC_LIFECYCLE_V2.QUEUED,
    new Set([
      RUNNER_EXEC_LIFECYCLE_V2.RUNNING,
      RUNNER_EXEC_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    RUNNER_EXEC_LIFECYCLE_V2.RUNNING,
    new Set([
      RUNNER_EXEC_LIFECYCLE_V2.SUCCEEDED,
      RUNNER_EXEC_LIFECYCLE_V2.FAILED,
      RUNNER_EXEC_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [RUNNER_EXEC_LIFECYCLE_V2.SUCCEEDED, new Set()],
  [RUNNER_EXEC_LIFECYCLE_V2.FAILED, new Set()],
  [RUNNER_EXEC_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _rpsV2 = new Map();
const _resV2 = new Map();
let _rpMaxActivePerOwner = 8;
let _rpMaxPendingExecsPerProfile = 15;
let _rpIdleMs = 14 * 24 * 60 * 60 * 1000;
let _reStuckMs = 20 * 60 * 1000;

function _rpPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveRunnerProfilesPerOwnerV2(n) {
  _rpMaxActivePerOwner = _rpPos(n, "maxActiveRunnerProfilesPerOwner");
}
export function getMaxActiveRunnerProfilesPerOwnerV2() {
  return _rpMaxActivePerOwner;
}
export function setMaxPendingRunnerExecsPerProfileV2(n) {
  _rpMaxPendingExecsPerProfile = _rpPos(n, "maxPendingRunnerExecsPerProfile");
}
export function getMaxPendingRunnerExecsPerProfileV2() {
  return _rpMaxPendingExecsPerProfile;
}
export function setRunnerProfileIdleMsV2(n) {
  _rpIdleMs = _rpPos(n, "runnerProfileIdleMs");
}
export function getRunnerProfileIdleMsV2() {
  return _rpIdleMs;
}
export function setRunnerExecStuckMsV2(n) {
  _reStuckMs = _rpPos(n, "runnerExecStuckMs");
}
export function getRunnerExecStuckMsV2() {
  return _reStuckMs;
}

export function _resetStateRunnerV2() {
  _rpsV2.clear();
  _resV2.clear();
  _rpMaxActivePerOwner = 8;
  _rpMaxPendingExecsPerProfile = 15;
  _rpIdleMs = 14 * 24 * 60 * 60 * 1000;
  _reStuckMs = 20 * 60 * 1000;
}

export function registerRunnerProfileV2({
  id,
  owner,
  template,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_rpsV2.has(id))
    throw new Error(`runner profile ${id} already registered`);
  const now = Date.now();
  const p = {
    id,
    owner,
    template: template || "default",
    status: RUNNER_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    retiredAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _rpsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
function _rpCheckP(from, to) {
  const a = _rpTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid runner profile transition ${from} → ${to}`);
}
function _rpCountActive(owner) {
  let n = 0;
  for (const p of _rpsV2.values())
    if (p.owner === owner && p.status === RUNNER_PROFILE_MATURITY_V2.ACTIVE)
      n++;
  return n;
}

export function activateRunnerProfileV2(id) {
  const p = _rpsV2.get(id);
  if (!p) throw new Error(`runner profile ${id} not found`);
  _rpCheckP(p.status, RUNNER_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === RUNNER_PROFILE_MATURITY_V2.PAUSED;
  if (!recovery) {
    const c = _rpCountActive(p.owner);
    if (c >= _rpMaxActivePerOwner)
      throw new Error(
        `max active runner profiles per owner (${_rpMaxActivePerOwner}) reached for ${p.owner}`,
      );
  }
  const now = Date.now();
  p.status = RUNNER_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseRunnerProfileV2(id) {
  const p = _rpsV2.get(id);
  if (!p) throw new Error(`runner profile ${id} not found`);
  _rpCheckP(p.status, RUNNER_PROFILE_MATURITY_V2.PAUSED);
  p.status = RUNNER_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function retireRunnerProfileV2(id) {
  const p = _rpsV2.get(id);
  if (!p) throw new Error(`runner profile ${id} not found`);
  _rpCheckP(p.status, RUNNER_PROFILE_MATURITY_V2.RETIRED);
  const now = Date.now();
  p.status = RUNNER_PROFILE_MATURITY_V2.RETIRED;
  p.updatedAt = now;
  if (!p.retiredAt) p.retiredAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchRunnerProfileV2(id) {
  const p = _rpsV2.get(id);
  if (!p) throw new Error(`runner profile ${id} not found`);
  if (_rpTerminal.has(p.status))
    throw new Error(`cannot touch terminal runner profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getRunnerProfileV2(id) {
  const p = _rpsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listRunnerProfilesV2() {
  return [..._rpsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}

function _reCountPending(profileId) {
  let n = 0;
  for (const e of _resV2.values())
    if (
      e.profileId === profileId &&
      (e.status === RUNNER_EXEC_LIFECYCLE_V2.QUEUED ||
        e.status === RUNNER_EXEC_LIFECYCLE_V2.RUNNING)
    )
      n++;
  return n;
}

export function createRunnerExecV2({
  id,
  profileId,
  taskInput,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!profileId || typeof profileId !== "string")
    throw new Error("profileId is required");
  if (_resV2.has(id)) throw new Error(`runner exec ${id} already exists`);
  if (!_rpsV2.has(profileId))
    throw new Error(`runner profile ${profileId} not found`);
  const pending = _reCountPending(profileId);
  if (pending >= _rpMaxPendingExecsPerProfile)
    throw new Error(
      `max pending runner execs per profile (${_rpMaxPendingExecsPerProfile}) reached for ${profileId}`,
    );
  const now = Date.now();
  const e = {
    id,
    profileId,
    taskInput: taskInput || "",
    status: RUNNER_EXEC_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _resV2.set(id, e);
  return { ...e, metadata: { ...e.metadata } };
}
function _reCheckE(from, to) {
  const a = _reTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid runner exec transition ${from} → ${to}`);
}
export function startRunnerExecV2(id) {
  const e = _resV2.get(id);
  if (!e) throw new Error(`runner exec ${id} not found`);
  _reCheckE(e.status, RUNNER_EXEC_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  e.status = RUNNER_EXEC_LIFECYCLE_V2.RUNNING;
  e.updatedAt = now;
  if (!e.startedAt) e.startedAt = now;
  return { ...e, metadata: { ...e.metadata } };
}
export function succeedRunnerExecV2(id) {
  const e = _resV2.get(id);
  if (!e) throw new Error(`runner exec ${id} not found`);
  _reCheckE(e.status, RUNNER_EXEC_LIFECYCLE_V2.SUCCEEDED);
  const now = Date.now();
  e.status = RUNNER_EXEC_LIFECYCLE_V2.SUCCEEDED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  return { ...e, metadata: { ...e.metadata } };
}
export function failRunnerExecV2(id, reason) {
  const e = _resV2.get(id);
  if (!e) throw new Error(`runner exec ${id} not found`);
  _reCheckE(e.status, RUNNER_EXEC_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  e.status = RUNNER_EXEC_LIFECYCLE_V2.FAILED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  if (reason) e.metadata.failReason = String(reason);
  return { ...e, metadata: { ...e.metadata } };
}
export function cancelRunnerExecV2(id, reason) {
  const e = _resV2.get(id);
  if (!e) throw new Error(`runner exec ${id} not found`);
  _reCheckE(e.status, RUNNER_EXEC_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  e.status = RUNNER_EXEC_LIFECYCLE_V2.CANCELLED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  if (reason) e.metadata.cancelReason = String(reason);
  return { ...e, metadata: { ...e.metadata } };
}
export function getRunnerExecV2(id) {
  const e = _resV2.get(id);
  if (!e) return null;
  return { ...e, metadata: { ...e.metadata } };
}
export function listRunnerExecsV2() {
  return [..._resV2.values()].map((e) => ({
    ...e,
    metadata: { ...e.metadata },
  }));
}

export function autoPauseIdleRunnerProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _rpsV2.values())
    if (
      p.status === RUNNER_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _rpIdleMs
    ) {
      p.status = RUNNER_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckRunnerExecsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const e of _resV2.values())
    if (
      e.status === RUNNER_EXEC_LIFECYCLE_V2.RUNNING &&
      e.startedAt != null &&
      t - e.startedAt >= _reStuckMs
    ) {
      e.status = RUNNER_EXEC_LIFECYCLE_V2.FAILED;
      e.updatedAt = t;
      if (!e.settledAt) e.settledAt = t;
      e.metadata.failReason = "auto-fail-stuck";
      flipped.push(e.id);
    }
  return { flipped, count: flipped.length };
}

export function getRunnerGovStatsV2() {
  const profilesByStatus = {};
  for (const s of Object.values(RUNNER_PROFILE_MATURITY_V2))
    profilesByStatus[s] = 0;
  for (const p of _rpsV2.values()) profilesByStatus[p.status]++;
  const execsByStatus = {};
  for (const s of Object.values(RUNNER_EXEC_LIFECYCLE_V2)) execsByStatus[s] = 0;
  for (const e of _resV2.values()) execsByStatus[e.status]++;
  return {
    totalRunnerProfilesV2: _rpsV2.size,
    totalRunnerExecsV2: _resV2.size,
    maxActiveRunnerProfilesPerOwner: _rpMaxActivePerOwner,
    maxPendingRunnerExecsPerProfile: _rpMaxPendingExecsPerProfile,
    runnerProfileIdleMs: _rpIdleMs,
    runnerExecStuckMs: _reStuckMs,
    profilesByStatus,
    execsByStatus,
  };
}
