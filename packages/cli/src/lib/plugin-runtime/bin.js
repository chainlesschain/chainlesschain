/**
 * Trusted plugin `bin` discovery and direct invocation.
 *
 * Plugin binaries used to be exposed by prepending their directories to the
 * process-wide PATH. That made the eventual target impossible to prove at the
 * Broker boundary: a shell could resolve a different file, a compound command
 * could append an unsandboxed process, and every unrelated descendant inherited
 * the plugin PATH. Policy-bearing bins therefore never enter PATH. `run_shell`
 * resolves their declared alias here, converts one command into literal argv,
 * attests the exact on-disk target, and passes the absolute launch target to
 * ProcessExecutionBroker with `shell:false`. Legacy bins without a policy keep
 * their historical PATH compatibility.
 */

import path from "path";
import fs from "fs";
import crypto from "node:crypto";
import { discoverPlugins } from "./scopes.js";
import { partitionByTrust, warnUntrustedOnce } from "./trust.js";
import { componentCapabilityDenial } from "./capabilities.js";
import { isWithin } from "./manifest.js";

// One-time stderr notice when a plugin's bin dir is refused at the COMPONENT
// level because the plugin opted into the capability model but did not declare
// the `process` capability its executables need. Distinct from the trust gate:
// these plugins ARE trusted, but their bin component is denied.
const _capabilityDenied = new Set();
function warnBinCapabilityDeniedOnce(entries) {
  if (!entries || entries.length === 0) return;
  if (_capabilityDenied.has("bin-capability")) return;
  _capabilityDenied.add("bin-capability");
  const list = entries.map((e) => `${e.name} (${e.reason})`).join("; ");
  try {
    process.stderr.write(
      `[plugins] refused bin dir(s) from plugin(s) that declared a permissions ` +
        `block but did not declare the 'process' capability: ${list}\n` +
        `          add 'process' to the plugin's permissions block to enable them.\n`,
    );
  } catch {
    /* stderr notice is best-effort */
  }
}

/** Test hook: reset the one-time capability-denied warning guard. */
export function _resetBinWarnings() {
  _capabilityDenied.clear();
}

/**
 * Collect trusted, installed plugins' declared bin commands. Unlike a PATH
 * directory, each record preserves the manifest alias, exact target, sandbox
 * requirement, and immutable plugin-version provenance.
 *
 * @param {object} [opts] { cwd, scopes }
 * @returns {Array<object>}
 */
export function collectPluginBinCommands(opts = {}) {
  let plugins = [];
  try {
    plugins = discoverPlugins({ cwd: opts.cwd, scopes: opts.scopes });
  } catch {
    return [];
  }
  const { trusted, skipped } = partitionByTrust(plugins);
  warnUntrustedOnce(
    skipped
      .filter((p) => p.manifest?.components?.bin?.length)
      .map((p) => p.name),
    "bin",
  );
  const out = [];
  const denied = [];
  for (const p of trusted) {
    if (!p.manifest || p.manifest.ok !== true) continue;
    const bins = p.manifest.components?.bin;
    if (!Array.isArray(bins) || bins.length === 0) continue;
    const denial = componentCapabilityDenial(p.manifest, ["process"]);
    if (denial) {
      denied.push({ name: p.name, reason: denial.reason });
      continue;
    }
    for (const bin of bins) {
      if (
        !bin ||
        typeof bin.name !== "string" ||
        typeof bin.absPath !== "string"
      ) {
        continue;
      }
      out.push({
        plugin: p.name,
        scope: p.scope,
        version: p.version,
        root: p.root,
        manifestPath: p.manifest.manifestPath,
        name: bin.name,
        path: bin.path,
        absPath: bin.absPath,
        ...(bin.sandboxPolicy
          ? { sandboxPolicy: bin.sandboxPolicy }
          : p.manifest.sandboxPolicy
            ? { sandboxPolicy: p.manifest.sandboxPolicy }
            : {}),
      });
    }
  }
  warnBinCapabilityDeniedOnce(denied);
  return out;
}

/**
 * Compatibility view used by plugin status surfaces. Directories are never
 * filtered here; `applyPluginBinPath` decides which legacy-only directories
 * remain safe to expose.
 */
export function collectPluginBinDirs(opts = {}) {
  const out = [];
  const seen = new Set();
  for (const bin of collectPluginBinCommands(opts)) {
    const dir = path.dirname(bin.absPath);
    const key = `${bin.plugin}\0${dir}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      plugin: bin.plugin,
      scope: bin.scope,
      version: bin.version,
      dir,
    });
  }
  return out;
}

/**
 * Preserve the legacy PATH contract only for plugins that did not request a
 * sandbox boundary. A directory containing even one policy-bearing bin is
 * excluded as a unit: PATH exposes directories, so adding it for a legacy
 * sibling would also make the strict sibling shell-resolvable.
 *
 * @param {object} [opts] { cwd, scopes, env }
 * @returns {{ added: string[], restore: () => void }}
 */
export function applyPluginBinPath(opts = {}) {
  const env = opts.env || process.env;
  const byDir = new Map();
  for (const bin of collectPluginBinCommands({
    cwd: opts.cwd,
    scopes: opts.scopes,
  })) {
    const dir = path.dirname(bin.absPath);
    const state = byDir.get(dir) || { legacy: false, strict: false };
    if (bin.sandboxPolicy) state.strict = true;
    else state.legacy = true;
    byDir.set(dir, state);
  }
  const dirs = [...byDir]
    .filter(([, state]) => state.legacy && !state.strict)
    .map(([dir]) => dir);
  const prevPath = env.PATH;
  if (dirs.length === 0) {
    return { added: [], restore: () => {} };
  }
  const existing = new Set(
    String(prevPath || "")
      .split(path.delimiter)
      .filter(Boolean),
  );
  const added = dirs.filter((dir) => !existing.has(dir));
  if (added.length === 0) {
    return { added: [], restore: () => {} };
  }
  env.PATH = [...added, prevPath].filter(Boolean).join(path.delimiter);
  let restored = false;
  return {
    added,
    restore: () => {
      if (restored) return;
      restored = true;
      env.PATH = prevPath;
    },
  };
}

function pluginBinError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.pluginBinFailClosed = true;
  return error;
}

function sameName(left, right) {
  return process.platform === "win32"
    ? String(left).toLowerCase() === String(right).toLowerCase()
    : String(left) === String(right);
}

function firstCommandToken(command) {
  const value = String(command || "");
  let token = "";
  let quote = null;
  let escaping = false;
  let started = false;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (!started && /\s/.test(ch)) continue;
    if (escaping) {
      token += ch;
      escaping = false;
      started = true;
      continue;
    }
    if (quote === '"') {
      if (ch === "\\") {
        const next = value[i + 1];
        if (next === '"' || next === "\\") {
          escaping = true;
        } else {
          token += ch;
        }
      } else if (ch === '"') {
        quote = null;
      } else {
        token += ch;
      }
      started = true;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = null;
      else token += ch;
      started = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch) || /[|&;<>()`]/.test(ch)) break;
    token += ch;
    started = true;
  }
  return token;
}

/**
 * Parse exactly one command into literal argv. Every unquoted shell control
 * operator is rejected. Once parsed, no shell sees these values.
 */
export function parsePluginBinCommand(command) {
  if (typeof command !== "string" || command.trim() === "") {
    throw pluginBinError(
      "ERR_PLUGIN_BIN_COMMAND_INVALID",
      "plugin bin command must be a non-empty string",
    );
  }
  if (command.includes("\0")) {
    throw pluginBinError(
      "ERR_PLUGIN_BIN_COMMAND_INVALID",
      "plugin bin command contains a NUL byte",
    );
  }
  const argv = [];
  let current = "";
  let quote = null;
  let escaping = false;
  let tokenStarted = false;

  const flush = () => {
    if (!tokenStarted) return;
    argv.push(current);
    current = "";
    tokenStarted = false;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (escaping) {
      current += ch;
      tokenStarted = true;
      escaping = false;
      continue;
    }
    if (quote === '"') {
      if (ch === "\\") {
        const next = command[i + 1];
        if (next === '"' || next === "\\") {
          escaping = true;
        } else {
          current += ch;
          tokenStarted = true;
        }
      } else if (ch === '"') {
        quote = null;
        tokenStarted = true;
      } else {
        current += ch;
        tokenStarted = true;
      }
      continue;
    }
    if (quote === "'") {
      if (ch === "'") {
        quote = null;
        tokenStarted = true;
      } else {
        current += ch;
        tokenStarted = true;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      tokenStarted = true;
      continue;
    }
    if (ch === "\r" || ch === "\n" || /[|&;<>()`]/.test(ch)) {
      throw pluginBinError(
        "ERR_PLUGIN_BIN_COMPOUND_COMMAND",
        "plugin bin commands must be a single direct invocation; shell operators are not allowed",
      );
    }
    if (ch === "$" && command[i + 1] === "(") {
      throw pluginBinError(
        "ERR_PLUGIN_BIN_COMPOUND_COMMAND",
        "plugin bin commands may not contain command substitution",
      );
    }
    if (ch === " " || ch === "\t") {
      flush();
      continue;
    }
    current += ch;
    tokenStarted = true;
  }
  if (quote || escaping) {
    throw pluginBinError(
      "ERR_PLUGIN_BIN_COMMAND_INVALID",
      "plugin bin command contains an unmatched quote or escape",
    );
  }
  flush();
  if (argv.length === 0 || argv[0] === "") {
    throw pluginBinError(
      "ERR_PLUGIN_BIN_COMMAND_INVALID",
      "plugin bin command has no executable",
    );
  }
  return argv;
}

function fileIdentity(file, root) {
  let fd;
  try {
    const rootReal = fs.realpathSync.native(path.resolve(root));
    const lst = fs.lstatSync(file);
    if (lst.isSymbolicLink() || !lst.isFile()) {
      throw new Error("target must be a regular, non-symlink file");
    }
    const targetReal = fs.realpathSync.native(file);
    if (!isWithin(rootReal, targetReal)) {
      throw new Error("target resolves outside the plugin root");
    }
    fd = fs.openSync(targetReal, "r");
    const before = fs.fstatSync(fd);
    if (!before.isFile())
      throw new Error("opened target is not a regular file");
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    const pathStat = fs.statSync(targetReal);
    const stable =
      before.dev === after.dev &&
      before.ino === after.ino &&
      before.size === after.size &&
      before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs &&
      after.dev === pathStat.dev &&
      after.ino === pathStat.ino &&
      after.size === pathStat.size &&
      after.mtimeMs === pathStat.mtimeMs &&
      after.ctimeMs === pathStat.ctimeMs;
    if (!stable) throw new Error("target identity changed during attestation");
    if (after.nlink !== 1) {
      throw new Error("target must not be hard-linked");
    }
    return Object.freeze({
      realPath: targetReal,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      bytes: after.size,
      dev: String(after.dev),
      ino: String(after.ino),
      mtimeMs: after.mtimeMs,
      mode: after.mode,
    });
  } catch (err) {
    throw pluginBinError(
      "ERR_PLUGIN_BIN_IDENTITY_UNATTESTED",
      `plugin bin target identity could not be attested: ${err.message}`,
    );
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* best-effort */
      }
    }
  }
}

function launchForTarget(identity, userArgs) {
  const ext = path.extname(identity.realPath).toLowerCase();
  if ([".js", ".cjs", ".mjs"].includes(ext)) {
    return {
      command: process.execPath,
      args: [identity.realPath, ...userArgs],
      runtime: "node",
    };
  }
  if (process.platform === "win32" && [".cmd", ".bat", ".ps1"].includes(ext)) {
    throw pluginBinError(
      "ERR_PLUGIN_BIN_WRAPPER_UNSUPPORTED",
      `plugin bin wrapper ${ext} is not supported by the direct native route; ship a Node script or native executable`,
    );
  }
  if (process.platform !== "win32" && (identity.mode & 0o111) === 0) {
    throw pluginBinError(
      "ERR_PLUGIN_BIN_NOT_EXECUTABLE",
      "plugin bin target is not executable",
    );
  }
  return {
    command: identity.realPath,
    args: userArgs,
    runtime: "native",
  };
}

function matchesEntryToken(token, entry, opts) {
  if (sameName(token, entry.name)) return true;
  if (process.platform === "win32" && !/[\\/]/.test(token)) {
    const executableExtensions = new Set([".exe", ".com", ".cmd", ".bat"]);
    const tokenExt = path.extname(token).toLowerCase();
    const aliasExt = path.extname(entry.name).toLowerCase();
    if (
      executableExtensions.has(tokenExt) &&
      !aliasExt &&
      sameName(token.slice(0, -tokenExt.length), entry.name)
    ) {
      return true;
    }
    if (
      !tokenExt &&
      executableExtensions.has(aliasExt) &&
      sameName(token, entry.name.slice(0, -aliasExt.length))
    ) {
      return true;
    }
  }
  if (!path.isAbsolute(token) && !/[\\/]/.test(token)) return false;
  try {
    const resolved = path.resolve(
      opts.commandCwd || opts.cwd || process.cwd(),
      token,
    );
    return sameName(resolved, path.resolve(entry.absPath));
  } catch {
    return false;
  }
}

/**
 * Resolve a trusted declared alias to a direct Broker invocation. Ordinary
 * commands return null. A matching plugin alias that cannot be parsed or
 * attested throws fail-closed instead of falling back to a shell.
 *
 * @returns {object|null}
 */
export function resolvePluginBinInvocation(command, opts = {}) {
  if (typeof command !== "string") return null;
  const token = firstCommandToken(command);
  if (!token) return null;
  const matches = collectPluginBinCommands(opts).filter((entry) =>
    matchesEntryToken(token, entry, opts),
  );
  if (matches.length === 0) return null;
  const policyRequired = matches.some((entry) => entry.sandboxPolicy);
  if (matches.length > 1) {
    if (!policyRequired) return null;
    throw pluginBinError(
      "ERR_PLUGIN_BIN_COMMAND_AMBIGUOUS",
      `plugin bin alias "${token}" is declared by multiple trusted plugins`,
    );
  }
  let words;
  try {
    words = parsePluginBinCommand(command);
  } catch (err) {
    if (!policyRequired && err?.pluginBinFailClosed) return null;
    throw err;
  }
  const entry = matches[0];
  if (!matchesEntryToken(words[0], entry, opts)) {
    throw pluginBinError(
      "ERR_PLUGIN_BIN_COMMAND_INVALID",
      "plugin bin command target changed while parsing",
    );
  }
  let identity;
  let launch;
  try {
    identity = fileIdentity(entry.absPath, entry.root);
    launch = launchForTarget(identity, words.slice(1));
  } catch (err) {
    if (!policyRequired && err?.pluginBinFailClosed) return null;
    throw err;
  }
  const sandboxPolicy = entry.sandboxPolicy
    ? Object.freeze({
        requiredBoundaries: Object.freeze([
          ...(entry.sandboxPolicy.requiredBoundaries || []),
        ]),
      })
    : null;
  return Object.freeze({
    command: launch.command,
    args: Object.freeze([...launch.args]),
    runtime: launch.runtime,
    shell: false,
    pluginId: entry.plugin,
    pluginVersion: entry.version || null,
    pluginSource: entry.manifestPath || entry.root,
    scope: entry.scope || null,
    binName: entry.name,
    binPath: identity.realPath,
    pluginRoot: entry.root,
    executableIdentity: identity,
    ...(sandboxPolicy ? { sandboxPolicy } : {}),
  });
}

/**
 * Compare the target with the identity captured during resolution. Call this
 * immediately before the Broker method so a version-dir mutation cannot be
 * silently accepted after policy resolution.
 */
export function reattestPluginBinInvocation(invocation) {
  if (!invocation?.binPath || !invocation?.pluginRoot) {
    throw pluginBinError(
      "ERR_PLUGIN_BIN_IDENTITY_UNATTESTED",
      "plugin bin invocation has no attested target",
    );
  }
  const current = fileIdentity(invocation.binPath, invocation.pluginRoot);
  const expected = invocation.executableIdentity || {};
  for (const field of [
    "realPath",
    "sha256",
    "bytes",
    "dev",
    "ino",
    "mtimeMs",
  ]) {
    if (current[field] !== expected[field]) {
      throw pluginBinError(
        "ERR_PLUGIN_BIN_IDENTITY_CHANGED",
        `plugin bin target identity changed before launch (${field})`,
      );
    }
  }
  return current;
}

/**
 * Backward-compatible provenance resolver. It now succeeds only for commands
 * that qualify for the direct, attested invocation route.
 */
export function resolvePluginBinCommand(command, opts = {}) {
  const invocation = resolvePluginBinInvocation(command, opts);
  if (!invocation) return null;
  return {
    pluginId: invocation.pluginId,
    pluginVersion: invocation.pluginVersion,
    pluginSource: invocation.pluginSource,
    scope: invocation.scope,
    binPath: invocation.binPath,
    executableIdentity: invocation.executableIdentity,
    ...(invocation.sandboxPolicy
      ? { sandboxPolicy: invocation.sandboxPolicy }
      : {}),
  };
}
