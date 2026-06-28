/**
 * `/release-notes` REPL command — show the running cc version and point at the
 * full changelog (Claude-Code parity). The npm package ships only bin/ + src/ +
 * README, so rather than bundle a copy of the changelog that would go stale, we
 * surface a reliable pointer to the canonical sources + how to upgrade.
 */

export const CHANGELOG_URL = "https://docs.chainlesschain.com/changelog";
export const RELEASES_URL =
  "https://github.com/chainlesschain/chainlesschain/releases";

/**
 * @param {object} info  { version, installedVersion }
 */
export function formatReleaseNotes(info = {}) {
  const lines = [`cc ${info.version || "?"}`];
  if (info.installedVersion && info.installedVersion !== info.version) {
    lines.push(`  (disk ${info.installedVersion} — restart to apply)`);
  }
  lines.push(
    "",
    "What's new / 完整更新日志:",
    `  ${CHANGELOG_URL}`,
    `  ${RELEASES_URL}`,
    "",
    "检查更新 / 升级: cc update  ·  npm i -g chainlesschain",
  );
  return lines.join("\n");
}
