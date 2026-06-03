/**
 * AppConfigManager 单元测试 — focus on the `ui.*` round-trip persistence
 * fix. Before this fix, `load()` / `loadAsync()` whitelist-merged only
 * `database` / `app` / `logging`, dropping any `ui` field on the next
 * launch. SystemSettings.vue's V6 / web-shell toggles silently lost
 * their state across restarts as a result.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tempUserData;

// Mock electron's `app.getPath("userData")` to point at our temp dir
// before the AppConfigManager module is required (it captures the path
// in `getConfigPath()`).
function mockElectronUserData(userData) {
  // Strip require cache so mocked electron applies to a fresh require.
  const electronPath = require.resolve("electron");
  const dbConfigPath =
    require.resolve("../../../src/main/config/database-config.js");
  delete require.cache[electronPath];
  delete require.cache[dbConfigPath];
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: {
        getPath: (key) => {
          if (key === "userData") {
            return userData;
          }
          return userData;
        },
        getVersion: () => "test-version",
      },
    },
  };
}

beforeEach(() => {
  tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), "appconfig-"));
  mockElectronUserData(tempUserData);
});

afterEach(() => {
  if (tempUserData && fs.existsSync(tempUserData)) {
    fs.rmSync(tempUserData, { recursive: true, force: true });
  }
});

describe("AppConfigManager — ui.* round-trip persistence", () => {
  it("DEFAULT_CONFIG includes ui block with both shell flags", () => {
    const {
      DEFAULT_CONFIG,
    } = require("../../../src/main/config/database-config.js");
    expect(DEFAULT_CONFIG.ui).toBeDefined();
    expect(DEFAULT_CONFIG.ui.useV6ShellByDefault).toBe(true);
    // Phase 1.6 hard-flip: useWebShellExperimental default true,
    // shouldRunWebShell semantics are now opt-out (`!== false`).
    expect(DEFAULT_CONFIG.ui.useWebShellExperimental).toBe(true);
  });

  it("set('ui.useWebShellExperimental', true) persists across reloads (sync load)", () => {
    const {
      AppConfigManager,
    } = require("../../../src/main/config/database-config.js");

    const writer = new AppConfigManager();
    writer.load();
    writer.set("ui.useWebShellExperimental", true);

    // Fresh instance simulates a process restart.
    const reader = new AppConfigManager();
    reader.load();
    expect(reader.get("ui.useWebShellExperimental")).toBe(true);
    // Other ui defaults should still be present after merge.
    expect(reader.get("ui.useV6ShellByDefault")).toBe(true);
  });

  it("set('ui.useV6ShellByDefault', false) persists across reloads (sync load)", () => {
    const {
      AppConfigManager,
    } = require("../../../src/main/config/database-config.js");

    const writer = new AppConfigManager();
    writer.load();
    writer.set("ui.useV6ShellByDefault", false);

    const reader = new AppConfigManager();
    reader.load();
    expect(reader.get("ui.useV6ShellByDefault")).toBe(false);
    // The other flag should retain its default after partial write
    // (Phase 1.6 hard-flip: default is now true).
    expect(reader.get("ui.useWebShellExperimental")).toBe(true);
  });

  it("config:update-style top-level set('ui', {...}) round-trips both fields", () => {
    const {
      AppConfigManager,
    } = require("../../../src/main/config/database-config.js");

    // Mirrors what config-ipc.js's config:update does when SystemSettings
    // posts the whole `cleanConfig.ui` blob via setMultiple.
    const writer = new AppConfigManager();
    writer.load();
    writer.set("ui", {
      useV6ShellByDefault: false,
      useWebShellExperimental: true,
    });

    const reader = new AppConfigManager();
    reader.load();
    expect(reader.get("ui.useV6ShellByDefault")).toBe(false);
    expect(reader.get("ui.useWebShellExperimental")).toBe(true);
  });

  it("loadAsync() preserves ui across reloads (async load path)", async () => {
    const {
      AppConfigManager,
    } = require("../../../src/main/config/database-config.js");

    const writer = new AppConfigManager();
    await writer.loadAsync();
    writer.set("ui.useWebShellExperimental", true);

    const reader = new AppConfigManager();
    await reader.loadAsync();
    expect(reader.get("ui.useWebShellExperimental")).toBe(true);
  });

  it("on first launch (no app-config.json) returns DEFAULT_CONFIG.ui values", () => {
    const {
      AppConfigManager,
    } = require("../../../src/main/config/database-config.js");

    const reader = new AppConfigManager();
    reader.load();
    expect(reader.get("ui.useV6ShellByDefault")).toBe(true);
    // Phase 1.6 hard-flip: web-shell is now the default destination.
    expect(reader.get("ui.useWebShellExperimental")).toBe(true);
  });

  it("malformed app-config.json falls back to defaults including ui", () => {
    fs.writeFileSync(
      path.join(tempUserData, "app-config.json"),
      "{ this is not json",
      "utf8",
    );
    const {
      AppConfigManager,
    } = require("../../../src/main/config/database-config.js");

    const reader = new AppConfigManager();
    reader.load();
    expect(reader.get("ui.useV6ShellByDefault")).toBe(true);
    // Phase 1.6 hard-flip: malformed config falls back to web-shell default.
    expect(reader.get("ui.useWebShellExperimental")).toBe(true);
  });

  it("load() tolerates a UTF-8 BOM at the start of app-config.json", () => {
    // Windows tools (PowerShell Out-File, Notepad, some VS Code save modes)
    // prepend a UTF-8 BOM (U+FEFF) that JSON.parse rejects. AppConfigManager
    // must strip it so saved ui.* values still load.
    const BOM = String.fromCharCode(0xfeff);
    const body = JSON.stringify({
      ui: { useV6ShellByDefault: false, useWebShellExperimental: false },
    });
    fs.writeFileSync(
      path.join(tempUserData, "app-config.json"),
      BOM + body,
      "utf8",
    );
    const {
      AppConfigManager,
    } = require("../../../src/main/config/database-config.js");
    const reader = new AppConfigManager();
    reader.load();
    expect(reader.get("ui.useV6ShellByDefault")).toBe(false);
    expect(reader.get("ui.useWebShellExperimental")).toBe(false);
  });

  it("loadAsync() tolerates a UTF-8 BOM at the start of app-config.json", async () => {
    const BOM = String.fromCharCode(0xfeff);
    const body = JSON.stringify({
      ui: { useV6ShellByDefault: false, useWebShellExperimental: true },
    });
    fs.writeFileSync(
      path.join(tempUserData, "app-config.json"),
      BOM + body,
      "utf8",
    );
    const {
      AppConfigManager,
    } = require("../../../src/main/config/database-config.js");
    const reader = new AppConfigManager();
    await reader.loadAsync();
    expect(reader.get("ui.useV6ShellByDefault")).toBe(false);
    expect(reader.get("ui.useWebShellExperimental")).toBe(true);
  });
});
