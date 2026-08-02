/**
 * @deprecated — canonical implementation lives in
 * `../harness/jsonl-session-store.js` as of the CLI Runtime Convergence
 * roadmap. This file is retained as a re-export shim for backwards
 * compatibility and will be removed once all external consumers have
 * migrated.
 *
 * Please import from `packages/cli/src/harness/jsonl-session-store.js`
 * in new code.
 */

export {
  _sessionScaleFaultHooks,
  appendEvent,
  appendEventIfHead,
  appendAuthorityEvent,
  appendAuthorityEventIfHead,
  startSession,
  appendUserMessage,
  appendAssistantMessage,
  appendToolCall,
  appendToolCallCompact,
  appendLlmRetryCompact,
  MAX_COMPACT_DURATION_MS,
  appendToolResult,
  appendCompactEvent,
  readEvents,
  readVerifiedEvents,
  findLatestEvent,
  rebuildMessages,
  getJsonlSessionMetadata,
  listJsonlSessions,
  listSessionIds,
  resolveSessionId,
  renameSession,
  deleteJsonlSession,
  pruneJsonlSessions,
  forkSession,
  createBranchSession,
  sessionExists,
  getLastSessionId,
  migrateLegacySessions,
  migrateLegacySessionsBatch,
  migrateLegacySessionFile,
  validateJsonlSession,
  validateAllJsonlSessions,
  sampleMigratedSessionsValidation,
  sessionPath,
  isUnsafeSessionId,
  appendTokenUsage,
  toIsoSafe,
  verifySession,
  verifyAllSessions,
  repairSession,
  TRANSCRIPT_CHAIN_STATUS,
} from "../harness/jsonl-session-store.js";
