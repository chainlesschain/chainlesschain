import { isGovernedSkillMarketplaceCliHost } from "../lib/evolution/governed-skill-marketplace-cli-host.js";
import { startGovernedSkillMarketplaceBadgeServer } from "../lib/evolution/governed-skill-marketplace-badge.js";
import { intArg } from "../lib/cli-arg.js";

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
    .command("serve-badge <skill-name>")
    .description(
      "Serve a read-only public Eval badge for one explicitly pinned listing",
    )
    .requiredOption("--skill-version <version>", "Exact public catalog version")
    .requiredOption(
      "--manifest <digest>",
      "Explicitly approved manifest digest",
    )
    .option(
      "--listen <ip>",
      "Bind IP; non-loopback explicitly publishes the badge",
      "127.0.0.1",
    )
    .option(
      "--port <port>",
      "HTTP port (0 selects an available port)",
      intArg("--port", { min: 0, max: 65535 }),
      8321,
    )
    .option(
      "--snapshot-seconds <seconds>",
      "Snapshot lifetime; expiration requires explicit restart",
      intArg("--snapshot-seconds", { min: 1, max: 3600 }),
      600,
    )
    .action(async (skillName, options) => {
      const service = await startGovernedSkillMarketplaceBadgeServer({
        marketplaceHost: host(marketplaceHost),
        skillName,
        version: options.skillVersion,
        manifestDigest: options.manifest,
        listen: options.listen,
        port: options.port,
        snapshotTtlMs: options.snapshotSeconds * 1000,
      });
      const close = () => {
        service.close().catch(() => {
          process.exitCode = 1;
        });
      };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
      service.server.once("close", () => {
        process.removeListener("SIGINT", close);
        process.removeListener("SIGTERM", close);
      });
      console.log(`Public Eval badge: ${service.url}`);
    });

  marketplace
    .command("inspect <skill-name>")
    .description(
      "Verify a signed Skill listing for the deployment's fixed target",
    )
    .option("--skill-version <version>", "Exact catalog version")
    .action(async (skillName, options) =>
      output(
        await host(marketplaceHost).inspect({
          skillName,
          version: options.skillVersion ?? null,
        }),
      ),
    );

  marketplace
    .command("install <skill-name>")
    .description(
      "Persist verified candidate files and governance state; does not activate the Skill",
    )
    .option("--skill-version <version>", "Exact catalog version")
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
          version: options.skillVersion ?? null,
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
