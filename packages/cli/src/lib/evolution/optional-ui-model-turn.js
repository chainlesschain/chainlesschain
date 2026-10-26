import { loadEvolutionDeploymentCommandDependencies } from "./evolution-deployment-loader.js";
import {
  prepareGovernedModelTurn,
  readEvolutionCompositionFactory,
} from "./governed-model-turn.js";

/** Host-only entry point; client frames cannot select the Evolution policy. */
export async function loadConfiguredUiEvolutionFactory(options = {}) {
  return readEvolutionCompositionFactory(
    (await loadEvolutionDeploymentCommandDependencies("ui", options)) || {},
  );
}

export async function resolveServerEvolutionFactory(server) {
  return typeof server.resolveEvolutionCompositionFactory === "function"
    ? server.resolveEvolutionCompositionFactory()
    : (server.evolutionCompositionFactory ?? null);
}

export async function prepareConfiguredUiModelTurn(context, options = {}) {
  const current = await loadConfiguredUiEvolutionFactory(options);
  return prepareGovernedModelTurn(current, {
    ...context,
    evolutionDisabled: current === null,
  });
}
