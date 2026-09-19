import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const {
  CHROMIUM_LOG_ENVIRONMENT_KEYS,
  CHROMIUM_LOG_SWITCHES,
  applyChromiumLoggingPrivacyBoundary,
  clearChromiumLoggingEnvironment,
} = require("../../../src/main/monitoring/chromium-log-privacy.js");

describe("Chromium log privacy boundary", () => {
  it("removes native logging environment inputs", () => {
    const secret = "C:/private/chromium.log";
    const environment = {
      ELECTRON_ENABLE_LOGGING: "1",
      ELECTRON_LOG_ASAR_READS: secret,
      CHROME_LOG_FILE: secret,
      SAFE_SETTING: "keep",
    };

    clearChromiumLoggingEnvironment(environment);

    expect(CHROMIUM_LOG_ENVIRONMENT_KEYS).toEqual([
      "ELECTRON_ENABLE_LOGGING",
      "ELECTRON_LOG_ASAR_READS",
      "CHROME_LOG_FILE",
    ]);
    expect(environment).toEqual({ SAFE_SETTING: "keep" });
    expect(JSON.stringify(environment)).not.toContain(secret);
  });

  it("removes verbose switches and forces logging and breakpad off", () => {
    const commandLine = {
      removeSwitch: vi.fn(),
      appendSwitch: vi.fn(),
    };

    applyChromiumLoggingPrivacyBoundary(commandLine);

    expect(CHROMIUM_LOG_SWITCHES).toEqual([
      "enable-logging",
      "log-file",
      "v",
      "vmodule",
      "trace-startup",
    ]);
    for (const name of CHROMIUM_LOG_SWITCHES) {
      expect(commandLine.removeSwitch).toHaveBeenCalledWith(name);
    }
    expect(commandLine.appendSwitch).toHaveBeenCalledWith("disable-logging");
    expect(commandLine.appendSwitch).toHaveBeenCalledWith("disable-breakpad");
  });

  it("applies environment filtering before Electron loads", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/main/index.js"),
      "utf8",
    );
    const clearIndex = source.indexOf(
      "clearChromiumLoggingEnvironment(process.env)",
    );
    const electronIndex = source.indexOf('require("electron")', clearIndex);
    const commandLineIndex = source.indexOf(
      "applyChromiumLoggingPrivacyBoundary(app.commandLine)",
      electronIndex,
    );

    expect(clearIndex).toBeGreaterThan(-1);
    expect(electronIndex).toBeGreaterThan(clearIndex);
    expect(commandLineIndex).toBeGreaterThan(electronIndex);
    expect(source).not.toContain('console.warn("[gpu-recovery] init failed:",');
  });
});
