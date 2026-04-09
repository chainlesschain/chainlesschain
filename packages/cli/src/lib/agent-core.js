/**
 * @deprecated — canonical implementation lives in
 * `../runtime/agent-core.js` as of the CLI Runtime Convergence roadmap
 * (Phase 6b, 2026-04-09). This file is retained as a re-export shim for
 * backwards compatibility and will be removed once all external consumers
 * have migrated.
 *
 * Please import from `packages/cli/src/runtime/agent-core.js` in new code.
 */

export {
  AGENT_TOOLS,
  AGENT_TOOL_REGISTRY,
  getAgentToolDefinitions,
  getAgentToolDescriptors,
  getCachedPython,
  getEnvironmentInfo,
  getBaseSystemPrompt,
  buildSystemPrompt,
  executeTool,
  classifyError,
  isValidPackageName,
  chatWithTools,
  agentLoop,
  formatToolArgs,
} from "../runtime/agent-core.js";
