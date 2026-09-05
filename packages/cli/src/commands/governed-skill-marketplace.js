import { isGovernedSkillMarketplaceCliHost } from "../lib/evolution/governed-skill-marketplace-cli-host.js";

function host(value) {
  if (!isGovernedSkillMarketplaceCliHost(value))
    throw new Error(
      "Governed Skill marketplace is unavailable: a trusted deployment host is required",
    );
  return value;
}

function output(value) {
  console.log(JSON.stringify(value, null, 2));
}

export function registerGovernedSkillMarketplaceCommands(
  marketplace,
  { marketplaceHost = null } = {},
) {
  marketplace
    .command("inspect <skill-name>")
    .description(
      "Verify a signed Skill listing for the deployment's fixed target",
    )
    .option("--version <version>", "Exact catalog version")
    .action(async (skillName, options) =>
      output(
        await host(marketplaceHost).inspect({
          skillName,
          version: options.version ?? null,
        }),
      ),
    );

  marketplace
    .command("install <skill-name>")
    .description(
      "Persist verified candidate files and governance state; does not activate the Skill",
    )
    .option("--version <version>", "Exact catalog version")
    .requiredOption(
      "--manifest <digest>",
      "Manifest digest returned by inspect",
    )
    .option(
      "--expected-state <digest>",
      "Current state digest for an update; omitted for first stage",
    )
    .action(async (skillName, options) =>
      output(
        await host(marketplaceHost).install({
          skillName,
          version: options.version ?? null,
          manifestDigest: options.manifest,
          expectedStateDigest: options.expectedState ?? null,
        }),
      ),
    );

  marketplace
    .command("state <skill-name>")
    .description("Read the verified durable governed Skill state")
    .action(async (skillName) =>
      output(await host(marketplaceHost).state({ skillName })),
    );

  for (const operation of ["rollout", "revoke"]) {
    marketplace
      .command(`${operation} <skill-name>`)
      .description(
        operation === "rollout"
          ? "Advance exactly one stage using a verified Pilot receipt"
          : "Roll back using a verified revocation receipt",
      )
      .requiredOption("--expected-state <digest>", "Exact current state digest")
      .requiredOption(
        "--receipt <reference>",
        "Reference resolved and verified by deployment authority",
      )
      .action(async (skillName, options) =>
        output(
          await host(marketplaceHost)[operation]({
            skillName,
            expectedStateDigest: options.expectedState,
            receiptRef: options.receipt,
          }),
        ),
      );
  }
}
