/**
 * Agentic AI assistant - Claude Code style
 * chainlesschain agent [--model] [--provider]
 *
 * User describes what they want in natural language.
 * AI reads files, writes code, runs commands, and explains what it's doing.
 */

import { createAgentRuntimeFactory } from "../runtime/runtime-factory.js";

export function registerAgentCommand(program) {
  program
    .command("agent")
    .alias("a")
    .description(
      "Start an agentic AI session (reads/writes files, runs commands)",
    )
    .option("--model <model>", "Model name")
    .option(
      "--provider <provider>",
      "LLM provider (ollama, openai, volcengine, deepseek, ...)",
    )
    .option("--base-url <url>", "API base URL")
    .option("--api-key <key>", "API key")
    .option("--session <id>", "Resume a previous agent session")
    .option("--agent-id <id>", "Agent id for scoped memory recall")
    .option("--recall-limit <n>", "Top-K memories to inject into system prompt")
    .option("--recall-query <q>", "Query string for startup memory recall")
    .option("--no-recall-memory", "Disable startup memory recall")
    .option("--no-stream", "Disable streamed response rendering")
    .option(
      "--no-park-on-exit",
      "Close the session-core handle on exit instead of parking it",
    )
    .option(
      "--bundle <path>",
      "Agent bundle directory (chainless-agent.toml + AGENTS.md + skills/ + mcp.json + USER.md)",
    )
    .action(async (options) => {
      const runtime = createAgentRuntimeFactory().createAgentRuntime({
        model: options.model,
        provider: options.provider,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        sessionId: options.session,
        agentId: options.agentId,
        recallLimit: options.recallLimit,
        recallQuery: options.recallQuery,
        recallMemory: options.recallMemory, // false when --no-recall-memory
        noStream: options.stream === false, // true when --no-stream
        parkOnExit: options.parkOnExit, // false when --no-park-on-exit
        bundlePath: options.bundle || null,
      });
      await runtime.startAgentSession();
    });
}


export function registerSubAgentV2Command(program) {
  const sa = program.command("subagent").description("Sub-agent registry V2 governance");
  sa.command("maturities-v2").action(async () => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.SUBAGENT_PROFILE_MATURITY_V2, null, 2)); });
  sa.command("task-lifecycle-v2").action(async () => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.SUBAGENT_TASK_LIFECYCLE_V2, null, 2)); });
  sa.command("stats-v2").action(async () => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.getSubAgentRegistryStatsV2(), null, 2)); });
  sa.command("config-v2").action(async () => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify({ maxActiveSubagentsPerOwner: m.getMaxActiveSubagentsPerOwnerV2(), maxPendingTasksPerSubagent: m.getMaxPendingTasksPerSubagentV2(), subagentIdleMs: m.getSubagentIdleMsV2(), subagentTaskStuckMs: m.getSubagentTaskStuckMsV2() }, null, 2)); });
  sa.command("register-profile-v2 <id> <owner> [role]").action(async (id, owner, role) => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.registerSubagentProfileV2({ id, owner, role }), null, 2)); });
  sa.command("activate-profile-v2 <id>").action(async (id) => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.activateSubagentProfileV2(id), null, 2)); });
  sa.command("pause-profile-v2 <id>").action(async (id) => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.pauseSubagentProfileV2(id), null, 2)); });
  sa.command("retire-profile-v2 <id>").action(async (id) => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.retireSubagentProfileV2(id), null, 2)); });
  sa.command("touch-profile-v2 <id>").action(async (id) => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.touchSubagentProfileV2(id), null, 2)); });
  sa.command("get-profile-v2 <id>").action(async (id) => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.getSubagentProfileV2(id), null, 2)); });
  sa.command("list-profiles-v2").action(async () => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.listSubagentProfilesV2(), null, 2)); });
  sa.command("create-task-v2 <id> <profileId> [desc]").action(async (id, profileId, desc) => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.createSubagentTaskV2({ id, profileId, description: desc }), null, 2)); });
  sa.command("start-task-v2 <id>").action(async (id) => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.startSubagentTaskV2(id), null, 2)); });
  sa.command("complete-task-v2 <id>").action(async (id) => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.completeSubagentTaskV2(id), null, 2)); });
  sa.command("fail-task-v2 <id> [reason]").action(async (id, reason) => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.failSubagentTaskV2(id, reason), null, 2)); });
  sa.command("cancel-task-v2 <id> [reason]").action(async (id, reason) => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.cancelSubagentTaskV2(id, reason), null, 2)); });
  sa.command("get-task-v2 <id>").action(async (id) => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.getSubagentTaskV2(id), null, 2)); });
  sa.command("list-tasks-v2").action(async () => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.listSubagentTasksV2(), null, 2)); });
  sa.command("auto-pause-idle-v2").action(async () => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.autoPauseIdleSubagentsV2(), null, 2)); });
  sa.command("auto-fail-stuck-v2").action(async () => { const m = await import("../lib/sub-agent-registry.js"); console.log(JSON.stringify(m.autoFailStuckSubagentTasksV2(), null, 2)); });
  sa.command("set-max-active-v2 <n>").action(async (n) => { const m = await import("../lib/sub-agent-registry.js"); m.setMaxActiveSubagentsPerOwnerV2(parseInt(n, 10)); console.log(JSON.stringify({ maxActiveSubagentsPerOwner: m.getMaxActiveSubagentsPerOwnerV2() }, null, 2)); });
  sa.command("set-max-pending-v2 <n>").action(async (n) => { const m = await import("../lib/sub-agent-registry.js"); m.setMaxPendingTasksPerSubagentV2(parseInt(n, 10)); console.log(JSON.stringify({ maxPendingTasksPerSubagent: m.getMaxPendingTasksPerSubagentV2() }, null, 2)); });
  sa.command("set-idle-ms-v2 <n>").action(async (n) => { const m = await import("../lib/sub-agent-registry.js"); m.setSubagentIdleMsV2(parseInt(n, 10)); console.log(JSON.stringify({ subagentIdleMs: m.getSubagentIdleMsV2() }, null, 2)); });
  sa.command("set-stuck-ms-v2 <n>").action(async (n) => { const m = await import("../lib/sub-agent-registry.js"); m.setSubagentTaskStuckMsV2(parseInt(n, 10)); console.log(JSON.stringify({ subagentTaskStuckMs: m.getSubagentTaskStuckMsV2() }, null, 2)); });
  sa.command("reset-state-v2").action(async () => { const m = await import("../lib/sub-agent-registry.js"); m._resetStateSubAgentRegistryV2(); console.log(JSON.stringify({ ok: true }, null, 2)); });
}

export function registerExecBackendV2Command(program) {
  const eb = program.command("execbe").description("Execution backend V2 governance");
  eb.command("maturities-v2").action(async () => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.EXECBE_BACKEND_MATURITY_V2, null, 2)); });
  eb.command("job-lifecycle-v2").action(async () => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.EXECBE_JOB_LIFECYCLE_V2, null, 2)); });
  eb.command("stats-v2").action(async () => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.getExecutionBackendStatsV2(), null, 2)); });
  eb.command("config-v2").action(async () => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify({ maxActiveBackendsPerOwner: m.getMaxActiveBackendsPerOwnerV2(), maxPendingJobsPerBackend: m.getMaxPendingJobsPerBackendV2(), backendIdleMs: m.getBackendIdleMsV2(), execJobStuckMs: m.getExecJobStuckMsV2() }, null, 2)); });
  eb.command("register-backend-v2 <id> <owner> [kind]").action(async (id, owner, kind) => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.registerBackendV2({ id, owner, kind }), null, 2)); });
  eb.command("activate-backend-v2 <id>").action(async (id) => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.activateBackendV2(id), null, 2)); });
  eb.command("degrade-backend-v2 <id>").action(async (id) => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.degradeBackendV2(id), null, 2)); });
  eb.command("retire-backend-v2 <id>").action(async (id) => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.retireBackendV2(id), null, 2)); });
  eb.command("touch-backend-v2 <id>").action(async (id) => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.touchBackendV2(id), null, 2)); });
  eb.command("get-backend-v2 <id>").action(async (id) => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.getBackendV2(id), null, 2)); });
  eb.command("list-backends-v2").action(async () => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.listBackendsV2(), null, 2)); });
  eb.command("create-job-v2 <id> <backendId> [cmd]").action(async (id, backendId, cmd) => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.createExecJobV2({ id, backendId, command: cmd }), null, 2)); });
  eb.command("start-job-v2 <id>").action(async (id) => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.startExecJobV2(id), null, 2)); });
  eb.command("succeed-job-v2 <id>").action(async (id) => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.succeedExecJobV2(id), null, 2)); });
  eb.command("fail-job-v2 <id> [reason]").action(async (id, reason) => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.failExecJobV2(id, reason), null, 2)); });
  eb.command("cancel-job-v2 <id> [reason]").action(async (id, reason) => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.cancelExecJobV2(id, reason), null, 2)); });
  eb.command("get-job-v2 <id>").action(async (id) => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.getExecJobV2(id), null, 2)); });
  eb.command("list-jobs-v2").action(async () => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.listExecJobsV2(), null, 2)); });
  eb.command("auto-degrade-idle-v2").action(async () => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.autoDegradeIdleBackendsV2(), null, 2)); });
  eb.command("auto-fail-stuck-v2").action(async () => { const m = await import("../lib/execution-backend.js"); console.log(JSON.stringify(m.autoFailStuckExecJobsV2(), null, 2)); });
  eb.command("set-max-active-v2 <n>").action(async (n) => { const m = await import("../lib/execution-backend.js"); m.setMaxActiveBackendsPerOwnerV2(parseInt(n, 10)); console.log(JSON.stringify({ maxActiveBackendsPerOwner: m.getMaxActiveBackendsPerOwnerV2() }, null, 2)); });
  eb.command("set-max-pending-v2 <n>").action(async (n) => { const m = await import("../lib/execution-backend.js"); m.setMaxPendingJobsPerBackendV2(parseInt(n, 10)); console.log(JSON.stringify({ maxPendingJobsPerBackend: m.getMaxPendingJobsPerBackendV2() }, null, 2)); });
  eb.command("set-idle-ms-v2 <n>").action(async (n) => { const m = await import("../lib/execution-backend.js"); m.setBackendIdleMsV2(parseInt(n, 10)); console.log(JSON.stringify({ backendIdleMs: m.getBackendIdleMsV2() }, null, 2)); });
  eb.command("set-stuck-ms-v2 <n>").action(async (n) => { const m = await import("../lib/execution-backend.js"); m.setExecJobStuckMsV2(parseInt(n, 10)); console.log(JSON.stringify({ execJobStuckMs: m.getExecJobStuckMsV2() }, null, 2)); });
  eb.command("reset-state-v2").action(async () => { const m = await import("../lib/execution-backend.js"); m._resetStateExecutionBackendV2(); console.log(JSON.stringify({ ok: true }, null, 2)); });
}

export function registerTodoV2Command(program) {
  const td = program.command("todo").description("Todo manager V2 governance");
  td.command("maturities-v2").action(async () => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.TODO_LIST_MATURITY_V2, null, 2)); });
  td.command("item-lifecycle-v2").action(async () => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.TODO_ITEM_LIFECYCLE_V2, null, 2)); });
  td.command("stats-v2").action(async () => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.getTodoManagerStatsV2(), null, 2)); });
  td.command("config-v2").action(async () => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify({ maxActiveTodoListsPerOwner: m.getMaxActiveTodoListsPerOwnerV2(), maxPendingItemsPerTodoList: m.getMaxPendingItemsPerTodoListV2(), todoListIdleMs: m.getTodoListIdleMsV2(), todoItemStuckMs: m.getTodoItemStuckMsV2() }, null, 2)); });
  td.command("register-list-v2 <id> <owner> [title]").action(async (id, owner, title) => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.registerTodoListV2({ id, owner, title }), null, 2)); });
  td.command("activate-list-v2 <id>").action(async (id) => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.activateTodoListV2(id), null, 2)); });
  td.command("pause-list-v2 <id>").action(async (id) => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.pauseTodoListV2(id), null, 2)); });
  td.command("archive-list-v2 <id>").action(async (id) => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.archiveTodoListV2(id), null, 2)); });
  td.command("touch-list-v2 <id>").action(async (id) => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.touchTodoListV2(id), null, 2)); });
  td.command("get-list-v2 <id>").action(async (id) => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.getTodoListV2(id), null, 2)); });
  td.command("list-lists-v2").action(async () => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.listTodoListsV2(), null, 2)); });
  td.command("create-item-v2 <id> <listId> [desc]").action(async (id, listId, desc) => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.createTodoItemV2({ id, listId, description: desc }), null, 2)); });
  td.command("start-item-v2 <id>").action(async (id) => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.startTodoItemV2(id), null, 2)); });
  td.command("complete-item-v2 <id>").action(async (id) => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.completeTodoItemV2(id), null, 2)); });
  td.command("fail-item-v2 <id> [reason]").action(async (id, reason) => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.failTodoItemV2(id, reason), null, 2)); });
  td.command("cancel-item-v2 <id> [reason]").action(async (id, reason) => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.cancelTodoItemV2(id, reason), null, 2)); });
  td.command("get-item-v2 <id>").action(async (id) => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.getTodoItemV2(id), null, 2)); });
  td.command("list-items-v2").action(async () => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.listTodoItemsV2(), null, 2)); });
  td.command("auto-pause-idle-v2").action(async () => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.autoPauseIdleTodoListsV2(), null, 2)); });
  td.command("auto-fail-stuck-v2").action(async () => { const m = await import("../lib/todo-manager.js"); console.log(JSON.stringify(m.autoFailStuckTodoItemsV2(), null, 2)); });
  td.command("set-max-active-v2 <n>").action(async (n) => { const m = await import("../lib/todo-manager.js"); m.setMaxActiveTodoListsPerOwnerV2(parseInt(n, 10)); console.log(JSON.stringify({ maxActiveTodoListsPerOwner: m.getMaxActiveTodoListsPerOwnerV2() }, null, 2)); });
  td.command("set-max-pending-v2 <n>").action(async (n) => { const m = await import("../lib/todo-manager.js"); m.setMaxPendingItemsPerTodoListV2(parseInt(n, 10)); console.log(JSON.stringify({ maxPendingItemsPerTodoList: m.getMaxPendingItemsPerTodoListV2() }, null, 2)); });
  td.command("set-idle-ms-v2 <n>").action(async (n) => { const m = await import("../lib/todo-manager.js"); m.setTodoListIdleMsV2(parseInt(n, 10)); console.log(JSON.stringify({ todoListIdleMs: m.getTodoListIdleMsV2() }, null, 2)); });
  td.command("set-stuck-ms-v2 <n>").action(async (n) => { const m = await import("../lib/todo-manager.js"); m.setTodoItemStuckMsV2(parseInt(n, 10)); console.log(JSON.stringify({ todoItemStuckMs: m.getTodoItemStuckMsV2() }, null, 2)); });
  td.command("reset-state-v2").action(async () => { const m = await import("../lib/todo-manager.js"); m._resetStateTodoManagerV2(); console.log(JSON.stringify({ ok: true }, null, 2)); });
}

export function registerAutoAgentV2Command(program) {
  const aa = program.command("autoagent").description("Autonomous agent V2 governance");
  const L = async () => await import("../lib/autonomous-agent.js");
  aa.command("enums-v2").action(async () => { const m = await L(); console.log(JSON.stringify({ agentMaturity: m.AUTOAGENT_MATURITY_V2, runLifecycle: m.AUTOAGENT_RUN_LIFECYCLE_V2 }, null, 2)); });
  aa.command("config-v2").action(async () => { const m = await L(); console.log(JSON.stringify({ maxActiveAutoAgentsPerOwner: m.getMaxActiveAutoAgentsPerOwnerV2(), maxPendingAutoAgentRunsPerAgent: m.getMaxPendingAutoAgentRunsPerAgentV2(), autoAgentIdleMs: m.getAutoAgentIdleMsV2(), autoAgentRunStuckMs: m.getAutoAgentRunStuckMsV2() }, null, 2)); });
  aa.command("set-max-active-v2 <n>").action(async (n) => { const m = await L(); m.setMaxActiveAutoAgentsPerOwnerV2(Number(n)); console.log("ok"); });
  aa.command("set-max-pending-v2 <n>").action(async (n) => { const m = await L(); m.setMaxPendingAutoAgentRunsPerAgentV2(Number(n)); console.log("ok"); });
  aa.command("set-idle-ms-v2 <n>").action(async (n) => { const m = await L(); m.setAutoAgentIdleMsV2(Number(n)); console.log("ok"); });
  aa.command("set-stuck-ms-v2 <n>").action(async (n) => { const m = await L(); m.setAutoAgentRunStuckMsV2(Number(n)); console.log("ok"); });
  aa.command("register-agent-v2 <id> <owner>").option("--goal <g>", "Goal").action(async (id, owner, o) => { const m = await L(); console.log(JSON.stringify(m.registerAutoAgentV2({ id, owner, goal: o.goal }), null, 2)); });
  aa.command("activate-agent-v2 <id>").action(async (id) => { const m = await L(); console.log(JSON.stringify(m.activateAutoAgentV2(id), null, 2)); });
  aa.command("pause-agent-v2 <id>").action(async (id) => { const m = await L(); console.log(JSON.stringify(m.pauseAutoAgentV2(id), null, 2)); });
  aa.command("archive-agent-v2 <id>").action(async (id) => { const m = await L(); console.log(JSON.stringify(m.archiveAutoAgentV2(id), null, 2)); });
  aa.command("touch-agent-v2 <id>").action(async (id) => { const m = await L(); console.log(JSON.stringify(m.touchAutoAgentV2(id), null, 2)); });
  aa.command("get-agent-v2 <id>").action(async (id) => { const m = await L(); console.log(JSON.stringify(m.getAutoAgentV2(id), null, 2)); });
  aa.command("list-agents-v2").action(async () => { const m = await L(); console.log(JSON.stringify(m.listAutoAgentsV2(), null, 2)); });
  aa.command("create-run-v2 <id> <agentId>").option("--prompt <p>", "Prompt").action(async (id, agentId, o) => { const m = await L(); console.log(JSON.stringify(m.createAutoAgentRunV2({ id, agentId, prompt: o.prompt }), null, 2)); });
  aa.command("start-run-v2 <id>").action(async (id) => { const m = await L(); console.log(JSON.stringify(m.startAutoAgentRunV2(id), null, 2)); });
  aa.command("complete-run-v2 <id>").action(async (id) => { const m = await L(); console.log(JSON.stringify(m.completeAutoAgentRunV2(id), null, 2)); });
  aa.command("fail-run-v2 <id> [reason]").action(async (id, reason) => { const m = await L(); console.log(JSON.stringify(m.failAutoAgentRunV2(id, reason), null, 2)); });
  aa.command("cancel-run-v2 <id> [reason]").action(async (id, reason) => { const m = await L(); console.log(JSON.stringify(m.cancelAutoAgentRunV2(id, reason), null, 2)); });
  aa.command("get-run-v2 <id>").action(async (id) => { const m = await L(); console.log(JSON.stringify(m.getAutoAgentRunV2(id), null, 2)); });
  aa.command("list-runs-v2").action(async () => { const m = await L(); console.log(JSON.stringify(m.listAutoAgentRunsV2(), null, 2)); });
  aa.command("auto-pause-idle-v2").action(async () => { const m = await L(); console.log(JSON.stringify(m.autoPauseIdleAutoAgentsV2(), null, 2)); });
  aa.command("auto-fail-stuck-v2").action(async () => { const m = await L(); console.log(JSON.stringify(m.autoFailStuckAutoAgentRunsV2(), null, 2)); });
  aa.command("gov-stats-v2").action(async () => { const m = await L(); console.log(JSON.stringify(m.getAutonomousAgentGovStatsV2(), null, 2)); });
  aa.command("reset-state-v2").action(async () => { const m = await L(); m._resetStateAutonomousAgentV2(); console.log(JSON.stringify({ ok: true }, null, 2)); });
}
