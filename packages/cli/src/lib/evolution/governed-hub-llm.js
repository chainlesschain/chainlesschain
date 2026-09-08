import { prepareGovernedModelTurn } from "./governed-model-turn.js";

// A scoped wrapper preserves the Hub's independent local/cloud consent check.
// Never replace llm on the process-wide cached Hub or its analysis engine.
export function createGovernedHubLlm(llm, factory) {
  if (
    !llm ||
    typeof llm.chat !== "function" ||
    typeof llm.isLocal !== "boolean"
  ) {
    throw new TypeError(
      "A Hub model client with declared locality is required",
    );
  }
  if (typeof factory !== "function")
    throw new TypeError("A Hub evolution factory is required");
  const chat = llm.chat.bind(llm);
  return Object.freeze({
    name: llm.name,
    isLocal: llm.isLocal,
    async chat(messages, options = {}) {
      const turn = await prepareGovernedModelTurn(factory, {
        mode: "hub-analysis",
        messages,
        signal: options.signal,
      });
      const response = await chat(turn.messages, options);
      if (!response || typeof response.text !== "string") {
        throw new Error("Hub model response must contain text");
      }
      await turn.complete(response.text);
      return response;
    },
  });
}
