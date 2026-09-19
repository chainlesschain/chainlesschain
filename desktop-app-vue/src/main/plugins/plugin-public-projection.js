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

function projectSettingOptions(options) {
  if (!Array.isArray(options)) {
    return [];
  }
  return options.slice(0, 128).flatMap((option) => {
    if (typeof option === "string") {
      const value = boundedString(option, 512);
      return [{ label: value, value }];
    }
    if (!option || typeof option !== "object") {
      return [];
    }
    return [
      {
        label: boundedString(option.label, 512),
        value: boundedString(option.value, 512),
      },
    ];
  });
}

function projectPluginSettingDefinitions(definitions) {
  if (!Array.isArray(definitions)) {
    return [];
  }
  return definitions.slice(0, 256).flatMap((definition) => {
    if (!definition || typeof definition !== "object") {
      return [];
    }
    const key = boundedString(definition.key ?? definition.id, 256);
    if (!key) {
      return [];
    }
    const secret =
      definition.secret === true ||
      definition.isSecret === true ||
      definition.is_secret === true ||
      definition.is_secret === 1;
    return [
      {
        key,
        label: boundedString(definition.label, 512),
        description: boundedString(definition.description, 2048),
        type: boundedString(definition.type, 64),
        required: definition.required === true,
        secret,
        options: projectSettingOptions(definition.options),
      },
    ];
  });
}

function projectSettingValue(value) {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    return boundedString(value, 4096);
  }
  if (Array.isArray(value)) {
    const projected = value
      .slice(0, 128)
      .map(projectSettingValue)
      .filter((entry) => entry !== undefined && !Array.isArray(entry));
    return projected;
  }
  return undefined;
}

function projectPluginSettings(settings, definitions) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }
  const projectedDefinitions = projectPluginSettingDefinitions(definitions);
  const result = {};

  for (const definition of projectedDefinitions) {
    if (!Object.prototype.hasOwnProperty.call(settings, definition.key)) {
      continue;
    }
    const value = settings[definition.key];
    if (definition.secret) {
      result[definition.key] = {
        configured: value !== null && value !== undefined && value !== "",
        redacted: true,
      };
      continue;
    }
    const projected = projectSettingValue(value);
    if (projected !== undefined) {
      result[definition.key] = projected;
    }
  }

  return result;
}

function projectRoutePath(value) {
  if (typeof value !== "string" || value.length > 1024) {
    return "";
  }
  if (!value.startsWith("/") || value.includes("..")) {
    return "";
  }
  return /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/u.test(value) ? value : "";
}

function projectMenuChildren(children) {
  if (!Array.isArray(children)) {
    return [];
  }
  return children.slice(0, 64).flatMap((child) => {
    if (!child || typeof child !== "object") {
      return [];
    }
    return [
      {
        id: boundedString(child.id, 256),
        label: boundedString(child.label, 512),
        icon: boundedString(child.icon, 128),
        path: projectRoutePath(child.path),
      },
    ];
  });
}

function projectUiConfig(config, kind) {
  const source = config && typeof config === "object" ? config : {};
  if (kind === "page") {
    return {
      id: boundedString(source.id, 256),
      path: projectRoutePath(source.path),
      title: boundedString(source.title, 512),
      icon: boundedString(source.icon, 128),
    };
  }
  if (kind === "menu") {
    const badge =
      typeof source.badge === "number" && Number.isFinite(source.badge)
        ? source.badge
        : boundedString(source.badge, 128);
    return {
      label: boundedString(source.label, 512),
      icon: boundedString(source.icon, 128),
      path: projectRoutePath(source.path),
      badge,
      children: projectMenuChildren(source.children),
    };
  }

  const allowedTypes = new Set([
    "button",
    "link",
    "panel",
    "toolbar-button",
    "menu-item",
  ]);
  const type = boundedString(source.type, 64);
  const method = boundedString(
    typeof source.onClick === "string" ? source.onClick : source.actions?.click,
    256,
  );
  return {
    slot: boundedString(source.slot, 128),
    type: allowedTypes.has(type) ? type : "custom",
    label: boundedString(source.label, 512),
    title: boundedString(source.title, 512),
    tooltip: boundedString(source.tooltip, 1024),
    icon: boundedString(source.icon, 128),
    buttonType: boundedString(source.buttonType, 64),
    size: boundedString(source.size, 64),
    badge:
      typeof source.badge === "number" && Number.isFinite(source.badge)
        ? source.badge
        : boundedString(source.badge, 128),
    bordered: source.bordered !== false,
    visible: source.visible !== false,
    onClick: /^[A-Za-z_$][A-Za-z0-9_$.-]*$/u.test(method) ? method : "",
  };
}

function projectPluginUiExtension(extension, kind) {
  if (!extension || typeof extension !== "object") {
    return null;
  }
  const pluginId = boundedString(
    extension.plugin_id ?? extension.pluginId,
    256,
  );
  const priority = Number.isSafeInteger(extension.priority)
    ? Math.max(-10000, Math.min(10000, extension.priority))
    : 100;
  return {
    id: boundedString(extension.id, 256),
    plugin_id: pluginId,
    plugin_name: boundedString(
      extension.plugin_name ?? extension.pluginName,
      256,
    ),
    type: boundedString(extension.type ?? extension.extension_point, 128),
    priority,
    config: projectUiConfig(extension.config, kind),
  };
}

function projectPluginUiExtensions(extensions, kind) {
  if (!Array.isArray(extensions)) {
    return [];
  }
  return extensions
    .slice(0, 1024)
    .map((extension) => projectPluginUiExtension(extension, kind))
    .filter(Boolean);
}

function projectPluginPageContent(pluginId, pageId) {
  return {
    success: true,
    contentType: "component",
    props: {
      pluginId: boundedString(pluginId, 256),
      pageId: boundedString(pageId, 256),
    },
  };
}

function projectStringList(values, limit = 128, maxLength = 256) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .slice(0, limit)
    .filter((value) => typeof value === "string")
    .map((value) => boundedString(value, maxLength));
}

function projectPluginToolDefinitions(tools) {
  if (!Array.isArray(tools)) {
    return [];
  }
  return tools.slice(0, 256).flatMap((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      return [];
    }
    const name = boundedString(tool.name ?? tool.id, 256);
    if (!name) {
      return [];
    }
    const riskLevel = Number.isSafeInteger(tool.riskLevel ?? tool.risk_level)
      ? Math.max(0, Math.min(4, tool.riskLevel ?? tool.risk_level))
      : 2;
    return [
      {
        id: boundedString(tool.id ?? tool.name, 256),
        name,
        displayName: boundedString(
          tool.displayName ?? tool.display_name ?? tool.name,
          512,
        ),
        description: boundedString(tool.description, 4096),
        category: boundedString(tool.category, 128),
        type: boundedString(tool.type, 64),
        riskLevel,
        requiredPermissions: projectStringList(
          tool.requiredPermissions ?? tool.required_permissions,
          64,
          256,
        ),
      },
    ];
  });
}

function projectPluginSkillDefinitions(skills) {
  if (!Array.isArray(skills)) {
    return [];
  }
  return skills.slice(0, 256).flatMap((skill) => {
    if (!skill || typeof skill !== "object" || Array.isArray(skill)) {
      return [];
    }
    const id = boundedString(skill.id ?? skill.name, 256);
    const name = boundedString(skill.name ?? skill.id, 256);
    if (!id || !name) {
      return [];
    }
    return [
      {
        id,
        name,
        displayName: boundedString(
          skill.displayName ?? skill.display_name ?? skill.name,
          512,
        ),
        description: boundedString(skill.description, 4096),
        category: boundedString(skill.category, 128),
        icon: boundedString(skill.icon, 128),
        tags: projectStringList(skill.tags, 64, 128),
        tools: projectStringList(skill.tools, 128, 256),
      },
    ];
  });
}

function projectPluginToolExecutionReceipt() {
  return { success: true, executed: true };
}

function projectPluginDataExtensions(extensions) {
  if (!Array.isArray(extensions)) {
    return [];
  }
  return extensions.slice(0, 1024).flatMap((extension) => {
    if (!extension || typeof extension !== "object") {
      return [];
    }
    const config =
      extension.config && typeof extension.config === "object"
        ? extension.config
        : {};
    return [
      {
        id: boundedString(extension.id, 256),
        plugin_id: boundedString(
          extension.plugin_id ?? extension.pluginId,
          256,
        ),
        plugin_name: boundedString(
          extension.plugin_name ?? extension.pluginName,
          256,
        ),
        type: boundedString(extension.type ?? extension.extension_point, 128),
        priority: Number.isSafeInteger(extension.priority)
          ? Math.max(-10000, Math.min(10000, extension.priority))
          : 100,
        config: {
          id: boundedString(config.id, 256),
          name: boundedString(config.name, 512),
          label: boundedString(config.label, 512),
          description: boundedString(config.description, 4096),
          icon: boundedString(config.icon, 128),
          formats: projectStringList(config.formats, 128, 128),
          extensions: projectStringList(config.extensions, 128, 128),
          mimeTypes: projectStringList(
            config.mimeTypes ?? config.mime_types,
            128,
            256,
          ),
        },
      },
    ];
  });
}

function projectPluginDataExecutionReceipt(operation) {
  return {
    success: true,
    executed: true,
    operation: operation === "export" ? "export" : "import",
  };
}

function projectPluginInvocationReceipt(invocation) {
  return {
    success: true,
    executed: true,
    invocation: invocation === "extension" ? "extension" : "method",
  };
}

function projectRuntimeMenuChildren(children) {
  if (!Array.isArray(children)) {
    return [];
  }
  return children.slice(0, 64).flatMap((child) => {
    if (!child || typeof child !== "object") {
      return [];
    }
    return [
      {
        id: boundedString(child.id, 256),
        label: boundedString(child.label, 512),
        icon: boundedString(child.icon, 128),
        route: projectRoutePath(child.route),
      },
    ];
  });
}

function projectPluginRuntimeUiEntries(entries, kind) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.slice(0, 1024).flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const common = {
      id: boundedString(entry.id, 256),
      pluginId: boundedString(entry.pluginId ?? entry.plugin_id, 256),
    };
    if (kind === "page") {
      return [
        {
          ...common,
          path: projectRoutePath(entry.path),
          title: boundedString(entry.title, 512),
          icon: boundedString(entry.icon, 128),
          requireAuth: entry.requireAuth === true,
        },
      ];
    }
    if (kind === "menu") {
      const order = Number.isSafeInteger(entry.order)
        ? Math.max(-10000, Math.min(10000, entry.order))
        : 100;
      return [
        {
          ...common,
          label: boundedString(entry.label, 512),
          icon: boundedString(entry.icon, 128),
          route: projectRoutePath(entry.route),
          position: boundedString(entry.position, 64),
          order,
          parent: boundedString(entry.parent, 256),
          children: projectRuntimeMenuChildren(entry.children),
          visible: entry.visible !== false,
        },
      ];
    }
    const order = Number.isSafeInteger(entry.order)
      ? Math.max(-10000, Math.min(10000, entry.order))
      : 100;
    return [
      {
        ...common,
        name: boundedString(entry.name, 512),
        slot: boundedString(entry.slot, 128),
        order,
      },
    ];
  });
}

function projectV6Actions(actions) {
  if (!Array.isArray(actions)) {
    return [];
  }
  return actions.slice(0, 64).flatMap((action) => {
    if (!action || typeof action !== "object") {
      return [];
    }
    return [
      {
        id: boundedString(action.id, 256),
        label: boundedString(action.label, 512),
        icon: boundedString(action.icon, 128),
      },
    ];
  });
}

function projectPluginV6UiEntries(entries, kind) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.slice(0, 1024).flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const common = {
      id: boundedString(entry.id, 256),
      pluginId: boundedString(entry.pluginId ?? entry.plugin_id, 256),
    };
    const order = Number.isSafeInteger(entry.order)
      ? Math.max(-10000, Math.min(10000, entry.order))
      : 100;

    switch (kind) {
      case "space":
        return [
          {
            ...common,
            name: boundedString(entry.name, 512),
            icon: boundedString(entry.icon, 128),
            description: boundedString(entry.description, 4096),
            permissions: projectStringList(entry.permissions, 64, 256),
            order,
          },
        ];
      case "artifact":
        return [
          {
            ...common,
            type: boundedString(entry.type, 128),
            icon: boundedString(entry.icon, 128),
            label: boundedString(entry.label, 512),
            actions: projectV6Actions(entry.actions),
          },
        ];
      case "slash":
        return [
          {
            ...common,
            trigger: boundedString(entry.trigger, 128),
            description: boundedString(entry.description, 4096),
            icon: boundedString(entry.icon, 128),
            requirePermissions: projectStringList(
              entry.requirePermissions,
              64,
              256,
            ),
          },
        ];
      case "mention":
        return [
          {
            ...common,
            prefix: boundedString(entry.prefix, 128),
            label: boundedString(entry.label, 512),
            icon: boundedString(entry.icon, 128),
          },
        ];
      case "status-bar":
        return [
          {
            ...common,
            position: boundedString(entry.position, 64),
            order,
            tooltip: boundedString(entry.tooltip, 1024),
          },
        ];
      case "home-widget":
        return [
          {
            ...common,
            size: boundedString(entry.size, 64),
            order,
            title: boundedString(entry.title, 512),
          },
        ];
      case "composer-slot":
        return [
          {
            ...common,
            position: boundedString(entry.position, 64),
            order,
          },
        ];
      default:
        return [];
    }
  });
}

function projectBrandThemeTokens(tokens) {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    return {};
  }
  const result = {};
  for (const [key, value] of Object.entries(tokens).slice(0, 128)) {
    if (!/^(?:--)?[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key)) {
      continue;
    }
    if (typeof value !== "string" || value.length > 128) {
      continue;
    }
    if (
      !/^(?:#[0-9A-Fa-f]{3,8}|-?\d+(?:\.\d+)?(?:px|rem|em|%|s|ms)?|[A-Za-z][A-Za-z0-9 -]{0,63})$/u.test(
        value,
      )
    ) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function projectPluginEnterpriseEntries(entries, kind) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.slice(0, 1024).flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const common = {
      id: boundedString(entry.id, 256),
      pluginId: boundedString(entry.pluginId ?? entry.plugin_id, 256),
      name: boundedString(entry.name, 512),
      priority: Number.isSafeInteger(entry.priority)
        ? Math.max(-10000, Math.min(10000, entry.priority))
        : 100,
    };

    switch (kind) {
      case "brand-theme":
        return [
          {
            ...common,
            themeId: boundedString(entry.themeId ?? entry.theme_id, 256),
            mode: ["light", "dark", "auto"].includes(entry.mode)
              ? entry.mode
              : "light",
            tokens: projectBrandThemeTokens(entry.tokens),
          },
        ];
      case "brand-identity":
        return [
          {
            ...common,
            identityId: boundedString(
              entry.identityId ?? entry.identity_id,
              256,
            ),
            productName: boundedString(entry.productName, 512),
            tagline: boundedString(entry.tagline, 1024),
          },
        ];
      case "llm":
        return [
          {
            ...common,
            providerId: boundedString(entry.providerId, 256),
            models: projectStringList(entry.models, 256, 256),
          },
        ];
      case "auth":
        return [
          {
            ...common,
            providerId: boundedString(entry.providerId, 256),
            kind: boundedString(entry.kind, 64),
            scopes: projectStringList(entry.scopes, 128, 256),
          },
        ];
      case "storage":
        return [
          {
            ...common,
            storageId: boundedString(entry.storageId, 256),
            kind: boundedString(entry.kind, 64),
          },
        ];
      case "crypto":
        return [
          {
            ...common,
            cryptoId: boundedString(entry.cryptoId, 256),
            algs: projectStringList(entry.algs, 128, 128),
          },
        ];
      case "audit":
        return [
          {
            ...common,
            auditId: boundedString(entry.auditId, 256),
            kind: boundedString(entry.kind, 64),
          },
        ];
      default:
        return [];
    }
  });
}

module.exports = {
  projectMarketplaceInstalledPlugin,
  projectPluginDataExecutionReceipt,
  projectPluginDataExtensions,
  projectPluginEnterpriseEntries,
  projectPluginInvocationReceipt,
  projectPluginPageContent,
  projectPluginPublicRecord,
  projectPluginRuntimeUiEntries,
  projectPluginSettingDefinitions,
  projectPluginSettings,
  projectPluginSkillDefinitions,
  projectPluginToolDefinitions,
  projectPluginToolExecutionReceipt,
  projectPluginUiExtensions,
  projectPluginV6UiEntries,
};
