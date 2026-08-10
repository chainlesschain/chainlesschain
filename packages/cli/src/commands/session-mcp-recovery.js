import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { resolveSessionId as storeResolveSessionId } from "../harness/jsonl-session-store.js";
import {
  adjudicateMcpRecovery,
  buildMcpRecoveryAdjudicationChallenge,
  publicMcpRecoveryAuthority,
  readMcpRecoveryAuthority,
} from "../lib/mcp-recovery-adjudication.js";

function commandError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveJsonlSession(id, dependencies = {}) {
  const resolveSessionId =
    dependencies.resolveSessionId || storeResolveSessionId;
  const sessionId = resolveSessionId(id);
  if (!sessionId) {
    throw commandError(
      "CC_MCP_RECOVERY_SESSION_NOT_FOUND",
      `JSONL session not found: ${id}`,
    );
  }
  return sessionId;
}

export async function requireMcpRecoveryTypedChallenge(
  request,
  dependencies = {},
) {
  const stdin = dependencies.stdin || process.stdin;
  const stdout = dependencies.stdout || process.stdout;
  if (stdin?.isTTY !== true || stdout?.isTTY !== true) {
    throw commandError(
      "CC_MCP_RECOVERY_ADJUDICATION_NON_INTERACTIVE",
      "MCP recovery adjudication requires an interactive TTY",
    );
  }
  const challenge = buildMcpRecoveryAdjudicationChallenge(request);
  const readChallenge =
    dependencies.readChallenge ||
    (async (expected) => {
      const { input } = await import("@inquirer/prompts");
      return input({
        message:
          "First stop the prior host, drain every already-dispatched MCP request, and verify its external outcome. Revocation fences future dispatches; it does not cancel a request already sent. " +
          `Type this authorization exactly:\n${expected}`,
      });
    });
  const answer = await readChallenge(challenge);
  if (answer !== challenge) {
    throw commandError(
      "CC_MCP_RECOVERY_ADJUDICATION_CHALLENGE_FAILED",
      "MCP recovery adjudication challenge did not match; no change was made",
    );
  }
  return challenge;
}

export async function readMcpRecoveryReason(dependencies = {}) {
  const stdin = dependencies.stdin || process.stdin;
  const stdout = dependencies.stdout || process.stdout;
  if (stdin?.isTTY !== true || stdout?.isTTY !== true) {
    throw commandError(
      "CC_MCP_RECOVERY_ADJUDICATION_NON_INTERACTIVE",
      "MCP recovery adjudication requires an interactive TTY",
    );
  }
  const readReason =
    dependencies.readReason ||
    (async () => {
      const { input } = await import("@inquirer/prompts");
      return input({
        message: "Reason (its digest only is persisted; do not enter secrets)",
      });
    });
  return readReason();
}

export function showMcpRecoveryCommand(id, dependencies = {}) {
  const sessionId = resolveJsonlSession(id, dependencies);
  const recovery = readMcpRecoveryAuthority(sessionId, dependencies);
  return publicMcpRecoveryAuthority(sessionId, recovery);
}

export async function adjudicateMcpRecoveryCommand(
  id,
  options,
  dependencies = {},
) {
  const sessionId = resolveJsonlSession(id, dependencies);
  const challengeRequest = {
    sessionId,
    ledgerId: options.ledgerId,
    decision: options.decision,
    recoveryDigest: options.expectedRecoveryDigest,
  };
  const reason = await readMcpRecoveryReason(dependencies);
  await requireMcpRecoveryTypedChallenge(challengeRequest, dependencies);
  return adjudicateMcpRecovery(
    {
      sessionId,
      ledgerId: options.ledgerId,
      decision: options.decision,
      expectedHeadHash: options.expectedHeadHash,
      expectedRecoveryDigest: options.expectedRecoveryDigest,
      reason,
    },
    dependencies,
  );
}

function printRecoveryAuthority(authority, outputLogger = logger) {
  outputLogger.log(chalk.bold(`MCP recovery: ${authority.sessionId}`));
  outputLogger.log(`  verified: ${authority.verified ? "yes" : "no"}`);
  outputLogger.log(`  headHash: ${authority.headHash || "(none)"}`);
  outputLogger.log(`  recoveryDigest: ${authority.recoveryDigest || "(none)"}`);
  outputLogger.log(`  blockMode: ${authority.blockMode || "none"}`);
  outputLogger.log(`  remediation: ${authority.remediation || "none"}`);
  for (const record of authority.unsettled) {
    outputLogger.log(
      `  outcome unknown: ${record.ledgerId} ${record.serverName}/${record.toolName} [${record.effect}]`,
    );
  }
  for (const incident of authority.incidents) {
    outputLogger.log(
      `  incident: ${incident.code}${incident.ledgerId ? ` (${incident.ledgerId})` : ""}`,
    );
  }
  for (const adjudication of authority.adjudications) {
    outputLogger.log(
      `  adjudication: ${adjudication.ledgerId} ${adjudication.decision} ` +
        `${adjudication.requestId} ${adjudication.reasonDigest}`,
    );
  }
  for (const deny of authority.replayDenied) {
    outputLogger.log(
      `  replay denied: ${deny.ledgerId} ${deny.serverName}/${deny.toolName} ${deny.replayDigest}`,
    );
  }
}

export function registerSessionMcpRecoveryCommands(session, dependencies = {}) {
  const outputLogger = dependencies.logger || logger;
  const recovery = session
    .command("mcp-recovery")
    .description("Inspect or adjudicate verified MCP outcome-unknown calls");

  recovery
    .command("show", { isDefault: true })
    .description("Show verified MCP recovery authority (read-only)")
    .argument("<id>", "JSONL session ID or prefix")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const authority = showMcpRecoveryCommand(id, dependencies);
        if (options.json) {
          console.log(JSON.stringify(authority, null, 2));
        } else {
          printRecoveryAuthority(authority, outputLogger);
        }
      } catch (error) {
        outputLogger.error(`MCP recovery show failed: ${error.message}`);
        process.exitCode = 1;
      }
    });

  recovery
    .command("adjudicate")
    .description(
      "After host stop, MCP drain and outcome verification, revoke authority and record a decision",
    )
    .argument("<id>", "JSONL session ID or prefix")
    .requiredOption("--ledger-id <id>", "Started-only MCP ledger ID")
    .requiredOption(
      "--decision <decision>",
      "confirmed_applied or confirmed_not_applied",
    )
    .requiredOption(
      "--expected-head-hash <digest>",
      "Exact headHash from the latest mcp-recovery show",
    )
    .requiredOption(
      "--expected-recovery-digest <digest>",
      "Exact recoveryDigest from the latest mcp-recovery show",
    )
    .option("--json", "Output as JSON after interactive confirmation")
    .action(async (id, options) => {
      try {
        const result = await adjudicateMcpRecoveryCommand(
          id,
          options,
          dependencies,
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          outputLogger.success(
            `Recorded ${result.decision} for ${result.ledgerId} at ${result.headHash}`,
          );
        }
        outputLogger.warn(
          "Prior host authority is durably revoked, fencing future MCP dispatches. " +
            "Revocation does not cancel calls that were already dispatched; retain the stopped/drained/outcome evidence and restart/resume before new MCP calls.",
        );
      } catch (error) {
        outputLogger.error(
          `MCP recovery adjudication failed: ${error.message}`,
        );
        process.exitCode = 1;
      }
    });

  return recovery;
}
