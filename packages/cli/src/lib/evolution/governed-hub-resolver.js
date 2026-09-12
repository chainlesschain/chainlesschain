import { prepareGovernedModelTurn } from "./governed-model-turn.js";
import {
  captureGovernedHubSdkPorts,
  createGovernedHubLlm,
} from "./governed-hub-llm.js";

function captureEmbeddingTransport(stage, sdk) {
  const {
    _embed: embed,
    _embedFn: embedFn,
    _ollamaUrl: baseUrl,
    _model: model,
  } = stage;
  const defaultOllama =
    stage instanceof sdk.EntityResolverEmbeddingStage &&
    embed === sdk.EntityResolverEmbeddingStage.prototype._embed &&
    !embedFn;
  if (defaultOllama) {
    const endpoint = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      !(
        endpoint.hostname === "localhost" ||
        endpoint.hostname === "[::1]" ||
        /^127(?:\.\d{1,3}){3}$/.test(endpoint.hostname)
      )
    ) {
      // Resolver drain has no explicit remote-embedding consent contract.
      // Restoring the local backend must not silently authorize remote input.
      const error = new Error(
        "Default Hub embeddings require a loopback endpoint; remote embedding consent is not supported",
      );
      error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
      throw error;
    }
  }
  const fetchImpl = defaultOllama ? globalThis.fetch : null;
  return {
    assertIdentity() {
      if (
        stage._embed !== embed ||
        stage._embedFn !== embedFn ||
        stage._ollamaUrl !== baseUrl ||
        stage._model !== model
      )
        throw new Error(
          "Hub embedding identity changed; reopen the resolver invocation",
        );
    },
    async embed(profile) {
      if (!defaultOllama) return await embed.call(stage, profile);
      // The raw SDK ollamaEmbed remains closed. This private transport is only
      // invoked below, after the scoped Run projected the profile.
      const response = await fetchImpl(
        `${baseUrl.replace(/\/$/, "")}/api/embeddings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(60_000),
          body: JSON.stringify({ model, prompt: profile }),
        },
      );
      if (!response.ok)
        throw new Error(
          `Hub embedding request failed: HTTP ${response.status}`,
        );
      const data = await response.json();
      if (data?.error)
        throw new Error("Hub embedding provider returned an error");
      return data?.embedding;
    },
  };
}

export function createGovernedHubResolver(ports, factory, sdkPorts) {
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
  const sdk = captureGovernedHubSdkPorts(sdkPorts);
  const transport =
    embeddingStage && captureEmbeddingTransport(embeddingStage, sdk);
  // Rebuild stages for each drain. Neither the shared resolver nor its embedding
  // cache may acquire the authority of an individual WebSocket request.
  const embedding =
    embeddingStage &&
    new EmbeddingStage({
      vault: resolver.vault,
      embedFn: async (profile) => {
        transport.assertIdentity();
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
        transport.assertIdentity();
        const vector = await transport.embed(profileMessage.content);
        transport.assertIdentity();
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
      llm: createGovernedHubLlm(llm, factory, {}, sdk),
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
