import { createGovernedHubLlm } from "./governed-hub-llm.js";

// Analysis skills treat commentary failures as optional. A governed invocation
// must still surface a failed model turn after the SDK returns its report.
export async function runGovernedHubSkill(
  hub,
  factory,
  runSkill,
  name,
  options,
  sdkPorts,
) {
  let failure;
  let failed = false;
  const llm = createGovernedHubLlm(
    hub.llm,
    factory,
    {
      onFailure(error) {
        failure = error;
        failed = true;
      },
    },
    sdkPorts,
  );
  const result = await runSkill({ vault: hub.vault, llm }, name, options);
  if (failed) throw failure;
  return result;
}
