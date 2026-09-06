import { intArg } from "../lib/cli-arg.js";
import { isGovernedKnowledgeReviewHost } from "../lib/evolution/governed-knowledge-review-host.js";
import { isGovernedKnowledgeRevocationHost } from "../lib/evolution/governed-knowledge-revocation-host.js";
import { parseJsonOption } from "../lib/parse-json-option.js";

function host(value) {
  if (!isGovernedKnowledgeReviewHost(value)) {
    throw new Error(
      "Governed knowledge review is unavailable: a trusted deployment host is required",
    );
  }
  return value;
}

function output(value) {
  console.log(JSON.stringify(value, null, 2));
}

function revocationHost(value) {
  if (!isGovernedKnowledgeRevocationHost(value)) {
    throw new Error(
      "Governed knowledge revocation is unavailable: a trusted deployment host is required",
    );
  }
  return value;
}

export function registerGovernedKnowledgeCommands(
  evolution,
  {
    governedKnowledgeReviewHost = null,
    governedKnowledgeRevocationHost = null,
  } = {},
) {
  const knowledge = evolution
    .command("knowledge")
    .description("Review encrypted governed knowledge conflicts");

  knowledge
    .command("conflicts")
    .description("List redacted conflicts awaiting human merge")
    .option("--cursor <n>", "Conflict cursor", intArg("--cursor"), 0)
    .option("--limit <n>", "Page size (1..256)", intArg("--limit"), 50)
    .action(async (options) => {
      output(
        await host(governedKnowledgeReviewHost).list({
          cursor: options.cursor,
          limit: options.limit,
        }),
      );
    });

  knowledge
    .command("merge <conflict-envelope-digest>")
    .description("Submit a human-reviewed merged governed record")
    .requiredOption("--record <json>", "Canonical merged knowledge record")
    .requiredOption("--reason <text>", "Human merge rationale")
    .action(async (conflictEnvelopeDigest, options) => {
      output(
        await host(governedKnowledgeReviewHost).merge({
          conflictEnvelopeDigest,
          mergedRecord: parseJsonOption(options.record, "--record"),
          reason: options.reason,
        }),
      );
    });

  knowledge
    .command("revoke-prepare")
    .description("Discover and durably freeze a complete revocation plan")
    .requiredOption(
      "--record <json>",
      "Governed revocation record without dependencies",
    )
    .action(async (options) => {
      output(
        await revocationHost(governedKnowledgeRevocationHost).prepare(
          parseJsonOption(options.record, "--record"),
        ),
      );
    });

  knowledge
    .command("revoke-publish <operation-digest>")
    .description("Recover and publish a durably prepared revocation plan")
    .action(async (operationDigest) => {
      output(
        await revocationHost(governedKnowledgeRevocationHost).publish({
          operationDigest,
        }),
      );
    });
}
