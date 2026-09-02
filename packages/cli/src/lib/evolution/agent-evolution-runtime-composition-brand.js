export const AGENT_EVOLUTION_RUNTIME_COMPOSITION_SCHEMA =
  "chainlesschain.agent-evolution-runtime-composition/v1";

const COMPOSITIONS = new WeakSet();

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
