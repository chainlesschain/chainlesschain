// This entrypoint is signed into a per-user local deployment on first `cc ui`.
// Its only command capability is the interactive UI model-egress path.
export async function createChainlessChainCommandDependencies({
  commandName,
  descriptor,
  factories,
}) {
  if (commandName !== "ui") {
    throw new Error("Local Evolution host only admits the ui command");
  }
  const createComposition = factories?.createLocalUiEvolutionComposition;
  if (typeof createComposition !== "function") {
    throw new Error("Local UI Evolution host factory is unavailable");
  }
  return Object.freeze({
    evolutionCompositionFactory: async (context) => {
      if (context?.mode !== "ws-llm-chat") {
        throw new Error("Local Evolution host only admits Quick Ask model turns");
      }
      return createComposition({
        context,
        handlerArtifactDigest: descriptor.moduleDigest,
      });
    },
  });
}
