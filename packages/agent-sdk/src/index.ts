/**
 * @chainlesschain/agent-sdk — Node entry.
 *
 * The protocol contract lives in ./protocol.ts (browser-safe re-export at
 * "@chainlesschain/agent-sdk/browser"). This entry adds the Node
 * transports: the stream-json spawn client, the background-session pipe
 * client, and the one-shot `--json` command wrappers.
 */

export * from "./protocol.js";
export { createNdjsonDecoder, encodeNdjson } from "./ndjson.js";
export type { NdjsonDecoderOptions } from "./ndjson.js";
export {
  AgentSession,
  buildAgentArgs,
  buildSpawnCommand,
} from "./agent-session.js";
export type {
  AgentSessionEvents,
  AgentSessionOptions,
  PermissionMode,
  SendOptions,
} from "./agent-session.js";
export {
  attachBackgroundSession,
  backgroundAgentsDir,
  readBackgroundAgentState,
} from "./background.js";
export type {
  AttachOptions,
  BackgroundAgentState,
  BackgroundSessionHandle,
} from "./background.js";
export {
  createCheckpoint,
  listCheckpoints,
  listSessions,
  restoreCheckpoint,
  runCliJson,
  showCheckpoint,
  showSession,
} from "./cli-json.js";
export type { CliRunOptions } from "./cli-json.js";
