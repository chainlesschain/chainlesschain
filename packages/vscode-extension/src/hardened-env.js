/**
 * Environment for every `cc` / `npm` child we spawn through a Windows shell.
 *
 * On Windows, spawning with `shell: true` runs the command through `cmd.exe`,
 * which resolves a BARE command name (`cc`, `npm`, `taskkill`) from the current
 * directory BEFORE searching PATH. Since our chat/preview spawns set `cwd` to
 * the open workspace root, a cloned or otherwise untrusted repo that ships a
 * `cc.bat` / `cc.cmd` (or `npm.cmd`) at its root would have that script executed
 * merely by opening the chat panel — no user action beyond that. Setting
 * `NoDefaultCurrentDirectoryInExePath` tells cmd.exe (and CreateProcess) to skip
 * the current-directory lookup, so only PATH resolution applies.
 *
 * No-op on non-Windows. Pure (no `vscode`).
 */
function hardenedEnv(base) {
  const env = { ...(base || process.env) };
  if (process.platform === "win32") {
    env.NoDefaultCurrentDirectoryInExePath = "1";
  }
  return env;
}

module.exports = { hardenedEnv };
