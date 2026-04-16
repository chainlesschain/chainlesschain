/**
 * Service Envelope — 92_Deep_Agents_Deploy 借鉴落地方案 Phase 5
 *
 * 统一 Agent Service 在 CLI / Desktop IPC / WS gateway / hosted HTTP 之间的事件 envelope。
 *
 * 设计原则:
 *   - 事件分层: session / run / approval / memory / sandbox
 *   - dot.case type, 例如 "run.token" / "approval.requested"
 *   - 顶层字段稳定: { v, type, sessionId, runId?, requestId?, ts, payload }
 *   - payload 由各类型自行约束，envelope 本身只关心 routing & correlation
 *   - 与 StreamRouter (Phase F) 衔接: fromStreamEvent() 把 stream events 包成 run.* envelope
 *
 * 该模块是纯 spec/纯函数，不持有任何状态。
 */

const ENVELOPE_VERSION = 1;

const TYPES = Object.freeze({
  // session lifecycle
  SESSION_CREATED: "session.created",
  SESSION_UPDATED: "session.updated",
  SESSION_CLOSED: "session.closed",

  // run lifecycle (1 session 多 run)
  RUN_STARTED: "run.started",
  RUN_TOKEN: "run.token",
  RUN_MESSAGE: "run.message",
  RUN_TOOL_CALL: "run.tool_call",
  RUN_TOOL_RESULT: "run.tool_result",
  RUN_ERROR: "run.error",
  RUN_ENDED: "run.ended",

  // approval gate
  APPROVAL_REQUESTED: "approval.requested",
  APPROVAL_DECIDED: "approval.decided",

  // memory
  MEMORY_UPSERTED: "memory.upserted",
  MEMORY_RECALLED: "memory.recalled",

  // sandbox
  SANDBOX_CREATED: "sandbox.created",
  SANDBOX_REUSED: "sandbox.reused",
  SANDBOX_DESTROYED: "sandbox.destroyed",
});

const VALID_TYPES = new Set(Object.values(TYPES));
const TYPE_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/**
 * createEnvelope({ type, sessionId, runId?, requestId?, payload?, ts? })
 *
 * 强制 sessionId 必填; runId/requestId 视事件类型而定.
 */
function createEnvelope({
  type,
  sessionId,
  runId = null,
  requestId = null,
  payload = null,
  ts = null,
} = {}) {
  if (!type || typeof type !== "string") {
    throw new Error("envelope.type is required (string)");
  }
  if (!TYPE_PATTERN.test(type)) {
    throw new Error(
      `envelope.type "${type}" must be dot.case (lower_snake.lower_snake)`,
    );
  }
  if (!sessionId || typeof sessionId !== "string") {
    throw new Error("envelope.sessionId is required (string)");
  }
  return {
    v: ENVELOPE_VERSION,
    type,
    sessionId,
    runId,
    requestId,
    ts: ts == null ? Date.now() : Number(ts),
    payload: payload == null ? {} : payload,
  };
}

/**
 * validateEnvelope(env) → string[]
 */
function validateEnvelope(env) {
  const errors = [];
  if (!env || typeof env !== "object") {
    return ["envelope must be an object"];
  }
  if (env.v !== ENVELOPE_VERSION) {
    errors.push(`envelope.v must be ${ENVELOPE_VERSION}`);
  }
  if (!env.type || typeof env.type !== "string") {
    errors.push("envelope.type required (string)");
  } else if (!TYPE_PATTERN.test(env.type)) {
    errors.push(`envelope.type "${env.type}" must match ${TYPE_PATTERN}`);
  }
  if (!env.sessionId || typeof env.sessionId !== "string") {
    errors.push("envelope.sessionId required (string)");
  }
  if (env.runId !== null && env.runId !== undefined && typeof env.runId !== "string") {
    errors.push("envelope.runId must be string or null");
  }
  if (
    env.requestId !== null &&
    env.requestId !== undefined &&
    typeof env.requestId !== "string"
  ) {
    errors.push("envelope.requestId must be string or null");
  }
  if (typeof env.ts !== "number" || !Number.isFinite(env.ts)) {
    errors.push("envelope.ts must be a finite number");
  }
  if (env.payload !== null && typeof env.payload !== "object") {
    errors.push("envelope.payload must be an object or null");
  }
  return errors;
}

/**
 * isKnownType(type) — 是否在 TYPES 白名单中。
 *
 * 校验 envelope.type 时**不强制** known —— 允许 service 扩展自定义类型，
 * 只要符合 dot.case 即可。本函数提供给 router/UI 用于 quick switch。
 */
function isKnownType(type) {
  return VALID_TYPES.has(type);
}

/**
 * StreamRouter event → run.* envelope.
 *
 * 映射:
 *   start       → run.started
 *   token       → run.token       (payload: { content })
 *   tool_call   → run.tool_call   (payload: { name, args, callId })
 *   tool_result → run.tool_result (payload: { callId, result, error })
 *   message     → run.message     (payload: { content })
 *   error       → run.error       (payload: { error, cause })
 *   end         → run.ended       (payload: { reason })
 */
const STREAM_TO_ENVELOPE = Object.freeze({
  start: TYPES.RUN_STARTED,
  token: TYPES.RUN_TOKEN,
  tool_call: TYPES.RUN_TOOL_CALL,
  tool_result: TYPES.RUN_TOOL_RESULT,
  message: TYPES.RUN_MESSAGE,
  error: TYPES.RUN_ERROR,
  end: TYPES.RUN_ENDED,
});

function fromStreamEvent(streamEvent, ctx = {}) {
  if (!streamEvent || typeof streamEvent !== "object") {
    throw new Error("streamEvent must be an object");
  }
  const mapped = STREAM_TO_ENVELOPE[streamEvent.type];
  if (!mapped) {
    throw new Error(`unknown stream event type "${streamEvent.type}"`);
  }
  // payload = streamEvent without "type"/"ts" passthrough
  const { type: _t, ts, ...rest } = streamEvent;
  return createEnvelope({
    type: mapped,
    sessionId: ctx.sessionId,
    runId: ctx.runId || null,
    requestId: ctx.requestId || null,
    payload: rest,
    ts: ts == null ? undefined : ts,
  });
}

/**
 * toLegacyWsMessage(env) — 兼容老 coding-agent WS envelope。
 * 老协议: { type: <dot.case>, requestId, ...payload }
 */
function toLegacyWsMessage(env) {
  const errors = validateEnvelope(env);
  if (errors.length) {
    throw new Error(`invalid envelope: ${errors.join("; ")}`);
  }
  return {
    type: env.type,
    requestId: env.requestId,
    sessionId: env.sessionId,
    runId: env.runId,
    ts: env.ts,
    ...(env.payload && typeof env.payload === "object" ? env.payload : {}),
  };
}

/**
 * parseEnvelope(input) — 严格 JSON.parse + 校验
 */
function parseEnvelope(input) {
  let env;
  if (typeof input === "string") {
    try {
      env = JSON.parse(input);
    } catch (e) {
      throw new Error(`invalid JSON: ${e.message}`);
    }
  } else {
    env = input;
  }
  const errors = validateEnvelope(env);
  if (errors.length) {
    throw new Error(`invalid envelope: ${errors.join("; ")}`);
  }
  return env;
}

module.exports = {
  ENVELOPE_VERSION,
  TYPES,
  VALID_TYPES,
  TYPE_PATTERN,
  STREAM_TO_ENVELOPE,
  createEnvelope,
  validateEnvelope,
  isKnownType,
  fromStreamEvent,
  toLegacyWsMessage,
  parseEnvelope,
};
