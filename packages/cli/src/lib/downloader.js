import {
  createWriteStream,
  existsSync,
  unlinkSync,
  readdirSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execSync } from "node:child_process";
import ora from "ora";
import { GITHUB_RELEASES_URL } from "../constants.js";
import { getBinDir, ensureDir } from "./paths.js";
import { getPlatform, getArch } from "./platform.js";
import logger from "./logger.js";

// Platform-specific asset matching patterns
const ASSET_PATTERNS = {
  win32: { x64: /chainlesschain.*win32.*x64.*\.zip$/i },
  darwin: {
    x64: /chainlesschain.*darwin.*x64.*\.zip$/i,
    arm64: /chainlesschain.*darwin.*arm64.*\.zip$/i,
  },
  linux: { x64: /chainlesschain.*linux.*x64.*\.zip$/i },
};

export async function downloadRelease(version, options = {}) {
  const binDir = ensureDir(getBinDir());

  // Check if we already have an extracted app
  if (!options.force && hasExtractedApp(binDir)) {
    logger.info("Application already installed");
    return binDir;
  }

  const { url: assetUrl, name: assetName } = options.url
    ? { url: options.url, name: "download.zip" }
    : await resolveAssetUrl(version);

  const destPath = join(binDir, assetName);
  const spinner = ora(`Downloading ${assetName}...`).start();

  try {
    const response = await fetch(assetUrl, {
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
          spinner.text = `Downloading ${assetName}... ${pct}% (${formatBytes(downloadedBytes)}/${formatBytes(totalBytes)})`;
        }
        controller.enqueue(value);
      },
    });

    const nodeStream = Readable.fromWeb(stream);
    await pipeline(nodeStream, createWriteStream(destPath));

    spinner.succeed(
      `Downloaded ${assetName} (${formatBytes(downloadedBytes)})`,
    );

    // Extract zip
    if (destPath.endsWith(".zip")) {
      const extractSpinner = ora("Extracting...").start();
      try {
        extractZip(destPath, binDir);
        unlinkSync(destPath);
        extractSpinner.succeed("Extracted and ready");
      } catch (err) {
        extractSpinner.fail(`Extraction failed: ${err.message}`);
        throw err;
      }
    }

    return binDir;
  } catch (err) {
    spinner.fail(`Download failed: ${err.message}`);
    if (existsSync(destPath)) {
      unlinkSync(destPath);
    }
    throw err;
  }
}

async function resolveAssetUrl(version) {
  // Try exact version first, then fall back to latest release
  const tagName = `v${version}`;
  let release = await fetchRelease(`${GITHUB_RELEASES_URL}/tags/${tagName}`);

  if (!release) {
    logger.info(`Release ${tagName} not found, fetching latest release...`);
    release = await fetchRelease(`${GITHUB_RELEASES_URL}/latest`);
  }

  if (!release) {
    throw new Error("No releases found on GitHub");
  }

  logger.info(`Using release ${release.tag_name}`);

  // Match asset by platform/arch pattern
  const p = getPlatform();
  const a = getArch();
  const patterns = ASSET_PATTERNS[p];
  if (!patterns) {
    throw new Error(`Unsupported platform: ${p}`);
  }
  const pattern = patterns[a];
  if (!pattern) {
    throw new Error(`Unsupported architecture: ${a} on ${p}`);
  }

  const asset = release.assets.find((ast) => pattern.test(ast.name));
  if (!asset) {
    const available = release.assets.map((ast) => ast.name).join(", ");
    throw new Error(
      `No matching asset for ${p}/${a} in release ${release.tag_name}. Available: ${available}`,
    );
  }

  return { url: asset.browser_download_url, name: asset.name };
}

async function fetchRelease(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!response.ok) return null;
  return response.json();
}

function extractZip(zipPath, destDir) {
  const p = getPlatform();
  if (p === "win32") {
    // Use PowerShell on Windows
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
      { stdio: "ignore" },
    );
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: "ignore" });
  }
}

function hasExtractedApp(binDir) {
  if (!existsSync(binDir)) return false;
  try {
    const files = readdirSync(binDir, { recursive: true });
    return files.some(
      (f) =>
        (typeof f === "string" ? f : f.toString())
          .toLowerCase()
          .includes("chainlesschain") &&
        ((typeof f === "string" ? f : f.toString()).endsWith(".exe") ||
          !(typeof f === "string" ? f : f.toString()).includes(".")),
    );
  } catch {
    return false;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export { resolveAssetUrl, formatBytes };
