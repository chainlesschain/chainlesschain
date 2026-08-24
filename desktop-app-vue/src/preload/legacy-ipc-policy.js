function legacyGenericIpcEnabled(env = process.env) {
  return env.CC_ENABLE_LEGACY_GENERIC_IPC === "1";
}

function assertLegacyGenericIpcEnabled(env = process.env) {
  if (legacyGenericIpcEnabled(env)) return;
  const error = new Error(
    "Generic renderer IPC is disabled; use a fixed preload capability API",
  );
  error.code = "LEGACY_GENERIC_IPC_DISABLED";
  throw error;
}

module.exports = {
  legacyGenericIpcEnabled,
  assertLegacyGenericIpcEnabled,
};
