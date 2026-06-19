/**
 * @deprecated Re-export shim; canonical impl is `../runtime/agent-core.js`
 * (CLI Runtime Convergence, Phase 6b). Import from there in new code.
 */

export {
  AGENT_TOOLS,
  AGENT_TOOL_REGISTRY,
  MAX_SUB_AGENT_DEPTH,
  reloadSkills,
  getAgentToolDefinitions,
  getAgentToolDescriptors,
  getCachedPython,
  getEnvironmentInfo,
  getBaseSystemPrompt,
  buildSystemPrompt,
  executeTool,
  computeProposedEdit,
  classifyError,
  isValidPackageName,
  chatWithTools,
  agentLoop,
  formatToolArgs,
  getActiveMcpServers,
  listBackgroundShellTasks,
  killBackgroundShellTask,
  killAllBackgroundShellTasks,
  writeFileVerified,
  formatProviderHttpError,
  _accumulateOllamaStream,
  _accumulateOpenAIStream,
  _accumulateAnthropicStream,
  _streamErrorDisposition,
  _isRetryableStreamError,
  _retryStreamingChat,
  _toAnthropicMessages,
  _anthropicThinkingParams,
  _normalizeAnthropicResponse,
} from "../runtime/agent-core.js";
