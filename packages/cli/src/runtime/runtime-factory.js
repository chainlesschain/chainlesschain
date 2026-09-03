import { loadConfig } from "../lib/config-manager.js";
import { AgentRuntime } from "./agent-runtime.js";
import {
  captureAgentEvolutionRuntimeComposition,
  captureAgentSkillOutcomeIndex,
} from "../lib/evolution/agent-evolution-runtime-composition-brand.js";
import { captureSkillVectorAuthority } from "../lib/skill-vector-authority.js";
import {
  resolveAgentPolicy,
  resolveServerPolicy,
  resolveUiPolicy,
} from "./policies/agent-policy.js";

export function createAgentRuntimeFactory({
  config = loadConfig(),
  deps = {},
  evolutionComposition = null,
  skillOutcomeIndex = null,
  skillVectorAuthority = null,
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
  const outcomeIndex =
    skillOutcomeIndex === null
      ? null
      : captureAgentSkillOutcomeIndex(skillOutcomeIndex);
  const vectorAuthority =
    skillVectorAuthority === null
      ? null
      : captureSkillVectorAuthority(skillVectorAuthority);
  if (
    composition !== null &&
    outcomeIndex !== null &&
    composition.tenantId !== outcomeIndex.tenantId
  ) {
    throw new TypeError(
      "evolution composition and Skill outcome index must share one tenant",
    );
  }
  if (outcomeIndex !== null && Object.hasOwn(deps, "skillOutcomeIndex")) {
    throw new TypeError(
      "Skill outcome index must come from the production composition root only",
    );
  }
  const retrievalTenant =
    composition?.tenantId ?? outcomeIndex?.tenantId ?? null;
  if (
    retrievalTenant !== null &&
    vectorAuthority !== null &&
    retrievalTenant !== vectorAuthority.tenantId
  ) {
    throw new TypeError("Agent retrieval authorities must share one tenant");
  }
  if (vectorAuthority !== null && Object.hasOwn(deps, "skillVectorAuthority")) {
    throw new TypeError(
      "Skill vector authority must come from the production root only",
    );
  }
  const runtimeDeps =
    composition === null && outcomeIndex === null && vectorAuthority === null
      ? deps
      : Object.freeze({
          ...deps,
          ...(composition === null
            ? {}
            : { evolutionIngress: composition.evolutionIngress }),
          ...(outcomeIndex === null ? {} : { skillOutcomeIndex: outcomeIndex }),
          ...(vectorAuthority === null
            ? {}
            : { skillVectorAuthority: vectorAuthority }),
        });
  const serverDeps =
    outcomeIndex === null && vectorAuthority === null
      ? deps
      : Object.freeze({
          ...deps,
          ...(outcomeIndex === null ? {} : { skillOutcomeIndex: outcomeIndex }),
          ...(vectorAuthority === null
            ? {}
            : { skillVectorAuthority: vectorAuthority }),
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
        deps: serverDeps,
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
