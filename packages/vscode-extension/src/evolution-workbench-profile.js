"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { IdeAppServerPilot } = require("./app-server-pilot.js");

const PROFILE_SCHEMA = "chainlesschain.evolution-workbench-profile/v1";
const PROFILE_SETTING = "chainlesschain.evolution.workbench.profile";
const ENV_KEYS = [
  "CHAINLESSCHAIN_HOME",
  "CHAINLESSCHAIN_SECURITY_ANCHOR_HOME",
  "CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR",
  "CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT",
];

function absolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`Evolution Workbench ${label} must be an absolute path`);
  }
  return value;
}

function readWorkbenchProfile(profilePath) {
  absolute(profilePath, "profile");
  const bytes = fs.readFileSync(profilePath);
  if (bytes.length > 64 * 1024)
    throw new Error("Workbench profile is too large");
  const value = JSON.parse(bytes.toString("utf8"));
  if (
    value?.schema !== PROFILE_SCHEMA ||
    !["local-test", "governed"].includes(value.mode) ||
    !value.env ||
    typeof value.env !== "object" ||
    Array.isArray(value.env) ||
    Object.keys(value.env).length !== ENV_KEYS.length ||
    ENV_KEYS.some((key) => !Object.hasOwn(value.env, key))
  )
    throw new Error("Invalid Evolution Workbench profile");
  const env = Object.fromEntries(
    ENV_KEYS.map((key) => [key, absolute(value.env[key], key)]),
  );
  return {
    mode: value.mode,
    cliPath: absolute(value.cliPath, "CLI entrypoint"),
    cwd: absolute(value.cwd, "working directory"),
    stateDirectory: absolute(
      value.stateDirectory,
      "App Server state directory",
    ),
    env,
  };
}

// A profile owns a separate process. Its deployment and TEST credentials must
// never flow into chat, other App Server features or integrated terminals.
function createWorkbenchProfileManager({ Pilot = IdeAppServerPilot } = {}) {
  let pilot = null;
  let fingerprint = null;
  return {
    async get(profilePath) {
      const options = readWorkbenchProfile(profilePath);
      const next = JSON.stringify(options);
      if (!pilot || next !== fingerprint) {
        await pilot?.close();
        pilot = new Pilot({
          ...options,
          // Extension hosts may use Code.exe / VSCodium.exe as process.execPath.
          // The SDK runs a .js CLI through it; force Node mode for that child.
          env: { ...options.env, ELECTRON_RUN_AS_NODE: "1" },
        });
        pilot.workbenchMode = options.mode;
        fingerprint = next;
      }
      return pilot;
    },
    async close() {
      const previous = pilot;
      pilot = null;
      fingerprint = null;
      await previous?.close();
    },
  };
}

module.exports = {
  PROFILE_SCHEMA,
  PROFILE_SETTING,
  readWorkbenchProfile,
  createWorkbenchProfileManager,
};
