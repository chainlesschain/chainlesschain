import { loadConfig } from "../lib/config-manager.js";
import { AgentRuntime } from "./agent-runtime.js";
import { captureAgentEvolutionRuntimeComposition } from "../lib/evolution/agent-evolution-runtime-composition-brand.js";
import {
  resolveAgentPolicy,
  resolveServerPolicy,
  resolveUiPolicy,
} from "./policies/agent-policy.js";

export function createAgentRuntimeFactory({
  config = loadConfig(),
  deps = {},
  evolutionComposition = null,
} = {}) {
  const composition =
    evolutionComposition === null
      ? null
      : captureAgentEvolutionRuntimeComposition(evolutionComposition);
  if (composition !== null && Object.hasOwn(deps, "evolutionIngress")) {
    throw new TypeError(
      "evolution ingress must come from the production composition root only",
    );
  }
  const runtimeDeps =
    composition === null
      ? deps
      : Object.freeze({
          ...deps,
          evolutionIngress: composition.evolutionIngress,
        });
  return {
    createAgentRuntime(overrides = {}) {
      return new AgentRuntime({
        kind: "agent",
        policy: resolveAgentPolicy({ config, overrides }),
        config,
        deps: runtimeDeps,
      });
    },

    createChatRuntime(overrides = {}) {
      return new AgentRuntime({
        kind: "chat",
        policy: resolveAgentPolicy({ config, overrides }),
        config,
        deps,
      });
    },

    createServerRuntime(overrides = {}) {
      return new AgentRuntime({
        kind: "server",
        policy: resolveServerPolicy(overrides),
        config,
        deps,
      });
    },

    createUiRuntime(overrides = {}) {
      return new AgentRuntime({
        kind: "ui",
        policy: resolveUiPolicy(overrides),
        config,
        deps,
      });
    },
  };
}
