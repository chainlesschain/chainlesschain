#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fsyncSync,
  chmodSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const IDE_JOURNEY_EVIDENCE_SCHEMA =
  "chainlesschain.ide-journey-evidence";
export const IDE_JOURNEY_EVIDENCE_VERSION = 1;
export const IDE_JOURNEY_MANIFEST_VERSION = "1.0.0";

const EXACT_COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const TEXT_EXTENSIONS = new Set([
  ".html",
  ".json",
  ".log",
  ".md",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const MAX_SOURCE_FILES = 100;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_BINARY_BYTES = 20 * 1024 * 1024;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256Buffer(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

export function redactDiagnosticText(value) {
  return String(value)
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(
      /((?:token|api[_-]?key|secret|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(?:ovsxat_|github_pat_|ghp_|sk-)[A-Za-z0-9._-]{8,}\b/g,
      "[REDACTED_CREDENTIAL]",
    )
    .replace(/([?&](?:access_token|api_key|token)=)[^&#\s]+/gi, "$1[REDACTED]");
}

function safeSegment(value, fallback = "artifact") {
  const segment = String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 160);
  return segment || fallback;
}

function boundedTail(filePath, maxBytes = MAX_TEXT_BYTES) {
  const size = statSync(filePath).size;
  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const descriptor = openSync(filePath, "r");
  try {
    if (length > 0) readSync(descriptor, buffer, 0, length, size - length);
  } finally {
    closeSync(descriptor);
  }
  return {
    buffer,
    truncated: size > length,
    originalBytes: size,
  };
}

function listSourceFiles(sourcePath, output, limit = MAX_SOURCE_FILES) {
  if (output.length >= limit || !existsSync(sourcePath)) return;
  const stats = statSync(sourcePath, { throwIfNoEntry: false });
  if (!stats) return;
  if (stats.isFile()) {
    output.push(sourcePath);
    return;
  }
  if (!stats.isDirectory()) return;
  for (const entry of readdirSync(sourcePath, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  )) {
    if (output.length >= limit) break;
    if (entry.isSymbolicLink()) continue;
    listSourceFiles(path.join(sourcePath, entry.name), output, limit);
  }
}

function sourceRelativePath(sourceRoot, filePath) {
  const rootStats = statSync(sourceRoot);
  const relative = rootStats.isFile()
    ? path.basename(filePath)
    : path.relative(sourceRoot, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.basename(filePath);
  }
  return relative;
}

/** Copy bounded, redacted host diagnostics into the evidence directory. */
export function collectIdeJourneyArtifacts(sourceRoots, artifactDir) {
  const diagnosticsDir = path.join(artifactDir, "diagnostics");
  mkdirSync(diagnosticsDir, { recursive: true, mode: 0o700 });
  const records = [];
  const incidents = [];
  let fileIndex = 0;

  for (const [sourceIndex, rawSource] of (sourceRoots || []).entries()) {
    const sourceRoot = path.resolve(rawSource);
    const files = [];
    try {
      listSourceFiles(sourceRoot, files);
    } catch (error) {
      incidents.push({
        code: "source-scan-failed",
        sourceIndex,
        messageDigest: sha256Buffer(String(error?.message || error)),
      });
      continue;
    }
    if (files.length === 0) {
      incidents.push({ code: "source-empty", sourceIndex });
      continue;
    }

    for (const filePath of files) {
      fileIndex += 1;
      const extension = path.extname(filePath).toLowerCase();
      const relative = sourceRelativePath(sourceRoot, filePath);
      const outputName = `${String(fileIndex).padStart(3, "0")}-${safeSegment(relative)}`;
      const outputPath = path.join(diagnosticsDir, outputName);
      try {
        const size = statSync(filePath).size;
        let truncated = false;
        let redacted = false;
        let sensitivity = "restricted-binary";
        if (TEXT_EXTENSIONS.has(extension)) {
          const tail = boundedTail(filePath);
          truncated = tail.truncated;
          const prefix = truncated
            ? `[truncated: retained final ${tail.buffer.length} of ${tail.originalBytes} bytes]\n`
            : "";
          const redactedText = redactDiagnosticText(
            `${prefix}${tail.buffer.toString("utf8")}`,
          );
          writeFileSync(outputPath, redactedText, {
            encoding: "utf8",
            mode: 0o600,
            flag: "wx",
          });
          redacted = true;
          sensitivity = "redacted-text";
        } else if (size <= MAX_BINARY_BYTES) {
          copyFileSync(filePath, outputPath, fsConstants.COPYFILE_EXCL);
          chmodSync(outputPath, 0o600);
        } else {
          incidents.push({
            code: "binary-artifact-too-large",
            sourceIndex,
            relativePath: relative,
            bytes: size,
          });
          continue;
        }
        records.push({
          kind: "host-diagnostic",
          path: path.posix.join("diagnostics", outputName),
          sha256: sha256File(outputPath),
          bytes: statSync(outputPath).size,
          truncated,
          redacted,
          sensitivity,
        });
      } catch (error) {
        incidents.push({
          code: "artifact-copy-failed",
          sourceIndex,
          relativePath: relative,
          messageDigest: sha256Buffer(String(error?.message || error)),
        });
      }
    }
  }

  return { records, incidents };
}

export function resolveReleaseCommit(options = {}) {
  const candidate = String(
    options.releaseCommit ||
      options.env?.GITHUB_SHA ||
      process.env.GITHUB_SHA ||
      "",
  ).toLowerCase();
  if (EXACT_COMMIT.test(candidate)) return candidate;
  try {
    const resolved = String(
      (options.execFileSync || execFileSync)("git", ["rev-parse", "HEAD"], {
        cwd: options.repoRoot || process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    )
      .trim()
      .toLowerCase();
    return EXACT_COMMIT.test(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function requiredText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function exactHostVersion(value) {
  return (
    requiredText(value) &&
    /\d/.test(value) &&
    !/^(?:stable|minimum|current|latest|insiders)$/i.test(value.trim())
  );
}

function exactPackageVersion(value) {
  return (
    requiredText(value) &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.trim())
  );
}

function normalizeResult(value) {
  const result = String(value || "").toLowerCase();
  if (["passed", "success", "succeeded"].includes(result)) return "passed";
  if (["failed", "failure", "cancelled", "canceled"].includes(result)) {
    return "failed";
  }
  return "unknown";
}

function normalizeWorkspaceEvidence(value, incidents) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0) {
    incidents.push({ code: "workspace-coordinate-invalid" });
    return null;
  }
  const roots = [];
  for (const workspaceFolder of value) {
    if (!requiredText(workspaceFolder)) {
      incidents.push({ code: "workspace-coordinate-invalid" });
      return null;
    }
    let resolved;
    try {
      resolved = realpathSync(workspaceFolder);
    } catch {
      incidents.push({ code: "workspace-coordinate-invalid" });
      return null;
    }
    roots.push(
      process.platform === "win32" ? resolved.toLowerCase() : resolved,
    );
  }
  if (new Set(roots).size !== roots.length) {
    incidents.push({ code: "workspace-coordinate-invalid" });
    return null;
  }
  return {
    layout: roots.length > 1 ? "multi-root" : "single-root",
    rootCount: roots.length,
    // Bind the ordered roots without publishing user workspace paths.
    orderedRootsDigest: sha256Buffer(canonicalJson(roots)),
  };
}

/** Build and atomically write one immutable, content-addressed evidence file. */
export function writeIdeJourneyEvidence(options = {}) {
  const artifactDir = path.resolve(options.artifactDir);
  if (existsSync(artifactDir) && readdirSync(artifactDir).length > 0) {
    const error = new Error(
      `evidence directory must be fresh and empty: ${artifactDir}`,
    );
    error.code = "EVIDENCE_DIRECTORY_NOT_EMPTY";
    throw error;
  }
  mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  const destination = path.join(artifactDir, "journey-evidence.json");
  const startedAt = options.startedAt || new Date().toISOString();
  const finishedAt = options.finishedAt || new Date().toISOString();
  const releaseCommit = resolveReleaseCommit(options);
  const captured = collectIdeJourneyArtifacts(
    options.sourceRoots || [],
    artifactDir,
  );
  const artifacts = [...captured.records];
  const incidents = [...captured.incidents];
  const workspace = normalizeWorkspaceEvidence(
    options.workspaceFolders,
    incidents,
  );

  for (const rawPath of options.artifactPaths || []) {
    const filePath = path.resolve(rawPath);
    try {
      if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
        incidents.push({ code: "required-artifact-missing" });
        continue;
      }
      artifacts.push({
        kind: "release-artifact",
        name: path.basename(filePath),
        sha256: sha256File(filePath),
        bytes: statSync(filePath).size,
      });
    } catch (error) {
      incidents.push({
        code: "required-artifact-unreadable",
        messageDigest: sha256Buffer(String(error?.message || error)),
      });
    }
  }

  if (!releaseCommit) incidents.push({ code: "exact-release-commit-missing" });
  if (!requiredText(options.hostVersion)) {
    incidents.push({ code: "host-version-missing" });
  } else if (!exactHostVersion(options.hostVersion)) {
    incidents.push({ code: "host-version-not-exact" });
  }
  if (!requiredText(options.cliVersion)) {
    incidents.push({ code: "cli-version-missing" });
  } else if (!exactPackageVersion(options.cliVersion)) {
    incidents.push({ code: "cli-version-invalid" });
  }
  if (artifacts.length === 0) {
    incidents.push({ code: "evidence-artifacts-missing" });
  }
  if (options.requireDiagnostics !== false && captured.records.length === 0) {
    incidents.push({ code: "host-diagnostics-missing" });
  }

  const criticalIncidentCodes = new Set([
    "source-scan-failed",
    "source-empty",
    "artifact-copy-failed",
    "required-artifact-missing",
    "required-artifact-unreadable",
    "exact-release-commit-missing",
    "host-version-missing",
    "host-version-not-exact",
    "cli-version-missing",
    "cli-version-invalid",
    "evidence-artifacts-missing",
    "host-diagnostics-missing",
    "workspace-coordinate-invalid",
  ]);

  const result = normalizeResult(options.result);
  const evidenceComplete =
    Boolean(releaseCommit) &&
    exactHostVersion(options.hostVersion) &&
    exactPackageVersion(options.cliVersion) &&
    artifacts.length > 0 &&
    result !== "unknown" &&
    !incidents.some((incident) => criticalIncidentCodes.has(incident.code));
  const core = {
    schema: IDE_JOURNEY_EVIDENCE_SCHEMA,
    schemaVersion: IDE_JOURNEY_EVIDENCE_VERSION,
    manifestVersion: options.manifestVersion || IDE_JOURNEY_MANIFEST_VERSION,
    journeyId: String(options.journeyId || "unknown"),
    required: options.required !== false,
    releaseCommit,
    host: {
      name: String(options.host || "unknown"),
      version: options.hostVersion || null,
      operatingSystem: options.operatingSystem || process.platform,
      architecture: options.architecture || process.arch,
      transport: options.transport || "local",
    },
    ...(workspace ? { workspace } : {}),
    cliVersion: options.cliVersion || null,
    extensionVersion: options.extensionVersion || null,
    startedAt,
    finishedAt,
    result,
    evidenceComplete,
    artifacts,
    incidents,
  };
  const evidence = {
    ...core,
    evidenceDigest: sha256Buffer(canonicalJson(core)),
  };
  const temporary = `${destination}.tmp-${process.pid}`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
    });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    // Hard-link publication is same-directory and refuses to replace existing
    // immutable evidence. Removing the temporary name leaves one durable inode.
    linkSync(temporary, destination);
    unlinkSync(temporary);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch {
      // Best-effort cleanup; the destination is never replaced.
    }
    throw error;
  }
  return { evidence, destination };
}

function parseCliArgs(argv) {
  const options = {
    sourceRoots: [],
    artifactPaths: [],
    required: true,
  };
  const valueOptions = new Map([
    ["--artifact-dir", "artifactDir"],
    ["--journey-id", "journeyId"],
    ["--host", "host"],
    ["--host-version", "hostVersion"],
    ["--cli-version", "cliVersion"],
    ["--extension-version", "extensionVersion"],
    ["--transport", "transport"],
    ["--result", "result"],
    ["--started-at", "startedAt"],
    ["--finished-at", "finishedAt"],
    ["--release-commit", "releaseCommit"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source" || argument === "--artifact") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      (argument === "--source"
        ? options.sourceRoots
        : options.artifactPaths
      ).push(value);
      index += 1;
    } else if (argument === "--advisory") {
      options.required = false;
    } else if (valueOptions.has(argument)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      options[valueOptions.get(argument)] = value;
      index += 1;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  if (!options.artifactDir) throw new Error("--artifact-dir is required");
  return options;
}

async function cli() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const { evidence, destination } = writeIdeJourneyEvidence({
      ...options,
      env: process.env,
    });
    process.stdout.write(`${JSON.stringify({ destination, ...evidence })}\n`);
    if (options.required && !evidence.evidenceComplete) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `CC_IDE_JOURNEY_EVIDENCE_FAILED: ${error?.message || error}\n`,
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) await cli();
