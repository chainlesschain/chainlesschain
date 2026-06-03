/**
 * read-settings-sync helper unit tests — Phase 1.3 + Stage 1 gap-fill.
 *
 * The helper sits behind ChainlessChainApp's `_readSettingsSync()` and is
 * extracted into a pure function so we can stub the userData path with a
 * temp dir instead of mocking Electron's `app`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSettingsSync } from "../../../src/main/config/read-settings-sync.js";

let tempUserData;

beforeEach(() => {
  tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), "settings-sync-"));
});

afterEach(() => {
  if (tempUserData && fs.existsSync(tempUserData)) {
    fs.rmSync(tempUserData, { recursive: true, force: true });
  }
});

describe("readSettingsSync", () => {
  it("returns null when settings.json is absent (fresh install)", () => {
    expect(readSettingsSync(tempUserData)).toBe(null);
  });

  it("parses a valid settings.json into an object", () => {
    fs.writeFileSync(
      path.join(tempUserData, "settings.json"),
      JSON.stringify({
        ui: { useV6ShellByDefault: true, useWebShellExperimental: true },
      }),
    );
    const result = readSettingsSync(tempUserData);
    expect(result).toEqual({
      ui: { useV6ShellByDefault: true, useWebShellExperimental: true },
    });
  });

  it("returns null AND fires onError when settings.json is malformed", () => {
    fs.writeFileSync(
      path.join(tempUserData, "settings.json"),
      "{ this is not json",
    );
    const onError = vi.fn();
    expect(readSettingsSync(tempUserData, { onError })).toBe(null);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(SyntaxError);
  });

  it("returns null without throwing when userDataPath is missing", () => {
    expect(readSettingsSync()).toBe(null);
    expect(readSettingsSync(null)).toBe(null);
    expect(readSettingsSync("")).toBe(null);
    expect(readSettingsSync(123)).toBe(null);
  });

  it("does not propagate exceptions raised inside onError", () => {
    fs.writeFileSync(path.join(tempUserData, "settings.json"), "{ broken");
    const onError = vi.fn(() => {
      throw new Error("logger blew up");
    });
    expect(() => readSettingsSync(tempUserData, { onError })).not.toThrow();
    expect(onError).toHaveBeenCalled();
  });

  it("handles a settings.json that JSON.parse'd to a non-object literal", () => {
    fs.writeFileSync(
      path.join(tempUserData, "settings.json"),
      JSON.stringify(42),
    );
    // Passes through whatever JSON.parse returned. Caller is responsible
    // for type-checking before reading deep keys.
    expect(readSettingsSync(tempUserData)).toBe(42);
  });

  it("tolerates a UTF-8 BOM at the start of settings.json (Windows tools may add one)", () => {
    // PowerShell's `Out-File` and some Notepad/VS Code save modes prepend
    // a UTF-8 BOM (U+FEFF) to JSON. JSON.parse rejects it; the helper must
    // strip it so settings still load.
    const BOM = String.fromCharCode(0xfeff);
    const body = JSON.stringify({
      ui: { useV6ShellByDefault: true, useWebShellExperimental: false },
    });
    fs.writeFileSync(
      path.join(tempUserData, "settings.json"),
      BOM + body,
      "utf8",
    );
    const onError = vi.fn();
    const result = readSettingsSync(tempUserData, { onError });
    expect(onError).not.toHaveBeenCalled();
    expect(result).toEqual({
      ui: { useV6ShellByDefault: true, useWebShellExperimental: false },
    });
  });

  it("tolerates a UTF-8 BOM at the start of app-config.json overlay file", () => {
    const BOM = String.fromCharCode(0xfeff);
    fs.writeFileSync(
      path.join(tempUserData, "settings.json"),
      JSON.stringify({ ui: { useV6ShellByDefault: false } }),
    );
    fs.writeFileSync(
      path.join(tempUserData, "app-config.json"),
      BOM + JSON.stringify({ ui: { useV6ShellByDefault: true } }),
      "utf8",
    );
    const onError = vi.fn();
    const result = readSettingsSync(tempUserData, { onError });
    expect(onError).not.toHaveBeenCalled();
    // app-config.json's ui overlays on top of settings.json's ui
    expect(result.ui.useV6ShellByDefault).toBe(true);
  });

  // Overlay: SystemSettings.vue writes ui.* to app-config.json (AppConfigManager).
  // _readSettingsSync must surface those values so the boot-time
  // shouldRunWebShell decision honors the SystemSettings switch.
  describe("app-config.json ui overlay", () => {
    it("overlays app-config.json's ui onto settings.json", () => {
      fs.writeFileSync(
        path.join(tempUserData, "settings.json"),
        JSON.stringify({
          ui: { useV6ShellByDefault: true, useWebShellExperimental: false },
          general: { theme: "dark" },
        }),
      );
      fs.writeFileSync(
        path.join(tempUserData, "app-config.json"),
        JSON.stringify({
          ui: { useWebShellExperimental: true },
        }),
      );
      const result = readSettingsSync(tempUserData);
      expect(result.ui.useWebShellExperimental).toBe(true); // from app-config.json
      expect(result.ui.useV6ShellByDefault).toBe(true); // from settings.json
      expect(result.general.theme).toBe("dark"); // unrelated keys preserved
    });

    it("synthesizes ui block when only app-config.json has it", () => {
      // No settings.json at all — only app-config.json.
      fs.writeFileSync(
        path.join(tempUserData, "app-config.json"),
        JSON.stringify({
          ui: { useWebShellExperimental: true, useV6ShellByDefault: false },
        }),
      );
      const result = readSettingsSync(tempUserData);
      expect(result).toEqual({
        ui: { useWebShellExperimental: true, useV6ShellByDefault: false },
      });
    });

    it("ignores non-object ui fields in app-config.json", () => {
      fs.writeFileSync(
        path.join(tempUserData, "settings.json"),
        JSON.stringify({ ui: { useV6ShellByDefault: true } }),
      );
      fs.writeFileSync(
        path.join(tempUserData, "app-config.json"),
        JSON.stringify({ ui: "not an object" }),
      );
      const result = readSettingsSync(tempUserData);
      expect(result).toEqual({ ui: { useV6ShellByDefault: true } });
    });

    it("malformed app-config.json does not poison settings.json read", () => {
      fs.writeFileSync(
        path.join(tempUserData, "settings.json"),
        JSON.stringify({ ui: { useV6ShellByDefault: true } }),
      );
      fs.writeFileSync(
        path.join(tempUserData, "app-config.json"),
        "{ broken json",
      );
      const onError = vi.fn();
      const result = readSettingsSync(tempUserData, { onError });
      expect(result).toEqual({ ui: { useV6ShellByDefault: true } });
      expect(onError).toHaveBeenCalled(); // app-config parse error reported
    });

    it("returns null when neither file exists", () => {
      expect(readSettingsSync(tempUserData)).toBe(null);
    });

    it("settings.json absent + app-config.json without ui returns null", () => {
      fs.writeFileSync(
        path.join(tempUserData, "app-config.json"),
        JSON.stringify({ database: { path: "/tmp" } }),
      );
      expect(readSettingsSync(tempUserData)).toBe(null);
    });
  });
});
