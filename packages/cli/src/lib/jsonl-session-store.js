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
  appendEvent,
  startSession,
  appendUserMessage,
  appendAssistantMessage,
  appendToolCall,
  appendToolResult,
  appendCompactEvent,
  readEvents,
  rebuildMessages,
  listJsonlSessions,
  forkSession,
  sessionExists,
  getLastSessionId,
  migrateLegacySessions,
  migrateLegacySessionsBatch,
  migrateLegacySessionFile,
  validateJsonlSession,
  validateAllJsonlSessions,
  sampleMigratedSessionsValidation,
  sessionPath,
  appendTokenUsage,
} from "../harness/jsonl-session-store.js";
