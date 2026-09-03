export const AGENT_EVOLUTION_RUNTIME_COMPOSITION_SCHEMA =
  "chainlesschain.agent-evolution-runtime-composition/v1";

const COMPOSITIONS = new WeakSet();
const SKILL_OUTCOME_INDEXES = new WeakSet();

export function sealAgentEvolutionRuntimeComposition(fields) {
  const composition = Object.freeze({
    schema: AGENT_EVOLUTION_RUNTIME_COMPOSITION_SCHEMA,
    ...fields,
  });
  COMPOSITIONS.add(composition);
  return composition;
}

export function captureAgentEvolutionRuntimeComposition(value) {
  if (!COMPOSITIONS.has(value)) {
    throw new TypeError(
      "a branded Agent evolution runtime composition is required",
    );
  }
  return value;
}

export function sealAgentSkillOutcomeIndex(fields) {
  const index = Object.freeze({
    schema: "chainlesschain.agent-skill-outcome-index/v1",
    ...fields,
  });
  SKILL_OUTCOME_INDEXES.add(index);
  return index;
}

export function captureAgentSkillOutcomeIndex(value) {
  if (!SKILL_OUTCOME_INDEXES.has(value)) {
    throw new TypeError("a branded Agent Skill outcome index is required");
  }
  return value;
}
