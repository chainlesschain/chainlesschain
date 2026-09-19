"use strict";

function boundedString(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function optionalTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function enabledValue(value) {
  return value === true || value === 1;
}

function projectPluginPublicRecord(plugin) {
  if (!plugin || typeof plugin !== "object") {
    return null;
  }

  const pluginId = boundedString(
    plugin.plugin_id ?? plugin.pluginId ?? plugin.id,
    256,
  );

  return {
    id: pluginId,
    plugin_id: pluginId,
    name: boundedString(plugin.name, 256),
    version: boundedString(plugin.version, 128),
    author: boundedString(plugin.author, 256),
    description: boundedString(plugin.description, 4096),
    homepage: boundedString(plugin.homepage, 2048),
    license: boundedString(plugin.license, 128),
    enabled: enabledValue(plugin.enabled),
    state: boundedString(plugin.state, 64),
    category: boundedString(plugin.category, 128),
    installed_at: optionalTimestamp(plugin.installed_at),
    updated_at: optionalTimestamp(plugin.updated_at),
  };
}

function projectMarketplaceInstalledPlugin(plugin) {
  if (!plugin || typeof plugin !== "object") {
    return null;
  }

  const pluginId = boundedString(
    plugin.plugin_id ?? plugin.pluginId ?? plugin.id,
    256,
  );
  const installedAt = optionalTimestamp(
    plugin.installed_at ?? plugin.installedAt,
  );
  const autoUpdate = enabledValue(plugin.auto_update ?? plugin.autoUpdate);

  return {
    pluginId,
    plugin_id: pluginId,
    name: boundedString(plugin.name, 256),
    version: boundedString(plugin.version, 128),
    author: boundedString(plugin.author, 256),
    installedAt,
    installed_at: installedAt,
    enabled: enabledValue(plugin.enabled),
    autoUpdate,
    auto_update: autoUpdate,
    source: boundedString(plugin.source, 64),
  };
}

module.exports = {
  projectMarketplaceInstalledPlugin,
  projectPluginPublicRecord,
};
