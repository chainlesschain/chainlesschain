// This single-file entrypoint is signed into a per-user local deployment.
// Command scopes remain explicit; a UI composition cannot borrow agent modes.
export async function createChainlessChainCommandDependencies({
  commandName,
  descriptor,
  factories,
}) {
  const modes = {
    ui: [
      "ws-llm-chat",
      "ws-stream",
      "ws-chat-session",
      "legacy-websocket",
      "intent-understand",
      "intent-understand-stream",
      "intent-classify",
    ],
    agent: ["interactive", "headless", "headless-stream"],
    ask: ["ask"],
    chat: ["chat", "chat-agent"],
  };
  if (
    !Object.hasOwn(modes, commandName) ||
    !descriptor.commands.includes(commandName)
  )
    throw new Error("Local Evolution host does not admit this command");
  const createComposition = factories?.createLocalUiEvolutionComposition;
  if (typeof createComposition !== "function") {
    throw new Error("Local UI Evolution host factory is unavailable");
  }
  return Object.freeze({
    evolutionCompositionFactory: async (context) => {
      if (!modes[commandName].includes(context?.mode))
        throw new Error(
          "Local Evolution host does not admit this command mode",
        );
      return createComposition({
        commandName,
        context,
        handlerArtifactDigest: descriptor.moduleDigest,
      });
    },
  });
}
