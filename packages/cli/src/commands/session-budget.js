import {
  adjudicateProductionSessionBudgetRecovery,
  readProductionSessionBudget,
  readProductionSessionBudgetRecoveryReceipts,
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
  const adjudication = status.state?.recoveryAdjudication;
  if (adjudication) {
    lines.push(
      `recovery adjudication ${adjudication.headDigest} (sequence ${adjudication.count})`,
    );
  }
  for (const pending of status.pendingRecovery) {
    lines.push(
      `  ${pending.authorityId} ${pending.resourceType}/${pending.kind}`,
    );
  }
  return lines;
}

export function renderSessionBudgetReceipts(receipts) {
  if (!receipts) {
    return ["No durable session budget authority was found."];
  }
  const retained = receipts.entries.length;
  const lines = [
    `Session budget recovery receipts ${receipts.sessionId} (revision ${receipts.revision})`,
    `history ${receipts.complete ? "complete" : "partial"}; retained ${retained}/${receipts.count}; head ${receipts.headDigest || "none"}`,
  ];
  if (!receipts.complete && receipts.baseDigest) {
    lines.push(
      `  legacy prefix through sequence ${receipts.baseSequence}: ${receipts.baseDigest}`,
    );
  }
  for (const receipt of receipts.entries) {
    lines.push(
      `  sequence ${receipt.sequence}: ${receipt.digest}; settled ${receipt.settled.length}; abandoned ${receipt.abandoned.length}; tokens ${receipt.totalsBefore.tokens}->${receipt.totalsAfter.tokens}; USD ${receipt.totalsBefore.spentUsd}->${receipt.totalsAfter.spentUsd}`,
    );
  }
  return lines;
}

export function registerSessionBudgetCommands(session, dependencies = {}) {
  const readBudget =
    dependencies.readProductionSessionBudget || readProductionSessionBudget;
  const readReceipts =
    dependencies.readProductionSessionBudgetRecoveryReceipts ||
    readProductionSessionBudgetRecoveryReceipts;
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
            `Recovered session budget ${sessionId}; recorded ${result.settled.length} verified usage settlement(s), abandoned ${result.abandoned.length} exact authority id(s); adjudication ${result.adjudication.digest}.`,
          );
        }
      } catch (error) {
        writeError(`Session budget recovery failed: ${error.message}`);
        process.exitCode = 1;
      }
    });

  budget
    .command("receipts <session-id>")
    .description(
      "Read canonical content-free recovery receipts retained by the durable budget",
    )
    .option("--json", "Output JSON")
    .action((sessionId, options) => {
      try {
        const receipts = readReceipts(sessionId);
        if (options.json) writeJson(receipts, write);
        else {
          for (const line of renderSessionBudgetReceipts(receipts)) write(line);
        }
      } catch (error) {
        writeError(`Session budget receipts failed: ${error.message}`);
        process.exitCode = 1;
      }
    });
}
