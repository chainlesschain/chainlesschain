import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const {
  projectMarketplaceInstalledPlugin,
  projectPluginPublicRecord,
  projectPluginSettingDefinitions,
  projectPluginSettings,
} = require("../plugin-public-projection.js");

describe("plugin public projection", () => {
  it("allowlists renderer plugin identity fields", () => {
    const secret = "C:/private/plugin-secret";
    const projected = projectPluginPublicRecord({
      id: "plugin-1",
      name: "Plugin",
      version: "1.0.0",
      author: "Author",
      description: "Description",
      homepage: "https://example.test/plugin",
      license: "MIT",
      enabled: 1,
      state: "enabled",
      category: "custom",
      installed_at: 1,
      updated_at: 2,
      path: secret,
      installed_path: secret,
      manifest: { entry: secret },
      metadata: { secret },
      last_error: secret,
    });

    expect(projected).toEqual({
      id: "plugin-1",
      plugin_id: "plugin-1",
      name: "Plugin",
      version: "1.0.0",
      author: "Author",
      description: "Description",
      homepage: "https://example.test/plugin",
      license: "MIT",
      enabled: true,
      state: "enabled",
      category: "custom",
      installed_at: 1,
      updated_at: 2,
    });
    expect(JSON.stringify(projected)).not.toContain(secret);
  });

  it("allowlists marketplace installation state without local metadata", () => {
    const secret = "C:/private/marketplace-secret";
    const projected = projectMarketplaceInstalledPlugin({
      id: "database-row-id",
      plugin_id: "plugin-1",
      name: "Plugin",
      version: "1.0.0",
      author: "Author",
      installed_at: 1,
      enabled: 1,
      auto_update: 0,
      source: "marketplace",
      install_path: secret,
      metadata: JSON.stringify({ secret }),
    });

    expect(projected).toEqual({
      pluginId: "plugin-1",
      plugin_id: "plugin-1",
      name: "Plugin",
      version: "1.0.0",
      author: "Author",
      installedAt: 1,
      installed_at: 1,
      enabled: true,
      autoUpdate: false,
      auto_update: false,
      source: "marketplace",
    });
    expect(JSON.stringify(projected)).not.toContain(secret);
    expect(JSON.stringify(projected)).not.toContain("database-row-id");
  });

  it("does not include local paths in installation success receipts", () => {
    const sources = [
      "src/main/plugins/plugin-manager.js",
      "src/main/marketplace/plugin-installer.js",
      "src/main/plugins/plugin-ipc.js",
    ].map((file) => readFileSync(resolve(process.cwd(), file), "utf8"));

    expect(sources[0]).not.toContain("path: installedPath");
    expect(sources[1]).not.toContain("installPath: pluginDir");
    expect(sources[2]).not.toContain("path: pluginsDir");
  });

  it("returns secret status without secret values or defaults", () => {
    const secret = "plugin-setting-secret";
    const definitions = [
      {
        key: "apiKey",
        label: "API key",
        type: "password",
        is_secret: 1,
        default: secret,
      },
      {
        key: "theme",
        label: "Theme",
        type: "select",
        options: ["dark", { label: "Light", value: "light", secret }],
      },
      { key: "advanced", type: "object" },
    ];

    expect(projectPluginSettingDefinitions(definitions)).toEqual([
      {
        key: "apiKey",
        label: "API key",
        description: "",
        type: "password",
        required: false,
        secret: true,
        options: [],
      },
      {
        key: "theme",
        label: "Theme",
        description: "",
        type: "select",
        required: false,
        secret: false,
        options: [
          { label: "dark", value: "dark" },
          { label: "Light", value: "light" },
        ],
      },
      {
        key: "advanced",
        label: "",
        description: "",
        type: "object",
        required: false,
        secret: false,
        options: [],
      },
    ]);

    const projected = projectPluginSettings(
      {
        apiKey: secret,
        theme: "dark",
        advanced: { secret },
        undeclared: secret,
      },
      definitions,
    );
    expect(projected).toEqual({
      apiKey: { configured: true, redacted: true },
      theme: "dark",
    });
    expect(JSON.stringify(projected)).not.toContain(secret);
  });
});
