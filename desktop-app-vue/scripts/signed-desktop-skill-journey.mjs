#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { receiptDigest } from "./verify-signed-desktop-skill-matrix.mjs";

const require = createRequire(import.meta.url);
const SCHEMA = "chainlesschain.desktop-signed-skill-journey/v1";
const COLLECTION_SCHEMA =
  "chainlesschain.desktop-signed-skill-journey-collection/v1";
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const REQUIRED_SECRETS = Object.freeze([
  "CC_SKILL_GITHUB_TOKEN",
  "CC_SKILL_GOOGLE_CLIENT_ID",
  "CC_SKILL_GOOGLE_CLIENT_SECRET",
  "CC_SKILL_GOOGLE_REFRESH_TOKEN",
  "CC_SKILL_NOTION_API_KEY",
  "CC_SKILL_TAVILY_API_KEY",
]);
const JOURNEYS = Object.freeze([
  Object.freeze({
    skillId: "github-manager",
    input: "repo-info chainlesschain/chainlesschain",
    authorityKinds: Object.freeze(["environment", "network"]),
  }),
  Object.freeze({
    skillId: "google-workspace",
    input: "calendar-list --max 1 --days 1",
    authorityKinds: Object.freeze(["environment", "network"]),
  }),
  Object.freeze({
    skillId: "notion",
    input: "search ChainlessChain qualification",
    authorityKinds: Object.freeze(["environment", "network"]),
  }),
  Object.freeze({
    skillId: "tavily-search",
    input: "search ChainlessChain --max 1 --depth basic",
    authorityKinds: Object.freeze(["environment", "network"]),
  }),
  Object.freeze({
    skillId: "obsidian",
    input:
      "create-note 'signed-desktop-qualification' --content 'installed app.asar authority journey'",
    authorityKinds: Object.freeze(["environment", "filesystem"]),
  }),
  Object.freeze({
    skillId: "code-runner",
    input: null,
    authorityKinds: Object.freeze(["environment", "process"]),
  }),
  Object.freeze({
    skillId: "network-diagnostics",
    input: "--ping api.github.com --count 1",
    authorityKinds: Object.freeze(["network", "process"]),
  }),
]);

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function assertion(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function digest(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)), "utf8")
    .digest("hex")}`;
}

function moduleFromAsar(appAsar, relativePath) {
  return require(path.join(appAsar, "dist", "main", ...relativePath));
}

function secretResolver({ key }) {
  const mapping = {
    "github-token": "CC_SKILL_GITHUB_TOKEN",
    "google-client-id": "CC_SKILL_GOOGLE_CLIENT_ID",
    "google-client-secret": "CC_SKILL_GOOGLE_CLIENT_SECRET",
    "google-refresh-token": "CC_SKILL_GOOGLE_REFRESH_TOKEN",
    "google-access-token": "CC_SKILL_GOOGLE_ACCESS_TOKEN",
    "notion-api-key": "CC_SKILL_NOTION_API_KEY",
    "tavily-api-key": "CC_SKILL_TAVILY_API_KEY",
  };
  return mapping[key] ? process.env[mapping[key]] || null : null;
}

function wrapAuthorityFactory(kind, factory, state) {
  return async (request) => {
    const authority = await factory(request);
    state.get(request.skillId)?.add(kind);
    return authority;
  };
}

export function createJourneyReceipt(options) {
  const receipt = {
    schema: SCHEMA,
    status: "passed",
    platform: options.platform,
    commitSha: options.commitSha,
    artifactSha256: options.artifactSha256,
    challengeDigest: options.challengeDigest,
    skillId: options.skillId,
    approved: true,
    policyAuthorized: true,
    authorityKinds: [...options.authorityKinds].sort(),
    handlerSource: "installed-app.asar",
    resultDigest: options.resultDigest,
  };
  receipt.receiptDigest = receiptDigest(receipt);
  return Object.freeze(receipt);
}

async function executeJourneys(options) {
  for (const name of REQUIRED_SECRETS) {
    assertion(String(process.env[name] || "").trim(), `${name} is required`);
  }
  const appAsar = path.resolve(options.appAsar);
  const asarStat = fs.statSync(appAsar);
  assertion(asarStat.isFile(), "installed app.asar is unavailable");
  const buildInfo = JSON.parse(
    fs.readFileSync(
      path.join(appAsar, "dist", "main", "build-info.json"),
      "utf8",
    ),
  );
  assertion(
    buildInfo.commitSha === options.commitSha,
    "installed app.asar commit mismatch",
  );

  const workspace = fs.realpathSync(path.resolve(options.workspace));
  const vault = path.join(workspace, "qualification-vault");
  fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });

  const { SkillRegistry } = moduleFromAsar(appAsar, [
    "ai-engine",
    "cowork",
    "skills",
    "skill-registry.js",
  ]);
  const { SkillLoader } = moduleFromAsar(appAsar, [
    "ai-engine",
    "cowork",
    "skills",
    "skill-loader.js",
  ]);
  const { createBundledSkillEnvironmentAuthorityFactory } = moduleFromAsar(
    appAsar,
    ["ai-engine", "cowork", "skills", "bundled-skill-environment-authority.js"],
  );
  const { createBundledSkillFilesystemAuthorityFactory } = moduleFromAsar(
    appAsar,
    ["ai-engine", "cowork", "skills", "bundled-skill-filesystem-authority.js"],
  );
  const { createBundledSkillProcessAuthorityFactory } = moduleFromAsar(
    appAsar,
    ["ai-engine", "cowork", "skills", "bundled-skill-process-authority.js"],
  );
  const { createBundledSkillNetworkAuthorityFactory } = moduleFromAsar(
    appAsar,
    ["ai-engine", "cowork", "skills", "bundled-skill-network-authority.js"],
  );

  const authorities = new Map(
    JOURNEYS.map(({ skillId }) => [skillId, new Set()]),
  );
  const decisions = new Map();
  const auditSink = (entry) => {
    assertion(
      entry && typeof entry === "object",
      "authority audit entry is invalid",
    );
  };
  const registry = new SkillRegistry({ autoLoad: false });
  registry.setExecutionAuthorizer(async ({ skillId }) => {
    decisions.set(skillId, (decisions.get(skillId) || 0) + 1);
    return {
      approved: true,
      authorityId: `signed-desktop:${options.challengeDigest.slice(7, 31)}:${skillId}`,
    };
  });
  registry.setBundledSkillEnvironmentAuthorityFactory(
    wrapAuthorityFactory(
      "environment",
      createBundledSkillEnvironmentAuthorityFactory({
        workspacePath: workspace,
        secretResolver,
        pathResolver: ({ key }) => (key === "vault-directory" ? vault : null),
        auditSink,
      }),
      authorities,
    ),
  );
  registry.setBundledSkillFilesystemAuthorityFactory(
    wrapAuthorityFactory(
      "filesystem",
      createBundledSkillFilesystemAuthorityFactory({
        workspacePath: workspace,
        auditSink,
      }),
      authorities,
    ),
  );
  registry.setBundledSkillProcessAuthorityFactory(
    wrapAuthorityFactory(
      "process",
      createBundledSkillProcessAuthorityFactory({
        workspacePath: workspace,
        auditSink,
      }),
      authorities,
    ),
  );
  registry.setBundledSkillNetworkAuthorityFactory(
    wrapAuthorityFactory(
      "network",
      createBundledSkillNetworkAuthorityFactory({
        auditSink,
        diagnosticsDependencies: { auditSink },
        egressDependencies: { auditSink },
      }),
      authorities,
    ),
  );

  const loader = new SkillLoader({
    workspacePath: workspace,
    autoGating: true,
    strictGating: true,
    externalHandlerExecutor: null,
  });
  await loader.loadLayer("bundled");
  loader.resolveConflicts();
  for (const skill of loader
    .createSkillInstances()
    .filter(({ skillId }) => authorities.has(skillId))) {
    registry.register(skill);
  }
  assertion(
    registry.getAllSkills().length === JOURNEYS.length,
    "installed bundled Skill set is incomplete",
  );

  const token = options.challengeDigest.slice(7, 23);
  const receipts = [];
  for (const journey of JOURNEYS) {
    const input =
      journey.skillId === "code-runner"
        ? `--run "console.log('cc-signed-${token}')" --lang javascript`
        : journey.input;
    const result = await registry.executeSkill(
      journey.skillId,
      { input },
      { projectRoot: workspace, workspaceRoot: workspace },
    );
    assertion(
      result?.success === true,
      `${journey.skillId} journey failed: ${result?.error || result?.message || "unknown error"}`,
    );
    if (journey.skillId === "code-runner") {
      assertion(
        result.result?.stdout === `cc-signed-${token}`,
        "code-runner did not execute the challenge",
      );
      authorities.get(journey.skillId).add("process");
    }
    if (journey.skillId === "network-diagnostics") {
      assertion(
        result.result?.reachable === true,
        "network-diagnostics process journey was unreachable",
      );
      authorities.get(journey.skillId).add("process");
    }
    assertion(
      decisions.get(journey.skillId) === 1,
      `${journey.skillId} was not authorized exactly once`,
    );
    const skill = registry.getSkill(journey.skillId);
    const handlerPath = path.resolve(
      skill?._executionSecurity?.handlerRealPath || "",
    );
    const handlerRelative = path.relative(appAsar, handlerPath);
    assertion(
      skill?.source === "bundled" &&
        skill?._executionSecurity?.packageOwned === true &&
        handlerRelative.length > 0 &&
        handlerRelative !== ".." &&
        !handlerRelative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(handlerRelative),
      `${journey.skillId} handler was not loaded from installed app.asar`,
    );
    for (const kind of journey.authorityKinds) {
      assertion(
        authorities.get(journey.skillId).has(kind),
        `${journey.skillId} did not exercise ${kind} authority`,
      );
    }
    receipts.push(
      createJourneyReceipt({
        platform: options.platform,
        commitSha: options.commitSha,
        artifactSha256: options.artifactSha256,
        challengeDigest: options.challengeDigest,
        skillId: journey.skillId,
        authorityKinds: journey.authorityKinds,
        resultDigest: digest(result),
      }),
    );
  }
  return Object.freeze({ schema: COLLECTION_SCHEMA, journeys: receipts });
}

async function main(argv = process.argv.slice(2)) {
  assertion(
    process.versions.electron,
    "journey must run with the installed Electron runtime",
  );
  const output = argument(argv, "--output");
  const options = {
    appAsar: argument(argv, "--app-asar"),
    workspace: argument(argv, "--workspace"),
    platform: argument(argv, "--platform"),
    commitSha: argument(argv, "--expected-sha"),
    artifactSha256: argument(argv, "--artifact-sha256"),
    challengeDigest: argument(argv, "--challenge"),
  };
  assertion(output, "--output is required");
  assertion(
    COMMIT_SHA.test(options.commitSha || ""),
    "--expected-sha must be an exact commit SHA",
  );
  assertion(
    SHA256.test(options.artifactSha256 || ""),
    "--artifact-sha256 is required",
  );
  assertion(
    SHA256.test(options.challengeDigest || ""),
    "--challenge is required",
  );
  const collection = await executeJourneys(options);
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(collection, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Installed Desktop Skill journeys passed: ${collection.journeys.length}\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
