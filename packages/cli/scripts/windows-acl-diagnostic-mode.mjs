import { createHash } from "node:crypto";

// Diagnostic-only overlay: PowerShell can reconstruct inherited PSModulePath
// during startup. Set it inside the real helper, after param() and before its
// first cmdlet, using PSHOME from that exact PowerShell process. Product source,
// timeout, ACL operations and verification are untouched.
export function diagnosticAclCommandArgs(args, mode = "inherited") {
  if (!["inherited", "builtin"].includes(mode))
    throw new TypeError("Unknown ACL diagnostic module path mode");
  const commandIndex = args.indexOf("-Command") + 1;
  if (commandIndex === 0 || typeof args[commandIndex] !== "string")
    throw new TypeError("Expected a PowerShell ACL command");
  const source = args[commandIndex];
  const marker = "$ErrorActionPreference = 'Stop'";
  if (
    source.split(marker).length !== 2 ||
    !source.includes("CC_WINDOWS_ACL_STAGE=")
  )
    throw new TypeError("Expected exactly one ACL helper initialization");
  const builtinLine =
    "$env:PSModulePath = [System.IO.Path]::Combine($PSHOME, 'Modules')";
  const sourceUsesBuiltinModules = source.includes(builtinLine);
  const overlayApplied = mode === "builtin" && !sourceUsesBuiltinModules;
  const script = overlayApplied
    ? source.replace(marker, `${marker}\n${builtinLine}`)
    : source;
  const changed = [...args];
  changed[commandIndex] = script;
  const digest = (text) => createHash("sha256").update(text).digest("hex");
  return {
    args: changed,
    sourceUsesBuiltinModules,
    effectiveBuiltinModules: sourceUsesBuiltinModules || overlayApplied,
    overlayApplied,
    originalScriptSha256: digest(source),
    executedScriptSha256: digest(script),
  };
}
