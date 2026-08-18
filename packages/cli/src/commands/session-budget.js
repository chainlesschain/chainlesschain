import {
  adjudicateProductionSessionBudgetRecovery,
  readProductionSessionBudget,
} from "../lib/session-budget-production-root.js";

function writeJson(value, write = console.log) {
  write(JSON.stringify(value, null, 2));
}

function collect(value, previous) {
  return [...previous, value];
}

function parseSettlement(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid --settlement JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid --settlement JSON: expected one object");
  }
  return parsed;
}

export function renderSessionBudgetStatus(status) {
  if (!status) return ["No durable session budget authority was found."];
  const lines = [
    `Session budget ${status.sessionId} (revision ${status.revision})`,
    `turns ${status.totals.turns}/${status.limits.maxTurns ?? "unlimited"}; tokens ${status.totals.tokens}/${status.limits.maxTokens ?? "unlimited"}; USD ${status.totals.spentUsd}/${status.limits.maxUsd ?? "unlimited"}`,
    `tool time ${status.totals.toolMs}/${status.limits.maxToolMs ?? "unlimited"} ms; active wall ${status.totals.elapsedMs}/${status.limits.maxWallMs ?? "unlimited"} ms`,
    `recovery ${status.recoveryRequired ? `required (${status.pendingRecovery.length})` : "not required"}`,
  ];
  for (const pending of status.pendingRecovery) {
    lines.push(
      `  ${pending.authorityId} ${pending.resourceType}/${pending.kind}`,
    );
  }
  return lines;
}

export function registerSessionBudgetCommands(session, dependencies = {}) {
  const readBudget =
    dependencies.readProductionSessionBudget || readProductionSessionBudget;
  const adjudicate =
    dependencies.adjudicateProductionSessionBudgetRecovery ||
    adjudicateProductionSessionBudgetRecovery;
  const write = dependencies.write || console.log;
  const writeError = dependencies.writeError || console.error;

  const budget = session
    .command("budget")
    .description("Inspect or adjudicate a durable session budget authority");

  budget
    .command("status <session-id>", { isDefault: true })
    .description("Read the current durable session budget status")
    .option("--json", "Output JSON")
    .action((sessionId, options) => {
      try {
        const status = readBudget(sessionId);
        if (options.json) writeJson(status, write);
        else for (const line of renderSessionBudgetStatus(status)) write(line);
      } catch (error) {
        writeError(`Session budget status failed: ${error.message}`);
        process.exitCode = 1;
      }
    });

  budget
    .command("recover <session-id>")
    .description(
      "Adjudicate every exact crash-pending authority as verified usage or abandoned",
    )
    .option(
      "--abandon <authority-id...>",
      "Exact opaque authority ids shown by session budget status",
    )
    .option(
      "--settlement <json>",
      "Repeatable verified usage JSON with authorityId, provider, model, and usage",
      collect,
      [],
    )
    .option("--json", "Output JSON")
    .action((sessionId, options) => {
      try {
        const result = adjudicate(sessionId, {
          abandoned: options.abandon || [],
          settled: options.settlement.map(parseSettlement),
        });
        if (options.json) writeJson(result, write);
        else {
          write(
            `Recovered session budget ${sessionId}; recorded ${result.settled.length} verified usage settlement(s), abandoned ${result.abandoned.length} exact authority id(s).`,
          );
        }
      } catch (error) {
        writeError(`Session budget recovery failed: ${error.message}`);
        process.exitCode = 1;
      }
    });
}
