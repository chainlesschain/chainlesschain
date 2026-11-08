import { resolveSessionAuthority } from "../harness/jsonl-session-store.js";
import { acquireSessionHostLease } from "../lib/session-host-lease.js";
import { parseJsonOption } from "../lib/parse-json-option.js";
import { numericOption } from "../lib/cli-numeric.js";
import {
  createDurableMcpTaskRuntime,
  listDurableMcpTasks,
} from "../lib/mcp-task-runtime.js";
import { readMcpTaskJournal } from "../lib/mcp-task-journal.js";

function sessionFor(value) {
  const authority = resolveSessionAuthority(value);
  if (!authority?.readable) {
    throw Object.assign(new Error("A readable canonical session is required"), {
      code: "CC_MCP_TASK_SESSION_UNAVAILABLE",
    });
  }
  return authority.id;
}

function emit(value, json) {
  if (json) console.log(JSON.stringify(value));
  else if (Array.isArray(value.records)) {
    if (!value.records.length) console.log("No tasks in this session.");
    for (const record of value.records) {
      console.log(
        record.localId +
          "  " +
          record.serverName +
          "/" +
          record.toolName +
          "  " +
          (record.resultSaved
            ? "result_saved"
            : record.remoteStatus || record.phase) +
          (record.resultSaved ? "  result saved" : "") +
          (record.outcomeUnknown ? "  outcome unknown" : ""),
      );
    }
  } else if (value.delivered === true) {
    console.log(
      "Task " +
        value.localId +
        (value.duplicate
          ? ": result already delivered."
          : ": result delivered for the next user continuation."),
    );
  } else if (Object.hasOwn(value, "result")) {
    for (const block of value.result.content) {
      if (block.type === "text" && typeof block.text === "string")
        console.log(block.text);
    }
    console.log(
      "Task " + value.localId + (value.cached ? " (saved result)" : ""),
    );
  } else {
    console.log(
      "Task " + value.localId + ": " + (value.remoteStatus || value.phase),
    );
  }
}

export function registerMcpTaskCommands(
  mcp,
  { connect, shutdown = async () => {}, secretStore = null } = {},
) {
  const tasks = mcp
    .command("tasks")
    .description(
      "Track durable server tasks in a canonical session (experimental, HTTP(S))",
    );
  const action = (operation) => async (first, second) => {
    // Commander passes only options for list, and one positional argument for
    // other operations. Avoid accepting a server override on resumed tasks.
    const options = operation === "list" ? first : second;
    const item = operation === "list" ? null : first;
    let client = null;
    let lease = null;
    try {
      const sessionId = sessionFor(options.session);
      if (operation === "list") {
        emit(listDurableMcpTasks(sessionId), options.json);
        return;
      }
      const journal = readMcpTaskJournal(sessionId);
      const stored =
        operation === "create"
          ? null
          : journal.records.find((record) => record.localId === item);
      if (operation !== "create" && !stored) {
        throw Object.assign(
          new Error("No task exists in this verified session"),
          {
            code: "CC_MCP_TASK_NOT_FOUND",
          },
        );
      }
      const serverName = stored?.serverName || options.server;
      const args =
        operation === "create"
          ? parseJsonOption(options.args, "--args", {})
          : null;
      const ttl =
        options.ttl === undefined
          ? undefined
          : numericOption(options.ttl, {
              name: "--ttl",
              integer: true,
              min: 0,
              max: Number.MAX_SAFE_INTEGER,
            });
      lease = acquireSessionHostLease(sessionId, { hostKind: "mcp-tasks" });
      const savedResult =
        stored?.result != null &&
        (operation === "result" ||
          operation === "poll" ||
          operation === "deliver");
      if (!savedResult) {
        const connection = await connect(serverName);
        client = connection.client;
        if (!connection.connected.includes(serverName)) {
          throw Object.assign(
            new Error("MCP task server could not be connected"),
            {
              code: "CC_MCP_TASK_CONNECTION_REQUIRED",
            },
          );
        }
      }
      const runtime = createDurableMcpTaskRuntime({
        client,
        sessionId,
        lease,
        secretStore,
      });
      const result =
        operation === "create"
          ? await runtime.create(serverName, item, args, { ttl })
          : operation === "watch"
            ? await runtime.watch(item, {
                intervalMs: numericOption(options.interval, {
                  name: "--interval",
                  integer: true,
                  min: 0,
                  max: 60_000,
                }),
                timeoutMs: numericOption(options.timeout, {
                  name: "--timeout",
                  integer: true,
                  min: 1,
                  max: 24 * 60 * 60 * 1000,
                }),
                deliver: options.deliver !== false,
              })
            : await runtime[operation](item);
      emit(result, options.json);
    } catch (error) {
      process.exitCode = 1;
      const value = {
        error: {
          code:
            typeof error.code === "string"
              ? error.code
              : "CC_MCP_TASK_COMMAND_FAILED",
          message:
            "MCP task operation could not complete. Inspect session tasks and recovery before retrying a tool call.",
          ...(typeof error.localId === "string"
            ? { localId: error.localId }
            : {}),
          outcomeUnknown: error.outcomeUnknown === true,
          ...(typeof error.dispatched === "boolean"
            ? { dispatched: error.dispatched }
            : {}),
        },
      };
      if (options.json) console.log(JSON.stringify(value));
      else console.error(value.error.code + ": " + value.error.message);
    } finally {
      try {
        await client?.disconnectAll();
      } finally {
        try {
          lease?.release();
        } finally {
          await shutdown();
        }
      }
    }
  };
  tasks
    .command("list")
    .description("List verified local task records without contacting servers")
    .requiredOption("--session <id>", "Owning canonical session")
    .option("--json", "Output as JSON")
    .action(action("list"));
  tasks
    .command("create <tool>")
    .description("Start one server task and persist its acceptance")
    .requiredOption("--session <id>", "Owning canonical session")
    .requiredOption("-s, --server <name>", "Configured server")
    .option("-a, --args <json>", "Tool arguments as JSON")
    .option("--ttl <ms>", "Requested task lifetime in milliseconds")
    .option("--json", "Output as JSON")
    .action(action("create"));
  for (const operation of ["poll", "result", "deliver", "cancel", "watch"]) {
    tasks
      .command(operation + " <local-id>")
      .description(
        operation === "poll"
          ? "Refresh remote task status without replaying the tool"
          : operation === "result"
            ? "Retrieve and save a result, or read its saved copy"
            : operation === "deliver"
              ? "Deliver a saved result once to its session as external reference data"
              : operation === "watch"
                ? "Poll a remote task until its result is saved, then deliver once"
                : "Request cancellation; remote side effects may already have occurred",
      )
      .requiredOption("--session <id>", "Owning canonical session")
      .option("--interval <ms>", "Polling interval in milliseconds")
      .option(
        "--timeout <ms>",
        "Maximum watch duration in milliseconds",
        String(15 * 60 * 1000),
      )
      .option(
        "--no-deliver",
        "Save the result without appending a delivery event",
      )
      .option("--json", "Output as JSON")
      .action(action(operation));
  }
  return tasks;
}
