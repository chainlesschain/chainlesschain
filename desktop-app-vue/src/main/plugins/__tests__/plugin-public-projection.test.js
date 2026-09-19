import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const {
  projectMarketplaceInstalledPlugin,
  projectPluginPageContent,
  projectPluginPublicRecord,
  projectPluginSettingDefinitions,
  projectPluginSettings,
  projectPluginUiExtensions,
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

  it("projects UI extensions without executable or arbitrary config", () => {
    const secret = "extension-config-secret";
    const base = {
      id: "extension-1",
      plugin_id: "plugin-1",
      plugin_name: "Plugin",
      extension_point: "ui.component",
      priority: 10,
    };
    const pages = projectPluginUiExtensions(
      [
        {
          ...base,
          config: {
            id: "main",
            path: "/main",
            title: "Main",
            icon: "HomeOutlined",
            meta: { secret },
            componentPath: secret,
            html: secret,
          },
        },
      ],
      "page",
    );
    const menus = projectPluginUiExtensions(
      [
        {
          ...base,
          config: {
            label: "Menu",
            path: "/main",
            children: [
              {
                id: "child",
                label: "Child",
                path: "/child",
                onClick: { secret },
              },
            ],
          },
        },
      ],
      "menu",
    );
    const components = projectPluginUiExtensions(
      [
        {
          ...base,
          config: {
            slot: "global-header",
            type: "html",
            html: secret,
            content: secret,
            componentPath: secret,
            conditions: [{ value: secret }],
            actions: { click: "safeMethod", other: { secret } },
          },
        },
      ],
      "component",
    );

    expect(pages[0].config).toEqual({
      id: "main",
      path: "/main",
      title: "Main",
      icon: "HomeOutlined",
    });
    expect(menus[0].config.children).toEqual([
      { id: "child", label: "Child", icon: "", path: "/child" },
    ]);
    expect(components[0].config).toMatchObject({
      slot: "global-header",
      type: "custom",
      onClick: "safeMethod",
    });
    expect(JSON.stringify({ pages, menus, components })).not.toContain(secret);
  });

  it("returns a bounded non-executable plugin page receipt", () => {
    const projected = projectPluginPageContent("plugin-1", "main");
    const bounded = projectPluginPageContent("p".repeat(300), "q".repeat(300));

    expect(projected).toEqual({
      success: true,
      contentType: "component",
      props: { pluginId: "plugin-1", pageId: "main" },
    });
    expect(projected).not.toHaveProperty("html");
    expect(projected).not.toHaveProperty("src");
    expect(projected).not.toHaveProperty("componentPath");
    expect(bounded.props.pluginId).toHaveLength(256);
    expect(bounded.props.pageId).toHaveLength(256);
  });

  it("keeps active plugin page content paths out of the renderer", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/renderer/components/plugins/PluginPageWrapper.vue",
      ),
      "utf8",
    );

    expect(source).not.toContain("<iframe");
    expect(source).not.toContain("v-html");
    expect(source).not.toContain("@vite-ignore");
    expect(source).not.toContain("DOMPurify");
    expect(source).not.toMatch(/pageResult\.(?:src|html|componentPath)/u);
  });
});
