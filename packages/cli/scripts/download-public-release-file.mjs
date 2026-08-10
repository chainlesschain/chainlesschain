#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLIC_DOWNLOAD_PROFILES = Object.freeze({
  metadata: Object.freeze(["api.github.com"]),
  release: Object.freeze([
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
  ]),
});

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const MAX_ALLOWED_BYTES = 512 * 1024 * 1024;

export function validatePublicDownloadUrl(value, profile) {
  const allowed = PUBLIC_DOWNLOAD_PROFILES[profile];
  if (!allowed) throw new Error(`unknown public download profile: ${profile}`);
  const url = value instanceof URL ? value : new URL(String(value));
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username ||
    url.password ||
    url.hash ||
    !allowed.includes(url.hostname)
  ) {
    throw new Error(
      `URL is outside the ${profile} HTTPS allowlist: ${url.href}`,
    );
  }
  return url;
}

export function resolvePublicRedirect(current, location, profile) {
  if (typeof location !== "string" || !location.trim()) {
    throw new Error("public download redirect lacks a Location header");
  }
  return validatePublicDownloadUrl(
    new URL(location, validatePublicDownloadUrl(current, profile)),
    profile,
  );
}

export function validatePublicDownloadLimit(value) {
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_ALLOWED_BYTES) {
    throw new Error(
      `public download limit must be 1..${MAX_ALLOWED_BYTES} bytes`,
    );
  }
  return bytes;
}

function ensureOutput(output) {
  const resolved = path.resolve(output);
  const directory = path.dirname(resolved);
  const root = fs.lstatSync(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error(
      "public download output parent must be a regular directory",
    );
  }
  try {
    fs.lstatSync(resolved);
    throw new Error(`public download output already exists: ${resolved}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return resolved;
}

function requestOnce(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: "application/octet-stream, application/vnd.github+json",
          "User-Agent": "chainlesschain-native-public-readback/1",
        },
      },
      resolve,
    );
    request.setTimeout(30_000, () => {
      request.destroy(new Error("public download request timed out"));
    });
    request.on("error", reject);
  });
}

export async function downloadPublicReleaseFile(options) {
  const output = ensureOutput(options.output);
  const maximumBytes = validatePublicDownloadLimit(options.maximumBytes);
  const profile = String(options.profile || "");
  let current = validatePublicDownloadUrl(options.url, profile);
  const redirects = [];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await requestOnce(current);
    if (REDIRECT_STATUSES.has(response.statusCode)) {
      response.resume();
      if (hop === MAX_REDIRECTS) {
        throw new Error("public download exceeded the redirect limit");
      }
      const next = resolvePublicRedirect(
        current,
        response.headers.location,
        profile,
      );
      redirects.push({ from: current.href, to: next.href });
      current = next;
      continue;
    }
    if (response.statusCode !== 200) {
      response.resume();
      throw new Error(`public download returned HTTP ${response.statusCode}`);
    }
    if (response.headers["content-encoding"]) {
      response.resume();
      throw new Error("public download content encoding is not accepted");
    }
    const declared = response.headers["content-length"];
    if (declared !== undefined) {
      const declaredBytes = Number(declared);
      if (
        !Number.isSafeInteger(declaredBytes) ||
        declaredBytes < 1 ||
        declaredBytes > maximumBytes
      ) {
        response.resume();
        throw new Error("public download Content-Length exceeds its policy");
      }
    }
    const temporary = `${output}.partial-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
    const handle = fs.openSync(temporary, "wx", 0o600);
    const digest = crypto.createHash("sha256");
    let bytes = 0;
    try {
      for await (const chunk of response) {
        bytes += chunk.length;
        if (bytes > maximumBytes) {
          throw new Error("public download exceeded its streaming size limit");
        }
        digest.update(chunk);
        fs.writeSync(handle, chunk);
      }
      fs.fsyncSync(handle);
    } catch (error) {
      fs.closeSync(handle);
      fs.rmSync(temporary, { force: true });
      throw error;
    }
    fs.closeSync(handle);
    if (bytes < 1) {
      fs.rmSync(temporary, { force: true });
      throw new Error("public download is empty");
    }
    try {
      fs.linkSync(temporary, output);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    return {
      schema: "chainlesschain.public-download.v1",
      requestedUrl: String(options.url),
      effectiveUrl: current.href,
      profile,
      maximumBytes,
      bytes,
      sha256: digest.digest("hex"),
      redirects,
      anonymous: true,
    };
  }
  throw new Error("public download did not reach a terminal response");
}

async function main() {
  const [profile, url, output, maximumBytes, ...extra] = process.argv.slice(2);
  if (!profile || !url || !output || !maximumBytes || extra.length) {
    throw new Error(
      "usage: download-public-release-file.mjs <metadata|release> <https-url> <output> <maximum-bytes>",
    );
  }
  const evidence = await downloadPublicReleaseFile({
    profile,
    url,
    output,
    maximumBytes,
  });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    process.stderr.write(`public release download failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
