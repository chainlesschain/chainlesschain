#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  BROWSER_EVIDENCE_SCHEMA,
  CLAUDE_INCREMENT_AUDIT_FRAGMENT_SCHEMA,
  browserEvidenceDigest,
  canonicalBrowserEvidenceJson,
  verifyBrowserEvidenceEnvelope,
} from "../src/lib/browser-evidence.js";
import { scanSecrets } from "../src/lib/secret-scan.js";

const REQUIRED_OS = Object.freeze(["linux", "macos", "windows"]);
const EXACT_SHA_RE = /^[a-f0-9]{40}$/u;
const KNOWN_JOURNEY_SECRETS = Object.freeze([
  "opaque-login-password",
  "opaque-network-ticket",
  "opaque-upload-secret",
  "abcdefghijklmnop",
]);
const EXPECTED_PRODUCER_PATHS = Object.freeze([
  ".github/workflows/ide-extensions.yml",
  "package-lock.json",
  "packages/cli/package.json",
  "packages/cli/src/lib/browser-evidence.js",
  "packages/cli/src/lib/chrome-connector.js",
  "packages/cli/src/lib/artifact-store.js",
  "packages/cli/src/lib/secret-scan.js",
  "packages/cli/src/lib/credential-guard.js",
  "packages/cli/src/lib/with-file-lock.js",
  "packages/cli/src/runtime/agent-core.js",
  "packages/cli/src/runtime/coding-agent-contract-shared.cjs",
  "packages/cli/scripts/ide-roadmap-browser-evidence.mjs",
  "packages/cli/scripts/verify-ide-roadmap-browser-evidence.mjs",
  "packages/cli/__tests__/unit/browser-evidence.test.js",
  "packages/cli/__tests__/unit/ide-roadmap-browser-evidence.test.js",
  "packages/cli/__tests__/unit/chrome-connector-actions.test.js",
  "packages/cli/__tests__/unit/browser-act-tool.test.js",
  "packages/cli/__tests__/unit/browser-state-tool.test.js",
  "packages/cli/__tests__/unit/chrome-connector.test.js",
  "packages/cli/__tests__/unit/artifact-store.test.js",
  "packages/cli/__tests__/unit/coding-agent-contract.test.js",
]);
const EXPECTED_TEST_IDS = Object.freeze([
  "browser-evidence.local-two-origin",
  "browser-evidence.origin-revision-enforcement",
  "browser-evidence.login-redaction",
  "browser-evidence.upload-download",
  "browser-evidence.console-network-failure",
  "browser-evidence.screenshot-diff",
  "browser-evidence.session-replay",
]);
const EXPECTED_THRESHOLDS = Object.freeze({
  origins: 2,
  crossOriginDenied: 1,
  revisionDenied: 1,
  uploadCount: 1,
  downloadCount: 1,
  consoleErrorsMin: 1,
  networkErrorsMin: 1,
  screenshotDiffs: 1,
  replayCount: 1,
  loginFieldRedactions: 1,
  queryValueRedactions: 1,
  secretScanHits: 0,
});
const EXPECTED_ACTIONS = Object.freeze([
  "screenshot",
  "upload",
  "waitForSelector",
  "click",
  "waitForSelector",
  "click",
  "screenshot",
  "download",
  "navigate",
  "assertText",
  "navigate",
  "waitForSelector",
  "assertText",
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`invalid aggregate argument near ${key || "<end>"}`);
    }
    options[key.slice(2)] = value;
    index += 1;
  }
  for (const key of [
    "input-dir",
    "head-sha",
    "output",
    "run-id",
    "run-attempt",
    "workflow-ref",
  ]) {
    if (!options[key]) throw new Error(`--${key} is required`);
  }
  return options;
}

function repositoryRoot() {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
}

function regularFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(root);
  return files.sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function gitBlobDigest(root, headSha, sourcePath) {
  if (
    !sourcePath ||
    sourcePath.includes("\\") ||
    path.posix.isAbsolute(sourcePath) ||
    sourcePath.split("/").includes("..")
  ) {
    throw new Error(
      `producer digest path is not repository-relative: ${sourcePath}`,
    );
  }
  const bytes = execFileSync(
    "git",
    ["cat-file", "blob", `${headSha}:${sourcePath}`],
    {
      cwd: root,
      encoding: null,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return browserEvidenceDigest(bytes);
}

function assertExactHeadSources(root, headSha) {
  const checkedOut = String(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }),
  )
    .trim()
    .toLowerCase();
  if (checkedOut !== headSha) {
    throw new Error(
      `browser evidence aggregate head mismatch: checkout=${checkedOut} requested=${headSha}`,
    );
  }
  for (const sourcePath of EXPECTED_PRODUCER_PATHS) {
    const workingDigest = browserEvidenceDigest(
      fs.readFileSync(path.join(root, ...sourcePath.split("/"))),
    );
    if (workingDigest !== gitBlobDigest(root, headSha, sourcePath)) {
      throw new Error(
        `browser evidence aggregate source differs from exact head: ${sourcePath}`,
      );
    }
  }
}

function artifactPath(producerDir, relativePath) {
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    relativePath.split("/").some((segment) => ["", ".", ".."].includes(segment))
  ) {
    throw new Error(
      `browser evidence path is not artifact-relative: ${relativePath}`,
    );
  }
  const resolved = path.resolve(producerDir, ...relativePath.split("/"));
  const prefix = `${path.resolve(producerDir)}${path.sep}`;
  if (!resolved.startsWith(prefix)) {
    throw new Error(`browser evidence path escapes producer: ${relativePath}`);
  }
  return resolved;
}

function assertMeasurements(fragment) {
  const measurements = fragment.measurements || {};
  const exact = {
    origins: 2,
    crossOriginDenied: 1,
    revisionDenied: 1,
    crossOriginAllowed: 1,
    uploadCount: 1,
    downloadCount: 1,
    screenshotCount: 2,
    screenshotDiffs: 1,
    replayCount: 1,
    managedArtifactCount: 5,
    loginFieldRedactions: 1,
    queryValueRedactions: 1,
    secretScanHits: 0,
  };
  for (const [key, expected] of Object.entries(exact)) {
    if (measurements[key] !== expected) {
      throw new Error(
        `${fragment.os} browser evidence measurement ${key}=${measurements[key]} expected ${expected}`,
      );
    }
  }
  for (const key of ["consoleErrors", "networkErrors"]) {
    if (!(Number(measurements[key]) >= 1)) {
      throw new Error(`${fragment.os} browser evidence ${key} is missing`);
    }
  }
  if (measurements.domTruncated !== true) {
    throw new Error(
      `${fragment.os} browser evidence did not prove DOM truncation`,
    );
  }
}

function scanFiles(files) {
  let hits = 0;
  for (const filePath of files) {
    const bytes = fs.readFileSync(filePath);
    if (bytes.length > 5 * 1024 * 1024) {
      throw new Error(`browser evidence file exceeds 5 MiB: ${filePath}`);
    }
    const text = bytes.toString("utf8");
    hits += scanSecrets(text).length;
    for (const secret of KNOWN_JOURNEY_SECRETS) {
      if (text.includes(secret)) hits += 1;
    }
  }
  return hits;
}

export function verifyBrowserEvidenceAggregate(options) {
  const root = repositoryRoot();
  const headSha = String(options["head-sha"] || "").toLowerCase();
  const trustedRunId = String(options["run-id"] || "");
  const trustedRunAttempt = String(options["run-attempt"] || "");
  const trustedWorkflowRef = String(options["workflow-ref"] || "");
  if (!EXACT_SHA_RE.test(headSha)) {
    throw new Error("browser evidence aggregate requires an exact head SHA");
  }
  if (
    !/^[1-9][0-9]*$/u.test(trustedRunId) ||
    !/^[1-9][0-9]*$/u.test(trustedRunAttempt)
  ) {
    throw new Error("browser evidence aggregate run authority is invalid");
  }
  if (
    !/^[^/\s]+\/[^/\s]+\/\.github\/workflows\/ide-extensions\.yml@(?:refs\/[^\s]+|[a-f0-9]{40})$/u.test(
      trustedWorkflowRef,
    )
  ) {
    throw new Error("browser evidence aggregate workflow authority is invalid");
  }
  assertExactHeadSources(root, headSha);
  const inputDir = path.resolve(root, options["input-dir"]);
  const files = regularFiles(inputDir);
  const fragmentFiles = files.filter(
    (filePath) =>
      path.basename(filePath) === "claude-code-increment-audit-fragment.json",
  );
  if (fragmentFiles.length !== REQUIRED_OS.length) {
    throw new Error(
      `browser evidence aggregate requires ${REQUIRED_OS.length} fragments, found ${fragmentFiles.length}`,
    );
  }

  const fragments = fragmentFiles.map((filePath) => ({
    filePath,
    fragment: readJson(filePath),
  }));
  const observedOs = fragments.map(({ fragment }) => fragment.os).sort();
  if (
    canonicalBrowserEvidenceJson(observedOs) !==
    canonicalBrowserEvidenceJson(REQUIRED_OS)
  ) {
    throw new Error(
      `browser evidence OS matrix is incomplete: ${observedOs.join(",")}`,
    );
  }
  const artifactNames = new Set();
  const runIds = new Set();
  const runAttempts = new Set();
  const baseShas = new Set();
  const diffDigests = new Set();
  const fragmentDigests = {};
  const envelopeDigests = {};
  for (const { filePath, fragment } of fragments) {
    if (fragment.schema !== CLAUDE_INCREMENT_AUDIT_FRAGMENT_SCHEMA) {
      throw new Error(`${fragment.os} audit fragment schema mismatch`);
    }
    if (
      fragment.commitmentId !== "BROWSER-EVIDENCE" ||
      fragment.headSha !== headSha ||
      fragment.disposition !== "required" ||
      fragment.outcome !== "passed"
    ) {
      throw new Error(
        `${fragment.os} browser evidence fragment is not release-ready`,
      );
    }
    if (fragment.profileVersion !== "browser-evidence-local-two-origin-v1") {
      throw new Error(
        `${fragment.os} browser evidence profile version mismatch`,
      );
    }
    if (
      fragment.runtime?.name !== "node" ||
      fragment.runtime?.version !== "22.12.0" ||
      !["x64", "arm64"].includes(fragment.runtime?.arch)
    ) {
      throw new Error(`${fragment.os} browser evidence runtime is invalid`);
    }
    if (
      canonicalBrowserEvidenceJson(fragment.thresholds) !==
      canonicalBrowserEvidenceJson(EXPECTED_THRESHOLDS)
    ) {
      throw new Error(`${fragment.os} browser evidence thresholds mismatch`);
    }
    if (
      canonicalBrowserEvidenceJson(fragment.testIds) !==
      canonicalBrowserEvidenceJson(EXPECTED_TEST_IDS)
    ) {
      throw new Error(`${fragment.os} browser evidence test IDs mismatch`);
    }
    assertMeasurements(fragment);
    if (artifactNames.has(fragment.source?.artifactName)) {
      throw new Error(
        "browser evidence producer artifact names are not unique",
      );
    }
    artifactNames.add(fragment.source?.artifactName);
    const producerPaths = Object.keys(fragment.producerDigests || {}).sort();
    if (
      canonicalBrowserEvidenceJson(producerPaths) !==
      canonicalBrowserEvidenceJson([...EXPECTED_PRODUCER_PATHS].sort())
    ) {
      throw new Error(`${fragment.os} producer digest path set mismatch`);
    }
    for (const [sourcePath, expectedDigest] of Object.entries(
      fragment.producerDigests,
    )) {
      const actualDigest = gitBlobDigest(root, headSha, sourcePath);
      if (actualDigest !== expectedDigest) {
        throw new Error(
          `${fragment.os} producer digest mismatch for ${sourcePath}`,
        );
      }
    }
    const producerDir = path.dirname(filePath);
    const artifactNamePattern = new RegExp(
      `^browser-evidence-${fragment.os}-([1-9][0-9]*)$`,
      "u",
    );
    const artifactNameMatch = artifactNamePattern.exec(
      fragment.source?.artifactName || "",
    );
    if (
      fragment.source?.workflowId !== trustedWorkflowRef ||
      !fragment.source?.runId ||
      fragment.source?.jobId !== `browser-evidence-producer-${fragment.os}` ||
      path.basename(producerDir) !== fragment.source?.artifactName ||
      !artifactNameMatch
    ) {
      throw new Error(`${fragment.os} producer source authority mismatch`);
    }
    runIds.add(fragment.source.runId);
    runAttempts.add(artifactNameMatch[1]);
    const summary = readJson(
      path.join(producerDir, "browser-evidence-journey-summary.json"),
    );
    if (
      summary.outcome !== "passed" ||
      summary.headSha !== headSha ||
      summary.os !== fragment.os
    ) {
      throw new Error(`${fragment.os} journey summary authority mismatch`);
    }
    if (
      canonicalBrowserEvidenceJson(summary.measurements) !==
        canonicalBrowserEvidenceJson(fragment.measurements) ||
      canonicalBrowserEvidenceJson(summary.tests) !==
        canonicalBrowserEvidenceJson(fragment.testIds)
    ) {
      throw new Error(`${fragment.os} summary/fragment result mismatch`);
    }
    const attachments = Array.isArray(summary.attachments)
      ? summary.attachments
      : [];
    if (
      attachments.length !== 3 ||
      attachments.filter((row) => row.evidenceKind === "screenshot").length !==
        2 ||
      attachments.filter((row) => row.evidenceKind === "download").length !== 1
    ) {
      throw new Error(`${fragment.os} browser evidence attachments mismatch`);
    }
    const expectedEvidencePaths = [
      "browser-evidence-envelope.json",
      "browser-evidence-replay-envelope.json",
      ...attachments.map((row) => row.path),
    ].sort();
    if (
      canonicalBrowserEvidenceJson(
        Object.keys(summary.evidenceDigests || {}).sort(),
      ) !== canonicalBrowserEvidenceJson(expectedEvidencePaths)
    ) {
      throw new Error(`${fragment.os} evidence digest path set mismatch`);
    }
    for (const [relativePath, expectedDigest] of Object.entries(
      summary.evidenceDigests || {},
    )) {
      const evidencePath = artifactPath(producerDir, relativePath);
      const actualDigest = browserEvidenceDigest(fs.readFileSync(evidencePath));
      if (actualDigest !== expectedDigest) {
        throw new Error(
          `${fragment.os} artifact evidence digest mismatch for ${relativePath}`,
        );
      }
    }
    const envelope = readJson(
      path.join(producerDir, "browser-evidence-envelope.json"),
    );
    const replayEnvelope = readJson(
      path.join(producerDir, "browser-evidence-replay-envelope.json"),
    );
    verifyBrowserEvidenceEnvelope(envelope);
    verifyBrowserEvidenceEnvelope(replayEnvelope);
    if (
      envelope.schema !== BROWSER_EVIDENCE_SCHEMA ||
      replayEnvelope.replay.sourceEnvelopeDigest !== envelope.envelopeDigest
    ) {
      throw new Error(`${fragment.os} replay source binding mismatch`);
    }
    if (
      summary.envelopeDigest !== envelope.envelopeDigest ||
      summary.replayEnvelopeDigest !== replayEnvelope.envelopeDigest ||
      envelope.binding.diff.headSha !== headSha ||
      canonicalBrowserEvidenceJson(envelope.binding) !==
        canonicalBrowserEvidenceJson(replayEnvelope.binding) ||
      canonicalBrowserEvidenceJson(
        envelope.actions.map((action) => action.type),
      ) !== canonicalBrowserEvidenceJson(EXPECTED_ACTIONS) ||
      envelope.actions.some((action) => action.outcome?.ok !== true) ||
      replayEnvelope.actions.length !== 1 ||
      replayEnvelope.actions[0].type !== "assertText" ||
      replayEnvelope.actions[0].outcome?.ok !== true ||
      replayEnvelope.actions[0].intentDigest !==
        envelope.actions.at(-1)?.intentDigest ||
      envelope.binding.diff.baseSha !== summary.baseSha ||
      envelope.observations.console.count !==
        fragment.measurements.consoleErrors ||
      envelope.observations.console.captureAvailable !== true ||
      envelope.observations.network.count !==
        fragment.measurements.networkErrors ||
      envelope.observations.network.captureAvailable !== true ||
      envelope.domSnapshot.truncated !== true ||
      envelope.domSnapshot.captureSucceeded !== true ||
      envelope.domSnapshot.redaction.applied !== true ||
      envelope.domSnapshot.redaction.sensitiveFieldValues !== 1 ||
      envelope.observations.page.queryValueRedactions !== 1 ||
      envelope.observations.page.credentialMaterialRetained !== false ||
      envelope.replay.sourceEnvelopeDigest !== null ||
      envelope.replay.sideEffectBoundary !==
        "recorded-not-authorized-for-replay" ||
      envelope.replay.credentialBoundary !== "payloads-not-retained" ||
      replayEnvelope.replay.sideEffectBoundary !== "deny" ||
      replayEnvelope.replay.credentialBoundary !== "deny" ||
      !envelope.originPermissions.some(
        (permission) => permission.crossOrigin === true,
      ) ||
      new Set(envelope.originPermissions.map((permission) => permission.origin))
        .size !== 2 ||
      new Set(envelope.screenshots.map((row) => row.digest)).size !== 2
    ) {
      throw new Error(`${fragment.os} canonical envelope journey mismatch`);
    }
    baseShas.add(envelope.binding.diff.baseSha);
    diffDigests.add(envelope.binding.diff.digest);
    const managedEvidenceArtifact = summary.managedEvidenceArtifact;
    if (
      managedEvidenceArtifact?.sessionId !== envelope.binding.session.id ||
      managedEvidenceArtifact?.immutable !== true ||
      managedEvidenceArtifact?.recordDigest !== envelope.envelopeDigest ||
      `sha256:${managedEvidenceArtifact?.sha256}` !==
        summary.evidenceDigests["browser-evidence-envelope.json"] ||
      managedEvidenceArtifact?.lineage?.sessionRevision !==
        envelope.binding.session.revision ||
      managedEvidenceArtifact?.lineage?.diffDigest !==
        envelope.binding.diff.digest ||
      managedEvidenceArtifact?.lineage?.testRunId !==
        envelope.binding.testRun.id
    ) {
      throw new Error(`${fragment.os} managed evidence authority mismatch`);
    }
    const screenshotDigests = attachments
      .filter((row) => row.evidenceKind === "screenshot")
      .map((row) => row.digest)
      .sort();
    const downloadDigests = attachments
      .filter((row) => row.evidenceKind === "download")
      .map((row) => row.digest)
      .sort();
    if (
      canonicalBrowserEvidenceJson(screenshotDigests) !==
        canonicalBrowserEvidenceJson(
          envelope.screenshots.map((row) => row.digest).sort(),
        ) ||
      canonicalBrowserEvidenceJson(downloadDigests) !==
        canonicalBrowserEvidenceJson(
          envelope.downloads.map((row) => row.digest).sort(),
        )
    ) {
      throw new Error(`${fragment.os} attachment/envelope digest mismatch`);
    }
    for (const attachment of attachments) {
      if (
        summary.evidenceDigests[attachment.path] !== attachment.digest ||
        attachment.artifact?.sessionId !== envelope.binding.session.id ||
        `sha256:${attachment.artifact?.sha256}` !== attachment.digest ||
        attachment.artifact?.immutable !== false ||
        envelope.actions[attachment.actionIndex]?.type !==
          attachment.evidenceKind
      ) {
        throw new Error(`${fragment.os} managed attachment authority mismatch`);
      }
    }
    fragmentDigests[fragment.os] = browserEvidenceDigest(
      fs.readFileSync(filePath),
    );
    envelopeDigests[fragment.os] = {
      record: envelope.envelopeDigest,
      replay: replayEnvelope.envelopeDigest,
    };
  }

  if (
    runIds.size !== 1 ||
    runAttempts.size !== 1 ||
    baseShas.size !== 1 ||
    diffDigests.size !== 1
  ) {
    throw new Error(
      "browser evidence producers do not share one run/diff authority",
    );
  }
  if (!runIds.has(trustedRunId) || !runAttempts.has(trustedRunAttempt)) {
    throw new Error("browser evidence producer run authority mismatch");
  }

  const secretScanHits = scanFiles(files);
  if (secretScanHits !== 0) {
    throw new Error(
      `browser evidence aggregate secret scan found ${secretScanHits} hit(s)`,
    );
  }
  const aggregate = {
    schema: "chainlesschain.browser-evidence-aggregate.v1",
    outcome: "passed",
    commitmentId: "BROWSER-EVIDENCE",
    headSha,
    os: REQUIRED_OS,
    fragmentDigests,
    envelopeDigests,
    artifactNames: [...artifactNames].sort(),
    source: { runId: trustedRunId, runAttempt: trustedRunAttempt },
    secretScan: { hits: 0, files: files.length },
  };
  const output = path.resolve(root, options.output);
  const aggregateJson = `${canonicalBrowserEvidenceJson(aggregate)}\n`;
  if (
    scanSecrets(aggregateJson).length > 0 ||
    KNOWN_JOURNEY_SECRETS.some((secret) => aggregateJson.includes(secret))
  ) {
    throw new Error("browser evidence aggregate contains secret material");
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, aggregateJson, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
    flush: true,
  });
  return aggregate;
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));
if (isDirect) {
  try {
    const aggregate = verifyBrowserEvidenceAggregate(
      parseArgs(process.argv.slice(2)),
    );
    process.stdout.write(
      `${JSON.stringify({
        outcome: aggregate.outcome,
        headSha: aggregate.headSha,
        os: aggregate.os,
        secretScanHits: aggregate.secretScan.hits,
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

export { parseArgs, regularFiles };
