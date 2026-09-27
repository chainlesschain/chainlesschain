import fs from "node:fs";
import path from "node:path";
const [root, mode] = process.argv.slice(2);
process.env.CHAINLESSCHAIN_HOME = path.join(
  root,
  "target-home",
  ".chainlesschain",
);
process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = path.join(
  root,
  "target-security",
);
const store = await import("../../../src/harness/jsonl-session-store.js");
store.startSession("resume-auth-test", {
  provider: "fixture-no-provider-call",
  model: "fixture-no-model-call",
});
store.appendUserMessage("resume-auth-test", "saved user input");
store.appendAssistantMessage("resume-auth-test", "saved response");
if (mode === "chat") {
  const { prepareTargetChatDeployment } =
    await import("../../../../../.github/scripts/prepare-ide-roadmap-location-deployment.mjs");
  await prepareTargetChatDeployment(path.join(root, "target-home"));
} else if (mode === "agent") {
  const deploymentRoot = path.join(
    process.env.CHAINLESSCHAIN_HOME,
    "agent-test-deployment",
  );
  fs.mkdirSync(deploymentRoot, { recursive: true });
  const { createSignedAgentEvolutionDeployment } =
    await import("../../fixtures/agent-evolution-test-deployment.js");
  const { configureEvolutionDeployment } =
    await import("../../../src/lib/evolution/evolution-deployment-config.js");
  const deployment = createSignedAgentEvolutionDeployment(deploymentRoot);
  await configureEvolutionDeployment({
    descriptorPath: deployment.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR,
    trustRootPath: deployment.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT,
  });
}
