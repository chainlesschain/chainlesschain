/**
 * Coding Agent event envelope — re-exported from the canonical CLI runtime
 * module so the Desktop Main process and the CLI runtime cannot drift apart.
 *
 * Source of truth: packages/cli/src/runtime/coding-agent-events.cjs
 * Spec:            docs/design/modules/79_Coding_Agent系统.md §5
 *
 * The legacy `CodingAgentEventType` enum is preserved as an alias so the
 * 40+ existing call sites in coding-agent-session-service.js keep working
 * during the migration; new code should import `CODING_AGENT_EVENT_TYPES`
 * (the dot-case unified set) directly.
 */

const sharedCodingAgentEvents = require("../../../../../packages/cli/src/runtime/coding-agent-events.cjs");

const {
  CODING_AGENT_EVENT_VERSION,
  CODING_AGENT_EVENT_CHANNEL,
  CODING_AGENT_EVENT_TYPES,
  CodingAgentEventType,
  LEGACY_TO_UNIFIED_TYPE,
  CodingAgentSequenceTracker,
  defaultSequenceTracker,
  createCodingAgentEvent,
  wrapLegacyMessage,
  validateCodingAgentEvent,
  mapLegacyType,
} = sharedCodingAgentEvents;

module.exports = {
  CODING_AGENT_EVENT_VERSION,
  CODING_AGENT_EVENT_CHANNEL,
  CODING_AGENT_EVENT_TYPES,
  CodingAgentEventType,
  LEGACY_TO_UNIFIED_TYPE,
  CodingAgentSequenceTracker,
  defaultSequenceTracker,
  createCodingAgentEvent,
  wrapLegacyMessage,
  validateCodingAgentEvent,
  mapLegacyType,
};
