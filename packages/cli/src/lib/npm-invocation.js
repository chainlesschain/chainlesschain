import path from "node:path";

/**
 * Resolve npm without asking a shell to interpret the platform shim.
 *
 * Windows npm installations expose `npm.cmd`, but Node cannot execute a CMD
 * shim with `shell:false` (`spawnSync npm.cmd EINVAL`). The shim delegates to
 * the npm CLI located beside node.exe, so invoke that JavaScript entrypoint
 * through the current Node executable instead.
 */
export function resolveNpmInvocation({
  platform = process.platform,
  execPath = process.execPath,
} = {}) {
  if (platform !== "win32") {
    return { command: "npm", prefixArgs: [] };
  }

  const npmCliPath = path.win32.join(
    path.win32.dirname(execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  return { command: execPath, prefixArgs: [npmCliPath] };
}

export default resolveNpmInvocation;
