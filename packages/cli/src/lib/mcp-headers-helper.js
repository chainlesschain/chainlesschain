import fs from "node:fs";
import path from "node:path";
import executionBroker from "./process-execution-broker/index.js";
import hookShellCommand from "./hook-shell-command.cjs";
import {
  currentHostHooksV2WorkspaceBinding,
  resolveHostHooksV2WorkspaceBinding,
} from "./hooks-v2-workspace-context.js";
import { checkLocalMcpHeadersHelperTrust } from "./mcp-headers-helper-trust.js";
import { resolvePluginWorkspaceAuthority } from "./plugin-runtime/sandbox-policy.js";
import { resolveProjectMcpWorkspaceAuthority } from "./project-mcp-trust.js";

const { buildExplicitHookShellInvocation } = hookShellCommand;

export const MCP_HEADERS_HELPER_TIMEOUT_MS = 10_000;
export const MCP_HEADERS_HELPER_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_HELPER_COMMAND_BYTES = 32 * 1024;
const MAX_HEADER_COUNT = 128;
const MAX_HEADER_VALUE_BYTES = 16 * 1024;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const TRANSPORT_OWNED_HEADERS = new Set([
  "accept",
  "connection",
  "content-length",
  "content-type",
  "host",
  "mcp-protocol-version",
  "mcp-session-id",
  "sec-websocket-accept",
  "sec-websocket-extensions",
  "sec-websocket-key",
  "sec-websocket-protocol",
  "sec-websocket-version",
  "transfer-encoding",
  "upgrade",
]);
const PUBLIC_CONFIG_SCOPES = new Set(["local", "project", "user", "managed"]);

function helperError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeHelperCommand(value) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > MAX_HELPER_COMMAND_BYTES
  ) {
    throw helperError(
      "CC_MCP_HEADERS_HELPER_INVALID",
      "MCP headersHelper must be a non-empty bounded command string",
    );
  }
  return value;
}

function canonicalHelperCwd(value, realpath = fs.realpathSync.native) {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.includes("\0") ||
    !path.isAbsolute(value)
  ) {
    throw helperError(
      "CC_MCP_HEADERS_HELPER_CWD_INVALID",
      "MCP headersHelper requires an absolute trusted working directory",
    );
  }
  let canonical;
  let stats;
  try {
    canonical = realpath(path.resolve(value));
    stats = fs.statSync(canonical);
  } catch {
    throw helperError(
      "CC_MCP_HEADERS_HELPER_CWD_INVALID",
      "MCP headersHelper working directory is unavailable",
    );
  }
  if (!stats.isDirectory()) {
    throw helperError(
      "CC_MCP_HEADERS_HELPER_CWD_INVALID",
      "MCP headersHelper working directory must be a directory",
    );
  }
  return canonical;
}

function normalizeHeaderMap(value, source) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw helperError(
      "CC_MCP_HEADERS_HELPER_OUTPUT_INVALID",
      `MCP ${source} headers must be a JSON object of string values`,
    );
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_HEADER_COUNT) {
    throw helperError(
      "CC_MCP_HEADERS_HELPER_OUTPUT_INVALID",
      `MCP ${source} headers exceed the allowed entry count`,
    );
  }
  const normalized = [];
  for (const [name, headerValue] of entries) {
    if (
      !HEADER_NAME.test(name) ||
      typeof headerValue !== "string" ||
      /[\0-\x08\x0a-\x1f\x7f]/.test(headerValue) ||
      Buffer.byteLength(headerValue, "utf8") > MAX_HEADER_VALUE_BYTES ||
      (source === "dynamic" && TRANSPORT_OWNED_HEADERS.has(name.toLowerCase()))
    ) {
      throw helperError(
        "CC_MCP_HEADERS_HELPER_OUTPUT_INVALID",
        `MCP ${source} headers contain an invalid name or value`,
      );
    }
    normalized.push([name, headerValue]);
  }
  return normalized;
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

/**
 * Resolve helper cwd only from an existing source authority. Project/local
 * configs must run inside the host bootstrap's immutable workspace binding;
 * plugin configs must carry the collector-issued opaque plugin authority.
 */
export function resolveMcpHeadersHelperContext(config = {}, deps = {}) {
  if (config.origin === "plugin:mcp") {
    const resolvePlugin =
      deps.resolvePluginWorkspaceAuthority || resolvePluginWorkspaceAuthority;
    const pluginRoot = resolvePlugin(config.pluginWorkspaceAuthority, {
      origin: config.origin,
      pluginId: config.pluginId,
      pluginVersion: config.pluginVersion,
      pluginSource: config.pluginSource,
    });
    if (!pluginRoot) {
      throw helperError(
        "CC_MCP_HEADERS_HELPER_UNTRUSTED_WORKSPACE",
        "Plugin MCP headersHelper is missing its trusted workspace authority",
      );
    }
    return {
      cwd: pluginRoot,
      pluginRoot,
      execution: {
        origin: config.origin,
        policy: config.policy || "allow",
        scope: config.scope || "mcp",
        pluginId: config.pluginId,
        pluginVersion: config.pluginVersion,
        pluginSource: config.pluginSource,
        ...(config.sandboxPolicy
          ? { sandboxPolicy: config.sandboxPolicy }
          : {}),
      },
    };
  }

  const scope = config.configScope == null ? "user" : config.configScope;
  if (!PUBLIC_CONFIG_SCOPES.has(scope)) {
    throw helperError(
      "CC_MCP_HEADERS_HELPER_UNTRUSTED_WORKSPACE",
      "MCP headersHelper has an unsupported configuration source",
    );
  }
  const hasBindingOverride = Object.prototype.hasOwnProperty.call(
    deps,
    "currentWorkspaceBinding",
  );
  const candidateBinding = hasBindingOverride
    ? typeof deps.currentWorkspaceBinding === "function"
      ? deps.currentWorkspaceBinding()
      : null
    : currentHostHooksV2WorkspaceBinding();
  const binding = hasBindingOverride
    ? (deps.resolveHostWorkspaceBinding || resolveHostHooksV2WorkspaceBinding)(
        candidateBinding,
      )
    : candidateBinding;
  if (scope === "local" || scope === "project") {
    if (!binding?.workspaceRoot || !config.projectPath) {
      throw helperError(
        "CC_MCP_HEADERS_HELPER_UNTRUSTED_WORKSPACE",
        "Project-local MCP headersHelper requires a trusted host workspace",
      );
    }
    let projectRoot;
    try {
      projectRoot = fs.realpathSync.native(
        path.resolve(String(config.projectPath)),
      );
    } catch {
      throw helperError(
        "CC_MCP_HEADERS_HELPER_UNTRUSTED_WORKSPACE",
        "MCP headersHelper project authority is unavailable",
      );
    }
    if (!isPathInside(projectRoot, binding.workspaceRoot)) {
      throw helperError(
        "CC_MCP_HEADERS_HELPER_UNTRUSTED_WORKSPACE",
        "MCP headersHelper source does not belong to the trusted host workspace",
      );
    }
    if (scope === "project") {
      const resolveProject =
        deps.resolveProjectMcpWorkspaceAuthority ||
        resolveProjectMcpWorkspaceAuthority;
      const authorityRoot = resolveProject(
        config.projectMcpWorkspaceAuthority,
        {
          configSource: config.configSource,
          serverName: config.serverName || config.name,
          url: config.url,
          transport: config.transport,
          headersHelper: config.headersHelper,
        },
      );
      if (!authorityRoot || path.resolve(authorityRoot) !== projectRoot) {
        throw helperError(
          "CC_MCP_HEADERS_HELPER_UNTRUSTED_WORKSPACE",
          "Project MCP headersHelper is missing its trusted file authority",
        );
      }
    }
    if (scope === "local") {
      const checkTrust =
        deps.checkLocalMcpHeadersHelperTrust || checkLocalMcpHeadersHelperTrust;
      const trust = checkTrust({
        workspaceRoot: projectRoot,
        serverName: config.serverName || config.name,
        url: config.url,
        transport: config.transport,
        headersHelper: config.headersHelper,
      });
      if (trust?.status !== "trusted") {
        throw helperError(
          "CC_MCP_HEADERS_HELPER_UNTRUSTED_WORKSPACE",
          "Local MCP headersHelper changed or has not been explicitly trusted",
        );
      }
    }
    return { cwd: binding.workspaceRoot, pluginRoot: null, execution: null };
  }
  return {
    cwd: binding?.workspaceRoot || path.resolve(deps.cwd || process.cwd()),
    pluginRoot: null,
    execution: null,
  };
}

/**
 * Merge HTTP headers case-insensitively. A dynamic helper value replaces every
 * static spelling of the same header name, while unrelated static headers stay
 * intact. Duplicate spellings within either input collapse to the last value.
 */
export function mergeMcpHeaders(staticHeaders = {}, dynamicHeaders = {}) {
  const byLowerName = new Map();
  for (const [name, value] of normalizeHeaderMap(staticHeaders, "static")) {
    byLowerName.set(name.toLowerCase(), [name, value]);
  }
  for (const [name, value] of normalizeHeaderMap(dynamicHeaders, "dynamic")) {
    byLowerName.set(name.toLowerCase(), [name, value]);
  }
  return Object.fromEntries(byLowerName.values());
}

function waitForHelperClose(child, timeoutMs) {
  if (child?.exitCode != null || child?.signalCode != null) {
    return Promise.resolve(true);
  }
  if (typeof child?.once !== "function") return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off?.("close", onClose);
      resolve(value);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("close", onClose);
  });
}

async function waitForPosixGroupExit(pid, kill, timeoutMs, deps = {}) {
  const probe =
    deps.probeGroupGone ||
    (() => {
      try {
        kill(-pid, 0);
        return false;
      } catch (error) {
        return error?.code === "ESRCH";
      }
    });
  const deadline = Date.now() + timeoutMs;
  do {
    if (probe(pid) === true) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  return probe(pid) === true;
}

/** Bounded whole-tree termination fence for a timed-out helper. */
export async function terminateMcpHeadersHelperTree(child, deps = {}) {
  const platform = deps.platform || process.platform;
  const sandboxManagedTree = deps.sandboxManagedTree === true;
  const kill = deps.kill || process.kill.bind(process);
  const spawnSync =
    deps.spawnSync || executionBroker.spawnSync.bind(executionBroker);
  const cleanupTimeoutMs = Math.max(
    1,
    Math.min(2_000, Number(deps.cleanupTimeoutMs || 2_000)),
  );
  const pid = Number(child?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return { requested: false, closed: false, treeTerminated: false };
  }

  const closeFence = deps.alreadyClosed
    ? Promise.resolve(true)
    : waitForHelperClose(child, cleanupTimeoutMs);
  let requested = false;
  let treeTerminated = false;

  if (platform === "win32") {
    try {
      const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        origin: "mcp:headers-helper:taskkill",
        policy: "allow",
        scope: "mcp",
      });
      if (!result?.error && result?.status === 0) {
        requested = true;
        treeTerminated = true;
      }
    } catch {
      // Fall through to the direct child handle below.
    }
  } else if (!requested && !sandboxManagedTree) {
    try {
      kill(-pid, "SIGKILL");
      requested = true;
    } catch {
      // The helper may have failed before becoming a process-group leader.
    }
  }

  if (!requested) {
    try {
      requested = child.kill?.("SIGKILL") !== false;
    } catch {
      requested = false;
    }
  }

  const [closed, posixTreeGone] = await Promise.all([
    closeFence,
    platform === "win32" || !requested || sandboxManagedTree
      ? Promise.resolve(treeTerminated)
      : waitForPosixGroupExit(pid, kill, cleanupTimeoutMs, deps),
  ]);
  if (platform !== "win32") {
    // A strong Linux workspace contract launches bubblewrap as the direct
    // child with a private PID namespace and a close fence. Once that child
    // closes, Broker's process-tree guarantee confirms the namespace is empty;
    // it must not be treated as an independently detached process group.
    treeTerminated = sandboxManagedTree ? requested && closed : posixTreeGone;
  }
  return { requested, closed, treeTerminated };
}

/**
 * Execute one trusted MCP headersHelper command and return its validated JSON
 * object. The helper output is credential material: errors deliberately omit
 * the command, stdout, and stderr.
 */
export function runMcpHeadersHelper(spec, deps = {}) {
  const command = normalizeHelperCommand(spec?.command);
  const platform = deps.platform || process.platform;
  const cwd = canonicalHelperCwd(
    spec?.cwd,
    deps.realpath || fs.realpathSync.native,
  );
  const invocation = buildExplicitHookShellInvocation(command, { platform });
  const spawn = deps.spawn || executionBroker.spawn.bind(executionBroker);
  const timeoutMs = Math.max(
    1,
    Math.min(
      MCP_HEADERS_HELPER_TIMEOUT_MS,
      Number(deps.timeoutMs || MCP_HEADERS_HELPER_TIMEOUT_MS),
    ),
  );
  const maxOutputBytes = Math.max(
    1024,
    Math.min(
      MCP_HEADERS_HELPER_MAX_OUTPUT_BYTES,
      Number(deps.maxOutputBytes || MCP_HEADERS_HELPER_MAX_OUTPUT_BYTES),
    ),
  );
  const env = {
    ...(spec?.env || process.env),
    CLAUDE_CODE_MCP_SERVER_NAME: String(spec?.serverName || ""),
    CLAUDE_CODE_MCP_SERVER_URL: String(spec?.serverUrl || ""),
    ...(spec?.pluginRoot
      ? { CLAUDE_PLUGIN_ROOT: String(spec.pluginRoot) }
      : {}),
  };
  const spawnOptions = {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    detached: platform !== "win32",
    origin:
      spec?.execution?.origin ||
      `mcp:headers-helper:${String(spec?.serverName || "unknown")}`,
    policy: spec?.execution?.policy || "allow",
    scope: spec?.execution?.scope || "mcp",
    pluginId: spec?.execution?.pluginId,
    pluginVersion: spec?.execution?.pluginVersion,
    pluginSource: spec?.execution?.pluginSource,
    ...(spec?.execution?.sandboxPolicy
      ? { sandboxPolicy: spec.execution.sandboxPolicy }
      : {}),
    auditRedactArgIndexes: [invocation.argv.length - 1],
  };
  const issueSandboxContract =
    deps.issueSandboxExecutionContract ||
    executionBroker.issueLinuxWorkspaceSandboxExecutionContract.bind(
      executionBroker,
    );
  let sandboxExecutionContract;
  try {
    // Strong Linux workspace contracts deliberately reject detached launches:
    // bubblewrap owns the whole process tree through its PID namespace. Probe
    // with detached:false, then retain a detached process group only when no
    // Broker-owned sandbox contract is issued.
    sandboxExecutionContract = issueSandboxContract(
      invocation.file,
      invocation.argv,
      { ...spawnOptions, detached: false },
      cwd,
    );
  } catch {
    throw helperError(
      "CC_MCP_HEADERS_HELPER_SANDBOX_UNAVAILABLE",
      "MCP headersHelper sandbox authority is unavailable",
    );
  }
  const sandboxManagedTree = Boolean(sandboxExecutionContract);
  const launchOptions = {
    ...spawnOptions,
    detached: sandboxManagedTree ? false : spawnOptions.detached,
  };

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(invocation.file, invocation.argv, {
        ...launchOptions,
        ...(sandboxExecutionContract ? { sandboxExecutionContract } : {}),
      });
    } catch {
      reject(
        helperError(
          "CC_MCP_HEADERS_HELPER_START_FAILED",
          "MCP headersHelper could not be started",
        ),
      );
      return;
    }

    if (!child?.stdout || !child?.stderr) {
      void terminateMcpHeadersHelperTree(child, {
        ...deps,
        platform,
        sandboxManagedTree,
      }).finally(() =>
        reject(
          helperError(
            "CC_MCP_HEADERS_HELPER_START_FAILED",
            "MCP headersHelper did not expose bounded output streams",
          ),
        ),
      );
      return;
    }

    let state = "running";
    let stdout = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const settle = (fn, value) => {
      if (state === "settled") return;
      state = "settled";
      clearTimeout(timer);
      fn(value);
    };
    const failAndTerminate = (error, cleanupDeps = {}) => {
      if (state !== "running") return;
      state = "terminating";
      clearTimeout(timer);
      void terminateMcpHeadersHelperTree(child, {
        ...deps,
        ...cleanupDeps,
        platform,
        sandboxManagedTree,
      })
        .catch(() => ({ closed: false, treeTerminated: false }))
        .then((cleanup) => {
          error.cleanupConfirmed =
            cleanup.closed === true && cleanup.treeTerminated === true;
          settle(reject, error);
        });
    };
    const timer = setTimeout(
      () =>
        failAndTerminate(
          helperError(
            "CC_MCP_HEADERS_HELPER_TIMEOUT",
            "MCP headersHelper exceeded its 10-second timeout",
          ),
        ),
      timeoutMs,
    );

    child.stdout.on("data", (chunk) => {
      if (state !== "running") return;
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk));
      stdoutBytes += buffer.byteLength;
      if (stdoutBytes > maxOutputBytes) {
        failAndTerminate(
          helperError(
            "CC_MCP_HEADERS_HELPER_OUTPUT_TOO_LARGE",
            "MCP headersHelper stdout exceeded the bounded output limit",
          ),
        );
        return;
      }
      stdout += buffer.toString("utf8");
    });
    // Drain stderr so a noisy helper cannot block on a full pipe, but never
    // retain or surface credential-bearing diagnostics.
    child.stderr.on("data", (chunk) => {
      if (state === "settled" || stderrBytes > maxOutputBytes) return;
      stderrBytes += Buffer.isBuffer(chunk)
        ? chunk.byteLength
        : Buffer.byteLength(String(chunk));
    });
    child.once("error", () =>
      failAndTerminate(
        helperError(
          "CC_MCP_HEADERS_HELPER_START_FAILED",
          "MCP headersHelper process failed",
        ),
      ),
    );
    child.once("close", (code, signal) => {
      if (state !== "running") return;
      if (code !== 0) {
        failAndTerminate(
          helperError(
            "CC_MCP_HEADERS_HELPER_FAILED",
            `MCP headersHelper exited unsuccessfully (code ${code ?? "null"}, signal ${signal || "none"})`,
          ),
          { alreadyClosed: true },
        );
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        settle(
          reject,
          helperError(
            "CC_MCP_HEADERS_HELPER_OUTPUT_INVALID",
            "MCP headersHelper stdout must be one JSON object of string headers",
          ),
        );
        return;
      }
      try {
        const headers = Object.fromEntries(
          normalizeHeaderMap(parsed, "dynamic"),
        );
        settle(resolve, headers);
      } catch (error) {
        settle(reject, error);
      }
    });
  });
}
