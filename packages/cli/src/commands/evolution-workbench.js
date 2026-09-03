import { intArg } from "../lib/cli-arg.js";
import { isEvolutionWorkbenchCliHost } from "../lib/evolution/evolution-workbench-cli-host.js";

function host(value) {
  if (!isEvolutionWorkbenchCliHost(value)) {
    throw new Error(
      "Evolution Workbench is unavailable: a trusted deployment host is required",
    );
  }
  return value;
}

function output(value) {
  console.log(JSON.stringify(value, null, 2));
}

export function registerEvolutionWorkbenchCommands(
  evolution,
  { workbenchHost = null } = {},
) {
  const workbench = evolution
    .command("workbench")
    .description("Review governed Skill evolution evidence and versions");

  workbench
    .command("list")
    .description("List verified candidate review packets")
    .option(
      "--query <text>",
      "Search evidence, digest, runtime or capability",
      "",
    )
    .option("--status <status>", "Filter pending|approved|rejected|expired")
    .option("--offset <n>", "Result offset", intArg("--offset"), 0)
    .option("--limit <n>", "Result limit (1..500)", intArg("--limit"), 100)
    .action(async (options) => {
      output(
        await host(workbenchHost).list({
          query: options.query,
          status: options.status ?? null,
          offset: options.offset,
          limit: options.limit,
        }),
      );
    });

  workbench
    .command("compare <left-packet-digest> <right-packet-digest>")
    .description("Compare two verified Skill versions")
    .action(async (left, right) => {
      output(await host(workbenchHost).compare(left, right));
    });

  workbench
    .command("review <decision> <packet-digests...>")
    .description(
      "Approve or reject pending packets with per-item human decisions",
    )
    .requiredOption("--reason <text>", "Human review reason")
    .action(async (decision, packetDigests, options) => {
      output(
        await host(workbenchHost).review({
          decision,
          packetDigests,
          reason: options.reason,
        }),
      );
    });

  workbench
    .command("rollback <from-packet-digest> <to-packet-digest>")
    .description("Roll back the active Skill to an approved exact version")
    .requiredOption("--reason <text>", "Human rollback reason")
    .action(async (fromPacketDigest, toPacketDigest, options) => {
      output(
        await host(workbenchHost).rollback({
          fromPacketDigest,
          toPacketDigest,
          reason: options.reason,
        }),
      );
    });
}
