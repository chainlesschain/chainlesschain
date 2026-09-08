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
  const identity = { name: llm.name, isLocal: llm.isLocal, chat: llm.chat };
  const assertIdentity = () => {
    if (
      llm.name !== identity.name ||
      llm.isLocal !== identity.isLocal ||
      llm.chat !== identity.chat
    ) {
      throw new Error(
        "Hub model identity changed; reopen the analysis invocation",
      );
    }
  };
  const chat = identity.chat.bind(llm);
  return Object.freeze({
    get name() {
      assertIdentity();
      return identity.name;
    },
    get isLocal() {
      assertIdentity();
      return identity.isLocal;
    },
    async chat(messages, options = {}) {
      assertIdentity();
      const turn = await prepareGovernedModelTurn(factory, {
        mode: "hub-analysis",
        messages,
        signal: options.signal,
      });
      assertIdentity();
      const response = await chat(turn.messages, options);
      assertIdentity();
      if (!response || typeof response.text !== "string") {
        throw new Error("Hub model response must contain text");
      }
      await turn.complete(response.text);
      return response;
    },
  });
}
