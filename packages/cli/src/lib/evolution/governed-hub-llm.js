import { createRequire } from "node:module";
import { prepareGovernedModelTurn } from "./governed-model-turn.js";

const { createAuthenticatedEvolutionModelClient } = createRequire(
  import.meta.url,
)("@chainlesschain/personal-data-hub/model-egress-guard");

// A scoped wrapper preserves the Hub's independent local/cloud consent check.
// Never replace llm on the process-wide cached Hub or its analysis engine.
export function createGovernedHubLlm(llm, factory, options = {}) {
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
  if (options.onFailure != null && typeof options.onFailure !== "function")
    throw new TypeError("onFailure must be a function");
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
  return createAuthenticatedEvolutionModelClient({
    getName() {
      assertIdentity();
      return identity.name;
    },
    getIsLocal() {
      assertIdentity();
      return identity.isLocal;
    },
    async prepare(messages, chatOptions = {}) {
      assertIdentity();
      return await prepareGovernedModelTurn(factory, {
        mode: "hub-analysis",
        messages,
        signal: chatOptions.signal,
      });
    },
    async transport(messages, chatOptions = {}) {
      assertIdentity();
      const response = await chat(messages, chatOptions);
      assertIdentity();
      return response;
    },
    onFailure: options.onFailure,
  });
}
