// Test-only target provisioning: no source credentials are copied. The signed
// ephemeral deployment permits the control campaign to resume chat and /exit;
// it is not evidence of a real provider request or production trust policy.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSignedAgentEvolutionDeployment } from "../../packages/cli/__tests__/fixtures/agent-evolution-test-deployment.js";
import { configureEvolutionDeployment } from "../../packages/cli/src/lib/evolution/evolution-deployment-config.js";

export async function prepareTargetChatDeployment(targetHome) {
  assert.ok(path.isAbsolute(targetHome));
  const physicalHome = fs.realpathSync(targetHome);
  const repository = fs.realpathSync(
    fileURLToPath(new URL("../../", import.meta.url)),
  );
  const relative = path.relative(repository, physicalHome);
  assert.ok(
    relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative),
    "Target fixture home must be outside the repository",
  );
  const cliHome = path.join(physicalHome, ".chainlesschain");
  const deploymentRoot = path.join(cliHome, "location-test-deployment");
  fs.mkdirSync(deploymentRoot, { recursive: true, mode: 0o700 });
  const deployment = createSignedAgentEvolutionDeployment(deploymentRoot, {
    commands: ["chat"],
  });
  await configureEvolutionDeployment(
    {
      descriptorPath: deployment.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR,
      trustRootPath: deployment.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT,
    },
    { cwd: repository, env: { ...process.env, CHAINLESSCHAIN_HOME: cliHome } },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await prepareTargetChatDeployment(process.argv[2]);
