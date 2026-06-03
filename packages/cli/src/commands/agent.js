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
  const sa = program
    .command("subagent")
    .description("Sub-agent registry V2 governance");
  sa.command("maturities-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.SUBAGENT_PROFILE_MATURITY_V2, null, 2));
  });
  sa.command("task-lifecycle-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.SUBAGENT_TASK_LIFECYCLE_V2, null, 2));
  });
  sa.command("stats-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.getSubAgentRegistryStatsV2(), null, 2));
  });
  sa.command("config-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(
      JSON.stringify(
        {
          maxActiveSubagentsPerOwner: m.getMaxActiveSubagentsPerOwnerV2(),
          maxPendingTasksPerSubagent: m.getMaxPendingTasksPerSubagentV2(),
          subagentIdleMs: m.getSubagentIdleMsV2(),
          subagentTaskStuckMs: m.getSubagentTaskStuckMsV2(),
        },
        null,
        2,
      ),
    );
  });
  sa.command("register-profile-v2 <id> <owner> [role]").action(
    async (id, owner, role) => {
      const m = await import("../lib/sub-agent-registry.js");
      console.log(
        JSON.stringify(
          m.registerSubagentProfileV2({ id, owner, role }),
          null,
          2,
        ),
      );
    },
  );
  sa.command("activate-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.activateSubagentProfileV2(id), null, 2));
  });
  sa.command("pause-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.pauseSubagentProfileV2(id), null, 2));
  });
  sa.command("retire-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.retireSubagentProfileV2(id), null, 2));
  });
  sa.command("touch-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.touchSubagentProfileV2(id), null, 2));
  });
  sa.command("get-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.getSubagentProfileV2(id), null, 2));
  });
  sa.command("list-profiles-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.listSubagentProfilesV2(), null, 2));
  });
  sa.command("create-task-v2 <id> <profileId> [desc]").action(
    async (id, profileId, desc) => {
      const m = await import("../lib/sub-agent-registry.js");
      console.log(
        JSON.stringify(
          m.createSubagentTaskV2({ id, profileId, description: desc }),
          null,
          2,
        ),
      );
    },
  );
  sa.command("start-task-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.startSubagentTaskV2(id), null, 2));
  });
  sa.command("complete-task-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.completeSubagentTaskV2(id), null, 2));
  });
  sa.command("fail-task-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.failSubagentTaskV2(id, reason), null, 2));
  });
  sa.command("cancel-task-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.cancelSubagentTaskV2(id, reason), null, 2));
  });
  sa.command("get-task-v2 <id>").action(async (id) => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.getSubagentTaskV2(id), null, 2));
  });
  sa.command("list-tasks-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.listSubagentTasksV2(), null, 2));
  });
  sa.command("auto-pause-idle-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.autoPauseIdleSubagentsV2(), null, 2));
  });
  sa.command("auto-fail-stuck-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    console.log(JSON.stringify(m.autoFailStuckSubagentTasksV2(), null, 2));
  });
  sa.command("set-max-active-v2 <n>").action(async (n) => {
    const m = await import("../lib/sub-agent-registry.js");
    m.setMaxActiveSubagentsPerOwnerV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxActiveSubagentsPerOwner: m.getMaxActiveSubagentsPerOwnerV2() },
        null,
        2,
      ),
    );
  });
  sa.command("set-max-pending-v2 <n>").action(async (n) => {
    const m = await import("../lib/sub-agent-registry.js");
    m.setMaxPendingTasksPerSubagentV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxPendingTasksPerSubagent: m.getMaxPendingTasksPerSubagentV2() },
        null,
        2,
      ),
    );
  });
  sa.command("set-idle-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/sub-agent-registry.js");
    m.setSubagentIdleMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify({ subagentIdleMs: m.getSubagentIdleMsV2() }, null, 2),
    );
  });
  sa.command("set-stuck-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/sub-agent-registry.js");
    m.setSubagentTaskStuckMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { subagentTaskStuckMs: m.getSubagentTaskStuckMsV2() },
        null,
        2,
      ),
    );
  });
  sa.command("reset-state-v2").action(async () => {
    const m = await import("../lib/sub-agent-registry.js");
    m._resetStateSubAgentRegistryV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}

export function registerExecBackendV2Command(program) {
  const eb = program
    .command("execbe")
    .description("Execution backend V2 governance");
  eb.command("maturities-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.EXECBE_BACKEND_MATURITY_V2, null, 2));
  });
  eb.command("job-lifecycle-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.EXECBE_JOB_LIFECYCLE_V2, null, 2));
  });
  eb.command("stats-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.getExecutionBackendStatsV2(), null, 2));
  });
  eb.command("config-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(
      JSON.stringify(
        {
          maxActiveBackendsPerOwner: m.getMaxActiveBackendsPerOwnerV2(),
          maxPendingJobsPerBackend: m.getMaxPendingJobsPerBackendV2(),
          backendIdleMs: m.getBackendIdleMsV2(),
          execJobStuckMs: m.getExecJobStuckMsV2(),
        },
        null,
        2,
      ),
    );
  });
  eb.command("register-backend-v2 <id> <owner> [kind]").action(
    async (id, owner, kind) => {
      const m = await import("../lib/execution-backend.js");
      console.log(
        JSON.stringify(m.registerBackendV2({ id, owner, kind }), null, 2),
      );
    },
  );
  eb.command("activate-backend-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.activateBackendV2(id), null, 2));
  });
  eb.command("degrade-backend-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.degradeBackendV2(id), null, 2));
  });
  eb.command("retire-backend-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.retireBackendV2(id), null, 2));
  });
  eb.command("touch-backend-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.touchBackendV2(id), null, 2));
  });
  eb.command("get-backend-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.getBackendV2(id), null, 2));
  });
  eb.command("list-backends-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.listBackendsV2(), null, 2));
  });
  eb.command("create-job-v2 <id> <backendId> [cmd]").action(
    async (id, backendId, cmd) => {
      const m = await import("../lib/execution-backend.js");
      console.log(
        JSON.stringify(
          m.createExecJobV2({ id, backendId, command: cmd }),
          null,
          2,
        ),
      );
    },
  );
  eb.command("start-job-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.startExecJobV2(id), null, 2));
  });
  eb.command("succeed-job-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.succeedExecJobV2(id), null, 2));
  });
  eb.command("fail-job-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.failExecJobV2(id, reason), null, 2));
  });
  eb.command("cancel-job-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.cancelExecJobV2(id, reason), null, 2));
  });
  eb.command("get-job-v2 <id>").action(async (id) => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.getExecJobV2(id), null, 2));
  });
  eb.command("list-jobs-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.listExecJobsV2(), null, 2));
  });
  eb.command("auto-degrade-idle-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.autoDegradeIdleBackendsV2(), null, 2));
  });
  eb.command("auto-fail-stuck-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    console.log(JSON.stringify(m.autoFailStuckExecJobsV2(), null, 2));
  });
  eb.command("set-max-active-v2 <n>").action(async (n) => {
    const m = await import("../lib/execution-backend.js");
    m.setMaxActiveBackendsPerOwnerV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxActiveBackendsPerOwner: m.getMaxActiveBackendsPerOwnerV2() },
        null,
        2,
      ),
    );
  });
  eb.command("set-max-pending-v2 <n>").action(async (n) => {
    const m = await import("../lib/execution-backend.js");
    m.setMaxPendingJobsPerBackendV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxPendingJobsPerBackend: m.getMaxPendingJobsPerBackendV2() },
        null,
        2,
      ),
    );
  });
  eb.command("set-idle-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/execution-backend.js");
    m.setBackendIdleMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify({ backendIdleMs: m.getBackendIdleMsV2() }, null, 2),
    );
  });
  eb.command("set-stuck-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/execution-backend.js");
    m.setExecJobStuckMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify({ execJobStuckMs: m.getExecJobStuckMsV2() }, null, 2),
    );
  });
  eb.command("reset-state-v2").action(async () => {
    const m = await import("../lib/execution-backend.js");
    m._resetStateExecutionBackendV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}

export function registerTodoV2Command(program) {
  const td = program.command("todo").description("Todo manager V2 governance");
  td.command("maturities-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.TODO_LIST_MATURITY_V2, null, 2));
  });
  td.command("item-lifecycle-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.TODO_ITEM_LIFECYCLE_V2, null, 2));
  });
  td.command("stats-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.getTodoManagerStatsV2(), null, 2));
  });
  td.command("config-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(
      JSON.stringify(
        {
          maxActiveTodoListsPerOwner: m.getMaxActiveTodoListsPerOwnerV2(),
          maxPendingItemsPerTodoList: m.getMaxPendingItemsPerTodoListV2(),
          todoListIdleMs: m.getTodoListIdleMsV2(),
          todoItemStuckMs: m.getTodoItemStuckMsV2(),
        },
        null,
        2,
      ),
    );
  });
  td.command("register-list-v2 <id> <owner> [title]").action(
    async (id, owner, title) => {
      const m = await import("../lib/todo-manager.js");
      console.log(
        JSON.stringify(m.registerTodoListV2({ id, owner, title }), null, 2),
      );
    },
  );
  td.command("activate-list-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.activateTodoListV2(id), null, 2));
  });
  td.command("pause-list-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.pauseTodoListV2(id), null, 2));
  });
  td.command("archive-list-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.archiveTodoListV2(id), null, 2));
  });
  td.command("touch-list-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.touchTodoListV2(id), null, 2));
  });
  td.command("get-list-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.getTodoListV2(id), null, 2));
  });
  td.command("list-lists-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.listTodoListsV2(), null, 2));
  });
  td.command("create-item-v2 <id> <listId> [desc]").action(
    async (id, listId, desc) => {
      const m = await import("../lib/todo-manager.js");
      console.log(
        JSON.stringify(
          m.createTodoItemV2({ id, listId, description: desc }),
          null,
          2,
        ),
      );
    },
  );
  td.command("start-item-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.startTodoItemV2(id), null, 2));
  });
  td.command("complete-item-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.completeTodoItemV2(id), null, 2));
  });
  td.command("fail-item-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.failTodoItemV2(id, reason), null, 2));
  });
  td.command("cancel-item-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.cancelTodoItemV2(id, reason), null, 2));
  });
  td.command("get-item-v2 <id>").action(async (id) => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.getTodoItemV2(id), null, 2));
  });
  td.command("list-items-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.listTodoItemsV2(), null, 2));
  });
  td.command("auto-pause-idle-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.autoPauseIdleTodoListsV2(), null, 2));
  });
  td.command("auto-fail-stuck-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    console.log(JSON.stringify(m.autoFailStuckTodoItemsV2(), null, 2));
  });
  td.command("set-max-active-v2 <n>").action(async (n) => {
    const m = await import("../lib/todo-manager.js");
    m.setMaxActiveTodoListsPerOwnerV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxActiveTodoListsPerOwner: m.getMaxActiveTodoListsPerOwnerV2() },
        null,
        2,
      ),
    );
  });
  td.command("set-max-pending-v2 <n>").action(async (n) => {
    const m = await import("../lib/todo-manager.js");
    m.setMaxPendingItemsPerTodoListV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxPendingItemsPerTodoList: m.getMaxPendingItemsPerTodoListV2() },
        null,
        2,
      ),
    );
  });
  td.command("set-idle-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/todo-manager.js");
    m.setTodoListIdleMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify({ todoListIdleMs: m.getTodoListIdleMsV2() }, null, 2),
    );
  });
  td.command("set-stuck-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/todo-manager.js");
    m.setTodoItemStuckMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify({ todoItemStuckMs: m.getTodoItemStuckMsV2() }, null, 2),
    );
  });
  td.command("reset-state-v2").action(async () => {
    const m = await import("../lib/todo-manager.js");
    m._resetStateTodoManagerV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}

export function registerAutoAgentV2Command(program) {
  const aa = program
    .command("autoagent")
    .description("Autonomous agent V2 governance");
  const L = async () => await import("../lib/autonomous-agent.js");
  aa.command("enums-v2").action(async () => {
    const m = await L();
    console.log(
      JSON.stringify(
        {
          agentMaturity: m.AUTOAGENT_MATURITY_V2,
          runLifecycle: m.AUTOAGENT_RUN_LIFECYCLE_V2,
        },
        null,
        2,
      ),
    );
  });
  aa.command("config-v2").action(async () => {
    const m = await L();
    console.log(
      JSON.stringify(
        {
          maxActiveAutoAgentsPerOwner: m.getMaxActiveAutoAgentsPerOwnerV2(),
          maxPendingAutoAgentRunsPerAgent:
            m.getMaxPendingAutoAgentRunsPerAgentV2(),
          autoAgentIdleMs: m.getAutoAgentIdleMsV2(),
          autoAgentRunStuckMs: m.getAutoAgentRunStuckMsV2(),
        },
        null,
        2,
      ),
    );
  });
  aa.command("set-max-active-v2 <n>").action(async (n) => {
    const m = await L();
    m.setMaxActiveAutoAgentsPerOwnerV2(Number(n));
    console.log("ok");
  });
  aa.command("set-max-pending-v2 <n>").action(async (n) => {
    const m = await L();
    m.setMaxPendingAutoAgentRunsPerAgentV2(Number(n));
    console.log("ok");
  });
  aa.command("set-idle-ms-v2 <n>").action(async (n) => {
    const m = await L();
    m.setAutoAgentIdleMsV2(Number(n));
    console.log("ok");
  });
  aa.command("set-stuck-ms-v2 <n>").action(async (n) => {
    const m = await L();
    m.setAutoAgentRunStuckMsV2(Number(n));
    console.log("ok");
  });
  aa.command("register-agent-v2 <id> <owner>")
    .option("--goal <g>", "Goal")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerAutoAgentV2({ id, owner, goal: o.goal }),
          null,
          2,
        ),
      );
    });
  aa.command("activate-agent-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.activateAutoAgentV2(id), null, 2));
  });
  aa.command("pause-agent-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.pauseAutoAgentV2(id), null, 2));
  });
  aa.command("archive-agent-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.archiveAutoAgentV2(id), null, 2));
  });
  aa.command("touch-agent-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.touchAutoAgentV2(id), null, 2));
  });
  aa.command("get-agent-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.getAutoAgentV2(id), null, 2));
  });
  aa.command("list-agents-v2").action(async () => {
    const m = await L();
    console.log(JSON.stringify(m.listAutoAgentsV2(), null, 2));
  });
  aa.command("create-run-v2 <id> <agentId>")
    .option("--prompt <p>", "Prompt")
    .action(async (id, agentId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createAutoAgentRunV2({ id, agentId, prompt: o.prompt }),
          null,
          2,
        ),
      );
    });
  aa.command("start-run-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.startAutoAgentRunV2(id), null, 2));
  });
  aa.command("complete-run-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.completeAutoAgentRunV2(id), null, 2));
  });
  aa.command("fail-run-v2 <id> [reason]").action(async (id, reason) => {
    const m = await L();
    console.log(JSON.stringify(m.failAutoAgentRunV2(id, reason), null, 2));
  });
  aa.command("cancel-run-v2 <id> [reason]").action(async (id, reason) => {
    const m = await L();
    console.log(JSON.stringify(m.cancelAutoAgentRunV2(id, reason), null, 2));
  });
  aa.command("get-run-v2 <id>").action(async (id) => {
    const m = await L();
    console.log(JSON.stringify(m.getAutoAgentRunV2(id), null, 2));
  });
  aa.command("list-runs-v2").action(async () => {
    const m = await L();
    console.log(JSON.stringify(m.listAutoAgentRunsV2(), null, 2));
  });
  aa.command("auto-pause-idle-v2").action(async () => {
    const m = await L();
    console.log(JSON.stringify(m.autoPauseIdleAutoAgentsV2(), null, 2));
  });
  aa.command("auto-fail-stuck-v2").action(async () => {
    const m = await L();
    console.log(JSON.stringify(m.autoFailStuckAutoAgentRunsV2(), null, 2));
  });
  aa.command("gov-stats-v2").action(async () => {
    const m = await L();
    console.log(JSON.stringify(m.getAutonomousAgentGovStatsV2(), null, 2));
  });
  aa.command("reset-state-v2").action(async () => {
    const m = await L();
    m._resetStateAutonomousAgentV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}

// === Iter25 V2 governance overlay ===
export function registerSaregovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "agent");
  if (!parent) return;
  const L = async () => await import("../lib/sub-agent-registry.js");
  parent
    .command("saregov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.SAREGOV_PROFILE_MATURITY_V2,
            spawnLifecycle: m.SAREGOV_SPAWN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("saregov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveSaregovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingSaregovSpawnsPerProfileV2(),
            idleMs: m.getSaregovProfileIdleMsV2(),
            stuckMs: m.getSaregovSpawnStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("saregov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveSaregovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("saregov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingSaregovSpawnsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("saregov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setSaregovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("saregov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setSaregovSpawnStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("saregov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--kind <v>", "kind")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerSaregovProfileV2({ id, owner, kind: o.kind }),
          null,
          2,
        ),
      );
    });
  parent
    .command("saregov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateSaregovProfileV2(id), null, 2),
      );
    });
  parent
    .command("saregov-suspend-v2 <id>")
    .description("Suspend profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).suspendSaregovProfileV2(id), null, 2),
      );
    });
  parent
    .command("saregov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveSaregovProfileV2(id), null, 2),
      );
    });
  parent
    .command("saregov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchSaregovProfileV2(id), null, 2),
      );
    });
  parent
    .command("saregov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSaregovProfileV2(id), null, 2));
    });
  parent
    .command("saregov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSaregovProfilesV2(), null, 2));
    });
  parent
    .command("saregov-create-spawn-v2 <id> <profileId>")
    .description("Create spawn")
    .option("--task <v>", "task")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createSaregovSpawnV2({ id, profileId, task: o.task }),
          null,
          2,
        ),
      );
    });
  parent
    .command("saregov-spawning-spawn-v2 <id>")
    .description("Mark spawn as spawning")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).spawningSaregovSpawnV2(id), null, 2),
      );
    });
  parent
    .command("saregov-complete-spawn-v2 <id>")
    .description("Complete spawn")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeSpawnSaregovV2(id), null, 2),
      );
    });
  parent
    .command("saregov-fail-spawn-v2 <id> [reason]")
    .description("Fail spawn")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failSaregovSpawnV2(id, reason), null, 2),
      );
    });
  parent
    .command("saregov-cancel-spawn-v2 <id> [reason]")
    .description("Cancel spawn")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelSaregovSpawnV2(id, reason), null, 2),
      );
    });
  parent
    .command("saregov-get-spawn-v2 <id>")
    .description("Get spawn")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSaregovSpawnV2(id), null, 2));
    });
  parent
    .command("saregov-list-spawns-v2")
    .description("List spawns")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSaregovSpawnsV2(), null, 2));
    });
  parent
    .command("saregov-auto-suspend-idle-v2")
    .description("Auto-suspend idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoSuspendIdleSaregovProfilesV2(), null, 2),
      );
    });
  parent
    .command("saregov-auto-fail-stuck-v2")
    .description("Auto-fail stuck spawns")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckSaregovSpawnsV2(), null, 2),
      );
    });
  parent
    .command("saregov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getSubAgentRegistryGovStatsV2(), null, 2),
      );
    });
}

// === Iter25 V2 governance overlay ===
export function registerTodogovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "agent");
  if (!parent) return;
  const L = async () => await import("../lib/todo-manager.js");
  parent
    .command("todogov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.TODOGOV_PROFILE_MATURITY_V2,
            stepLifecycle: m.TODOGOV_STEP_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("todogov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveTodogovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingTodogovStepsPerProfileV2(),
            idleMs: m.getTodogovProfileIdleMsV2(),
            stuckMs: m.getTodogovStepStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("todogov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveTodogovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("todogov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingTodogovStepsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("todogov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setTodogovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("todogov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setTodogovStepStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("todogov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--list <v>", "list")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerTodogovProfileV2({ id, owner, list: o.list }),
          null,
          2,
        ),
      );
    });
  parent
    .command("todogov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateTodogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("todogov-pause-v2 <id>")
    .description("Pause profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).pauseTodogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("todogov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveTodogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("todogov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchTodogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("todogov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getTodogovProfileV2(id), null, 2));
    });
  parent
    .command("todogov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listTodogovProfilesV2(), null, 2));
    });
  parent
    .command("todogov-create-step-v2 <id> <profileId>")
    .description("Create step")
    .option("--title <v>", "title")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createTodogovStepV2({ id, profileId, title: o.title }),
          null,
          2,
        ),
      );
    });
  parent
    .command("todogov-doing-step-v2 <id>")
    .description("Mark step as doing")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).doingTodogovStepV2(id), null, 2));
    });
  parent
    .command("todogov-complete-step-v2 <id>")
    .description("Complete step")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeStepTodogovV2(id), null, 2),
      );
    });
  parent
    .command("todogov-fail-step-v2 <id> [reason]")
    .description("Fail step")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failTodogovStepV2(id, reason), null, 2),
      );
    });
  parent
    .command("todogov-cancel-step-v2 <id> [reason]")
    .description("Cancel step")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelTodogovStepV2(id, reason), null, 2),
      );
    });
  parent
    .command("todogov-get-step-v2 <id>")
    .description("Get step")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getTodogovStepV2(id), null, 2));
    });
  parent
    .command("todogov-list-steps-v2")
    .description("List steps")
    .action(async () => {
      console.log(JSON.stringify((await L()).listTodogovStepsV2(), null, 2));
    });
  parent
    .command("todogov-auto-pause-idle-v2")
    .description("Auto-pause idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoPauseIdleTodogovProfilesV2(), null, 2),
      );
    });
  parent
    .command("todogov-auto-fail-stuck-v2")
    .description("Auto-fail stuck steps")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckTodogovStepsV2(), null, 2),
      );
    });
  parent
    .command("todogov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getTodoManagerGovStatsV2(), null, 2),
      );
    });
}

// === Iter25 V2 governance overlay ===
export function registerEbgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "agent");
  if (!parent) return;
  const L = async () => await import("../lib/execution-backend.js");
  parent
    .command("ebgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.EBGOV_PROFILE_MATURITY_V2,
            jobLifecycle: m.EBGOV_JOB_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ebgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveEbgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingEbgovJobsPerProfileV2(),
            idleMs: m.getEbgovProfileIdleMsV2(),
            stuckMs: m.getEbgovJobStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ebgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveEbgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ebgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingEbgovJobsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ebgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setEbgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ebgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setEbgovJobStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ebgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--backend <v>", "backend")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerEbgovProfileV2({ id, owner, backend: o.backend }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ebgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateEbgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ebgov-degrade-v2 <id>")
    .description("Degrade profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).degradeEbgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ebgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveEbgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ebgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchEbgovProfileV2(id), null, 2));
    });
  parent
    .command("ebgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getEbgovProfileV2(id), null, 2));
    });
  parent
    .command("ebgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listEbgovProfilesV2(), null, 2));
    });
  parent
    .command("ebgov-create-job-v2 <id> <profileId>")
    .description("Create job")
    .option("--task <v>", "task")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createEbgovJobV2({ id, profileId, task: o.task }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ebgov-executing-job-v2 <id>")
    .description("Mark job as executing")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).executingEbgovJobV2(id), null, 2));
    });
  parent
    .command("ebgov-complete-job-v2 <id>")
    .description("Complete job")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeJobEbgovV2(id), null, 2));
    });
  parent
    .command("ebgov-fail-job-v2 <id> [reason]")
    .description("Fail job")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failEbgovJobV2(id, reason), null, 2),
      );
    });
  parent
    .command("ebgov-cancel-job-v2 <id> [reason]")
    .description("Cancel job")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelEbgovJobV2(id, reason), null, 2),
      );
    });
  parent
    .command("ebgov-get-job-v2 <id>")
    .description("Get job")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getEbgovJobV2(id), null, 2));
    });
  parent
    .command("ebgov-list-jobs-v2")
    .description("List jobs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listEbgovJobsV2(), null, 2));
    });
  parent
    .command("ebgov-auto-degrade-idle-v2")
    .description("Auto-degrade idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoDegradeIdleEbgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("ebgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck jobs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckEbgovJobsV2(), null, 2),
      );
    });
  parent
    .command("ebgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getExecutionBackendGovStatsV2(), null, 2),
      );
    });
}

// === Iter26 V2 governance overlay ===
export function registerSactxgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "agent");
  if (!parent) return;
  const L = async () => await import("../lib/sub-agent-context.js");
  parent
    .command("sactxgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.SACTXGOV_PROFILE_MATURITY_V2,
            handoffLifecycle: m.SACTXGOV_HANDOFF_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("sactxgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveSactxgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingSactxgovHandoffsPerProfileV2(),
            idleMs: m.getSactxgovProfileIdleMsV2(),
            stuckMs: m.getSactxgovHandoffStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("sactxgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveSactxgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sactxgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingSactxgovHandoffsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sactxgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setSactxgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sactxgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setSactxgovHandoffStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sactxgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--scope <v>", "scope")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerSactxgovProfileV2({ id, owner, scope: o.scope }),
          null,
          2,
        ),
      );
    });
  parent
    .command("sactxgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateSactxgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleSactxgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveSactxgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchSactxgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getSactxgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listSactxgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("sactxgov-create-handoff-v2 <id> <profileId>")
    .description("Create handoff")
    .option("--subAgent <v>", "subAgent")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createSactxgovHandoffV2({ id, profileId, subAgent: o.subAgent }),
          null,
          2,
        ),
      );
    });
  parent
    .command("sactxgov-transferring-handoff-v2 <id>")
    .description("Mark handoff as transferring")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).transferringSactxgovHandoffV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-complete-handoff-v2 <id>")
    .description("Complete handoff")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeHandoffSactxgovV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-fail-handoff-v2 <id> [reason]")
    .description("Fail handoff")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failSactxgovHandoffV2(id, reason), null, 2),
      );
    });
  parent
    .command("sactxgov-cancel-handoff-v2 <id> [reason]")
    .description("Cancel handoff")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).cancelSactxgovHandoffV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("sactxgov-get-handoff-v2 <id>")
    .description("Get handoff")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getSactxgovHandoffV2(id), null, 2),
      );
    });
  parent
    .command("sactxgov-list-handoffs-v2")
    .description("List handoffs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listSactxgovHandoffsV2(), null, 2),
      );
    });
  parent
    .command("sactxgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleSactxgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("sactxgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck handoffs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckSactxgovHandoffsV2(), null, 2),
      );
    });
  parent
    .command("sactxgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getSubAgentContextGovStatsV2(), null, 2),
      );
    });
}

// === Iter27 V2 governance overlay ===
export function registerSapgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "agent");
  if (!parent) return;
  const L = async () => await import("../lib/sub-agent-profiles.js");
  parent
    .command("sapgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.SAPGOV_PROFILE_MATURITY_V2,
            applyLifecycle: m.SAPGOV_APPLY_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("sapgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveSapgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingSapgovApplysPerProfileV2(),
            idleMs: m.getSapgovProfileIdleMsV2(),
            stuckMs: m.getSapgovApplyStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("sapgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveSapgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sapgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingSapgovApplysPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sapgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setSapgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sapgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setSapgovApplyStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("sapgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--role <v>", "role")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerSapgovProfileV2({ id, owner, role: o.role }),
          null,
          2,
        ),
      );
    });
  parent
    .command("sapgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateSapgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sapgov-suspend-v2 <id>")
    .description("Suspend profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).suspendSapgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sapgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveSapgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sapgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchSapgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("sapgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSapgovProfileV2(id), null, 2));
    });
  parent
    .command("sapgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSapgovProfilesV2(), null, 2));
    });
  parent
    .command("sapgov-create-apply-v2 <id> <profileId>")
    .description("Create apply")
    .option("--agentId <v>", "agentId")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createSapgovApplyV2({ id, profileId, agentId: o.agentId }),
          null,
          2,
        ),
      );
    });
  parent
    .command("sapgov-applying-apply-v2 <id>")
    .description("Mark apply as applying")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).applyingSapgovApplyV2(id), null, 2),
      );
    });
  parent
    .command("sapgov-complete-apply-v2 <id>")
    .description("Complete apply")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeApplySapgovV2(id), null, 2),
      );
    });
  parent
    .command("sapgov-fail-apply-v2 <id> [reason]")
    .description("Fail apply")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failSapgovApplyV2(id, reason), null, 2),
      );
    });
  parent
    .command("sapgov-cancel-apply-v2 <id> [reason]")
    .description("Cancel apply")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelSapgovApplyV2(id, reason), null, 2),
      );
    });
  parent
    .command("sapgov-get-apply-v2 <id>")
    .description("Get apply")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSapgovApplyV2(id), null, 2));
    });
  parent
    .command("sapgov-list-applys-v2")
    .description("List applys")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSapgovApplysV2(), null, 2));
    });
  parent
    .command("sapgov-auto-suspend-idle-v2")
    .description("Auto-suspend idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoSuspendIdleSapgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("sapgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck applys")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckSapgovApplysV2(), null, 2),
      );
    });
  parent
    .command("sapgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getSubAgentProfilesGovStatsV2(), null, 2),
      );
    });
}

// === Iter28 V2 governance overlay: Autagov ===
export function registerAutagV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "agent");
  if (!parent) return;
  const L = async () => await import("../lib/autonomous-agent.js");
  parent
    .command("autagov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.AUTAGOV_PROFILE_MATURITY_V2,
            runLifecycle: m.AUTAGOV_RUN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("autagov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveAutagProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingAutagRunsPerProfileV2(),
            idleMs: m.getAutagProfileIdleMsV2(),
            stuckMs: m.getAutagRunStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("autagov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveAutagProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("autagov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingAutagRunsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("autagov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setAutagProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("autagov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setAutagRunStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("autagov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--tier <v>", "tier")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerAutagProfileV2({ id, owner, tier: o.tier }),
          null,
          2,
        ),
      );
    });
  parent
    .command("autagov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateAutagProfileV2(id), null, 2),
      );
    });
  parent
    .command("autagov-paused-v2 <id>")
    .description("Paused profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).pausedAutagProfileV2(id), null, 2),
      );
    });
  parent
    .command("autagov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveAutagProfileV2(id), null, 2),
      );
    });
  parent
    .command("autagov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchAutagProfileV2(id), null, 2));
    });
  parent
    .command("autagov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getAutagProfileV2(id), null, 2));
    });
  parent
    .command("autagov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listAutagProfilesV2(), null, 2));
    });
  parent
    .command("autagov-create-run-v2 <id> <profileId>")
    .description("Create run")
    .option("--runId <v>", "runId")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createAutagRunV2({ id, profileId, runId: o.runId }),
          null,
          2,
        ),
      );
    });
  parent
    .command("autagov-running-run-v2 <id>")
    .description("Mark run as running")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).runningAutagRunV2(id), null, 2));
    });
  parent
    .command("autagov-complete-run-v2 <id>")
    .description("Complete run")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeRunAutagV2(id), null, 2));
    });
  parent
    .command("autagov-fail-run-v2 <id> [reason]")
    .description("Fail run")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failAutagRunV2(id, reason), null, 2),
      );
    });
  parent
    .command("autagov-cancel-run-v2 <id> [reason]")
    .description("Cancel run")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelAutagRunV2(id, reason), null, 2),
      );
    });
  parent
    .command("autagov-get-run-v2 <id>")
    .description("Get run")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getAutagRunV2(id), null, 2));
    });
  parent
    .command("autagov-list-runs-v2")
    .description("List runs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listAutagRunsV2(), null, 2));
    });
  parent
    .command("autagov-auto-paused-idle-v2")
    .description("Auto-paused idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoPausedIdleAutagProfilesV2(), null, 2),
      );
    });
  parent
    .command("autagov-auto-fail-stuck-v2")
    .description("Auto-fail stuck runs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckAutagRunsV2(), null, 2),
      );
    });
  parent
    .command("autagov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(JSON.stringify((await L()).getAutagovStatsV2(), null, 2));
    });
}
