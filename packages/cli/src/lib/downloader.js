import { createWriteStream, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import ora from "ora";
import { GITHUB_RELEASES_URL } from "../constants.js";
import { getBinDir, ensureDir } from "./paths.js";
import { getBinaryName } from "./platform.js";
import { verifySha256 } from "./checksum.js";
import logger from "./logger.js";

export async function downloadRelease(version, options = {}) {
  const binaryName = getBinaryName(version);
  const binDir = ensureDir(getBinDir());
  const destPath = join(binDir, binaryName);

  if (existsSync(destPath) && !options.force) {
    logger.info(`Binary already exists: ${binaryName}`);
    return destPath;
  }

  const releaseUrl =
    options.url || (await resolveAssetUrl(version, binaryName));
  const spinner = ora(`Downloading ${binaryName}...`).start();

  try {
    const response = await fetch(releaseUrl, {
      headers: { Accept: "application/octet-stream" },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(
        `Download failed: HTTP ${response.status} ${response.statusText}`,
      );
    }

    const totalBytes = parseInt(
      response.headers.get("content-length") || "0",
      10,
    );
    let downloadedBytes = 0;

    const reader = response.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        downloadedBytes += value.byteLength;
        if (totalBytes > 0) {
          const pct = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          spinner.text = `Downloading ${binaryName}... ${pct}% (${formatBytes(downloadedBytes)}/${formatBytes(totalBytes)})`;
        }
        controller.enqueue(value);
      },
    });

    const nodeStream = Readable.fromWeb(stream);
    await pipeline(nodeStream, createWriteStream(destPath));

    spinner.succeed(
      `Downloaded ${binaryName} (${formatBytes(downloadedBytes)})`,
    );

    if (options.checksum) {
      const verifySpinner = ora("Verifying checksum...").start();
      const result = await verifySha256(destPath, options.checksum);
      if (!result.valid) {
        unlinkSync(destPath);
        verifySpinner.fail("Checksum verification failed");
        throw new Error(
          `SHA256 mismatch: expected ${result.expected}, got ${result.actual}`,
        );
      }
      verifySpinner.succeed("Checksum verified");
    }

    return destPath;
  } catch (err) {
    spinner.fail(`Download failed: ${err.message}`);
    if (existsSync(destPath)) {
      unlinkSync(destPath);
    }
    throw err;
  }
}

async function resolveAssetUrl(version, binaryName) {
  // Try exact version first, then fall back to latest release
  const tagName = `v${version}`;
  let release = await fetchRelease(`${GITHUB_RELEASES_URL}/tags/${tagName}`);

  if (!release) {
    logger.info(`Release ${tagName} not found, fetching latest release...`);
    release = await fetchRelease(`${GITHUB_RELEASES_URL}/latest`);
  }

  if (!release) {
    throw new Error(`No releases found for ${GITHUB_RELEASES_URL}`);
  }

  // Re-resolve binary name with the actual release version
  const actualVersion = release.tag_name.replace(/^v/, "");
  const actualBinaryName = binaryName.replace(version, actualVersion);

  const asset =
    release.assets.find((a) => a.name === actualBinaryName) ||
    release.assets.find((a) => a.name === binaryName);
  if (!asset) {
    const available = release.assets.map((a) => a.name).join(", ");
    throw new Error(
      `No matching asset in release ${release.tag_name}. Available: ${available}`,
    );
  }

  return asset.browser_download_url;
}

async function fetchRelease(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!response.ok) return null;
  return response.json();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export { resolveAssetUrl, formatBytes };
