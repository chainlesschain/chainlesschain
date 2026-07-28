"use strict";

const path = require("node:path");

const STRONG_HOOK_BOUNDARIES = new Set(["filesystem", "network"]);

function requiredHookBoundaries(sandboxPolicy) {
  const configured = sandboxPolicy?.requiredBoundaries;
  return Array.isArray(configured) ? configured : [];
}

function requiresExplicitHookShell(sandboxPolicy) {
  return requiredHookBoundaries(sandboxPolicy).some((boundary) =>
    STRONG_HOOK_BOUNDARIES.has(boundary),
  );
}

function sandboxBoundaryError(message) {
  const error = new Error(message);
  error.code = "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED";
  error.sandboxFailClosed = true;
  return error;
}

function asSandboxBoundaryError(error, prefix) {
  if (error?.code === "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED") {
    return error;
  }
  const detail =
    error && typeof error.message === "string" ? error.message : String(error);
  return sandboxBoundaryError(`${prefix}: ${detail}`);
}

function issueTrustedHookSandboxContract({
  issuer,
  receiver = null,
  file,
  args,
  options,
  trustedRoot,
  sync = false,
  label = "trusted hook sandbox contract issuance failed",
}) {
  if (typeof issuer !== "function") return null;
  try {
    return issuer.call(
      receiver,
      file,
      args,
      options,
      trustedRoot,
      ...(sync ? [{ sync: true }] : []),
    );
  } catch (error) {
    throw asSandboxBoundaryError(error, label);
  }
}

function requireTrustedHookRoot(value, label = "hook working directory") {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    !path.isAbsolute(value)
  ) {
    throw sandboxBoundaryError(
      `${label} must be an absolute trusted path for filesystem/network sandboxing`,
    );
  }
  return path.resolve(value);
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

function quotePosixShellArgument(value) {
  const text = String(value);
  if (text.length === 0) return "''";
  return `'${text.replace(/'/g, `'"'"'`)}'`;
}

function quoteCmdArgument(value) {
  const text = String(value);
  if (text.length === 0) return '""';
  // The command and its arguments are all hook-controlled, but quote cmd.exe
  // metacharacters anyway so an argv entry remains one argument.
  return `"${text
    .replace(/"/g, '""')
    .replace(/([&|<>^])/g, "^$1")
    .replace(/%/g, "%%")}"`;
}

function appendShellArguments(command, args, platform) {
  if (!Array.isArray(args) || args.length === 0) return command;
  const quote =
    platform === "win32" ? quoteCmdArgument : quotePosixShellArgument;
  return `${command} ${args.map((arg) => quote(arg)).join(" ")}`;
}

/**
 * Turn a settings-style shell command into an explicit executable + argv.
 * This is used only when filesystem/network boundaries are requested. Keeping
 * shell selection explicit lets the Broker bind its one-shot contract to the
 * actual launch tuple and guarantees the child spawn itself uses shell:false.
 */
function buildExplicitHookShellInvocation(
  command,
  {
    args = [],
    platform = process.platform,
    shellKind = null,
    buildPowershellArgv = null,
    powershellOptions = {},
  } = {},
) {
  const rendered = appendShellArguments(String(command), args, platform);
  if (
    (shellKind === "powershell" || shellKind === "pwsh") &&
    typeof buildPowershellArgv === "function"
  ) {
    return buildPowershellArgv(rendered, shellKind, powershellOptions);
  }
  if (platform === "win32") {
    return {
      file: process.env.ComSpec || "cmd.exe",
      argv: ["/d", "/s", "/c", rendered],
    };
  }
  return { file: "/bin/sh", argv: ["-c", rendered] };
}

module.exports = {
  buildExplicitHookShellInvocation,
  issueTrustedHookSandboxContract,
  isPathInside,
  requireTrustedHookRoot,
  requiredHookBoundaries,
  requiresExplicitHookShell,
  asSandboxBoundaryError,
  sandboxBoundaryError,
};
