import { prepareGovernedModelTurn } from "./governed-model-turn.js";
import { createGovernedHubLlm } from "./governed-hub-llm.js";

export function createGovernedHubResolver(ports, factory) {
  if (typeof factory !== "function")
    throw new TypeError("A resolver evolution factory is required");
  const {
    resolver,
    llm,
    embeddingStage,
    EntityResolver,
    EmbeddingStage,
    LLMStage,
  } = ports;
  // Rebuild stages for each drain. Neither the shared resolver nor its embedding
  // cache may acquire the authority of an individual WebSocket request.
  const embedding =
    embeddingStage &&
    new EmbeddingStage({
      vault: resolver.vault,
      embedFn: async (profile) => {
        const turn = await prepareGovernedModelTurn(factory, {
          mode: "hub-embedding",
          messages: [{ role: "user", content: profile }],
        });
        // Chat projection prepends host provenance. Embed only the projected
        // profile: per-Run evidence IDs must not change semantic similarity.
        const profileMessage = turn.messages[1];
        if (
          turn.messages.length !== 2 ||
          turn.messages[0].role !== "system" ||
          profileMessage?.role !== "user" ||
          typeof profileMessage.content !== "string"
        )
          throw new Error(
            "Projected embedding input must contain one text message",
          );
        const vector = await embeddingStage._embed(profileMessage.content);
        if (
          (!Array.isArray(vector) && !(vector instanceof Float32Array)) ||
          vector.length === 0 ||
          !Array.from(vector).every(Number.isFinite)
        )
          throw new Error(
            "Embedding response must contain a nonempty finite vector",
          );
        await turn.complete(JSON.stringify(Array.from(vector)));
        return vector;
      },
    });
  const model =
    resolver._llmStage &&
    new LLMStage({
      llm: createGovernedHubLlm(llm, factory),
      acceptNonLocal: false,
    });
  return new EntityResolver({
    vault: resolver.vault,
    candidateLimit: resolver._candidateLimit,
    embeddingHighThreshold: resolver._embeddingHighThreshold,
    embeddingLowThreshold: resolver._embeddingLowThreshold,
    embeddingStage: embedding ? embedding.asStageFn() : null,
    llmStage: model ? model.asStageFn() : null,
  });
}
