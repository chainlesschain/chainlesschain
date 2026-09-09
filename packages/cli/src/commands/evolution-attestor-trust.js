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

  trust
    .command("approve <request-file>")
    .description("Sign an attestor trust request with the isolated signer")
    .requiredOption(
      "--out <approval-file>",
      "Exclusively create the approval receipt",
    )
    .action(async (requestPath, options) => {
      output(
        await host(attestorTrustOperationsHost).approve({
          requestPath,
          outputPath: options.out,
        }),
      );
    });

  trust
    .command("operator-prepare <operation-file>")
    .description(
      "Create a registry change request for current-operator approval",
    )
    .requiredOption(
      "--out <request-file>",
      "Exclusively create the operator change request",
    )
    .action(async (operationPath, options) => {
      output(
        await host(attestorTrustOperationsHost).prepareOperatorChange({
          operationPath,
          outputPath: options.out,
        }),
      );
    });

  trust
    .command("operator-execute <request-file> <approval-files...>")
    .description("Commit a quorum-approved operator registry change")
    .action(async (requestPath, approvalPaths) => {
      output(
        await host(attestorTrustOperationsHost).executeOperatorChange({
          requestPath,
          approvalPaths,
        }),
      );
    });

  trust
    .command("operator-approve <request-file>")
    .description("Sign an operator change with the isolated signer")
    .requiredOption(
      "--out <approval-file>",
      "Exclusively create the operator approval receipt",
    )
    .action(async (requestPath, options) => {
      output(
        await host(attestorTrustOperationsHost).approveOperatorChange({
          requestPath,
          outputPath: options.out,
        }),
      );
    });
}
