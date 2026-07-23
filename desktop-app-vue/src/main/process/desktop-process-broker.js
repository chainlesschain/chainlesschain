/**
 * Desktop main-process child-process broker.
 *
 * Electron's main process is CommonJS and cannot import the CLI's ESM broker
 * during bootstrap. This adapter keeps Node's execution semantics intact while
 * giving every child_process entry point one auditable boundary.
 */
const nodeFs = require("node:fs");
const nodeOs = require("node:os");
const nodePath = require("node:path");
const nativeChildProcess = require("node:child_process");

const BROKER_MARK = Symbol.for("chainlesschain.desktopProcessBroker");

function redact(value) {
  return String(value ?? "")
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(
      /((?:token|api[_-]?key|secret|password|authorization|cookie)\s*[=:]\s*)(?!Bearer\s+)([^\s&;]+)/gi,
      "$1[REDACTED]",
    )
    .slice(0, 512);
}

function cleanOptions(options) {
  if (!options || typeof options !== "object") return options;
  const clean = { ...options };
  delete clean.origin;
  delete clean.provenance;
  return clean;
}

function commandLabel(command, args) {
  const argv = Array.isArray(args) ? args : [];
  return {
    command: redact(command),
    args: argv.slice(0, 32).map(redact),
    argCount: argv.length,
  };
}

function cleanProvenance(provenance) {
  if (!provenance || typeof provenance !== "object") return null;
  const allowed = [
    "pluginId",
    "pluginVersion",
    "pluginSource",
    "hookId",
    "hookName",
    "hookType",
    "eventName",
  ];
  const clean = {};
  for (const key of allowed) {
    if (provenance[key] !== undefined && provenance[key] !== null) {
      clean[key] = redact(provenance[key]);
    }
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

function defaultAuditSink(entry) {
  try {
    const logPath = nodePath.join(
      nodeOs.homedir(),
      ".chainlesschain",
      "logs",
      "desktop-process-audit.jsonl",
    );
    nodeFs.mkdirSync(nodePath.dirname(logPath), { recursive: true });
    nodeFs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Auditing must never change the desktop process execution result.
  }
}

function invokeWithOptionalArgs(original, first, args, options) {
  if (args === undefined && options === undefined) return original(first);
  if (options === undefined) return original(first, args);
  return original(first, args, cleanOptions(options));
}

function installDesktopProcessBroker({
  childProcess = nativeChildProcess,
  auditSink = defaultAuditSink,
  now = () => new Date().toISOString(),
} = {}) {
  if (childProcess[BROKER_MARK]) return childProcess[BROKER_MARK];

  const originals = {};
  const auditLog = [];
  const record = (operation, command, args, options) => {
    const entry = {
      timestamp: now(),
      pid: process.pid,
      host: "desktop-main",
      operation,
      origin: options?.origin || "desktop:unknown",
      provenance: cleanProvenance(options?.provenance),
      cwd: options?.cwd || process.cwd(),
      ...commandLabel(command, args),
    };
    auditLog.push(entry);
    if (auditLog.length > 1000) auditLog.shift();
    try {
      auditSink(entry);
    } catch {
      // An injected audit sink is advisory and must not break execution.
    }
  };

  const wrap = (name, fn) => {
    originals[name] = childProcess[name];
    childProcess[name] = fn(originals[name]);
  };

  wrap("spawn", (original) => (command, args, options) => {
    record("spawn", command, args, options);
    return invokeWithOptionalArgs(original, command, args, options);
  });
  wrap("spawnSync", (original) => (command, args, options) => {
    record("spawnSync", command, args, options);
    return invokeWithOptionalArgs(original, command, args, options);
  });
  wrap("exec", (original) => (command, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    record("exec", command, [], options);
    return options === undefined
      ? original(command, callback)
      : original(command, cleanOptions(options), callback);
  });
  wrap("execSync", (original) => (command, options) => {
    record("execSync", command, [], options);
    return options === undefined
      ? original(command)
      : original(command, cleanOptions(options));
  });
  wrap("execFile", (original) => (file, args, options, callback) => {
    if (typeof args === "function") {
      callback = args;
      args = undefined;
      options = undefined;
    } else if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    record("execFile", file, args, options);
    if (options === undefined) return original(file, args, callback);
    return original(file, args, cleanOptions(options), callback);
  });
  wrap("execFileSync", (original) => (file, args, options) => {
    record("execFileSync", file, args, options);
    return invokeWithOptionalArgs(original, file, args, options);
  });
  wrap("fork", (original) => (modulePath, args, options) => {
    record("fork", modulePath, args, options);
    return invokeWithOptionalArgs(original, modulePath, args, options);
  });

  const broker = {
    spawn(command, args, options) {
      return childProcess.spawn(command, args, options);
    },
    spawnPty(ptyModule, command, args, options) {
      if (!ptyModule || typeof ptyModule.spawn !== "function") {
        throw new TypeError("pty_module_spawn_unavailable");
      }
      // PTY options contain the complete inherited environment. Keep values
      // out of the audit record while preserving the native spawn options.
      record("pty.spawn", command, args, options);
      return ptyModule.spawn(command, args, options);
    },
    getAuditLog: (limit = 100) => auditLog.slice(-limit),
    flushAuditLog: () => auditLog.splice(0, auditLog.length),
    uninstall() {
      for (const [name, original] of Object.entries(originals)) {
        if (childProcess[name]?.[BROKER_MARK] === broker) {
          childProcess[name] = original;
        }
      }
      delete childProcess[BROKER_MARK];
    },
  };
  for (const name of Object.keys(originals)) {
    Object.defineProperty(childProcess[name], BROKER_MARK, {
      value: broker,
      configurable: true,
    });
  }
  childProcess[BROKER_MARK] = broker;
  return broker;
}

function getDesktopProcessBroker({ childProcess = nativeChildProcess } = {}) {
  return childProcess[BROKER_MARK] || null;
}

function spawnWithDesktopBroker(
  command,
  args,
  options,
  { childProcess = nativeChildProcess } = {},
) {
  const broker = getDesktopProcessBroker({ childProcess });
  if (!broker) throw new Error("desktop_process_broker_not_installed");
  return broker.spawn(command, args, options);
}

function spawnSyncWithDesktopBroker(
  command,
  args,
  options,
  { childProcess = nativeChildProcess } = {},
) {
  const broker = getDesktopProcessBroker({ childProcess });
  if (!broker) throw new Error("desktop_process_broker_not_installed");
  return childProcess.spawnSync(command, args, options);
}

function execFileSyncWithDesktopBroker(
  file,
  args,
  options,
  { childProcess = nativeChildProcess } = {},
) {
  const broker = getDesktopProcessBroker({ childProcess });
  if (!broker) throw new Error("desktop_process_broker_not_installed");
  return childProcess.execFileSync(file, args, options);
}

module.exports = {
  installDesktopProcessBroker,
  getDesktopProcessBroker,
  spawnWithDesktopBroker,
  spawnSyncWithDesktopBroker,
  execFileSyncWithDesktopBroker,
  redact,
};
