import { isGovernedSkillSynthesisAttestorTrustOperationsCliHost } from "../lib/evolution/governed-skill-synthesis-attestor-trust-operations-cli-host.js";

function host(value) {
  if (!isGovernedSkillSynthesisAttestorTrustOperationsCliHost(value)) {
    throw new Error(
      "Attestor trust operations are unavailable: a trusted deployment host is required",
    );
  }
  return value;
}

function output(value) {
  console.log(JSON.stringify(value, null, 2));
}

export function registerEvolutionAttestorTrustCommands(
  evolution,
  { attestorTrustOperationsHost = null } = {},
) {
  const trust = evolution
    .command("attestor-trust")
    .description("Operate the governed Skill attestor trust control plane");

  trust
    .command("prepare <operation-file>")
    .description("Create an immutable request plan for external approval")
    .requiredOption(
      "--out <request-file>",
      "Exclusively create the request plan",
    )
    .action(async (operationPath, options) => {
      output(
        await host(attestorTrustOperationsHost).prepare({
          operationPath,
          outputPath: options.out,
        }),
      );
    });

  trust
    .command("execute <request-file> <approval-files...>")
    .description("Execute a request using externally signed approval files")
    .action(async (requestPath, approvalPaths) => {
      output(
        await host(attestorTrustOperationsHost).execute({
          requestPath,
          approvalPaths,
        }),
      );
    });
}
