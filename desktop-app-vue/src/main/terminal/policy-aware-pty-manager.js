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

let defaultResolverPromise = null;

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

/**
 * Construct a Desktop PtyManager only after its synchronous policy resolver is
 * ready. Production callers inject a synchronous main-process database
 * project selector; the local `root_path` is selected per session. A
 * renderer / WS / mobile caller cannot supply a policy/workspace root.
 *
 * This fixes the initial PTY root only. Arbitrary interactive shell `cd`
 * remains an explicit residual because PTY byte streams are not a reliable
 * shell-state boundary.
 */
async function createPolicyAwarePtyManager(options = {}) {
  const resolveSandboxPolicy =
    options.resolveSandboxPolicy ||
    (await loadDesktopPluginBinSandboxPolicyResolver(
      options.policyLoaderOptions,
    ));
  return new PtyManager({
    config: options.config,
    ...(options.policyCwd
      ? { policyCwd: path.resolve(options.policyCwd) }
      : {}),
    resolveProjectBinding: options.resolveProjectBinding,
    requireProjectBinding: options.requireProjectBinding === true,
    resolveSandboxPolicy,
    ...(options._deps ? { _deps: options._deps } : {}),
  });
}

module.exports = {
  PLUGIN_BIN_MODULE_REL,
  loadDesktopPluginBinSandboxPolicyResolver,
  createPolicyAwarePtyManager,
};
