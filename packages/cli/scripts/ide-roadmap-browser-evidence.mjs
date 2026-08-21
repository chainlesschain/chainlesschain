#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  authorizeBrowserAction,
  browserEvidenceDigest,
  canonicalBrowserEvidenceJson,
  createClaudeIncrementAuditFragment,
  issueBrowserOriginGrant,
  verifyBrowserEvidenceEnvelope,
} from "../src/lib/browser-evidence.js";
import {
  discoverCdp,
  findChromeExecutable,
  performActions,
} from "../src/lib/chrome-connector.js";
import {
  ArtifactStore,
  publicArtifactMetadata,
} from "../src/lib/artifact-store.js";
import { scanSecrets } from "../src/lib/secret-scan.js";

const EXACT_SHA_RE = /^[a-f0-9]{40}$/u;
const POSITIVE_INTEGER_RE = /^[1-9][0-9]*$/u;
export const BROWSER_EVIDENCE_WORKFLOW_PATH =
  ".github/workflows/ide-extensions.yml";
export const BROWSER_EVIDENCE_WORKFLOW_PROVENANCE_SCHEMA =
  "chainlesschain.browser-evidence-workflow-provenance.v1";
export const BROWSER_EVIDENCE_JOURNEY_SUMMARY_SCHEMA =
  "chainlesschain.browser-evidence-journey-summary.v2";
export const BROWSER_EVIDENCE_PROFILE_VERSION =
  "browser-evidence-local-two-origin-v1";
export const BROWSER_EVIDENCE_PRODUCER_PATHS = Object.freeze([
  BROWSER_EVIDENCE_WORKFLOW_PATH,
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
const KNOWN_JOURNEY_SECRETS = Object.freeze([
  "opaque-login-password",
  "opaque-network-ticket",
  "opaque-upload-secret",
  "abcdefghijklmnop",
]);
export const BROWSER_EVIDENCE_TEST_IDS = Object.freeze([
  "browser-evidence.local-two-origin",
  "browser-evidence.origin-revision-enforcement",
  "browser-evidence.login-redaction",
  "browser-evidence.upload-download",
  "browser-evidence.console-network-failure",
  "browser-evidence.screenshot-diff",
  "browser-evidence.session-replay",
]);
export const BROWSER_EVIDENCE_THRESHOLDS = Object.freeze({
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
const PLATFORM_OS = Object.freeze({
  linux: "linux",
  darwin: "macos",
  win32: "windows",
});

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`unexpected argument: ${argument}`);
    }
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    options[key] = value;
    index += 1;
  }
  for (const key of [
    "artifact-dir",
    "head-sha",
    "os",
    "artifact-name",
    "repository",
    "ref",
    "workflow-ref",
    "workflow-sha",
    "run-id",
    "run-attempt",
    "job-id",
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

function gitBytes(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: null,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function exactHead(root, requested) {
  const normalized = String(requested || "").toLowerCase();
  if (!EXACT_SHA_RE.test(normalized)) {
    throw new Error("browser evidence requires an exact 40-character head SHA");
  }
  const checkedOut = String(gitBytes(root, ["rev-parse", "HEAD"]))
    .trim()
    .toLowerCase();
  if (checkedOut !== normalized) {
    throw new Error(
      `browser evidence head mismatch: checkout=${checkedOut} requested=${normalized}`,
    );
  }
  return normalized;
}

function resolveBaseSha(root, headSha, requested) {
  const candidate = String(requested || "")
    .trim()
    .toLowerCase();
  if (EXACT_SHA_RE.test(candidate) && !/^0+$/u.test(candidate))
    return candidate;
  return String(gitBytes(root, ["rev-parse", `${headSha}^`]))
    .trim()
    .toLowerCase();
}

function producerDigests(root, headSha) {
  return Object.fromEntries(
    BROWSER_EVIDENCE_PRODUCER_PATHS.map((sourcePath) => {
      const headDigest = browserEvidenceDigest(
        gitBytes(root, ["cat-file", "blob", `${headSha}:${sourcePath}`]),
      );
      const workingDigest = browserEvidenceDigest(
        fs.readFileSync(path.join(root, ...sourcePath.split("/"))),
      );
      if (workingDigest !== headDigest) {
        throw new Error(
          `browser evidence producer source differs from exact head: ${sourcePath}`,
        );
      }
      return [sourcePath, headDigest];
    }),
  );
}

function browserEvidenceArtifactName(osName, headSha, runAttempt) {
  if (!Object.values(PLATFORM_OS).includes(osName)) {
    throw new Error(`browser evidence artifact OS is invalid: ${osName}`);
  }
  if (!EXACT_SHA_RE.test(String(headSha || ""))) {
    throw new Error("browser evidence artifact requires an exact head SHA");
  }
  if (!POSITIVE_INTEGER_RE.test(String(runAttempt || ""))) {
    throw new Error(
      "browser evidence artifact requires a positive run attempt",
    );
  }
  return `browser-evidence-${osName}-${headSha}-${runAttempt}`;
}

function workflowProvenance(
  root,
  { headSha, repository, ref, workflowRef, workflowSha, runId, runAttempt },
  dependencies = {},
) {
  const normalizedHeadSha = String(headSha || "").toLowerCase();
  const normalizedWorkflowSha = String(workflowSha || "").toLowerCase();
  const normalizedRepository = String(repository || "");
  const normalizedRef = String(ref || "");
  const normalizedWorkflowRef = String(workflowRef || "");
  const normalizedRunId = String(runId || "");
  const normalizedRunAttempt = String(runAttempt || "");
  if (
    !EXACT_SHA_RE.test(normalizedHeadSha) ||
    !EXACT_SHA_RE.test(normalizedWorkflowSha)
  ) {
    throw new Error("browser evidence workflow authority requires exact SHAs");
  }
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(normalizedRepository) ||
    !/^refs\/[^\s]+$/u.test(normalizedRef) ||
    !POSITIVE_INTEGER_RE.test(normalizedRunId) ||
    !POSITIVE_INTEGER_RE.test(normalizedRunAttempt)
  ) {
    throw new Error("browser evidence workflow authority is invalid");
  }
  const workflowRefPrefix = `${normalizedRepository}/${BROWSER_EVIDENCE_WORKFLOW_PATH}@`;
  const workflowRefRevision = normalizedWorkflowRef.slice(
    workflowRefPrefix.length,
  );
  if (
    !normalizedWorkflowRef.startsWith(workflowRefPrefix) ||
    !(
      /^refs\/[^\s]+$/u.test(workflowRefRevision) ||
      EXACT_SHA_RE.test(workflowRefRevision)
    )
  ) {
    throw new Error("browser evidence workflow ref authority is invalid");
  }
  const readGitBlob =
    dependencies.readGitBlob ||
    ((commitSha, sourcePath) =>
      gitBytes(root, ["cat-file", "blob", `${commitSha}:${sourcePath}`]));
  const executedWorkflowBytes = Buffer.from(
    readGitBlob(normalizedWorkflowSha, BROWSER_EVIDENCE_WORKFLOW_PATH),
  );
  const exactHeadWorkflowBytes = Buffer.from(
    readGitBlob(normalizedHeadSha, BROWSER_EVIDENCE_WORKFLOW_PATH),
  );
  if (!executedWorkflowBytes.equals(exactHeadWorkflowBytes)) {
    throw new Error(
      "executed browser evidence workflow bytes differ from exact head",
    );
  }
  return Object.freeze({
    schema: BROWSER_EVIDENCE_WORKFLOW_PROVENANCE_SCHEMA,
    repository: normalizedRepository,
    ref: normalizedRef,
    workflowRef: normalizedWorkflowRef,
    workflowPath: BROWSER_EVIDENCE_WORKFLOW_PATH,
    executedWorkflowSha: normalizedWorkflowSha,
    executedWorkflowDigest: browserEvidenceDigest(executedWorkflowBytes),
    exactHeadWorkflowSha: normalizedHeadSha,
    exactHeadWorkflowDigest: browserEvidenceDigest(exactHeadWorkflowBytes),
    runId: normalizedRunId,
    runAttempt: normalizedRunAttempt,
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function startSite(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        server,
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((settle) => server.close(() => settle(undefined))),
      });
    });
  });
}

function siteAHtml(originB) {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Browser Evidence Origin A</title></head>
  <body>
    <h1>Browser Evidence Origin A</h1>
    <input id="password" type="password" value="opaque-login-password">
    <input id="upload" type="file">
    <p id="upload-status" data-ready="no">waiting for upload</p>
    <button id="fail">Capture console and network failure</button>
    <p id="failure-status" data-ready="no">waiting for failure</p>
    <button id="mutate">Change visual state</button>
    <a id="download" href="/download">Download report</a>
    <a id="cross-origin" href="${originB}/second">Second origin</a>
    <script>
      document.querySelector('#upload').addEventListener('change', (event) => {
        const file = event.target.files[0];
        const status = document.querySelector('#upload-status');
        status.textContent = file ? 'upload received: ' + file.name : 'missing';
        status.dataset.ready = 'yes';
      });
      document.querySelector('#fail').addEventListener('click', async () => {
        console.error('Authorization: Bearer abcdefghijklmnop');
        await fetch('/api/fail?token=opaque-network-ticket').catch(() => {});
        document.querySelector('#failure-status').dataset.ready = 'yes';
      });
      document.querySelector('#mutate').addEventListener('click', () => {
        document.body.style.background = 'rgb(12, 80, 160)';
        document.querySelector('h1').textContent = 'Browser Evidence Origin A Mutated';
      });
    </script>
  </body>
</html>`;
}

function siteBHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Origin B</title></head><body><h1>Second origin verified</h1></body></html>`;
}

function requestHandlerA(originB) {
  return (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/fail") {
      response.writeHead(500, { "content-type": "application/json" });
      response.end('{"ok":false}');
      return;
    }
    if (url.pathname === "/download") {
      response.writeHead(200, {
        "content-type": "text/plain",
        "content-disposition": 'attachment; filename="browser-report.txt"',
      });
      response.end("safe browser evidence download\n");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(siteAHtml(originB));
  };
}

function requestHandlerB(request, response) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(siteBHtml());
}

async function waitForCdp(port, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(
        `Chromium exited before CDP became ready (${child.exitCode})`,
      );
    }
    const status = await discoverCdp({ port });
    if (status.ok) return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chromium CDP endpoint did not become ready");
}

async function findJourneyChromium() {
  const playwright = await import("playwright");
  const bundled = playwright.chromium.executablePath();
  if (bundled && fs.existsSync(bundled)) return bundled;
  const system = findChromeExecutable();
  if (system) return system;
  throw new Error(
    "no Chromium executable is available; run `npx playwright install chromium`",
  );
}

function launchJourneyChromium(executable, port, profileDir, initialUrl) {
  const args = [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-sandbox",
    initialUrl,
  ];
  return spawn(executable, args, {
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
}

async function terminateChild(child) {
  if (!child || child.exitCode != null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    child.kill("SIGTERM");
  } catch {
    // The attached browser may already have closed after the CDP client left.
  }
  const settled = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!settled && child.exitCode == null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Best effort; the bounded rm retry below is the final cleanup check.
    }
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}

function writeExclusiveJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${canonicalBrowserEvidenceJson(value)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
    flush: true,
  });
}

function writeExclusiveBytes(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes, {
    flag: "wx",
    mode: 0o600,
    flush: true,
  });
}

function scanArtifactJson(artifactDir) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(artifactDir);
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
  return { hits, files: files.length };
}

function publishGenerated(
  store,
  filePath,
  title,
  kind,
  sessionId,
  artifactDir,
  exportName,
  expectedDigest,
) {
  try {
    const entry = store.publish({ filePath, title, kind, sessionId });
    if (!store.verifyIntegrity(entry).ok) {
      throw new Error(`managed ${kind} artifact failed integrity verification`);
    }
    const bytes = fs.readFileSync(store.storedPath(entry));
    const digest = browserEvidenceDigest(bytes);
    if (digest !== expectedDigest) {
      throw new Error(`managed ${kind} artifact differs from browser evidence`);
    }
    writeExclusiveBytes(path.join(artifactDir, exportName), bytes);
    return {
      artifact: publicArtifactMetadata(entry),
      digest,
      path: exportName,
    };
  } finally {
    fs.rmSync(filePath, { force: true });
  }
}

export async function runBrowserEvidenceJourney(options) {
  const root = repositoryRoot();
  const nativeOs = PLATFORM_OS[process.platform];
  if (!nativeOs || options.os !== nativeOs) {
    throw new Error(
      `browser evidence OS authority mismatch: runner=${nativeOs || process.platform} requested=${options.os}`,
    );
  }
  const headSha = exactHead(root, options["head-sha"]);
  const exactProducerDigests = producerDigests(root, headSha);
  const workflow = workflowProvenance(root, {
    headSha,
    repository: options.repository,
    ref: options.ref,
    workflowRef: options["workflow-ref"],
    workflowSha: options["workflow-sha"],
    runId: options["run-id"],
    runAttempt: options["run-attempt"],
  });
  if (
    exactProducerDigests[BROWSER_EVIDENCE_WORKFLOW_PATH] !==
    workflow.exactHeadWorkflowDigest
  ) {
    throw new Error("browser evidence workflow producer digest mismatch");
  }
  const expectedArtifactName = browserEvidenceArtifactName(
    options.os,
    headSha,
    workflow.runAttempt,
  );
  if (
    options["artifact-name"] !== expectedArtifactName ||
    options["job-id"] !== `browser-evidence-producer-${options.os}`
  ) {
    throw new Error(
      "browser evidence producer job/artifact authority mismatch",
    );
  }
  const baseSha = resolveBaseSha(root, headSha, options["base-sha"]);
  const artifactDir = path.resolve(root, options["artifact-dir"]);
  fs.mkdirSync(artifactDir, { recursive: true });
  if (fs.readdirSync(artifactDir).length > 0) {
    throw new Error("browser evidence artifact directory must be empty");
  }
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-browser-evidence-"),
  );
  const previousArtifactsDir = process.env.CC_ARTIFACTS_DIR;
  const previousActionsDir = process.env.CC_BROWSER_ACTIONS_DIR;
  process.env.CC_ARTIFACTS_DIR = path.join(temporaryRoot, "artifact-store");
  process.env.CC_BROWSER_ACTIONS_DIR = path.join(temporaryRoot, "actions");

  let siteA;
  let siteB;
  let chromium;
  const generatedFiles = new Set();
  try {
    siteB = await startSite(requestHandlerB);
    siteA = await startSite(requestHandlerA(siteB.origin));
    const port = await freePort();
    const executable = await findJourneyChromium();
    chromium = launchJourneyChromium(
      executable,
      port,
      path.join(temporaryRoot, "chrome-profile"),
      `${siteA.origin}/?session=opaque-login-password`,
    );
    await waitForCdp(port, chromium);

    const diffBytes = gitBytes(root, [
      "diff",
      "--binary",
      "--no-ext-diff",
      baseSha,
      headSha,
      "--",
    ]);
    const binding = {
      sessionId: `browser-evidence-${options.os}`,
      sessionRevision: 1,
      diff: {
        baseSha,
        headSha,
        digest: browserEvidenceDigest(diffBytes),
      },
      testRun: {
        id: `browser-evidence.local-two-origin.${options.os}`,
        attempt: Number(options["run-attempt"] || 1),
      },
    };
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const grantA = issueBrowserOriginGrant({
      grantId: `origin-a-${options.os}`,
      binding,
      origin: siteA.origin,
      revision: 11,
      scopes: ["observe", "act", "navigate", "upload", "download"],
      credentialBoundary: "session-bound",
      issuedAt,
      expiresAt,
    });
    const grantB = issueBrowserOriginGrant({
      grantId: `origin-b-${options.os}`,
      binding,
      origin: siteB.origin,
      revision: 17,
      scopes: ["observe", "navigate"],
      credentialBoundary: "none",
      issuedAt,
      expiresAt,
    });
    const expectedGrantRevisions = {
      [grantA.origin]: grantA.revision,
      [grantB.origin]: grantB.revision,
    };

    let crossOriginDenied = 0;
    try {
      authorizeBrowserAction({
        binding,
        grants: [grantA],
        expectedGrantRevisions: { [grantA.origin]: grantA.revision },
        action: { type: "navigate", url: `${siteB.origin}/second` },
        currentUrl: `${siteA.origin}/`,
      });
    } catch {
      crossOriginDenied += 1;
    }
    let revisionDenied = 0;
    try {
      authorizeBrowserAction({
        binding,
        grants: [grantA],
        expectedGrantRevisions: { [grantA.origin]: grantA.revision - 1 },
        action: { type: "screenshot" },
        currentUrl: `${siteA.origin}/`,
      });
    } catch {
      revisionDenied += 1;
    }
    if (crossOriginDenied !== 1 || revisionDenied !== 1) {
      throw new Error(
        "origin permission negative controls did not fail closed",
      );
    }

    const store = new ArtifactStore();
    const uploadSource = path.join(temporaryRoot, "browser-upload.txt");
    fs.writeFileSync(uploadSource, "opaque-upload-secret\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    const uploadArtifact = store.publish({
      filePath: uploadSource,
      title: "Browser evidence upload fixture",
      kind: "data",
      sessionId: binding.sessionId,
    });
    const resolveUploadArtifact = async (artifactId) => {
      const entry = store.get(artifactId);
      if (!entry || entry.sessionId !== binding.sessionId) {
        throw new Error("upload artifact session authority mismatch");
      }
      const integrity = store.verifyIntegrity(entry);
      if (!integrity.ok) throw new Error("upload artifact digest mismatch");
      return {
        path: store.storedPath(entry),
        metadata: publicArtifactMetadata(entry),
      };
    };

    const actions = [
      { type: "screenshot" },
      { type: "upload", selector: "#upload", artifactId: uploadArtifact.id },
      {
        type: "waitForSelector",
        selector: '#upload-status[data-ready="yes"]',
        timeoutMs: 10_000,
      },
      { type: "click", selector: "#fail" },
      {
        type: "waitForSelector",
        selector: '#failure-status[data-ready="yes"]',
        timeoutMs: 10_000,
      },
      { type: "click", selector: "#mutate" },
      { type: "screenshot" },
      { type: "download", selector: "#download" },
      { type: "navigate", url: `${siteB.origin}/second` },
      { type: "assertText", selector: "h1", expected: "Second origin" },
      {
        type: "navigate",
        url: `${siteA.origin}/return?session=opaque-login-password`,
      },
      {
        type: "waitForSelector",
        selector: "#password",
        timeoutMs: 10_000,
      },
      {
        type: "assertText",
        selector: "h1",
        expected: "Browser Evidence Origin A",
      },
    ];
    const result = await performActions(actions, {
      port,
      sessionId: binding.sessionId,
      evidenceBinding: binding,
      originGrants: [grantA, grantB],
      expectedGrantRevisions,
      resolveUploadArtifact,
      evidenceDomCap: 512,
    });
    for (const step of result.steps || []) {
      if (step.screenshotPath) generatedFiles.add(step.screenshotPath);
      if (step.downloadPath) generatedFiles.add(step.downloadPath);
    }
    if (!result.ok || !result.evidence) {
      throw new Error(
        `browser evidence action journey failed: ${result.error || result.steps?.find((step) => !step.ok)?.detail || "missing evidence"}`,
      );
    }
    verifyBrowserEvidenceEnvelope(result.evidence);
    const screenshotSteps = result.steps.filter(
      (step) => step.action === "screenshot",
    );
    const screenshotDiffs =
      screenshotSteps.length === 2 &&
      screenshotSteps[0].screenshotSha256 !==
        screenshotSteps[1].screenshotSha256
        ? 1
        : 0;
    if (screenshotDiffs !== 1) {
      throw new Error("browser screenshot visual diff was not observed");
    }
    if (result.console.length < 1 || result.network.length < 1) {
      throw new Error("browser console/network failure evidence is missing");
    }
    if (
      result.evidence.domSnapshot.captureSucceeded !== true ||
      result.evidence.domSnapshot.redaction.sensitiveFieldValues < 1 ||
      result.evidence.observations.page.queryValueRedactions < 1
    ) {
      throw new Error("browser login-state redaction evidence is missing");
    }

    const attachments = [];
    let screenshotNumber = 0;
    let downloadNumber = 0;
    for (const [index, step] of result.steps.entries()) {
      if (step.screenshotPath) {
        screenshotNumber += 1;
        attachments.push({
          actionIndex: index,
          evidenceKind: "screenshot",
          ...publishGenerated(
            store,
            step.screenshotPath,
            `Browser evidence screenshot ${index + 1}`,
            "screenshot",
            binding.sessionId,
            artifactDir,
            `browser-evidence-screenshot-${screenshotNumber}.png`,
            step.screenshotSha256,
          ),
        });
      }
      if (step.downloadPath) {
        downloadNumber += 1;
        attachments.push({
          actionIndex: index,
          evidenceKind: "download",
          ...publishGenerated(
            store,
            step.downloadPath,
            `Browser evidence download ${index + 1}`,
            "data",
            binding.sessionId,
            artifactDir,
            `browser-evidence-download-${downloadNumber}.bin`,
            step.downloadSha256,
          ),
        });
      }
    }
    const evidenceArtifact = store.publishDataOnce({
      data: `${canonicalBrowserEvidenceJson(result.evidence)}\n`,
      fileName: "browser-evidence-envelope.json",
      title: "Canonical browser evidence envelope",
      kind: "data",
      mime: "application/json",
      sessionId: binding.sessionId,
      immutable: true,
      recordDigest: result.evidence.envelopeDigest,
      lineage: {
        schema: result.evidence.schema,
        sessionId: binding.sessionId,
        sessionRevision: binding.sessionRevision,
        diffDigest: binding.diff.digest,
        testRunId: binding.testRun.id,
      },
    }).entry;
    if (!store.verifyIntegrity(evidenceArtifact).ok) {
      throw new Error(
        "managed browser evidence artifact failed integrity check",
      );
    }

    const replay = await performActions(
      [
        {
          type: "assertText",
          selector: "h1",
          expected: "Browser Evidence Origin A",
        },
      ],
      {
        port,
        sessionId: binding.sessionId,
        evidenceBinding: binding,
        originGrants: [grantA, grantB],
        expectedGrantRevisions,
        replaySourceEnvelope: result.evidence,
      },
    );
    if (!replay.ok || !replay.evidence) {
      throw new Error(
        `browser evidence replay failed: ${replay.error || replay.steps?.[0]?.detail || "missing replay evidence"}`,
      );
    }
    verifyBrowserEvidenceEnvelope(replay.evidence);
    if (
      replay.evidence.replay.sourceEnvelopeDigest !==
      result.evidence.envelopeDigest
    ) {
      throw new Error("browser replay is not bound to its source envelope");
    }

    const envelopePath = path.join(
      artifactDir,
      "browser-evidence-envelope.json",
    );
    const replayPath = path.join(
      artifactDir,
      "browser-evidence-replay-envelope.json",
    );
    writeExclusiveJson(envelopePath, result.evidence);
    writeExclusiveJson(replayPath, replay.evidence);
    const evidenceDigests = {
      "browser-evidence-envelope.json": browserEvidenceDigest(
        fs.readFileSync(envelopePath),
      ),
      "browser-evidence-replay-envelope.json": browserEvidenceDigest(
        fs.readFileSync(replayPath),
      ),
      ...Object.fromEntries(
        attachments.map((attachment) => [attachment.path, attachment.digest]),
      ),
    };
    const measurements = {
      origins: 2,
      crossOriginDenied,
      revisionDenied,
      crossOriginAllowed: result.evidence.originPermissions.some(
        (permission) => permission.crossOrigin,
      )
        ? 1
        : 0,
      uploadCount: result.steps.filter((step) => step.action === "upload")
        .length,
      downloadCount: result.steps.filter((step) => step.action === "download")
        .length,
      consoleErrors: result.console.length,
      networkErrors: result.network.length,
      screenshotCount: screenshotSteps.length,
      screenshotDiffs,
      replayCount: 1,
      managedArtifactCount: attachments.length + 2,
      domTruncated: result.evidence.domSnapshot.truncated,
      loginFieldRedactions:
        result.evidence.domSnapshot.redaction.sensitiveFieldValues,
      queryValueRedactions:
        result.evidence.observations.page.queryValueRedactions,
      secretScanHits: 0,
      workflowProvenanceDigest: browserEvidenceDigest(workflow),
    };
    const summary = {
      schema: BROWSER_EVIDENCE_JOURNEY_SUMMARY_SCHEMA,
      outcome: "passed",
      headSha,
      baseSha,
      os: options.os,
      envelopeDigest: result.evidence.envelopeDigest,
      replayEnvelopeDigest: replay.evidence.envelopeDigest,
      managedEvidenceArtifact: publicArtifactMetadata(evidenceArtifact),
      attachments,
      evidenceDigests,
      measurements,
      tests: BROWSER_EVIDENCE_TEST_IDS,
      workflow,
    };
    const summaryPath = path.join(
      artifactDir,
      "browser-evidence-journey-summary.json",
    );
    writeExclusiveJson(summaryPath, summary);

    const preliminaryScan = scanArtifactJson(artifactDir);
    if (preliminaryScan.hits !== 0) {
      throw new Error(
        `browser evidence artifact secret scan found ${preliminaryScan.hits} hit(s)`,
      );
    }
    const fragment = createClaudeIncrementAuditFragment({
      commitmentId: "BROWSER-EVIDENCE",
      headSha,
      os: options.os,
      runtime: {
        name: "node",
        version: process.version.replace(/^v/u, ""),
        arch: process.arch,
      },
      profileVersion: BROWSER_EVIDENCE_PROFILE_VERSION,
      thresholds: BROWSER_EVIDENCE_THRESHOLDS,
      measurements,
      testIds: summary.tests,
      producerDigests: exactProducerDigests,
      disposition: "required",
      outcome: "passed",
      source: {
        workflowId: workflow.workflowRef,
        runId: workflow.runId,
        jobId: options["job-id"],
        artifactName: expectedArtifactName,
      },
    });
    writeExclusiveJson(
      path.join(artifactDir, "claude-code-increment-audit-fragment.json"),
      fragment,
    );
    const finalScan = scanArtifactJson(artifactDir);
    if (finalScan.hits !== 0) {
      throw new Error(
        `final browser evidence artifact secret scan found ${finalScan.hits} hit(s)`,
      );
    }
    return { fragment, summary, secretScan: finalScan };
  } finally {
    await terminateChild(chromium);
    await Promise.allSettled([siteA?.close?.(), siteB?.close?.()]);
    for (const generatedFile of generatedFiles) {
      fs.rmSync(generatedFile, { force: true });
    }
    if (previousArtifactsDir === undefined) {
      delete process.env.CC_ARTIFACTS_DIR;
    } else {
      process.env.CC_ARTIFACTS_DIR = previousArtifactsDir;
    }
    if (previousActionsDir === undefined) {
      delete process.env.CC_BROWSER_ACTIONS_DIR;
    } else {
      process.env.CC_BROWSER_ACTIONS_DIR = previousActionsDir;
    }
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));
if (isDirect) {
  runBrowserEvidenceJourney(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(
        `${JSON.stringify({
          outcome: result.summary.outcome,
          headSha: result.summary.headSha,
          os: result.summary.os,
          envelopeDigest: result.summary.envelopeDigest,
          secretScanHits: result.secretScan.hits,
        })}\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

export {
  browserEvidenceArtifactName,
  parseArgs,
  producerDigests,
  scanArtifactJson,
  workflowProvenance,
};
