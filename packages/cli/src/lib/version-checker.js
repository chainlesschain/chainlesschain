import semver from "semver";
import { GITHUB_RELEASES_URL, VERSION } from "../constants.js";
import logger from "./logger.js";

const NPM_REGISTRY_URL = "https://registry.npmjs.org/chainlesschain/latest";

export async function checkForUpdates(options = {}) {
  const channel = options.channel || "stable";
  const currentVersion = options.currentVersion || VERSION;

  // Try GitHub releases first (has full release notes and assets)
  try {
    const releases = await fetchReleases();
    const filtered = filterByChannel(releases, channel);

    if (filtered.length > 0) {
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
    }
  } catch (err) {
    logger.verbose(`GitHub release check failed: ${err.message}`);
  }

  // Fallback: check npm registry for CLI package version
  // This catches cases where the GitHub Release CI is still building but npm is already published
  try {
    const npmVersion = await fetchNpmVersion();
    if (npmVersion) {
      const updateAvailable = semver.gt(npmVersion, currentVersion);
      return {
        updateAvailable,
        currentVersion,
        latestVersion: npmVersion,
        releaseUrl: `https://www.npmjs.com/package/chainlesschain/v/${npmVersion}`,
        source: "npm",
      };
    }
  } catch (err) {
    logger.verbose(`npm registry check failed: ${err.message}`);
  }

  return {
    updateAvailable: false,
    currentVersion,
    latestVersion: currentVersion,
    error:
      "Unable to check for updates (GitHub releases and npm registry both unavailable)",
  };
}

async function fetchNpmVersion() {
  const response = await fetch(NPM_REGISTRY_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`npm registry error: HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.version || null;
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
