/**
 * Extract a secret-free plugin identity from a tool result. Plugin bins expose
 * an explicit `plugin_bin` record; extension-tier tools may expose a
 * `toolAttribution.source` in the stable `plugin:<id>` / `plugin/<id>` form.
 */
export function extractPluginUsageAttribution(result) {
  const pluginBin =
    result?.plugin_bin && typeof result.plugin_bin === "object"
      ? result.plugin_bin
      : null;
  if (pluginBin?.plugin) {
    const plugin = boundedIdentity(pluginBin.plugin, 256);
    if (!plugin) return {};
    return {
      plugin,
      pluginVersion: pluginBin.version
        ? boundedIdentity(pluginBin.version, 128) || undefined
        : undefined,
    };
  }
  const attribution =
    result?.toolAttribution && typeof result.toolAttribution === "object"
      ? result.toolAttribution
      : null;
  const source =
    typeof attribution?.source === "string" ? attribution.source : "";
  const match = source.match(/^plugin(?::|\/)(.+)$/i);
  const plugin = match ? boundedIdentity(match[1], 256) : null;
  return plugin
    ? {
        plugin,
        pluginVersion: attribution.version
          ? boundedIdentity(attribution.version, 128) || undefined
          : undefined,
      }
    : {};
}

function boundedIdentity(value, max) {
  const clean = String(value ?? "")
    .replace(/\p{Cc}/gu, "")
    .trim();
  return clean ? clean.slice(0, max) : null;
}
