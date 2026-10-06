/** Explicit operator access to the existing Linux kernel recovery fence. */
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

function invalid(message, code = "CC_PROCESS_OWNERSHIP_INVALID") {
  return Object.assign(new Error(message), { code });
}

async function authority(dependencies) {
  if ((dependencies.platform ?? process.platform) !== "linux")
    throw invalid(
      "Durable process ownership inspection and recovery require Linux",
      "CC_PROCESS_OWNERSHIP_PLATFORM_UNSUPPORTED",
    );
  return dependencies.loadAuthority
    ? dependencies.loadAuthority()
    : import("../lib/process-execution-broker/process-ownership-quarantine.js");
}

export async function inspectProcessOwnership(dependencies = {}) {
  const host = await authority(dependencies);
  return {
    schema: "chainlesschain.process-ownership-status/v1",
    ...host.getProcessOwnershipStatus(),
  };
}

export async function recoverProcessOwnership(
  executionId,
  options = {},
  dependencies = {},
) {
  if (typeof executionId !== "string" || !UUID.test(executionId))
    throw invalid("An exact lowercase execution UUID is required");
  const rawTimeout = options.timeoutMs ?? 5000;
  if (
    (typeof rawTimeout !== "number" &&
      (typeof rawTimeout !== "string" || !/^[0-9]+$/u.test(rawTimeout))) ||
    !Number.isSafeInteger(Number(rawTimeout)) ||
    Number(rawTimeout) < 1 ||
    Number(rawTimeout) > 30000
  )
    throw invalid("--timeout-ms must be an integer from 1 to 30000");
  const host = await authority(dependencies);
  const receipt = await host.recoverProcessOwnership(executionId, {
    timeoutMs: Number(rawTimeout),
  });
  return { schema: "chainlesschain.process-ownership-recovery/v1", receipt };
}

export function registerProcessOwnershipCommands(agent, dependencies = {}) {
  const ownership = agent
    .command("process-ownership")
    .description(
      "Inspect Linux process quarantine or explicitly stop one recoverable execution",
    );
  const writeOut =
    dependencies.writeOut ?? ((text) => process.stdout.write(text));
  const writeError =
    dependencies.writeError ?? ((text) => process.stderr.write(text));
  const execute = async (operation, json, render) => {
    try {
      // Parent agent flags must never silently change the administrative target.
      if (
        agent.options.some(
          (option) =>
            agent.getOptionValueSource(option.attributeName()) === "cli",
        )
      )
        throw invalid(
          "Parent agent flags are unsupported for process-ownership",
        );
      const result = await operation();
      writeOut(json ? `${JSON.stringify(result)}\n` : render(result));
      process.exitCode = 0;
    } catch (error) {
      writeError(
        `${error.code || "CC_PROCESS_OWNERSHIP_FAILED"}: ${error.message}\n`,
      );
      process.exitCode = 1;
    }
  };
  ownership
    .command("status")
    .description(
      "Read quarantine state without provisioning or clearing records",
    )
    .option("--json", "Output structured quarantine state")
    .action(async (options) =>
      execute(
        () => inspectProcessOwnership(dependencies),
        options.json,
        (result) =>
          [
            `Process ownership quarantine: ${result.blocked ? "blocked" : "clear"}`,
            `Unresolved execution IDs: ${result.unresolvedExecutionIds.join(", ") || "none"}`,
            `Kernel recovery candidates: ${result.recoverableExecutionIds.join(", ") || "none"}`,
            "Candidates require live kernel identity verification; restart alone never confirms cleanup.",
            "",
          ].join("\n"),
      ),
    );
  ownership
    .command("recover <execution-id>")
    .description(
      "Stop the exact persisted cgroup and clear its quarantine only after confirmed cleanup; never resume the task",
    )
    .option(
      "--timeout-ms <n>",
      "Kernel empty-fence deadline, 1-30000 ms",
      "5000",
    )
    .option("--json", "Output the durable cleanup receipt")
    .action(async (executionId, options) =>
      execute(
        () => recoverProcessOwnership(executionId, options, dependencies),
        options.json,
        (result) =>
          `Confirmed cleanup for ${result.receipt.executionId}; task was not resumed.\n`,
      ),
    );
}
