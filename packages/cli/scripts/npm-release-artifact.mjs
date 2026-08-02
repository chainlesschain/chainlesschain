#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { list as listTarball } from "tar";

const WEB_PANEL_ROOT = "package/src/assets/web-panel";
const WEB_PANEL_INDEX = `${WEB_PANEL_ROOT}/index.html`;
const PACKAGE_JSON = "package/package.json";
const CHANGELOG_JSON = "package/src/data/changelog.json";
const MAX_WEB_PANEL_INDEX_BYTES = 1024 * 1024;
const MAX_PACKAGE_JSON_BYTES = 256 * 1024;
const MAX_CHANGELOG_JSON_BYTES = 4 * 1024 * 1024;

const AUTHORITY_LIMITS = new Map([
  [WEB_PANEL_INDEX, MAX_WEB_PANEL_INDEX_BYTES],
  [PACKAGE_JSON, MAX_PACKAGE_JSON_BYTES],
  [CHANGELOG_JSON, MAX_CHANGELOG_JSON_BYTES],
]);

function hashFile(file, algorithm) {
  return crypto
    .createHash(algorithm)
    .update(fs.readFileSync(file))
    .digest("hex");
}

function hashBytes(value, algorithm = "sha256") {
  return crypto.createHash(algorithm).update(value).digest("hex");
}

function isRegularTarFile(entry) {
  return entry.type === "File" || entry.type === "OldFile";
}

function resolveWebPanelReference(reference) {
  const raw = reference.trim();
  if (
    !raw ||
    raw.startsWith("#") ||
    raw.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(raw)
  ) {
    return null;
  }
  if (raw.includes("\\") || raw.includes("\0")) {
    throw new Error(`unsafe Web Panel asset reference: ${reference}`);
  }

  const withoutQuery = raw.split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    throw new Error(`invalid Web Panel asset reference: ${reference}`);
  }
  if (decoded.includes("\\") || decoded.includes("\0")) {
    throw new Error(`unsafe Web Panel asset reference: ${reference}`);
  }
  const relative = decoded.startsWith("/") ? decoded.slice(1) : decoded;
  const resolved = path.posix.normalize(
    path.posix.join(WEB_PANEL_ROOT, relative),
  );
  if (!resolved.startsWith(`${WEB_PANEL_ROOT}/`)) {
    throw new Error(`escaping Web Panel asset reference: ${reference}`);
  }
  return resolved;
}

function referencedWebPanelAssets(indexHtml) {
  const references = [];
  const tags = indexHtml.match(/<(?:script|link)\b[^>]*>/giu) || [];
  for (const tag of tags) {
    const script = /^<script\b/iu.test(tag);
    const attribute = tag.match(
      script
        ? /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/iu
        : /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/iu,
    );
    if (!attribute) continue;
    const archivePath = resolveWebPanelReference(
      attribute[1] === undefined ? attribute[2] : attribute[1],
    );
    if (!archivePath) continue;
    const rel = script
      ? null
      : tag.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/iu);
    const relValue = rel ? (rel[1] === undefined ? rel[2] : rel[1]) : "";
    references.push({
      archivePath,
      script,
      stylesheet: relValue
        .split(/\s+/u)
        .some((value) => value.toLowerCase() === "stylesheet"),
    });
  }
  return references;
}

function readBoundedEntry(entry, maximumBytes) {
  const result = new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    entry.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes <= maximumBytes) chunks.push(chunk);
    });
    entry.on("error", reject);
    entry.on("end", () => {
      if (bytes > maximumBytes) {
        reject(new Error(`archive authority exceeds ${maximumBytes} bytes`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
  // Archive traversal can continue after an authority entry ends. Mark the
  // promise handled immediately, then await it after traversal completes.
  result.catch(() => {});
  return result;
}

async function scanNpmTarball(tarball) {
  const file = path.resolve(tarball);
  const entries = new Map();
  const duplicates = new Set();
  const authorityReads = new Map();

  await listTarball({
    file,
    strict: true,
    maxDecompressionRatio: 100,
    onReadEntry(entry) {
      const name = entry.path;
      if (entries.has(name)) duplicates.add(name);
      else {
        entries.set(name, {
          bytes: Number(entry.size),
          regular: isRegularTarFile(entry),
        });
      }

      const maximumBytes = AUTHORITY_LIMITS.get(name);
      if (maximumBytes && !authorityReads.has(name)) {
        authorityReads.set(name, readBoundedEntry(entry, maximumBytes));
      }
    },
  });

  return { entries, duplicates, authorityReads };
}

async function readRequiredAuthority(context, archivePath, label) {
  const entry = context.entries.get(archivePath);
  if (!entry) throw new Error(`${label} is missing`);
  if (context.duplicates.has(archivePath)) {
    throw new Error(`${label} is duplicated`);
  }
  if (
    !entry.regular ||
    !Number.isSafeInteger(entry.bytes) ||
    entry.bytes <= 0
  ) {
    throw new Error(`${label} is not a non-empty regular file`);
  }
  const maximumBytes = AUTHORITY_LIMITS.get(archivePath);
  if (!maximumBytes || entry.bytes > maximumBytes) {
    throw new Error(`${label} exceeds the release size limit`);
  }
  const read = context.authorityReads.get(archivePath);
  if (!read) throw new Error(`${label} could not be read`);
  const contents = await read;
  if (contents.length !== entry.bytes) {
    throw new Error(`${label} size changed while reading`);
  }
  return contents;
}

function parseJsonObject(contents, label) {
  let value;
  try {
    value = JSON.parse(contents.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not a JSON object`);
  }
  return value;
}

async function inspectWebPanel(context) {
  const indexBytes = await readRequiredAuthority(
    context,
    WEB_PANEL_INDEX,
    "bundled Web Panel index.html",
  );
  const indexEntry = context.entries.get(WEB_PANEL_INDEX);

  const references = referencedWebPanelAssets(indexBytes.toString("utf8"));
  const uniqueReferences = new Map();
  let hasJavaScript = false;
  let hasStylesheet = false;
  for (const reference of references) {
    uniqueReferences.set(reference.archivePath, reference);
    if (reference.script && /\.(?:m?js)$/iu.test(reference.archivePath)) {
      hasJavaScript = true;
    }
    if (reference.stylesheet && /\.css$/iu.test(reference.archivePath)) {
      hasStylesheet = true;
    }
  }
  if (!hasJavaScript) {
    throw new Error(
      "bundled Web Panel index.html has no local JavaScript bundle",
    );
  }
  if (!hasStylesheet) {
    throw new Error(
      "bundled Web Panel index.html has no local CSS stylesheet bundle",
    );
  }

  const assets = [];
  for (const archivePath of [...uniqueReferences.keys()].sort()) {
    const entry = context.entries.get(archivePath);
    if (!entry || context.duplicates.has(archivePath)) {
      throw new Error(`bundled Web Panel asset is missing: ${archivePath}`);
    }
    if (
      !entry.regular ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0
    ) {
      throw new Error(
        `bundled Web Panel asset is not a non-empty file: ${archivePath}`,
      );
    }
    assets.push({ path: archivePath, bytes: entry.bytes });
  }

  return {
    index: WEB_PANEL_INDEX,
    indexBytes: indexEntry.bytes,
    indexSha256: hashBytes(indexBytes),
    assets,
  };
}

/**
 * Inspect identity and Web Panel authorities directly from the immutable npm
 * archive. Nothing is extracted to the filesystem.
 */
export async function inspectNpmReleaseTarball(tarball, expected = {}) {
  const context = await scanNpmTarball(tarball);
  const packageBytes = await readRequiredAuthority(
    context,
    PACKAGE_JSON,
    "packaged package.json",
  );
  const changelogBytes = await readRequiredAuthority(
    context,
    CHANGELOG_JSON,
    "packaged changelog.json",
  );
  const packageJson = parseJsonObject(packageBytes, "packaged package.json");
  const changelog = parseJsonObject(changelogBytes, "packaged changelog.json");
  const packageName = expected.packageName || "chainlesschain";
  if (packageJson.name !== packageName) {
    throw new Error(
      `packaged package.json name mismatch: expected ${packageName}, got ${packageJson.name}`,
    );
  }
  if (typeof packageJson.version !== "string" || !packageJson.version) {
    throw new Error("packaged package.json version is missing");
  }
  const version = expected.version || packageJson.version;
  if (packageJson.version !== version) {
    throw new Error(
      `packaged package.json version mismatch: expected ${version}, got ${packageJson.version}`,
    );
  }
  const changelogVersion = changelog.releases?.[0]?.cliVersion;
  if (changelogVersion !== version) {
    throw new Error(
      `packaged changelog.json version mismatch: expected ${version}, got ${changelogVersion}`,
    );
  }

  return {
    releaseIdentity: {
      packageJson: {
        path: PACKAGE_JSON,
        bytes: packageBytes.length,
        sha256: hashBytes(packageBytes),
        name: packageJson.name,
        version: packageJson.version,
      },
      changelog: {
        path: CHANGELOG_JSON,
        bytes: changelogBytes.length,
        sha256: hashBytes(changelogBytes),
        cliVersion: changelogVersion,
      },
    },
    webPanel: await inspectWebPanel(context),
  };
}

export async function inspectNpmPackageWebPanel(tarball, expected = {}) {
  return (await inspectNpmReleaseTarball(tarball, expected)).webPanel;
}

export async function createReleaseArtifactManifest(options) {
  const tarball = path.resolve(options.tarball);
  if (!fs.statSync(tarball).isFile()) throw new Error(`not a file: ${tarball}`);
  const packageName = options.packageName || "chainlesschain";
  if (!options.version) throw new Error("version is required");
  if (!options.commit) throw new Error("commit is required");
  const inspected = await inspectNpmReleaseTarball(tarball, {
    packageName,
    version: options.version,
  });
  const manifest = {
    schema: 2,
    package: packageName,
    version: options.version,
    commit: options.commit,
    workflowRun: options.workflowRun || null,
    artifact: path.basename(tarball),
    bytes: fs.statSync(tarball).size,
    sha256: hashFile(tarball, "sha256"),
    sha512: hashFile(tarball, "sha512"),
    createdAt: new Date().toISOString(),
    provenance: "npm --provenance",
    releaseIdentity: inspected.releaseIdentity,
    webPanel: inspected.webPanel,
  };
  return manifest;
}

export async function verifyReleaseArtifact(tarball, manifest, expected = {}) {
  const file = path.resolve(tarball);
  const failures = [];
  if (manifest?.schema !== 2) failures.push("manifest schema");
  if (manifest?.package !== (expected.packageName || "chainlesschain")) {
    failures.push("package name");
  }
  if (typeof manifest?.version !== "string" || !manifest.version) {
    failures.push("version");
  } else if (expected.version && manifest.version !== expected.version) {
    failures.push("version");
  }
  if (expected.commit && manifest?.commit !== expected.commit) {
    failures.push("commit");
  }
  if (manifest?.provenance !== "npm --provenance") {
    failures.push("provenance contract");
  }
  const bytes = fs.statSync(file).size;
  if (path.basename(file) !== manifest.artifact) failures.push("artifact name");
  if (bytes !== manifest.bytes) failures.push("byte length");
  if (hashFile(file, "sha256") !== manifest.sha256) failures.push("sha256");
  if (hashFile(file, "sha512") !== manifest.sha512) failures.push("sha512");
  if (failures.length > 0) {
    throw new Error(
      `release artifact verification failed: ${failures.join(", ")}`,
    );
  }

  const inspected = await inspectNpmReleaseTarball(file, {
    packageName: expected.packageName || "chainlesschain",
    version: expected.version || manifest.version,
  });
  if (
    JSON.stringify(inspected.releaseIdentity) !==
    JSON.stringify(manifest.releaseIdentity)
  ) {
    throw new Error(
      "release artifact verification failed: release identity attestation",
    );
  }
  if (
    JSON.stringify(inspected.webPanel) !== JSON.stringify(manifest.webPanel)
  ) {
    throw new Error(
      "release artifact verification failed: web panel attestation",
    );
  }
  return true;
}

function writeManifest(output, manifest) {
  fs.writeFileSync(
    path.resolve(output),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function main() {
  const [command, tarball, manifestPath] = process.argv.slice(2);
  if (!command || !tarball || !manifestPath) {
    throw new Error(
      "usage: npm-release-artifact.mjs create|verify <tarball> <manifest.json>",
    );
  }
  if (command === "create") {
    const manifest = await createReleaseArtifactManifest({
      tarball,
      packageName: process.env.CC_RELEASE_PACKAGE || "chainlesschain",
      version: process.env.CC_RELEASE_VERSION,
      commit: process.env.GITHUB_SHA || process.env.CC_RELEASE_COMMIT,
      workflowRun:
        process.env.GITHUB_SERVER_URL &&
        process.env.GITHUB_REPOSITORY &&
        process.env.GITHUB_RUN_ID
          ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : null,
    });
    writeManifest(manifestPath, manifest);
    process.stdout.write(`${manifest.sha256}  ${manifest.artifact}\n`);
    return;
  }
  if (command === "verify") {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(manifestPath), "utf8"),
    );
    await verifyReleaseArtifact(tarball, manifest, {
      packageName: process.env.CC_RELEASE_PACKAGE || "chainlesschain",
      version: process.env.CC_RELEASE_VERSION || null,
      commit: process.env.GITHUB_SHA || process.env.CC_RELEASE_COMMIT || null,
    });
    process.stdout.write(`verified ${manifest.sha256}  ${manifest.artifact}\n`);
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`npm release artifact error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
