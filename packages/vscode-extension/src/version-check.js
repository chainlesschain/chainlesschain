/**
 * Pure CLI version-sync logic. The extension and the `chainlesschain` CLI ship
 * on independent tracks (Open VSX vs npm); newer panel features need a recent
 * enough `cc`. This decides — from `cc --version` output — whether to nudge the
 * user to upgrade. No `vscode`, no child_process — so it's unit-testable; the
 * thin host glue (run `cc --version`, show the notification) lives in
 * extension.js.
 */

/**
 * Minimum `cc` the current extension features rely on (the chat panel, approval
 * cards, paste-image input). Bump this when a feature needs a newer CLI.
 * (Terminal-context auto-injection degrades gracefully on older cc — the tool
 * still works on demand — so it doesn't force the floor up.)
 */
const MIN_CLI_VERSION = "0.162.47";

/** The shell command that upgrades the global CLI to the latest published npm. */
const UPGRADE_COMMAND = "npm i -g chainlesschain@latest";

/** Bare install command (first-time, not @latest upgrade). */
const INSTALL_COMMAND = "npm i -g chainlesschain";

/**
 * Node.js floor — `npm i -g chainlesschain` ABORTS on older Node (the package's
 * engines requires this), so the install guidance must say it or users hit an
 * unexplained EBADENGINE failure. Mirror packages/cli/package.json `engines.node`.
 */
const MIN_NODE_VERSION = "22.12.0";

/** Install guidance naming both the command and the Node floor. `zh` picks the
 *  Chinese phrasing (panel wizard); default is English (notification surfaces). */
function installGuidance(zh = false) {
  return zh
    ? `请先安装(需 Node.js >= ${MIN_NODE_VERSION}):${INSTALL_COMMAND}`
    : `Install it with \`${INSTALL_COMMAND}\` (requires Node.js >= ${MIN_NODE_VERSION}).`;
}

/** Heuristic: does this spawn output / error mean the cc executable wasn't found? */
function looksLikeMissingCli(output) {
  if (!output) return false;
  const o = String(output).toLowerCase();
  return (
    o.includes("not recognized as an internal or external command") ||
    o.includes("command not found") ||
    o.includes("no such file or directory") ||
    o.includes("cannot run program") ||
    o.includes("enoent") ||
    o.includes("createprocess error=2") ||
    o.includes("error=2,")
  );
}

/** Pull an x.y.z(-prerelease) version out of `cc --version` output, or null. */
function parseCliVersion(stdout) {
  if (typeof stdout !== "string") return null;
  const m = stdout.match(/(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.]+)?/);
  return m ? m[0] : null;
}

/** Compare two x.y.z versions (prerelease suffix ignored): -1 / 0 / 1. */
function compareVersions(a, b) {
  const pa = String(a).split("-")[0].split(".");
  const pb = String(b).split("-")[0].split(".");
  for (let i = 0; i < 3; i++) {
    const da = parseInt(pa[i], 10) || 0;
    const db = parseInt(pb[i], 10) || 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/**
 * Classify the installed CLI against the minimum.
 * @param {string|null} versionStdout  raw `cc --version` output, or null if the
 *                                      command failed / cc is missing
 * @returns {{status:'ok'|'outdated'|'missing'|'unknown', installed:string|null, minimum:string}}
 */
function checkCliVersion(versionStdout, minimum = MIN_CLI_VERSION) {
  if (versionStdout == null || versionStdout === "") {
    return { status: "missing", installed: null, minimum };
  }
  const installed = parseCliVersion(String(versionStdout));
  if (!installed) return { status: "unknown", installed: null, minimum };
  const cmp = compareVersions(installed, minimum);
  return { status: cmp < 0 ? "outdated" : "ok", installed, minimum };
}

/**
 * The notice to show, or null when nothing should be shown. Only an *outdated*
 * cc warrants a nudge here — a missing cc is already surfaced elsewhere (the
 * spawn-failure path), and ok/unknown stay quiet.
 */
function upgradeNotice(check) {
  if (!check || check.status !== "outdated") return null;
  return {
    message:
      `ChainlessChain IDE: your cc CLI (${check.installed}) is older than this ` +
      `extension needs (${check.minimum}). Some features may not work until you upgrade.`,
    upgradeCommand: UPGRADE_COMMAND,
  };
}

/**
 * Orchestrate the version-sync nudge with injected I/O so it's unit-testable
 * (extension.js supplies the real vscode/child_process deps):
 *   deps.getVersion()      -> Promise<string|null>  (`cc --version` stdout)
 *   deps.isDismissed(key)  -> boolean               (globalState)
 *   deps.setDismissed(key) -> void
 *   deps.prompt(message)   -> Promise<'upgrade'|'dismiss'|null>
 *   deps.upgrade(command)  -> void                  (run npm i -g … in a terminal)
 * @returns {Promise<'none'|'shown'|'upgrade'|'dismissed'>} action taken
 */
async function runCliVersionSync(deps, minimum = MIN_CLI_VERSION) {
  let stdout = null;
  try {
    stdout = await deps.getVersion();
  } catch {
    return "none"; // version probe failed → stay quiet (missing-cc is handled elsewhere)
  }
  const check = checkCliVersion(stdout, minimum);
  const notice = upgradeNotice(check);
  if (!notice) return "none";
  const key = "cliUpgradeDismissed:" + check.minimum;
  if (deps.isDismissed(key)) return "none";
  const pick = await deps.prompt(notice.message);
  if (pick === "upgrade") {
    deps.upgrade(notice.upgradeCommand);
    return "upgrade";
  }
  if (pick === "dismiss") {
    deps.setDismissed(key);
    return "dismissed";
  }
  return "shown";
}

/**
 * The "a newer cc is available" nudge (distinct from the hard-floor check
 * above). The floor check only fires when cc is BELOW the minimum a feature
 * needs; this one fires whenever the installed cc trails the latest published
 * npm release, so users on a working-but-old cc still learn that newer features
 * shipped. Returns the notice, or null when up to date / ahead / unknown.
 */
function latestUpdateNotice(installed, latest) {
  if (!installed || !latest) return null;
  if (compareVersions(installed, latest) >= 0) return null; // up to date or ahead
  return {
    message:
      `ChainlessChain IDE: a newer cc CLI (${latest}) is available — you have ` +
      `${installed}. Update to get the latest features.`,
    upgradeCommand: UPGRADE_COMMAND,
  };
}

/**
 * Orchestrate the "newer version available" nudge with injected I/O (testable;
 * extension.js supplies the real vscode/https deps):
 *   deps.getVersion()        -> Promise<string|null>  (`cc --version` stdout)
 *   deps.getLatest()         -> Promise<string|null>  (npm `latest` dist-tag)
 *   deps.isSuppressed()      -> boolean   (user chose "Don't show again")
 *   deps.wasShownFor(latest) -> boolean   (already nudged for THIS version)
 *   deps.markShownFor(latest)-> void
 *   deps.setSuppressed()     -> void
 *   deps.prompt(message)     -> Promise<'upgrade'|'dismiss'|null>
 *   deps.upgrade(command)    -> void
 * @returns {Promise<'none'|'shown'|'upgrade'|'dismissed'>}
 */
async function runLatestVersionCheck(deps) {
  if (deps.isSuppressed && deps.isSuppressed()) return "none";
  let installedRaw;
  let latestRaw;
  try {
    installedRaw = await deps.getVersion();
    latestRaw = await deps.getLatest();
  } catch {
    return "none"; // probe/network failure → stay quiet (best-effort)
  }
  const installed = parseCliVersion(String(installedRaw || ""));
  const latest = parseCliVersion(String(latestRaw || ""));
  const notice = latestUpdateNotice(installed, latest);
  if (!notice) return "none";
  if (deps.wasShownFor && deps.wasShownFor(latest)) return "none";
  if (deps.markShownFor) deps.markShownFor(latest); // at most once per new version
  const pick = await deps.prompt(notice.message);
  if (pick === "upgrade") {
    deps.upgrade(notice.upgradeCommand);
    return "upgrade";
  }
  if (pick === "dismiss") {
    if (deps.setSuppressed) deps.setSuppressed();
    return "dismissed";
  }
  return "shown";
}

module.exports = {
  MIN_CLI_VERSION,
  UPGRADE_COMMAND,
  INSTALL_COMMAND,
  MIN_NODE_VERSION,
  installGuidance,
  looksLikeMissingCli,
  parseCliVersion,
  compareVersions,
  checkCliVersion,
  upgradeNotice,
  runCliVersionSync,
  latestUpdateNotice,
  runLatestVersionCheck,
};
