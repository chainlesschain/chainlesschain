const manifest = require("./renderer-ipc-capabilities.json");

const fixedRendererIpcChannels = new Set(manifest.channels);
const deniedUnregisteredRendererIpcChannels = new Set(
  manifest.deniedUnregisteredChannels || [],
);

function isFixedRendererIpcChannel(channel) {
  return typeof channel === "string" && fixedRendererIpcChannels.has(channel);
}

function assertFixedRendererIpcChannel(channel) {
  if (isFixedRendererIpcChannel(channel)) return;
  const error = new Error(
    `Renderer IPC capability is not allowed: ${String(channel)}`,
  );
  error.code = "RENDERER_IPC_CAPABILITY_DENIED";
  throw error;
}

module.exports = {
  fixedRendererIpcChannels,
  deniedUnregisteredRendererIpcChannels,
  isFixedRendererIpcChannel,
  assertFixedRendererIpcChannel,
};
