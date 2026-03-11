import semver from "semver";
import { GITHUB_RELEASES_URL, VERSION } from "../constants.js";
import logger from "./logger.js";

export async function checkForUpdates(options = {}) {
  const channel = options.channel || "stable";
  const currentVersion = options.currentVersion || VERSION;

  try {
    const releases = await fetchReleases();
    const filtered = filterByChannel(releases, channel);

    if (filtered.length === 0) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: currentVersion,
      };
    }

    const latest = filtered[0];
    const latestVersion = latest.tag_name.replace(/^v/, "");
    const updateAvailable = semver.gt(latestVersion, currentVersion);

    return {
      updateAvailable,
      currentVersion,
      latestVersion,
      releaseUrl: latest.html_url,
      publishedAt: latest.published_at,
      releaseNotes: latest.body,
      assets: latest.assets.map((a) => ({
        name: a.name,
        size: a.size,
        downloadUrl: a.browser_download_url,
      })),
    };
  } catch (err) {
    logger.verbose(`Update check failed: ${err.message}`);
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      error: err.message,
    };
  }
}

async function fetchReleases() {
  const response = await fetch(`${GITHUB_RELEASES_URL}?per_page=20`, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub API error: HTTP ${response.status}`);
  }
  return response.json();
}

function filterByChannel(releases, channel) {
  switch (channel) {
    case "stable":
      return releases.filter((r) => !r.prerelease && !r.draft);
    case "beta":
      return releases.filter((r) => !r.draft);
    case "dev":
      return releases;
    default:
      return releases.filter((r) => !r.prerelease && !r.draft);
  }
}

export { fetchReleases, filterByChannel };
