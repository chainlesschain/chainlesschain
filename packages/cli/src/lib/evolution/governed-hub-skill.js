import { createGovernedHubLlm } from "./governed-hub-llm.js";

// Analysis skills treat commentary failures as optional. A governed invocation
// must still surface a failed model turn after the SDK returns its report.
export async function runGovernedHubSkill(
  hub,
  factory,
  runSkill,
  name,
  options,
) {
  const model = createGovernedHubLlm(hub.llm, factory);
  let failure;
  let failed = false;
  const llm = Object.freeze({
    get name() {
      return model.name;
    },
    get isLocal() {
      return model.isLocal;
    },
    async chat(messages, chatOptions) {
      if (failed) throw failure;
      try {
        return await model.chat(messages, chatOptions);
      } catch (error) {
        failure = error;
        failed = true;
        throw error;
      }
    },
  });
  const result = await runSkill({ vault: hub.vault, llm }, name, options);
  if (failed) throw failure;
  return result;
}
