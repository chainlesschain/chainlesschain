/**
 * ChainlessChain Agent Protocol — the versioned wire contract.
 *
 * This module is pure types + constants (no runtime I/O, browser-safe).
 * It formalizes the NDJSON `stream-json` protocol spoken by
 * `cc agent --input-format stream-json --output-format stream-json`
 * (source of truth: packages/cli/src/runtime/headless-stream.js) and the
 * background-session pipe protocol
 * (packages/cli/src/lib/background-session-transport.js), plus the
 * `bg-*` WebSocket relay frames
 * (packages/cli/src/gateways/ws/background-agent-protocol.js).
 *
 * Consumers: the Node SDK client in this package, the VS Code extension,
 * the web-panel, and (as documentation) the JetBrains plugin — Kotlin
 * consumes the same wire shapes via docs/PROTOCOL.md, which is generated
 * from the same field inventory. Any field change here is a protocol
 * change: bump PROTOCOL_VERSION and update docs/PROTOCOL.md in the same
 * commit.
 */

export const PROTOCOL_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Agent output events (CLI → client), one JSON object per NDJSON line
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** First event of a session; carries the resume id. */
export interface SystemInitEvent {
  type: "system";
  subtype: "init";
  session_id: string;
  model?: string;
  provider?: string;
  permission_mode?: string;
  tools?: string[];
  input_format?: string;
  additional_directories?: string[];
  /** > 0 when the session was resumed from a prior transcript. */
  resumed_messages?: number;
}

export interface SystemEndEvent {
  type: "system";
  subtype: "end";
  turns?: number;
}

export interface TextDelta {
  type: "text_delta";
  text: string;
}

export interface ThinkingDelta {
  type: "thinking_delta";
  thinking: string;
}

/** Partial-output event (requires --include-partial-messages). */
export interface ContentDeltaEvent {
  type: "stream_event";
  event: {
    type: "content_block_delta";
    delta: TextDelta | ThinkingDelta;
  };
}

export interface ToolUseEvent {
  type: "tool_use";
  tool: string;
  args?: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool_result";
  tool: string;
  is_error?: boolean;
  error?: string | null;
  result?: unknown;
}

export interface TokenUsageEvent {
  type: "token_usage";
  usage: TokenUsage;
}

/**
 * Emitted when --interactive-approvals is on and a CONFIRM-tier decision
 * needs a human verdict. The tool is BLOCKED until an ApprovalResponse
 * arrives on stdin, or the CLI-side timeout fails closed
 * (CC_APPROVAL_TIMEOUT_MS, default 120 s).
 */
export interface ApprovalRequestEvent {
  type: "approval_request";
  id: string;
  session_id?: string;
  tool: string | null;
  command: string | null;
  risk: string | null;
  rule: string | null;
  reason: string | null;
}

export interface ApprovalResolvedEvent {
  type: "approval_resolved";
  id: string;
  approved: boolean;
  /** "user" when answered, "timeout" when the CLI failed closed. */
  via: string;
  session_id?: string;
}

/** ask_user_question round-trip (CC_INTERACTIVE_QUESTIONS=1). */
export interface QuestionRequestEvent {
  type: "question_request";
  id: string;
  question: string;
  options?: unknown[];
  multiSelect?: boolean;
  session_id?: string;
}

export interface QuestionResolvedEvent {
  type: "question_resolved";
  id: string;
  answer?: unknown;
  via?: string;
  session_id?: string;
}

export interface PlanUpdateEvent {
  type: "plan_update";
  active?: boolean;
  state?: string | null;
  items?: Array<{
    id?: string;
    title?: string;
    tool?: string;
    impact?: string;
    status?: string;
  }>;
  risk?: { level?: string; totalScore?: number } | null;
}

export interface CompactionEvent {
  type: "compaction";
  [key: string]: unknown;
}

export interface StreamRetryEvent {
  type: "stream_retry";
  [key: string]: unknown;
}

export interface IterationWarningEvent {
  type: "iteration_warning";
  message?: string;
}

export interface IterationBudgetExhaustedEvent {
  type: "iteration_budget_exhausted";
  budget?: number;
}

/** Non-protocol stdout or provider fallback / version-skew notices. */
export interface RawEvent {
  type: "raw";
  subtype?: string;
  text?: string;
  [key: string]: unknown;
}

export type ResultSubtype = "success" | "error" | "blocked" | "interrupted";

/** Terminal event of one turn. */
export interface ResultEvent {
  type: "result";
  subtype: ResultSubtype;
  is_error: boolean;
  result?: string;
  session_id?: string;
  num_turns?: number;
  duration_ms?: number;
  tool_calls?: number;
  usage?: TokenUsage;
  denials?: unknown[];
}

/** Echo of an accepted input turn (--replay-user-messages). */
export interface UserEchoEvent {
  type: "user";
  [key: string]: unknown;
}

export interface FeedbackAckEvent {
  type: "feedback_ack";
  [key: string]: unknown;
}

export interface ResumeAckEvent {
  type: "resume_ack";
  [key: string]: unknown;
}

/** Forward-compat: events this SDK version does not know yet. */
export interface UnknownAgentEvent {
  type: string;
  [key: string]: unknown;
}

export type AgentStreamEvent =
  | SystemInitEvent
  | SystemEndEvent
  | ContentDeltaEvent
  | ToolUseEvent
  | ToolResultEvent
  | TokenUsageEvent
  | ApprovalRequestEvent
  | ApprovalResolvedEvent
  | QuestionRequestEvent
  | QuestionResolvedEvent
  | PlanUpdateEvent
  | CompactionEvent
  | StreamRetryEvent
  | IterationWarningEvent
  | IterationBudgetExhaustedEvent
  | RawEvent
  | ResultEvent
  | UserEchoEvent
  | FeedbackAckEvent
  | ResumeAckEvent
  | UnknownAgentEvent;

// ─────────────────────────────────────────────────────────────────────────────
// Agent input events (client → CLI stdin), one JSON object per NDJSON line
// ─────────────────────────────────────────────────────────────────────────────

/** Optional per-turn LLM override (privacy-tier switch). */
export interface LlmHint {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface UserMessageInput {
  type: "user";
  text: string;
  /** Absolute image file paths (≤ 8 are honored). */
  images?: string[];
  llm?: LlmHint;
}

export interface InterruptInput {
  type: "interrupt";
}

export interface CompactInput {
  type: "compact";
}

export interface ApprovalResponseInput {
  type: "approval";
  id: string;
  approve: boolean;
}

export interface QuestionAnswerInput {
  type: "answer";
  id: string;
  /** null / absent cancels (handler resolves as user_timeout). */
  answer: string | string[] | null;
}

export interface PlanControlInput {
  type: "plan";
  action: "enter" | "approve" | "reject";
  /** Optional IDE review/audit payload written into the session transcript. */
  review?: {
    action?: string;
    reviewedAt?: string | null;
    conversationId?: string | null;
    snapshot?: string;
  };
  /** Back-compat shorthand for review.snapshot. */
  snapshot?: string;
}

export interface FeedbackInput {
  type: "feedback";
  turn_id?: string | null;
  kind: "positive" | "negative" | "correction";
  comment?: string | null;
}

export interface ResumeAssistInput {
  type: "resume";
  token?: string | null;
  action: "completed" | "skip";
}

export type AgentInputEvent =
  | UserMessageInput
  | InterruptInput
  | CompactInput
  | ApprovalResponseInput
  | QuestionAnswerInput
  | PlanControlInput
  | FeedbackInput
  | ResumeAssistInput;

// ─────────────────────────────────────────────────────────────────────────────
// Background-session pipe protocol (cc attach / daemon workers)
// ─────────────────────────────────────────────────────────────────────────────

export interface BgHelloClient {
  type: "hello";
  token: string;
}

export interface BgPromptClient {
  type: "prompt";
  text: string;
}

export interface BgStatusClient {
  type: "status";
}

export interface BgStopClient {
  type: "stop";
}

export interface BgDetachClient {
  type: "detach";
}

export type BgClientMessage =
  | BgHelloClient
  | BgPromptClient
  | BgStatusClient
  | BgStopClient
  | BgDetachClient;

export interface BgHelloServer {
  type: "hello";
  id?: string;
  [key: string]: unknown;
}

export interface BgAcceptedServer {
  type: "accepted";
  queued: number;
}

export interface BgStatusServer {
  type: "status";
  [key: string]: unknown;
}

export interface BgErrorServer {
  type: "error";
  message: string;
}

export interface BgStoppingServer {
  type: "stopping";
}

export interface BgTurnStartedServer {
  type: "turn-started";
  turn?: number;
  prompt?: string;
}

export interface BgTurnEndedServer {
  type: "turn-ended";
  turn?: number;
  exitCode?: number;
}

export interface BgIdleServer {
  type: "idle";
  turn?: number;
}

export interface BgClosingServer {
  type: "closing";
}

export type BgServerMessage =
  | BgHelloServer
  | BgAcceptedServer
  | BgStatusServer
  | BgErrorServer
  | BgStoppingServer
  | BgTurnStartedServer
  | BgTurnEndedServer
  | BgIdleServer
  | BgClosingServer
  | UnknownAgentEvent;

// ─────────────────────────────────────────────────────────────────────────────
// bg-* WebSocket relay frames (web-panel background-agents panel)
// ─────────────────────────────────────────────────────────────────────────────

export type BgWsRequestType =
  | "bg-list"
  | "bg-view"
  | "bg-attach"
  | "bg-prompt"
  | "bg-stop-turn"
  | "bg-detach"
  | "bg-stop"
  | "bg-rename"
  | "bg-resume";

export interface BgWsRequest {
  type: BgWsRequestType;
  bgId?: string;
  text?: string;
  name?: string;
  requestId?: string;
  [key: string]: unknown;
}

/** Unsolicited push while attached: relayed worker lifecycle event. */
export interface BgWsEventFrame {
  type: "bg-event";
  bgId: string;
  event: BgServerMessage | { type: "transport-closed" };
}

/** Unsolicited push while attached: appended log chunk. */
export interface BgWsLogFrame {
  type: "bg-log";
  bgId: string;
  chunk: string;
}

export type BgWsPushFrame = BgWsEventFrame | BgWsLogFrame;

// ─────────────────────────────────────────────────────────────────────────────
// Session & checkpoint records (cc session list --json / cc checkpoint --json)
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionRecord {
  id: string;
  title?: string;
  created_at?: string | number;
  updated_at?: string | number;
  messages?: number;
  [key: string]: unknown;
}

export interface CheckpointRecord {
  id: string;
  label?: string;
  created_at?: string | number;
  files?: number;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAgentEvent(value: unknown): value is AgentStreamEvent {
  return isObject(value) && typeof value.type === "string";
}

export function isSystemInit(
  event: AgentStreamEvent,
): event is SystemInitEvent {
  return (
    event.type === "system" &&
    (event as SystemInitEvent).subtype === "init" &&
    typeof (event as SystemInitEvent).session_id === "string"
  );
}

export function isContentDelta(
  event: AgentStreamEvent,
): event is ContentDeltaEvent {
  if (event.type !== "stream_event") return false;
  const inner = (event as ContentDeltaEvent).event;
  return isObject(inner) && inner.type === "content_block_delta";
}

/** Extract the delta payload, or null when not a content delta. */
export function contentDelta(
  event: AgentStreamEvent,
): { kind: "text" | "thinking"; text: string } | null {
  if (!isContentDelta(event)) return null;
  const delta = event.event.delta;
  if (delta.type === "text_delta") return { kind: "text", text: delta.text };
  if (delta.type === "thinking_delta")
    return { kind: "thinking", text: delta.thinking };
  return null;
}

export function isApprovalRequest(
  event: AgentStreamEvent,
): event is ApprovalRequestEvent {
  return (
    event.type === "approval_request" &&
    typeof (event as ApprovalRequestEvent).id === "string"
  );
}

export function isQuestionRequest(
  event: AgentStreamEvent,
): event is QuestionRequestEvent {
  return (
    event.type === "question_request" &&
    typeof (event as QuestionRequestEvent).id === "string"
  );
}

export function isResult(event: AgentStreamEvent): event is ResultEvent {
  return event.type === "result";
}
