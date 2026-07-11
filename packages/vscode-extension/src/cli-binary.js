/**
 * Resolve the chainlesschain CLI binary, tolerating a `cc` that is shadowed by
 * another tool — classically the C compiler, whose name is also `cc`. The npm
 * package installs `cc`, `chainlesschain`, `clc` and `clchain`; we try them in
 * order and pick the first whose `--version` prints a BARE chainlesschain
 * version (a leading semver line, not a compiler banner). The result is cached
 * process-wide so the panel spawn and every probe agree. An explicit
 * `chainlesschain.cli.path` (anything other than the default `cc`) always wins.
 * Pure (no `vscode`); the host injects `getVersionOf`.
 */

let _resolved = null;

/** Record the resolved binary (call once after resolveCliBinary). */
function setResolvedCli(bin) {
  if (bin && typeof bin === "string") _resolved = bin;
}

/** The resolved binary, or "cc" until resolution completes. */
function getResolvedCli() {
  return _resolved || "cc";
}

/**
 * True when `--version` output's first non-blank line is a bare semver
 * (chainlesschain prints "0.162.95"), distinguishing it from a `cc` that is
 * actually a C compiler ("cc (GCC) 12.2.0", "Apple clang version 15…") or any
 * other tool. parseCliVersion (find-anywhere) would wrongly accept those.
 */
function looksLikeCcVersion(out) {
  if (typeof out !== "string") return false;
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    return /^v?\d+\.\d+\.\d+/.test(t);
  }
  return false;
}

/**
 * Resolve the CLI binary. An explicit non-`cc` configured path wins; otherwise
 * probe cc → chainlesschain → clc → clchain and return the first that looks like
 * chainlesschain. An optional `getManaged` candidate source (the managed CLI
 * runtime, see managed-cli.js) is consulted ONLY after every global probe
 * failed — an explicit setting is never silently replaced, and behavior with
 * no managed install is byte-identical to before. Falls back to the
 * configured path (or "cc") if nothing matches.
 * @param {{configuredPath?:string,
 *          getVersionOf:(bin:string)=>Promise<string|null>,
 *          getManaged?:()=>Promise<{command:string}|null>|{command:string}|null}} deps
 */
async function resolveCliBinary({
  configuredPath,
  getVersionOf,
  getManaged,
} = {}) {
  const explicit = typeof configuredPath === "string" && configuredPath.trim();
  if (explicit && configuredPath !== "cc") return configuredPath;
  for (const cand of ["cc", "chainlesschain", "clc", "clchain"]) {
    let out = null;
    try {
      out = await getVersionOf(cand);
    } catch {
      out = null;
    }
    if (looksLikeCcVersion(out)) return cand;
  }
  if (typeof getManaged === "function") {
    try {
      const managed = await getManaged();
      if (managed && typeof managed.command === "string" && managed.command) {
        return managed.command;
      }
    } catch {
      /* managed resolution is best-effort — fall through */
    }
  }
  return explicit ? configuredPath : "cc";
}

module.exports = {
  setResolvedCli,
  getResolvedCli,
  looksLikeCcVersion,
  resolveCliBinary,
};
