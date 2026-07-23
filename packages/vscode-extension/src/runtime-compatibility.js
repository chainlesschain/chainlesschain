/**
 * Single user-facing verdict for the CLI + IDE bridge runtime combination.
 *
 * The IDE host supplies only observable signals. This pure core classifies
 * them identically in VS Code and JetBrains as ready, degraded, or requiring
 * repair, so Doctor does not leave users to interpret a list of versions.
 */
const { looksLikeCcVersion } = require("./cli-binary");
const {
  MIN_CLI_VERSION,
  parseCliVersion,
  compareVersions,
} = require("./version-check");

const STATUS_READY = "ready";
const STATUS_DEGRADED = "degraded";
const STATUS_REPAIR = "repair";

const LABELS = Object.freeze({
  [STATUS_READY]: "READY (可运行)",
  [STATUS_DEGRADED]: "DEGRADED (可降级运行)",
  [STATUS_REPAIR]: "NEEDS REPAIR (需要修复)",
});

function evaluateRuntimeCompatibility({
  cliVersionText,
  minimumCliVersion = MIN_CLI_VERSION,
  bridgePort,
  workspaceTrusted,
} = {}) {
  const reasons = [];
  const raw = String(cliVersionText || "");
  let cliVersion = null;
  let cliRequiresRepair = false;

  if (!raw.trim()) {
    reasons.push("cc CLI is missing");
    cliRequiresRepair = true;
  } else if (!looksLikeCcVersion(raw)) {
    reasons.push("resolved command is not the chainlesschain CLI");
    cliRequiresRepair = true;
  } else {
    cliVersion = parseCliVersion(raw);
    if (!cliVersion) {
      reasons.push("cc CLI version is unrecognized");
      cliRequiresRepair = true;
    } else if (compareVersions(cliVersion, minimumCliVersion) < 0) {
      reasons.push(
        `cc CLI ${cliVersion} is older than required ${minimumCliVersion}`,
      );
      cliRequiresRepair = true;
    }
  }

  if (!(Number(bridgePort) > 0)) {
    reasons.push("IDE bridge is stopped");
  }
  if (workspaceTrusted === false) {
    reasons.push("workspace trust is restricted");
  }

  const status = cliRequiresRepair
    ? STATUS_REPAIR
    : reasons.length
      ? STATUS_DEGRADED
      : STATUS_READY;
  const detail = reasons.length
    ? reasons.join("; ")
    : "CLI and bridge are compatible";

  return {
    status,
    label: LABELS[status],
    summary: `${LABELS[status]} — ${detail}`,
    cliVersion,
    minimumCliVersion,
    reasons,
  };
}

module.exports = {
  STATUS_READY,
  STATUS_DEGRADED,
  STATUS_REPAIR,
  evaluateRuntimeCompatibility,
};
