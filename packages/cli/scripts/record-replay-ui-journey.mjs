#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRecordedSkillDraft,
  replayRecordedSkill,
  reviewRecordedSkillDraft,
} from "../src/lib/record-replay/skill-recorder.js";
import { launchPlaywrightRecordedSkillDriver } from "../src/lib/record-replay/playwright-ui-driver.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PLATFORMS = Object.freeze(["linux", "macos", "windows"]);
const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Recorded Skill Fixture</title></head>
  <body>
    <main>
      <button data-project="project-1" onclick="document.querySelector('h1').textContent=this.dataset.project">Project 1</button>
      <button data-project="project-2" onclick="document.querySelector('h1').textContent=this.dataset.project">Project 2</button>
      <button id="network-attempt" onclick="fetch('https://example.invalid/recorded-skill-probe').catch(() => {})">Network probe</button>
      <h1>no-project</h1>
    </main>
  </body>
</html>`;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function digest(value, domain) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex")}`;
}

function parseArgs(argv) {
  const out = { commitSha: "", output: "", platform: "", verifyDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--commit-sha") out.commitSha = value || "";
    else if (key === "--output") out.output = value || "";
    else if (key === "--platform") out.platform = value || "";
    else if (key === "--verify-dir") out.verifyDir = value || "";
    else throw new TypeError(`Unknown argument: ${key}`);
    index += 1;
  }
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(out.commitSha)) {
    throw new TypeError("--commit-sha must be an exact 40 or 64 character SHA");
  }
  if (!out.output) throw new TypeError("--output is required");
  if (!out.verifyDir && !PLATFORMS.includes(out.platform)) {
    throw new TypeError("--platform must be linux, macos, or windows");
  }
  return out;
}

function exactHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

function writeJson(path, value) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function approvedProjectSkill() {
  const draft = createRecordedSkillDraft({
    name: "open-project",
    description: "Open a project in a local UI fixture and assert its title",
    actions: [
      { kind: "click", target: "[data-project='captured-project']" },
      { kind: "assert", target: "h1", value: "captured-project" },
    ],
    parameterBindings: [
      { name: "projectName", value: "captured-project", required: true },
    ],
    environment: {
      app: "chainlesschain-record-replay-fixture",
      browser: "chromium",
      selectorContract: "record-replay-ui-v1",
    },
    failureConditions: ["the selected project title is not visible"],
  });
  return reviewRecordedSkillDraft(draft, {
    reviewerId: "record-replay-matrix",
    approvedCapabilities: draft.capabilityManifest,
    acceptedFailureConditions: true,
  });
}

function approvedNetworkAttemptSkill() {
  const draft = createRecordedSkillDraft({
    name: "network-boundary-probe",
    actions: [{ kind: "click", target: "#network-attempt" }],
    environment: {
      app: "chainlesschain-record-replay-fixture",
      browser: "chromium",
      selectorContract: "record-replay-ui-v1",
    },
    failureConditions: ["any filesystem or network request is attempted"],
  });
  return reviewRecordedSkillDraft(draft, {
    reviewerId: "record-replay-matrix",
    approvedCapabilities: draft.capabilityManifest,
    acceptedFailureConditions: true,
  });
}

async function runPlatform({ commitSha, platform }) {
  if (exactHead() !== commitSha) {
    throw new Error("checked-out source does not match --commit-sha");
  }
  const skill = approvedProjectSkill();
  const driver = await launchPlaywrightRecordedSkillDriver({
    html: FIXTURE_HTML,
    settleMs: 50,
  });
  let replay;
  try {
    replay = await replayRecordedSkill(skill, {
      inputs: { projectName: "project-2" },
      environment: skill.environment.requirements,
      isolation: { sandboxed: true, network: "deny" },
      executor: driver.executor,
    });
  } finally {
    await driver.close();
  }
  const driverSummary = driver.summary();
  if (
    replay.status !== "succeeded" ||
    driverSummary.actionCount !== 2 ||
    driverSummary.deniedRequestCount !== 0
  ) {
    throw new Error("positive recorded UI replay did not close cleanly");
  }

  const boundarySkill = approvedNetworkAttemptSkill();
  const boundaryDriver = await launchPlaywrightRecordedSkillDriver({
    html: FIXTURE_HTML,
    settleMs: 100,
  });
  let boundaryCode = "";
  try {
    await replayRecordedSkill(boundarySkill, {
      environment: boundarySkill.environment.requirements,
      isolation: { sandboxed: true, network: "deny" },
      executor: boundaryDriver.executor,
    });
  } catch (error) {
    boundaryCode = String(error?.code || "");
  } finally {
    await boundaryDriver.close();
  }
  const boundarySummary = boundaryDriver.summary();
  if (
    boundaryCode !== "CC_REPLAY_UI_NETWORK_ATTEMPT" ||
    boundarySummary.deniedRequestCount < 1
  ) {
    throw new Error("network-denied recorded UI replay did not fail closed");
  }

  const body = {
    schema: "chainlesschain.record-replay-ui-journey/v1",
    commitSha,
    platform,
    driver: "playwright-chromium",
    browserVersion: driver.browserVersion,
    fixtureDigest: driver.fixtureDigest,
    draftDigest: skill.draftDigest,
    approvalDigest: skill.approvalDigest,
    replayDigest: replay.replayDigest,
    driverSummary,
    networkBoundary: {
      rejected: true,
      code: boundaryCode,
      deniedRequestCount: boundarySummary.deniedRequestCount,
    },
  };
  return Object.freeze({
    ...body,
    reportDigest: digest(body, "cc.record-replay.ui-journey/v1"),
  });
}

function jsonFiles(root) {
  const out = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...jsonFiles(path));
    else if (entry.endsWith(".json")) out.push(path);
  }
  return out.sort();
}

function verifyMatrix({ commitSha, verifyDir }) {
  const reports = jsonFiles(resolve(verifyDir)).map((path) =>
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (reports.length !== PLATFORMS.length) {
    throw new Error(
      `expected ${PLATFORMS.length} platform reports, found ${reports.length}`,
    );
  }
  const byPlatform = new Map(reports.map((report) => [report.platform, report]));
  if (
    byPlatform.size !== PLATFORMS.length ||
    PLATFORMS.some((platform) => !byPlatform.has(platform))
  ) {
    throw new Error("recorded UI replay matrix is missing a required platform");
  }
  const authority = reports[0];
  for (const report of reports) {
    if (
      report.schema !== "chainlesschain.record-replay-ui-journey/v1" ||
      report.commitSha !== commitSha ||
      report.driver !== "playwright-chromium" ||
      report.fixtureDigest !== authority.fixtureDigest ||
      report.draftDigest !== authority.draftDigest ||
      report.approvalDigest !== authority.approvalDigest ||
      report.driverSummary?.actionCount !== 2 ||
      report.driverSummary?.deniedRequestCount !== 0 ||
      report.networkBoundary?.rejected !== true ||
      report.networkBoundary?.code !== "CC_REPLAY_UI_NETWORK_ATTEMPT" ||
      report.networkBoundary?.deniedRequestCount < 1 ||
      !/^sha256:[a-f0-9]{64}$/u.test(String(report.reportDigest || ""))
    ) {
      throw new Error(`invalid recorded UI replay report for ${report.platform}`);
    }
  }
  const platforms = PLATFORMS.map((platform) => {
    const report = byPlatform.get(platform);
    return {
      platform,
      browserVersion: report.browserVersion,
      replayDigest: report.replayDigest,
      reportDigest: report.reportDigest,
    };
  });
  const body = {
    schema: "chainlesschain.record-replay-ui-matrix/v1",
    commitSha,
    fixtureDigest: authority.fixtureDigest,
    draftDigest: authority.draftDigest,
    approvalDigest: authority.approvalDigest,
    status: "passed",
    platforms,
  };
  return Object.freeze({
    ...body,
    matrixDigest: digest(body, "cc.record-replay.ui-matrix/v1"),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = options.verifyDir
    ? verifyMatrix(options)
    : await runPlatform(options);
  writeJson(options.output, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
