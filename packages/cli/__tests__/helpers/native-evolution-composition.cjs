// Match the native CJS-to-ESM import used by the Desktop main process.
module.exports = async () => {
  const [composition, durability, storage] = await Promise.all([
    import("../../src/lib/evolution/agent-evolution-runtime-composition.js"),
    import("../../src/lib/evolution/evolution-windows-directory-durability.js"),
    import("../../src/lib/evolution/evolution-private-storage.js"),
  ]);
  // Windows filesystem authority is module-local too. Callers explicitly
  // choose this factory; custom or fault-injected ports are never converted.
  return {
    ...composition,
    createLocalUiEvolutionFileSystem:
      durability.createLocalUiEvolutionFileSystem,
    evolutionPrivateStorageOptions: storage.evolutionPrivateStorageOptions,
  };
};
