import {
  captureAgentExecutionPolicy,
  resolveAgentToolSelection,
} from "../lib/agent-execution-policy.js";
import {
  executeTool as coreExecuteTool,
  getAgentToolDefinitions,
} from "../runtime/agent-core.js";

/** Direct /auto and /plan tools share the startup ceiling and live permissions. */
export function createReplToolExecutor(options, readLiveContext) {
  const policy = captureAgentExecutionPolicy(options);
  const selection = resolveAgentToolSelection(policy);
  const ceiling =
    selection.enabledToolNames !== null || selection.disabledTools.length > 0
      ? Object.freeze(
          getAgentToolDefinitions({
            names: selection.enabledToolNames,
            disabledTools: selection.disabledTools,
            exactToolNames: true,
          }).map((tool) => tool.function.name),
        )
      : null;
  return (name, args, context = {}) => {
    const live = readLiveContext();
    return coreExecuteTool(name, args, {
      ...live,
      ...policy,
      // Managed settings may tighten the explicit startup option while the
      // REPL loads. Neither source can turn off the other's classifier.
      classifyAllShell:
        policy.classifyAllShell === true || live.classifyAllShell === true,
      effectiveAllowedToolNames: ceiling,
      sessionId: context.sessionId || null,
      sessionBudget: context.sessionBudget || null,
      signal: context.signal || null,
    });
  };
}
