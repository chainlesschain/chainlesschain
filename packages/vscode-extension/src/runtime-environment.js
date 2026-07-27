"use strict";

/**
 * Installation Doctor environment probes. Process and filesystem access stay
 * here so the report renderer and compatibility classifier remain pure.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { MIN_NODE_VERSION, compareVersions } = require("./version-check");

function parseNodeVersion(output) {
  const match = /\bv?(\d+\.\d+\.\d+)\b/.exec(String(output || ""));
  return match ? match[1] : null;
}

function parseJavaVersion(output) {
  const text = String(output || "");
  const quoted = /\bversion\s+"([^"]+)"/i.exec(text);
  if (quoted) return quoted[1].slice(0, 64);
  const open = /\b(?:openjdk|java)\s+([0-9][^\s]*)/i.exec(text);
  return open ? open[1].slice(0, 64) : null;
}

function runVersion(command, args, deps = {}) {
  const spawnImpl = deps.spawn || spawn;
  const timeoutMs = Number(deps.timeoutMs) > 0 ? Number(deps.timeoutMs) : 5000;
  return new Promise((resolve) => {
    let done = false;
    let output = "";
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    try {
      const child = spawnImpl(command, args, {
        windowsHide: true,
        shell: false,
        env: deps.env || process.env,
      });
      const collect = (chunk) => {
        output += String(chunk || "");
        if (output.length > 8192) output = output.slice(0, 8192);
      };
      child.stdout?.on("data", collect);
      child.stderr?.on("data", collect);
      child.on("error", () => finish(null));
      child.on("close", (code) =>
        finish(code === 0 ? output.trim() || null : null),
      );
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // best effort
        }
        finish(null);
      }, timeoutMs);
      timer.unref?.();
    } catch {
      finish(null);
    }
  });
}

function defaultPluginRegistryCacheDir({
  platform = process.platform,
  homeDir = os.homedir(),
  env = process.env,
} = {}) {
  const app = "chainlesschain-desktop-vue";
  if (platform === "win32") {
    return path.join(
      env.APPDATA || path.join(homeDir, "AppData", "Roaming"),
      app,
      "plugin-registry-cache",
    );
  }
  if (platform === "darwin") {
    return path.join(
      homeDir,
      "Library",
      "Application Support",
      app,
      "plugin-registry-cache",
    );
  }
  return path.join(
    env.XDG_CONFIG_HOME || path.join(homeDir, ".config"),
    app,
    "plugin-registry-cache",
  );
}

function countRegularFiles(dir, fsImpl = fs) {
  try {
    return fsImpl
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry?.isFile?.()).length;
  } catch {
    return 0;
  }
}

function inspectManagedCli(rootDir, fsImpl = fs) {
  if (!rootDir) return { status: "unconfigured", version: null };
  const statePath = path.join(rootDir, "current.json");
  if (!fsImpl.existsSync(statePath)) {
    return { status: "missing", version: null };
  }
  try {
    const state = JSON.parse(fsImpl.readFileSync(statePath, "utf8"));
    const version =
      typeof state?.version === "string" ? state.version.slice(0, 64) : null;
    if (!version) return { status: "corrupt", version: null };
    const packageDir = path.join(rootDir, version, "package");
    return {
      status: fsImpl.existsSync(packageDir) ? "ready" : "incomplete",
      version,
      rollbackVersion:
        typeof state.previousVersion === "string"
          ? state.previousVersion.slice(0, 64)
          : null,
    };
  } catch {
    return { status: "corrupt", version: null };
  }
}

function inspectOfflineCaches({
  managedCliRoot,
  pluginRegistryCacheDir = defaultPluginRegistryCacheDir(),
  fsImpl = fs,
} = {}) {
  const registryEntries = countRegularFiles(pluginRegistryCacheDir, fsImpl);
  return {
    managedCli: inspectManagedCli(managedCliRoot, fsImpl),
    pluginRegistry: {
      status: registryEntries > 0 ? "ready" : "missing",
      entries: registryEntries,
    },
  };
}

async function probeRuntimeEnvironment(options = {}) {
  const run =
    typeof options.runVersion === "function"
      ? options.runVersion
      : (command, args) => runVersion(command, args, options);
  const [nodeOutput, javaOutput] = await Promise.all([
    run("node", ["--version"]),
    run("java", ["-version"]),
  ]);
  const nodeVersion = parseNodeVersion(nodeOutput);
  const javaVersion = parseJavaVersion(javaOutput);
  let nodeStatus = "missing";
  if (nodeVersion) {
    nodeStatus =
      compareVersions(nodeVersion, MIN_NODE_VERSION) >= 0
        ? "ready"
        : "outdated";
  }
  return {
    node: {
      status: nodeStatus,
      version: nodeVersion,
      minimumVersion: MIN_NODE_VERSION,
    },
    java: {
      status: javaVersion ? "ready" : "missing",
      version: javaVersion,
    },
    caches: inspectOfflineCaches(options),
  };
}

function formatRuntimeEnvironment(environment = {}) {
  const node = environment.node || {};
  const java = environment.java || {};
  const caches = environment.caches || {};
  const managed = caches.managedCli || {};
  const registry = caches.pluginRegistry || {};
  return [
    `- Node.js: ${node.version || "missing"}${
      node.minimumVersion ? ` (minimum ${node.minimumVersion})` : ""
    } — ${node.status || "unknown"}`,
    `- Java on PATH: ${java.version || "missing"} — ${
      java.status || "unknown"
    }`,
    `- Managed CLI offline copy: ${managed.status || "unknown"}${
      managed.version ? ` (${managed.version})` : ""
    }${managed.rollbackVersion ? `; rollback ${managed.rollbackVersion}` : ""}`,
    `- Plugin registry offline cache: ${registry.status || "unknown"}${
      Number.isFinite(Number(registry.entries))
        ? ` (${Number(registry.entries)} entries)`
        : ""
    }`,
  ];
}

module.exports = {
  parseNodeVersion,
  parseJavaVersion,
  runVersion,
  defaultPluginRegistryCacheDir,
  inspectManagedCli,
  inspectOfflineCaches,
  probeRuntimeEnvironment,
  formatRuntimeEnvironment,
};
