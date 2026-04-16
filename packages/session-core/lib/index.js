/**
 * Session module — 统一导出
 *
 * Phase A of Managed Agents parity plan (docs/design/modules/91_Managed_Agents对标计划.md)
 */

const {
  SessionHandle,
  STATUS,
  APPROVAL_POLICIES,
  VALID_TRANSITIONS,
  generateSessionId,
} = require("./session-handle.js");

const {
  TraceStore,
  TRACE_TYPES,
  DEFAULT_MAX_EVENTS,
  getDefaultTraceStore,
  setDefaultTraceStore,
} = require("./trace-store.js");

const {
  AgentDefinition,
  AgentDefinitionCache,
  normalizeToolSchema,
  generateAgentId,
} = require("./agent-definition.js");

const { SessionManager, MS_PER_HOUR } = require("./session-manager.js");

const {
  IdleParker,
  DEFAULT_IDLE_THRESHOLD_MS,
  DEFAULT_INTERVAL_MS,
} = require("./idle-parker.js");

const {
  AgentGroup,
  RELATIONSHIPS,
  generateGroupId,
  validateRelationship,
} = require("./agent-group.js");

const {
  SharedTaskList,
  TASK_STATUS,
  ConcurrencyError,
  generateTaskId,
} = require("./shared-task-list.js");

const {
  MemoryStore,
  SCOPE: MEMORY_SCOPE,
  defaultScorer: defaultMemoryScorer,
  validateScope: validateMemoryScope,
  generateMemoryId,
} = require("./memory-store.js");

const {
  MemoryConsolidator,
  defaultExtractor: defaultMemoryExtractor,
  CATEGORIES: MEMORY_CATEGORIES,
} = require("./memory-consolidator.js");

const {
  ApprovalGate,
  POLICY: APPROVAL_POLICY,
  RISK: APPROVAL_RISK,
  DECISION: APPROVAL_DECISION,
  baseDecision: approvalBaseDecision,
} = require("./approval-gate.js");

const {
  BetaFlags,
  FeatureNotEnabledError,
  FLAG_PATTERN: BETA_FLAG_PATTERN,
} = require("./beta-flags.js");

const {
  StreamRouter,
  STREAM_EVENT,
  normalize: normalizeStream,
  isAsyncIterable,
} = require("./stream-router.js");

const {
  createMemoryFileAdapter,
  createBetaFlagsFileAdapter,
  createApprovalGateFileAdapter,
  hydrateMemoryStore,
} = require("./file-adapters.js");

const {
  BUNDLE_FILES,
  BUNDLE_MODES,
  DEFAULT_MANIFEST,
  validateManifest,
  validateBundle,
  parseMinimalToml,
} = require("./agent-bundle-schema.js");

const { loadBundle } = require("./agent-bundle-loader.js");

const {
  resolveBundle,
  applyUserMemorySeed,
  parseUserMdSeed,
  buildSystemPrompt,
  DEFAULT_SEED_TAG,
} = require("./agent-bundle-resolver.js");

const {
  ENVELOPE_VERSION,
  TYPES: ENVELOPE_TYPES,
  TYPE_PATTERN: ENVELOPE_TYPE_PATTERN,
  STREAM_TO_ENVELOPE,
  createEnvelope,
  validateEnvelope,
  isKnownType: isKnownEnvelopeType,
  fromStreamEvent: envelopeFromStreamEvent,
  toLegacyWsMessage: envelopeToLegacyWsMessage,
  parseEnvelope,
} = require("./service-envelope.js");

const {
  SCOPES: SANDBOX_SCOPES,
  SCOPE_DEFAULTS: SANDBOX_SCOPE_DEFAULTS,
  DEFAULT_SANDBOX_POLICY,
  validateSandboxPolicy,
  mergeSandboxPolicy,
  isSandboxExpired,
  isSandboxIdleExpired,
  shouldReuseSandbox,
  resolveBundleSandboxPolicy,
} = require("./sandbox-policy.js");

const {
  QualityGate,
  CHECK_RESULT: QUALITY_CHECK_RESULT,
  AGGREGATE: QUALITY_AGGREGATE,
  validateChecker: validateQualityChecker,
  aggregateScore: qualityAggregateScore,
  createProtagonistChecker,
  createDurationChecker,
  createThresholdChecker,
} = require("./quality-gate.js");

const {
  TRANSPORTS: MCP_TRANSPORTS,
  REMOTE_TRANSPORTS: MCP_REMOTE_TRANSPORTS,
  MODE_ALLOWED_TRANSPORTS,
  inferTransport: inferMcpTransport,
  validateMcpServer,
  filterMcpServers,
  annotateCompatibility: annotateMcpCompatibility,
} = require("./mcp-policy.js");

module.exports = {
  // SessionHandle
  SessionHandle,
  SESSION_STATUS: STATUS,
  APPROVAL_POLICIES,
  VALID_TRANSITIONS,
  generateSessionId,
  // TraceStore
  TraceStore,
  TRACE_TYPES,
  DEFAULT_MAX_EVENTS,
  getDefaultTraceStore,
  setDefaultTraceStore,
  // AgentDefinition
  AgentDefinition,
  AgentDefinitionCache,
  normalizeToolSchema,
  generateAgentId,
  // SessionManager
  SessionManager,
  MS_PER_HOUR,
  // IdleParker
  IdleParker,
  DEFAULT_IDLE_THRESHOLD_MS,
  DEFAULT_INTERVAL_MS,
  // AgentGroup
  AgentGroup,
  RELATIONSHIPS,
  generateGroupId,
  validateRelationship,
  // SharedTaskList
  SharedTaskList,
  TASK_STATUS,
  ConcurrencyError,
  generateTaskId,
  // MemoryStore
  MemoryStore,
  MEMORY_SCOPE,
  defaultMemoryScorer,
  validateMemoryScope,
  generateMemoryId,
  // MemoryConsolidator
  MemoryConsolidator,
  defaultMemoryExtractor,
  MEMORY_CATEGORIES,
  // ApprovalGate
  ApprovalGate,
  APPROVAL_POLICY,
  APPROVAL_RISK,
  APPROVAL_DECISION,
  approvalBaseDecision,
  // BetaFlags
  BetaFlags,
  FeatureNotEnabledError,
  BETA_FLAG_PATTERN,
  // StreamRouter
  StreamRouter,
  STREAM_EVENT,
  normalizeStream,
  isAsyncIterable,
  // File adapters
  createMemoryFileAdapter,
  createBetaFlagsFileAdapter,
  createApprovalGateFileAdapter,
  hydrateMemoryStore,
  // Agent Bundle (Phase 1 of 92_Deep_Agents_Deploy 借鉴落地方案)
  BUNDLE_FILES,
  BUNDLE_MODES,
  DEFAULT_MANIFEST,
  validateManifest,
  validateBundle,
  parseMinimalToml,
  loadBundle,
  resolveBundle,
  applyUserMemorySeed,
  parseUserMdSeed,
  buildSystemPrompt,
  DEFAULT_SEED_TAG,
  // Service Envelope (Phase 5 of 92_Deep_Agents_Deploy 借鉴落地方案)
  ENVELOPE_VERSION,
  ENVELOPE_TYPES,
  ENVELOPE_TYPE_PATTERN,
  STREAM_TO_ENVELOPE,
  createEnvelope,
  validateEnvelope,
  isKnownEnvelopeType,
  envelopeFromStreamEvent,
  envelopeToLegacyWsMessage,
  parseEnvelope,
  // Sandbox Policy (Phase 4 of 92_Deep_Agents_Deploy 借鉴落地方案)
  SANDBOX_SCOPES,
  SANDBOX_SCOPE_DEFAULTS,
  DEFAULT_SANDBOX_POLICY,
  validateSandboxPolicy,
  mergeSandboxPolicy,
  isSandboxExpired,
  isSandboxIdleExpired,
  shouldReuseSandbox,
  resolveBundleSandboxPolicy,
  // MCP Policy (Phase 3 of 92_Deep_Agents_Deploy 借鉴落地方案)
  MCP_TRANSPORTS,
  MCP_REMOTE_TRANSPORTS,
  MODE_ALLOWED_TRANSPORTS,
  inferMcpTransport,
  validateMcpServer,
  filterMcpServers,
  annotateMcpCompatibility,
  // QualityGate (Path B-2 of CutClaw architecture alignment)
  QualityGate,
  QUALITY_CHECK_RESULT,
  QUALITY_AGGREGATE,
  validateQualityChecker,
  qualityAggregateScore,
  createProtagonistChecker,
  createDurationChecker,
  createThresholdChecker,
};
