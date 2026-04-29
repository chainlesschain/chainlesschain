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
});
