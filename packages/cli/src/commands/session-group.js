import { logger } from "../lib/logger.js";
import { SessionWorkbenchStore } from "../lib/session-workbench-store.js";

function output(value, options) {
  if (options.json) {
    logger.log(JSON.stringify(value, null, 2));
    return;
  }
  logger.log(
    `${value.items.length} groups; revision ${value.revision}; generation ${value.generation}`,
  );
}

function store() {
  return new SessionWorkbenchStore();
}

function expected(options) {
  return typeof options.expectedRevision === "string"
    ? options.expectedRevision.trim()
    : "";
}

export function registerSessionGroupCommands(session) {
  const group = session
    .command("group")
    .description("CLI-owned durable session groups and atomic batch moves");

  group
    .command("list")
    .description("Read the current group revision and assignments")
    .option("--json", "Output as JSON")
    .action((options) => output(store().projection(), options));

  group
    .command("create <name>")
    .description("Create a session group using exact revision CAS")
    .requiredOption(
      "--expected-revision <sha256>",
      "Exact group revision rendered by session projection",
    )
    .option("--order <n>", "Insert at a zero-based group order")
    .option("--json", "Output as JSON")
    .action((name, options) =>
      output(
        store().createGroup({
          name,
          order: options.order == null ? null : Number(options.order),
          expectedRevision: expected(options),
        }),
        options,
      ),
    );

  group
    .command("rename <group-id> <name>")
    .description("Rename a session group using exact revision CAS")
    .requiredOption(
      "--expected-revision <sha256>",
      "Exact group revision rendered by session projection",
    )
    .option("--json", "Output as JSON")
    .action((groupId, name, options) =>
      output(
        store().renameGroup({
          groupId,
          name,
          expectedRevision: expected(options),
        }),
        options,
      ),
    );

  group
    .command("delete <group-id>")
    .description("Delete a group and atomically ungroup its sessions")
    .requiredOption(
      "--expected-revision <sha256>",
      "Exact group revision rendered by session projection",
    )
    .option("--json", "Output as JSON")
    .action((groupId, options) =>
      output(
        store().deleteGroup({
          groupId,
          expectedRevision: expected(options),
        }),
        options,
      ),
    );

  group
    .command("order <group-id> <order>")
    .description("Move a group to a zero-based order using exact revision CAS")
    .requiredOption(
      "--expected-revision <sha256>",
      "Exact group revision rendered by session projection",
    )
    .option("--json", "Output as JSON")
    .action((groupId, order, options) =>
      output(
        store().setGroupOrder({
          groupId,
          order: Number(order),
          expectedRevision: expected(options),
        }),
        options,
      ),
    );

  group
    .command("move <group-id> <session-ids...>")
    .description(
      "Atomically move selected canonical sessions; use ungrouped as the target",
    )
    .requiredOption(
      "--expected-revision <sha256>",
      "Exact group revision rendered by session projection",
    )
    .option("--json", "Output as JSON")
    .action((groupId, sessionIds, options) =>
      output(
        store().moveSessions({
          groupId,
          sessionIds,
          expectedRevision: expected(options),
        }),
        options,
      ),
    );
}
