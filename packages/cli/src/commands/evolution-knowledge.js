import { intArg } from "../lib/cli-arg.js";
import { isGovernedKnowledgeReviewHost } from "../lib/evolution/governed-knowledge-review-host.js";
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

export function registerGovernedKnowledgeCommands(
  evolution,
  { governedKnowledgeReviewHost = null } = {},
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
}
