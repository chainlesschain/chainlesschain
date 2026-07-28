/**
 * Race-free Desktop PTY policy bootstrap.
 *
 * The Desktop main process is CommonJS while the canonical Plugin-bin policy
 * collector lives in the CLI's ESM tree. Resolve that async module boundary
 * before constructing a PtyManager, then inject a synchronous resolver into
 * every terminal create path. Import failure becomes a synchronous,
 * fail-closed resolver so the rest of the Desktop UI can still start without
 * ever allocating an unbounded terminal.
 */

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { PtyManager } = require("./PtyManager");

const PLUGIN_BIN_MODULE_REL =
  "../../../../packages/cli/src/lib/plugin-runtime/bin.js";
const PROCESS_BROKER_MODULE_REL =
  "../../../../packages/cli/src/lib/process-execution-broker/index.js";

let defaultResolverPromise = null;
let defaultStrongPtyBrokerPromise = null;

function resolverUnavailable(cause) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(
    `Desktop PTY Plugin-bin sandbox policy resolver unavailable: ${detail}`,
  );
  error.code = "ERR_DESKTOP_PTY_SANDBOX_POLICY_UNAVAILABLE";
  error.pluginBinFailClosed = true;
  error.cause = cause;

  const resolver = () => {
    throw error;
  };
  Object.defineProperty(resolver, "loadError", {
    value: error,
    enumerable: false,
  });
  return Object.freeze(resolver);
}

async function buildResolver(options = {}) {
  const moduleUrl =
    options.moduleUrl ||
    pathToFileURL(path.resolve(__dirname, PLUGIN_BIN_MODULE_REL)).href;
  const importModule =
    options.importModule || ((specifier) => import(specifier));

  try {
    const pluginBin = await importModule(moduleUrl);
    if (
      typeof pluginBin?.collectWorkspacePluginBinSandboxPolicy !== "function"
    ) {
      throw new TypeError(
        "collectWorkspacePluginBinSandboxPolicy export is unavailable",
      );
    }
    const collectWorkspacePluginBinSandboxPolicy =
      pluginBin.collectWorkspacePluginBinSandboxPolicy;
    const resolver = ({ workspaceCwd, executionCwd }) =>
      collectWorkspacePluginBinSandboxPolicy({
        workspaceCwd,
        executionCwd,
      });
    Object.defineProperty(resolver, "loadError", {
      value: null,
      enumerable: false,
    });
    return Object.freeze(resolver);
  } catch (error) {
    return resolverUnavailable(error);
  }
}

/**
 * Preload the CLI ESM collector and return a synchronous resolver.
 *
 * Custom loader options bypass the process-wide cache for deterministic unit
 * tests. Production callers share one import and one Plugin policy pin map.
 */
function loadDesktopPluginBinSandboxPolicyResolver(options = {}) {
  if (options.importModule || options.moduleUrl) {
    return buildResolver(options);
  }
  if (!defaultResolverPromise) {
    defaultResolverPromise = buildResolver();
  }
  return defaultResolverPromise;
}

function strongPtyBrokerUnavailable(cause) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(
    `Desktop strong Linux PTY broker unavailable: ${detail}`,
  );
  error.code = "ERR_DESKTOP_PTY_STRONG_BACKEND_UNAVAILABLE";
  error.sandboxReason = "desktop_strong_pty_backend_unavailable";
  error.sandboxFailClosed = true;
  error.cause = cause;
  const failClosed = () => {
    throw error;
  };
  return Object.freeze({
    issueLinuxWorkspaceSandboxExecutionContract: failClosed,
    spawnPty: failClosed,
    loadError: error,
  });
}

async function buildStrongPtyBroker(options = {}) {
  const moduleUrl =
    options.moduleUrl ||
    pathToFileURL(path.resolve(__dirname, PROCESS_BROKER_MODULE_REL)).href;
  const importModule =
    options.importModule || ((specifier) => import(specifier));

  try {
    const brokerModule = await importModule(moduleUrl);
    const broker = brokerModule?.executionBroker || brokerModule?.default;
    if (
      !broker ||
      typeof broker.issueLinuxWorkspaceSandboxExecutionContract !==
        "function" ||
      typeof broker.spawnPty !== "function"
    ) {
      throw new TypeError(
        "CLI ProcessExecutionBroker strong PTY exports are unavailable",
      );
    }
    return Object.freeze({
      issueLinuxWorkspaceSandboxExecutionContract:
        broker.issueLinuxWorkspaceSandboxExecutionContract.bind(broker),
      spawnPty: broker.spawnPty.bind(broker),
      loadError: null,
    });
  } catch (error) {
    return strongPtyBrokerUnavailable(error);
  }
}

/**
 * Preload the CLI ESM ProcessExecutionBroker in Electron's main process.
 *
 * The facade receives the node-pty module loaded by Desktop, so its native
 * binding remains Electron-ABI compatible. The CLI copy contributes only the
 * one-shot Linux contract, descriptor-pinned bwrap plan, PTY adapter, and
 * audit path. Import/export failure is retained as a synchronous fail-closed
 * facade and cannot fall back to native node-pty for a policy-bearing launch.
 */
function loadDesktopStrongPtyBroker(options = {}) {
  if (options.importModule || options.moduleUrl) {
    return buildStrongPtyBroker(options);
  }
  if (!defaultStrongPtyBrokerPromise) {
    defaultStrongPtyBrokerPromise = buildStrongPtyBroker();
  }
  return defaultStrongPtyBrokerPromise;
}

/**
 * Construct a Desktop PtyManager only after its synchronous policy resolver is
 * ready. Production callers inject a synchronous main-process database
 * project selector; the local `root_path` is selected per session. A
 * renderer / WS / mobile caller cannot supply a policy/workspace root.
 *
 * A policy-bearing Linux session additionally receives a one-shot contract
 * for that canonical root and runs inside the generic empty-root bwrap
 * backend. Interactive `cd` may move through the sandbox's runtime allowlist,
 * but cannot reveal another host workspace. Policy-free sessions retain their
 * legacy native PTY behavior; unsupported strict platforms remain fail-closed.
 */
async function createPolicyAwarePtyManager(options = {}) {
  const resolveSandboxPolicy =
    options.resolveSandboxPolicy ||
    (await loadDesktopPluginBinSandboxPolicyResolver(
      options.policyLoaderOptions,
    ));
  const platform = options._deps?.platform?.() || process.platform;
  const hasInjectedStrongBroker =
    typeof options.issueLinuxWorkspaceSandboxExecutionContract === "function" &&
    typeof options.spawnLinuxStrongPty === "function";
  const hasInjectedStrongDeps =
    typeof options._deps?.issueLinuxWorkspaceSandboxExecutionContract ===
      "function" && typeof options._deps?.spawnLinuxStrongPty === "function";
  const strongPtyBroker =
    options.strongPtyBroker ||
    (platform === "linux" && !hasInjectedStrongBroker && !hasInjectedStrongDeps
      ? await loadDesktopStrongPtyBroker(options.strongPtyBrokerLoaderOptions)
      : null);
  return new PtyManager({
    config: options.config,
    ...(options.policyCwd
      ? { policyCwd: path.resolve(options.policyCwd) }
      : {}),
    resolveProjectBinding: options.resolveProjectBinding,
    requireProjectBinding: options.requireProjectBinding === true,
    resolveSandboxPolicy,
    issueLinuxWorkspaceSandboxExecutionContract:
      options.issueLinuxWorkspaceSandboxExecutionContract ||
      strongPtyBroker?.issueLinuxWorkspaceSandboxExecutionContract ||
      null,
    spawnLinuxStrongPty:
      options.spawnLinuxStrongPty || strongPtyBroker?.spawnPty || null,
    ...(options._deps ? { _deps: options._deps } : {}),
  });
}

module.exports = {
  PLUGIN_BIN_MODULE_REL,
  PROCESS_BROKER_MODULE_REL,
  loadDesktopPluginBinSandboxPolicyResolver,
  loadDesktopStrongPtyBroker,
  createPolicyAwarePtyManager,
};
