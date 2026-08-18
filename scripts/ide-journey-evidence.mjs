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
  lstatSync,
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
export const IDE_JOURNEY_EVIDENCE_VERSION = 2;
export const IDE_JOURNEY_MANIFEST_VERSION = "1.9.21";

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
const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_WORKFLOW_REF =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/[A-Za-z0-9_./-]+\.ya?ml@\S+$/;
const GITHUB_RUN_NUMBER = /^[1-9]\d*$/;
const GITHUB_JOB = /^[A-Za-z0-9_-]+$/;
const STRICT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const CREDENTIAL_TOKEN_PATTERN =
  /\b(?:(?:ovsxat_|github_pat_|gh[pousr]_|npm_)[A-Za-z0-9._-]{8,}|glpat-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|sk-[A-Za-z0-9._-]{8,}|AKIA[0-9A-Z]{16})\b/g;

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

function copyBoundArtifact({
  sourcePath,
  artifactDir,
  relativeDirectory,
  outputName,
  kind,
  name,
}) {
  const source = path.resolve(sourcePath);
  const sourceStats = lstatSync(source, { throwIfNoEntry: false });
  if (!sourceStats?.isFile() || sourceStats.isSymbolicLink()) {
    throw new Error(
      `bound artifact must be a regular non-symlink file: ${source}`,
    );
  }
  const directory = path.join(artifactDir, relativeDirectory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, outputName);
  copyFileSync(source, destination, fsConstants.COPYFILE_EXCL);
  chmodSync(destination, 0o600);
  return {
    kind,
    ...(name ? { name } : {}),
    path: path.posix.join(relativeDirectory, outputName),
    sha256: sha256File(destination),
    bytes: statSync(destination).size,
  };
}

function normalizeGithubActionsProvenance(options, incidents) {
  const env = options.env || process.env;
  const raw = options.ciProvenance || {};
  const provenance = {
    provider: "github-actions",
    repository: String(raw.repository || env.GITHUB_REPOSITORY || ""),
    workflowRef: String(raw.workflowRef || env.GITHUB_WORKFLOW_REF || ""),
    workflowSha: String(
      raw.workflowSha || env.GITHUB_WORKFLOW_SHA || "",
    ).toLowerCase(),
    runId: String(raw.runId || env.GITHUB_RUN_ID || ""),
    runAttempt: String(raw.runAttempt || env.GITHUB_RUN_ATTEMPT || ""),
    job: String(raw.job || env.GITHUB_JOB || ""),
    artifactName: String(raw.artifactName || ""),
    eventName: String(raw.eventName || env.GITHUB_EVENT_NAME || ""),
  };
  const valid =
    GITHUB_REPOSITORY.test(provenance.repository) &&
    GITHUB_WORKFLOW_REF.test(provenance.workflowRef) &&
    EXACT_COMMIT.test(provenance.workflowSha) &&
    GITHUB_RUN_NUMBER.test(provenance.runId) &&
    GITHUB_RUN_NUMBER.test(provenance.runAttempt) &&
    GITHUB_JOB.test(provenance.job) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(provenance.artifactName) &&
    /^[A-Za-z0-9_]+$/.test(provenance.eventName);
  if (!valid) incidents.push({ code: "trusted-ci-provenance-invalid" });
  return valid ? provenance : null;
}

export function redactDiagnosticText(value) {
  return String(value)
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(
      /((?:token|api[_-]?key|secret|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,
      "$1[REDACTED]",
    )
    .replace(CREDENTIAL_TOKEN_PATTERN, "[REDACTED_CREDENTIAL]")
    .replace(
      /([?&](?:access_token|api_key|client_secret|refresh_token|token)=)[^&#\s]+/gi,
      "$1[REDACTED]",
    );
}

function safeSegment(value, fallback = "artifact") {
  const segment = String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 160);
  return segment || fallback;
}

function safeExtension(value) {
  const extension = String(value || "").toLowerCase();
  return /^\.[a-z0-9]{1,16}$/u.test(extension) ? extension : "";
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
  return requiredText(value) && STRICT_SEMVER.test(value);
}

export function isStrictSemver(value) {
  return exactPackageVersion(value);
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

function normalizeRemoteWorkspaceEvidence(value, incidents) {
  if (value === undefined) return null;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (workspaceFolder) =>
        !requiredText(workspaceFolder) ||
        !workspaceFolder.startsWith("/") ||
        workspaceFolder.includes("\\") ||
        path.posix.normalize(workspaceFolder) !== workspaceFolder,
    )
  ) {
    incidents.push({ code: "workspace-coordinate-invalid" });
    return null;
  }
  if (new Set(value).size !== value.length) {
    incidents.push({ code: "workspace-coordinate-invalid" });
    return null;
  }
  return {
    layout: value.length > 1 ? "multi-root" : "single-root",
    rootCount: value.length,
    orderedRootsDigest: sha256Buffer(canonicalJson(value)),
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
  const provenance = options.requireTrustedProvenance
    ? normalizeGithubActionsProvenance(options, incidents)
    : null;
  const workspace = options.remoteWorkspaceFolders
    ? normalizeRemoteWorkspaceEvidence(
        options.remoteWorkspaceFolders,
        incidents,
      )
    : normalizeWorkspaceEvidence(options.workspaceFolders, incidents);

  for (const [artifactIndex, rawPath] of (
    options.artifactPaths || []
  ).entries()) {
    const filePath = path.resolve(rawPath);
    try {
      if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
        incidents.push({ code: "required-artifact-missing" });
        continue;
      }
      artifacts.push(
        copyBoundArtifact({
          sourcePath: filePath,
          artifactDir,
          relativeDirectory: "release-artifacts",
          outputName: `${String(artifactIndex + 1).padStart(3, "0")}-${safeSegment(path.basename(filePath))}`,
          kind: "release-artifact",
          name: path.basename(filePath),
        }),
      );
    } catch (error) {
      incidents.push({
        code: "required-artifact-unreadable",
        messageDigest: sha256Buffer(String(error?.message || error)),
      });
    }
  }

  const roadmapArtifacts = {};
  for (const [artifactIndex, [name, rawPath]] of Object.entries(
    options.roadmapArtifactPaths || {},
  ).entries()) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      incidents.push({ code: "roadmap-artifact-name-invalid" });
      continue;
    }
    try {
      const extension = path.extname(String(rawPath)).toLowerCase();
      const record = copyBoundArtifact({
        sourcePath: rawPath,
        artifactDir,
        relativeDirectory: "roadmap-artifacts",
        outputName: `${String(artifactIndex + 1).padStart(3, "0")}-${name}${safeExtension(extension)}`,
        kind: "roadmap-artifact",
        name,
      });
      artifacts.push(record);
      roadmapArtifacts[name] = {
        path: record.path,
        sha256: record.sha256,
        bytes: record.bytes,
      };
    } catch (error) {
      incidents.push({
        code: "roadmap-artifact-unreadable",
        name,
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
  if (
    options.extensionVersion !== undefined &&
    !exactPackageVersion(options.extensionVersion)
  ) {
    incidents.push({ code: "extension-version-invalid" });
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
    "extension-version-invalid",
    "evidence-artifacts-missing",
    "host-diagnostics-missing",
    "workspace-coordinate-invalid",
    "trusted-ci-provenance-invalid",
    "roadmap-artifact-name-invalid",
    "roadmap-artifact-unreadable",
  ]);

  const result = normalizeResult(options.result);
  const evidenceComplete =
    Boolean(releaseCommit) &&
    exactHostVersion(options.hostVersion) &&
    exactPackageVersion(options.cliVersion) &&
    (options.extensionVersion === undefined ||
      exactPackageVersion(options.extensionVersion)) &&
    artifacts.length > 0 &&
    result !== "unknown" &&
    (!options.requireTrustedProvenance || Boolean(provenance)) &&
    !incidents.some((incident) => criticalIncidentCodes.has(incident.code));
  const artifactBundleDigest = sha256Buffer(
    canonicalJson(
      artifacts
        .filter((artifact) => artifact.path)
        .map(({ kind, name = null, path: artifactPath, sha256, bytes }) => ({
          kind,
          name,
          path: artifactPath,
          sha256,
          bytes,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    ),
  );
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
    ...(provenance ? { provenance } : {}),
    ...(Object.keys(roadmapArtifacts).length > 0 ? { roadmapArtifacts } : {}),
    ...(Array.isArray(options.dependencies)
      ? { dependencies: structuredClone(options.dependencies) }
      : {}),
    cliVersion: options.cliVersion || null,
    extensionVersion: options.extensionVersion || null,
    startedAt,
    finishedAt,
    result,
    evidenceComplete,
    artifactBundleDigest,
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
