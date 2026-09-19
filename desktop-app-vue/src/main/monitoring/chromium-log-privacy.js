"use strict";

const CHROMIUM_LOG_ENVIRONMENT_KEYS = Object.freeze([
  "ELECTRON_ENABLE_LOGGING",
  "ELECTRON_LOG_ASAR_READS",
  "CHROME_LOG_FILE",
]);

const CHROMIUM_LOG_SWITCHES = Object.freeze([
  "enable-logging",
  "log-file",
  "v",
  "vmodule",
  "trace-startup",
]);

function clearChromiumLoggingEnvironment(environment = process.env) {
  if (!environment || typeof environment !== "object") {
    throw new TypeError("Chromium logging environment is invalid");
  }
  for (const key of CHROMIUM_LOG_ENVIRONMENT_KEYS) {
    delete environment[key];
  }
}

function applyChromiumLoggingPrivacyBoundary(commandLine) {
  if (!commandLine || typeof commandLine.appendSwitch !== "function") {
    throw new TypeError("Chromium command line is invalid");
  }
  if (typeof commandLine.removeSwitch === "function") {
    for (const name of CHROMIUM_LOG_SWITCHES) {
      commandLine.removeSwitch(name);
    }
  }
  commandLine.appendSwitch("disable-logging");
  commandLine.appendSwitch("disable-breakpad");
}

module.exports = {
  CHROMIUM_LOG_ENVIRONMENT_KEYS,
  CHROMIUM_LOG_SWITCHES,
  applyChromiumLoggingPrivacyBoundary,
  clearChromiumLoggingEnvironment,
};
