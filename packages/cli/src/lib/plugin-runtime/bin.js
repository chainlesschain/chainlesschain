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
const _sandboxPolicyPins = new Map();
const _issuedPluginBinInvocations = new WeakMap();
const _issuedPluginSandboxContracts = new WeakMap();
const PLUGIN_BIN_MAX_BYTES = 64 * 1024 * 1024;
const PLUGIN_NODE_RUNTIME_MAX_BYTES = 256 * 1024 * 1024;
const ATTESTATION_HASH_CHUNK_BYTES = 1024 * 1024;
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

export function _resetPluginBinSandboxPolicyPins() {
  _sandboxPolicyPins.clear();
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
    plugins = discoverPlugins({
      cwd: opts.cwd,
      scopes: opts.scopes,
      strictIo: opts.failClosed === true,
    });
  } catch (error) {
    if (opts.failClosed === true) {
      throw pluginBinError(
        "ERR_PLUGIN_BIN_DISCOVERY_FAILED",
        `plugin bin policy discovery failed: ${error.message}`,
      );
    }
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
 * Return a tighten-only union of every trusted policy-bearing bin visible from
 * this workspace. The union is intentionally broader than alias attribution:
 * shell indirection (`node <script>`, compound commands, PATH assignment,
 * expansion, wrappers) cannot reliably identify the eventual executable from
 * source text, so every agent shell invocation inherits the union.
 *
 * Pinning by workspace prevents a manifest mutation or trust change from
 * weakening an already observed requirement during the process lifetime.
 */
export function collectPluginBinSandboxPolicy(opts = {}) {
  const pinKey = path.resolve(opts.cwd || process.cwd());
  const required = new Set(_sandboxPolicyPins.get(pinKey) || []);
  const commands = collectPluginBinCommands({
    ...opts,
    failClosed: true,
  });
  for (const command of commands) {
    for (const boundary of command.sandboxPolicy?.requiredBoundaries || []) {
      required.add(boundary);
    }
  }
  return pinPluginBinSandboxPolicy(
    { requiredBoundaries: [...required] },
    { cwd: pinKey },
  );
}

/**
 * Collect the tighten-only union for a fixed workspace and the requested
 * execution directory, then pin the result to the fixed workspace key.
 * Callers must not let an execution-directory override replace the workspace
 * root: it may only discover additional boundaries.
 */
export function collectWorkspacePluginBinSandboxPolicy(opts = {}) {
  const workspaceCwd = path.resolve(
    opts.workspaceCwd || opts.cwd || process.cwd(),
  );
  const executionCwd = path.resolve(opts.executionCwd || workspaceCwd);
  const required = new Set();
  for (const policyCwd of new Set([workspaceCwd, executionCwd])) {
    const observed = collectPluginBinSandboxPolicy({
      cwd: policyCwd,
      ...(opts.scopes !== undefined ? { scopes: opts.scopes } : {}),
    });
    for (const boundary of observed?.requiredBoundaries || []) {
      required.add(boundary);
    }
  }
  return pinPluginBinSandboxPolicy(
    { requiredBoundaries: [...required] },
    { cwd: workspaceCwd },
  );
}

export function pinPluginBinSandboxPolicy(policy, opts = {}) {
  const pinKey = path.resolve(opts.cwd || process.cwd());
  const required = new Set(_sandboxPolicyPins.get(pinKey) || []);
  for (const boundary of policy?.requiredBoundaries || []) {
    required.add(boundary);
  }
  if (required.size === 0) return null;
  const pinnedPolicy = Object.freeze({
    requiredBoundaries: Object.freeze([...required].sort()),
  });
  _sandboxPolicyPins.set(pinKey, pinnedPolicy.requiredBoundaries);
  return pinnedPolicy;
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

function hashOpenFile(fd, bytes) {
  const digest = crypto.createHash("sha256");
  const chunk = Buffer.allocUnsafe(
    Math.max(1, Math.min(ATTESTATION_HASH_CHUNK_BYTES, bytes)),
  );
  let offset = 0;
  while (offset < bytes) {
    const read = fs.readSync(
      fd,
      chunk,
      0,
      Math.min(chunk.length, bytes - offset),
      offset,
    );
    if (read <= 0) {
      throw new Error("file ended before its attested size");
    }
    digest.update(chunk.subarray(0, read));
    offset += read;
  }
  return digest.digest("hex");
}

function preciseOpenFileIdentity(stat) {
  const timestamp = (nanosecondsKey, millisecondsKey) =>
    stat[nanosecondsKey] !== undefined
      ? String(stat[nanosecondsKey])
      : String(Math.trunc(Number(stat[millisecondsKey] || 0) * 1_000_000));
  return Object.freeze({
    dev: String(stat.dev),
    ino: String(stat.ino),
    size: String(stat.size),
    mode: String(stat.mode),
    nlink: String(stat.nlink),
    birthtimeNs: timestamp("birthtimeNs", "birthtimeMs"),
    ctimeNs: timestamp("ctimeNs", "ctimeMs"),
    mtimeNs: timestamp("mtimeNs", "mtimeMs"),
  });
}

function samePreciseOpenFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.birthtimeNs === right.birthtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.mtimeNs === right.mtimeNs
  );
}

function samePreciseFileObject(left, right) {
  return (
    left.dev === right.dev && left.ino === right.ino && left.size === right.size
  );
}

function openFileForAttestation(file) {
  return fs.openSync(
    file,
    Number(fs.constants.O_RDONLY) |
      Number(fs.constants.O_NOFOLLOW || 0) |
      Number(fs.constants.O_NONBLOCK || 0),
  );
}

function assertRegularNonLinkPath(file, label) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} path is not a regular, non-symlink file`);
  }
}

/**
 * Windows/libuv does not guarantee that file IDs reported by stat(path) and
 * fstat(fd) are comparable on every volume. Bind the canonical path to the
 * already-open primary handle through a second handle instead: fstat-to-fstat
 * retains object identity, while the digest also proves byte identity.
 */
function attestWindowsPathHandle(
  file,
  expectedIdentity,
  expectedSha256,
  maxBytes,
  { label, requireSingleLink = false },
) {
  let pathFd;
  try {
    assertRegularNonLinkPath(file, label);
    pathFd = openFileForAttestation(file);
    const before = fs.fstatSync(pathFd, { bigint: true });
    if (!before.isFile()) {
      throw new Error(`${label} path handle is not a regular file`);
    }
    if (before.size < 0n || before.size > BigInt(maxBytes)) {
      throw new Error(
        `${label} path handle exceeds the attestation size limit`,
      );
    }
    const beforeIdentity = preciseOpenFileIdentity(before);
    if (!samePreciseFileObject(expectedIdentity, beforeIdentity)) {
      throw new Error(`${label} path handle identity changed`);
    }
    if (requireSingleLink && before.nlink !== 1n) {
      throw new Error(`${label} path handle must not be hard-linked`);
    }

    const sha256 = hashOpenFile(pathFd, Number(before.size));
    const after = fs.fstatSync(pathFd, { bigint: true });
    const afterIdentity = preciseOpenFileIdentity(after);
    if (
      !samePreciseOpenFileIdentity(beforeIdentity, afterIdentity) ||
      !samePreciseFileObject(expectedIdentity, afterIdentity)
    ) {
      throw new Error(`${label} path handle changed during attestation`);
    }
    if (sha256 !== expectedSha256) {
      throw new Error(`${label} path handle content changed`);
    }
    if (requireSingleLink && after.nlink !== 1n) {
      throw new Error(`${label} path handle must not be hard-linked`);
    }
    assertRegularNonLinkPath(file, label);
  } finally {
    if (pathFd !== undefined) {
      try {
        fs.closeSync(pathFd);
      } catch {
        /* best-effort */
      }
    }
  }
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
    fd = openFileForAttestation(targetReal);
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile())
      throw new Error("opened target is not a regular file");
    if (before.size < 0n || before.size > BigInt(PLUGIN_BIN_MAX_BYTES)) {
      throw new Error("target exceeds the attestation size limit");
    }
    const pathBefore = fs.statSync(targetReal, { bigint: true });
    const beforeIdentity = preciseOpenFileIdentity(before);
    const pathBeforeIdentity = preciseOpenFileIdentity(pathBefore);
    if (
      process.platform !== "win32" &&
      !samePreciseFileObject(beforeIdentity, pathBeforeIdentity)
    ) {
      throw new Error("target identity changed during attestation");
    }
    const sha256 = hashOpenFile(fd, Number(before.size));
    const after = fs.fstatSync(fd, { bigint: true });
    const pathAfter = fs.statSync(targetReal, { bigint: true });
    const afterIdentity = preciseOpenFileIdentity(after);
    const pathAfterIdentity = preciseOpenFileIdentity(pathAfter);
    const stable =
      samePreciseOpenFileIdentity(beforeIdentity, afterIdentity) &&
      samePreciseOpenFileIdentity(pathBeforeIdentity, pathAfterIdentity) &&
      (process.platform === "win32" ||
        samePreciseFileObject(afterIdentity, pathAfterIdentity));
    if (!stable) throw new Error("target identity changed during attestation");
    if (process.platform === "win32") {
      attestWindowsPathHandle(
        targetReal,
        afterIdentity,
        sha256,
        PLUGIN_BIN_MAX_BYTES,
        { label: "target", requireSingleLink: true },
      );
    }
    if (after.nlink !== 1n) {
      throw new Error("target must not be hard-linked");
    }
    const metadata = fs.fstatSync(fd);
    const finalStat = fs.fstatSync(fd, { bigint: true });
    const finalIdentity = preciseOpenFileIdentity(finalStat);
    const finalPathIdentity = preciseOpenFileIdentity(
      fs.statSync(targetReal, { bigint: true }),
    );
    if (
      !samePreciseOpenFileIdentity(afterIdentity, finalIdentity) ||
      !samePreciseOpenFileIdentity(pathAfterIdentity, finalPathIdentity) ||
      (process.platform !== "win32" &&
        !samePreciseFileObject(finalIdentity, finalPathIdentity))
    ) {
      throw new Error("target identity changed during attestation");
    }
    if (process.platform === "win32") {
      attestWindowsPathHandle(
        targetReal,
        finalIdentity,
        sha256,
        PLUGIN_BIN_MAX_BYTES,
        { label: "target", requireSingleLink: true },
      );
    }
    if (finalStat.nlink !== 1n) {
      throw new Error("target must not be hard-linked");
    }
    return Object.freeze({
      realPath: targetReal,
      sha256,
      bytes: Number(after.size),
      dev: String(after.dev),
      ino: String(after.ino),
      mtimeMs: metadata.mtimeMs,
      mode: Number(after.mode),
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

/**
 * Attest the exact Node runtime used by a direct policy-bearing plugin bin.
 *
 * This identity is intentionally produced outside the plugin manifest. The
 * manifest may request boundaries, but it cannot nominate a broader runtime
 * or filesystem root for a strong-sandbox execution contract.
 */
export function attestPluginNodeRuntime(command) {
  let fd;
  try {
    if (
      typeof command !== "string" ||
      !path.isAbsolute(command) ||
      command !== process.execPath
    ) {
      throw new Error("runtime must be the current absolute process.execPath");
    }
    const requestedPath = path.resolve(command);
    const runtimeReal = fs.realpathSync.native(requestedPath);
    const lst = fs.lstatSync(runtimeReal);
    if (lst.isSymbolicLink() || !lst.isFile()) {
      throw new Error("runtime must resolve to a regular file");
    }
    if (process.platform !== "win32" && (lst.mode & 0o111) === 0) {
      throw new Error("runtime is not executable");
    }
    fd = openFileForAttestation(runtimeReal);
    const before = fs.fstatSync(fd, { bigint: true });
    if (
      !before.isFile() ||
      before.size < 0n ||
      before.size > BigInt(PLUGIN_NODE_RUNTIME_MAX_BYTES)
    ) {
      throw new Error("runtime exceeds the attestation size limit");
    }
    const pathBefore = fs.statSync(runtimeReal, { bigint: true });
    const beforeIdentity = preciseOpenFileIdentity(before);
    const pathBeforeIdentity = preciseOpenFileIdentity(pathBefore);
    if (
      process.platform !== "win32" &&
      !samePreciseFileObject(beforeIdentity, pathBeforeIdentity)
    ) {
      throw new Error("runtime identity changed during attestation");
    }
    const sha256 = hashOpenFile(fd, Number(before.size));
    const after = fs.fstatSync(fd, { bigint: true });
    const pathAfter = fs.statSync(runtimeReal, { bigint: true });
    const afterIdentity = preciseOpenFileIdentity(after);
    const pathAfterIdentity = preciseOpenFileIdentity(pathAfter);
    const stable =
      samePreciseOpenFileIdentity(beforeIdentity, afterIdentity) &&
      samePreciseOpenFileIdentity(pathBeforeIdentity, pathAfterIdentity) &&
      (process.platform === "win32" ||
        samePreciseFileObject(afterIdentity, pathAfterIdentity));
    if (!stable) throw new Error("runtime identity changed during attestation");
    if (process.platform === "win32") {
      attestWindowsPathHandle(
        runtimeReal,
        afterIdentity,
        sha256,
        PLUGIN_NODE_RUNTIME_MAX_BYTES,
        { label: "runtime" },
      );
    }
    const metadata = fs.fstatSync(fd);
    const finalIdentity = preciseOpenFileIdentity(
      fs.fstatSync(fd, { bigint: true }),
    );
    const finalPathIdentity = preciseOpenFileIdentity(
      fs.statSync(runtimeReal, { bigint: true }),
    );
    if (
      !samePreciseOpenFileIdentity(afterIdentity, finalIdentity) ||
      !samePreciseOpenFileIdentity(pathAfterIdentity, finalPathIdentity) ||
      (process.platform !== "win32" &&
        !samePreciseFileObject(finalIdentity, finalPathIdentity))
    ) {
      throw new Error("runtime identity changed during attestation");
    }
    if (process.platform === "win32") {
      attestWindowsPathHandle(
        runtimeReal,
        finalIdentity,
        sha256,
        PLUGIN_NODE_RUNTIME_MAX_BYTES,
        { label: "runtime" },
      );
    }
    return Object.freeze({
      requestedPath,
      realPath: runtimeReal,
      sha256,
      bytes: Number(after.size),
      dev: String(after.dev),
      ino: String(after.ino),
      mtimeMs: metadata.mtimeMs,
      mode: Number(after.mode),
    });
  } catch (err) {
    throw pluginBinError(
      "ERR_PLUGIN_NODE_RUNTIME_UNATTESTED",
      `plugin Node runtime identity could not be attested: ${err.message}`,
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

function attestPluginRootIdentity(pluginRoot) {
  const before = fs.lstatSync(pluginRoot);
  const after = fs.statSync(pluginRoot);
  if (
    before.isSymbolicLink() ||
    !before.isDirectory() ||
    !after.isDirectory() ||
    before.dev !== after.dev ||
    before.ino !== after.ino
  ) {
    throw new Error("plugin root identity changed during attestation");
  }
  return Object.freeze({
    realPath: pluginRoot,
    dev: String(after.dev),
    ino: String(after.ino),
  });
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
  const invocation = Object.freeze({
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
  _issuedPluginBinInvocations.set(
    invocation,
    Object.freeze({
      command,
      cwd: path.resolve(opts.cwd || process.cwd()),
      commandCwd: path.resolve(opts.commandCwd || opts.cwd || process.cwd()),
      scopes: Array.isArray(opts.scopes)
        ? Object.freeze([...opts.scopes])
        : undefined,
    }),
  );
  return invocation;
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
 * Issue the private strong-sandbox contract for one resolver-produced
 * policy-bearing Plugin Node or native invocation. Object identity is the
 * capability: callers cannot mint a usable contract by copying public fields.
 */
export function createPluginSandboxExecutionContract(invocation, options = {}) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => key !== "sync") ||
    (options.sync !== undefined && typeof options.sync !== "boolean")
  ) {
    throw pluginBinError(
      "ERR_PLUGIN_SANDBOX_CONTRACT_OPTIONS_INVALID",
      "plugin sandbox execution contract options must contain an optional boolean sync field",
    );
  }
  const sync = options.sync !== false;
  const issuedResolution =
    invocation && typeof invocation === "object"
      ? _issuedPluginBinInvocations.get(invocation)
      : null;
  const runtime = invocation?.runtime;
  const runtimeLabel = runtime === "native" ? "native" : "Node";
  const errorPrefix =
    runtime === "native" ? "ERR_PLUGIN_NATIVE" : "ERR_PLUGIN_NODE";
  if (!invocation || typeof invocation !== "object" || !issuedResolution) {
    throw pluginBinError(
      `${errorPrefix}_SANDBOX_CONTRACT_UNTRUSTED`,
      `plugin ${runtimeLabel} sandbox execution contract requires a resolver-issued invocation`,
    );
  }
  // A resolver-issued invocation is itself a one-shot capability. Consume it
  // before any further work so failed or successful issuance cannot be replayed
  // after trust, capability, or manifest state changes.
  _issuedPluginBinInvocations.delete(invocation);
  const directNode =
    runtime === "node" &&
    invocation.command === process.execPath &&
    invocation.args?.[0] === invocation.binPath;
  const directNative =
    runtime === "native" && invocation.command === invocation.binPath;
  if (
    (!directNode && !directNative) ||
    invocation.shell !== false ||
    !invocation.sandboxPolicy?.requiredBoundaries?.length
  ) {
    throw pluginBinError(
      `${errorPrefix}_SANDBOX_CONTRACT_UNSUPPORTED`,
      `plugin ${runtimeLabel} sandbox execution contract requires one direct policy-bearing bin`,
    );
  }

  try {
    let currentInvocation;
    try {
      currentInvocation = resolvePluginBinInvocation(issuedResolution.command, {
        cwd: issuedResolution.cwd,
        commandCwd: issuedResolution.commandCwd,
        ...(issuedResolution.scopes !== undefined
          ? { scopes: issuedResolution.scopes }
          : {}),
        failClosed: true,
      });
      const scalarFields = [
        "command",
        "runtime",
        "shell",
        "pluginId",
        "pluginVersion",
        "pluginSource",
        "scope",
        "binName",
        "binPath",
        "pluginRoot",
      ];
      const identityFields = [
        "realPath",
        "sha256",
        "bytes",
        "dev",
        "ino",
        "mtimeMs",
        "mode",
      ];
      const originalBoundaries = [
        ...(invocation.sandboxPolicy?.requiredBoundaries || []),
      ].sort();
      const currentBoundaries = [
        ...(currentInvocation?.sandboxPolicy?.requiredBoundaries || []),
      ].sort();
      if (
        !currentInvocation ||
        scalarFields.some(
          (field) => currentInvocation[field] !== invocation[field],
        ) ||
        currentInvocation.args.length !== invocation.args.length ||
        currentInvocation.args.some(
          (value, index) => value !== invocation.args[index],
        ) ||
        originalBoundaries.length !== currentBoundaries.length ||
        originalBoundaries.some(
          (value, index) => value !== currentBoundaries[index],
        ) ||
        identityFields.some(
          (field) =>
            currentInvocation.executableIdentity?.[field] !==
            invocation.executableIdentity?.[field],
        )
      ) {
        throw pluginBinError(
          `${errorPrefix}_SANDBOX_CONTRACT_STALE`,
          `plugin ${runtimeLabel} sandbox execution contract provenance changed after resolution`,
        );
      }
    } finally {
      if (currentInvocation) {
        _issuedPluginBinInvocations.delete(currentInvocation);
      }
    }
    reattestPluginBinInvocation(invocation);
    const pluginRoot = fs.realpathSync.native(
      path.resolve(invocation.pluginRoot),
    );
    const entryRelative = path.relative(
      pluginRoot,
      invocation.executableIdentity.realPath,
    );
    if (
      entryRelative === "" ||
      entryRelative === ".." ||
      entryRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(entryRelative)
    ) {
      throw new Error("plugin bin target is outside its canonical plugin root");
    }
    // The trusted Node runtime is both the Node launch target and the
    // capability-probe runtime for a native launch. Keeping the probe runtime
    // in the contract prevents a plugin from nominating a host executable.
    const runtimeIdentity = attestPluginNodeRuntime(process.execPath);
    const rootIdentity = attestPluginRootIdentity(pluginRoot);
    const contract = Object.freeze({
      contractVersion: 1,
      kind:
        runtime === "native"
          ? "strict-plugin-native-elf-bin"
          : "strict-plugin-node-bin",
      pluginRoot,
      workingDirectory: pluginRoot,
      runtimePath: runtimeIdentity.realPath,
      rootIdentity,
      entryIdentity: invocation.executableIdentity,
      runtimeIdentity,
    });
    _issuedPluginSandboxContracts.set(
      contract,
      Object.freeze({
        origin: "plugin:bin",
        command:
          runtime === "native" ? invocation.command : runtimeIdentity.realPath,
        args: invocation.args,
        cwd: pluginRoot,
        pluginId: invocation.pluginId,
        pluginVersion: invocation.pluginVersion ?? null,
        pluginSource: invocation.pluginSource,
        pluginExecutableIdentity: invocation.executableIdentity,
        requiredBoundaries: invocation.sandboxPolicy.requiredBoundaries,
        sync,
      }),
    );
    return contract;
  } catch (error) {
    if (error?.pluginBinFailClosed) throw error;
    throw pluginBinError(
      `${errorPrefix}_SANDBOX_CONTRACT_UNATTESTED`,
      `plugin ${runtimeLabel} sandbox execution contract could not be created: ${error.message}`,
    );
  }
}

/**
 * Backward-compatible Node-only issuer retained for existing callers.
 */
export function createPluginNodeSandboxExecutionContract(
  invocation,
  options = {},
) {
  if (invocation?.runtime !== "node") {
    throw pluginBinError(
      "ERR_PLUGIN_NODE_SANDBOX_CONTRACT_UNSUPPORTED",
      "plugin Node sandbox execution contract requires one direct policy-bearing Node bin",
    );
  }
  return createPluginSandboxExecutionContract(invocation, options);
}

/**
 * Validate that a contract is the exact object issued above and is still
 * attached to the launch provenance for which it was issued.
 */
function issuedPluginSandboxContractMatches(contract, provenance = {}) {
  if (!contract || typeof contract !== "object") return false;
  const issued = _issuedPluginSandboxContracts.get(contract);
  if (!issued) return false;
  const args = Array.isArray(provenance.args) ? provenance.args : [];
  const requiredBoundaries = Array.isArray(provenance.requiredBoundaries)
    ? provenance.requiredBoundaries
    : [];
  return (
    provenance.origin === issued.origin &&
    provenance.command === issued.command &&
    args.length === issued.args.length &&
    args.every((value, index) => value === issued.args[index]) &&
    provenance.cwd === issued.cwd &&
    provenance.pluginId === issued.pluginId &&
    (provenance.pluginVersion ?? null) === issued.pluginVersion &&
    provenance.pluginSource === issued.pluginSource &&
    provenance.pluginExecutableIdentity === issued.pluginExecutableIdentity &&
    provenance.sync === issued.sync &&
    issued.requiredBoundaries.every((boundary) =>
      requiredBoundaries.includes(boundary),
    )
  );
}

export function verifyIssuedPluginNodeSandboxExecutionContract(
  contract,
  provenance = {},
) {
  return (
    contract?.kind === "strict-plugin-node-bin" &&
    issuedPluginSandboxContractMatches(contract, provenance)
  );
}

export function verifyIssuedPluginSandboxExecutionContract(
  contract,
  provenance = {},
) {
  return issuedPluginSandboxContractMatches(contract, provenance);
}

/**
 * Atomically consume a one-launch contract. A trust decision captured for one
 * Broker call cannot be replayed after trust/policy state changes.
 */
export function consumeIssuedPluginNodeSandboxExecutionContract(
  contract,
  provenance = {},
) {
  if (
    contract?.kind !== "strict-plugin-node-bin" ||
    !issuedPluginSandboxContractMatches(contract, provenance)
  ) {
    return false;
  }
  return _issuedPluginSandboxContracts.delete(contract);
}

export function consumeIssuedPluginSandboxExecutionContract(
  contract,
  provenance = {},
) {
  if (!issuedPluginSandboxContractMatches(contract, provenance)) {
    return false;
  }
  return _issuedPluginSandboxContracts.delete(contract);
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
