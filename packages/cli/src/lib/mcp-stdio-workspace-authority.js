import fs from "node:fs";
import path from "node:path";
import { isProxy } from "node:util/types";
import { resolveHostHooksV2WorkspaceBinding } from "./hooks-v2-workspace-context.js";
import { normalizeMcpSandboxPolicy } from "./mcp-sandbox-policy.js";
import { resolvePluginWorkspaceAuthority } from "./plugin-runtime/sandbox-policy.js";
import { resolveProjectMcpWorkspaceAuthority } from "./project-mcp-trust.js";

export const MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE =
  "CC_MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED";
export const MCP_STDIO_SANDBOX_CWD_INVALID_CODE =
  "CC_MCP_STDIO_SANDBOX_CWD_INVALID";

function workspaceError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function dataProperty(owner, key, fallback) {
  if (!owner || typeof owner !== "object" || isProxy(owner)) {
    throw workspaceError(
      MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
      "MCP stdio sandbox config must be a non-Proxy object",
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor) return fallback;
  if (!("value" in descriptor)) {
    throw workspaceError(
      MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
      `MCP stdio sandbox config.${key} must be an own data property`,
    );
  }
  return descriptor.value;
}

function canonicalDirectory(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw workspaceError(
      MCP_STDIO_SANDBOX_CWD_INVALID_CODE,
      `${label} must be a non-empty directory path`,
    );
  }
  try {
    const canonical = fs.realpathSync.native(path.resolve(value));
    if (!fs.statSync(canonical).isDirectory()) {
      throw new Error("not a directory");
    }
    return canonical;
  } catch (cause) {
    throw workspaceError(
      MCP_STDIO_SANDBOX_CWD_INVALID_CODE,
      `${label} must resolve to an existing directory`,
      cause,
    );
  }
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function sandboxPolicyFromConfig(config, serverName) {
  const raw = dataProperty(config, "sandboxPolicy", null);
  return normalizeMcpSandboxPolicy(raw, {
    label: `MCP stdio server "${serverName}" sandboxPolicy`,
  });
}

function pluginRootFromConfig(config, deps) {
  if (dataProperty(config, "origin", null) !== "plugin:mcp") return null;
  const resolvePlugin =
    deps.resolvePluginWorkspaceAuthority || resolvePluginWorkspaceAuthority;
  return resolvePlugin(dataProperty(config, "pluginWorkspaceAuthority", null), {
    origin: "plugin:mcp",
    pluginId: dataProperty(config, "pluginId", null),
    pluginVersion: dataProperty(config, "pluginVersion", null),
    pluginSource: dataProperty(config, "pluginSource", null),
  });
}

function isProjectFileSource(configScope, configSource) {
  return (
    configScope === "project" &&
    typeof configSource === "string" &&
    path.basename(configSource).toLowerCase() === ".mcp.json"
  );
}

function requirePublicWorkspaceRoot(
  serverName,
  config,
  workspaceBinding,
  deps,
) {
  const resolveHost =
    deps.resolveHostWorkspaceBinding || resolveHostHooksV2WorkspaceBinding;
  const binding = resolveHost(workspaceBinding);
  if (!binding?.workspaceRoot) {
    throw workspaceError(
      MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
      `Policy-bearing MCP stdio server "${serverName}" requires a trusted host workspace`,
    );
  }
  const hostRoot = canonicalDirectory(
    binding.workspaceRoot,
    `MCP stdio server "${serverName}" host workspace`,
  );
  const configScope = dataProperty(config, "configScope", null);
  const projectPath = dataProperty(config, "projectPath", null);
  const configSource = dataProperty(config, "configSource", null);
  const projectAuthority = dataProperty(
    config,
    "projectMcpWorkspaceAuthority",
    null,
  );
  const projectFileSource = isProjectFileSource(configScope, configSource);

  if (
    configScope === "project" &&
    (projectFileSource || projectAuthority) &&
    !projectPath
  ) {
    throw workspaceError(
      MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
      `Project MCP stdio server "${serverName}" is missing its project workspace`,
    );
  }

  if ((configScope === "local" || configScope === "project") && projectPath) {
    const projectRoot = canonicalDirectory(
      projectPath,
      `MCP stdio server "${serverName}" project workspace`,
    );
    if (!isPathInside(projectRoot, hostRoot)) {
      throw workspaceError(
        MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
        `MCP stdio server "${serverName}" does not belong to the trusted host workspace`,
      );
    }

    if (projectAuthority || projectFileSource) {
      const resolveProject =
        deps.resolveProjectMcpWorkspaceAuthority ||
        resolveProjectMcpWorkspaceAuthority;
      const authorityRoot = resolveProject(projectAuthority, {
        configSource,
        serverName,
        url: dataProperty(config, "url", null),
        transport: dataProperty(config, "transport", null),
        headersHelper: dataProperty(config, "headersHelper", null),
      });
      let canonicalAuthorityRoot = null;
      try {
        canonicalAuthorityRoot = authorityRoot
          ? canonicalDirectory(
              authorityRoot,
              `MCP stdio server "${serverName}" project authority`,
            )
          : null;
      } catch {
        canonicalAuthorityRoot = null;
      }
      if (canonicalAuthorityRoot !== projectRoot) {
        throw workspaceError(
          MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
          `Project MCP stdio server "${serverName}" is missing its trusted file authority`,
        );
      }
    }
  }

  return hostRoot;
}

function requestedWorkingDirectory(config, trustedRoot, serverName) {
  const requested = dataProperty(config, "cwd", null);
  if (requested == null || requested === "") return trustedRoot;
  if (typeof requested !== "string" || requested.includes("\0")) {
    throw workspaceError(
      MCP_STDIO_SANDBOX_CWD_INVALID_CODE,
      `MCP stdio server "${serverName}" cwd must be a path`,
    );
  }
  const candidate = canonicalDirectory(
    path.isAbsolute(requested)
      ? requested
      : path.resolve(trustedRoot, requested),
    `MCP stdio server "${serverName}" cwd`,
  );
  if (!isPathInside(trustedRoot, candidate)) {
    throw workspaceError(
      MCP_STDIO_SANDBOX_CWD_INVALID_CODE,
      `MCP stdio server "${serverName}" cwd escapes its trusted workspace`,
    );
  }
  return candidate;
}

/**
 * Resolve source-declared MCP isolation against an opaque host/plugin
 * workspace capability. A policy-bearing launch never derives authority from
 * process.cwd(); the selected cwd is canonical, existing, and contained by the
 * trusted root before executable identity or Broker contract issuance.
 */
export function resolveMcpStdioSandboxContext(
  { serverName, config, workspaceBinding },
  deps = {},
) {
  const name = String(serverName || "unknown");
  const sandboxPolicy = sandboxPolicyFromConfig(config, name);
  const pluginWorkspaceRoot = pluginRootFromConfig(config, deps);

  if (!sandboxPolicy) {
    return Object.freeze({
      sandboxPolicy: null,
      pluginWorkspaceRoot,
      workingDirectory: pluginWorkspaceRoot,
    });
  }

  if (
    dataProperty(config, "origin", null) === "plugin:mcp" &&
    !pluginWorkspaceRoot
  ) {
    throw workspaceError(
      MCP_STDIO_SANDBOX_WORKSPACE_REQUIRED_CODE,
      `Plugin MCP stdio server "${name}" is missing its trusted workspace authority`,
    );
  }

  const trustedRoot = pluginWorkspaceRoot
    ? canonicalDirectory(
        pluginWorkspaceRoot,
        `Plugin MCP stdio server "${name}" workspace`,
      )
    : requirePublicWorkspaceRoot(name, config, workspaceBinding, deps);
  const workingDirectory = requestedWorkingDirectory(config, trustedRoot, name);

  return Object.freeze({
    sandboxPolicy,
    pluginWorkspaceRoot,
    workingDirectory,
  });
}
