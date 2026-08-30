import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getElectronUserDataDir } from "../paths.js";
import { findProjectRoot } from "../project-detector.js";
import { validateReviewedRecordedSkill } from "./skill-recorder.js";

const PACKAGE_SCHEMA = "chainlesschain.recorded-skill-package/v1";
const PACKAGE_DIGEST_DOMAIN = "cc.record-replay.skill-package/v1";
const PACKAGE_FILES = Object.freeze([
  "SKILL.md",
  "handler.js",
  "recorded-skill.json",
]);
const MAX_PACKAGE_FILE_BYTES = 2 * 1024 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function packageError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "RecordedSkillPackageError";
  error.code = code;
  Object.assign(error, details);
  return error;
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

function digest(value, domain = PACKAGE_DIGEST_DOMAIN) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex")}`;
}

function assertName(value) {
  const name = String(value || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/u.test(name)) {
    throw packageError(
      "CC_RECORD_PACKAGE_ARGUMENT_INVALID",
      "recorded skill name is invalid",
    );
  }
  return name;
}

function pathContains(parent, candidate) {
  const relation = relative(resolve(parent), resolve(candidate));
  return (
    relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))
  );
}

function assertNoSymlinkTraversal(root, target) {
  const safeRoot = resolve(root);
  const safeTarget = resolve(target);
  if (!pathContains(safeRoot, safeTarget) || safeRoot === safeTarget) {
    throw packageError(
      "CC_RECORD_PACKAGE_PATH_UNSAFE",
      "recorded skill package path escaped its skill root",
    );
  }
  if (existsSync(safeRoot) && lstatSync(safeRoot).isSymbolicLink()) {
    throw packageError(
      "CC_RECORD_PACKAGE_PATH_UNSAFE",
      "recorded skill root may not be a symbolic link",
    );
  }
  const segments = relative(safeRoot, safeTarget)
    .split(/[\\/]+/u)
    .filter(Boolean);
  let current = safeRoot;
  for (const segment of segments) {
    current = join(current, segment);
    if (!existsSync(current)) break;
    const entry = lstatSync(current);
    if (entry.isSymbolicLink()) {
      throw packageError(
        "CC_RECORD_PACKAGE_PATH_UNSAFE",
        "recorded skill package path contains a symbolic link",
      );
    }
  }
  return safeTarget;
}

function assertNoExistingSymlinkBetween(root, target) {
  const safeRoot = resolve(root);
  const safeTarget = resolve(target);
  if (!pathContains(safeRoot, safeTarget)) {
    throw packageError(
      "CC_RECORD_PACKAGE_PATH_UNSAFE",
      "recorded skill path escaped its authority root",
    );
  }
  let current = safeRoot;
  if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
    throw packageError(
      "CC_RECORD_PACKAGE_PATH_UNSAFE",
      "recorded skill authority root may not be a symbolic link",
    );
  }
  for (const segment of relative(safeRoot, safeTarget)
    .split(/[\\/]+/u)
    .filter(Boolean)) {
    current = join(current, segment);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw packageError(
        "CC_RECORD_PACKAGE_PATH_UNSAFE",
        "recorded skill path contains a symbolic link",
      );
    }
  }
}

function yamlString(value) {
  return JSON.stringify(
    String(value)
      .replace(/[\r\n]+/gu, " ")
      .slice(0, 512),
  );
}

function packagePayload(entry) {
  const skill = validateReviewedRecordedSkill(entry.skill);
  if (!entry.lastReplay?.report?.replayDigest || entry.state !== "validated") {
    throw packageError(
      "CC_RECORD_PACKAGE_NOT_VALIDATED",
      "recorded skill must pass its current replay before it can be enabled",
    );
  }
  return Object.freeze({
    schema: PACKAGE_SCHEMA,
    name: skill.name,
    entryDigest: entry.entryDigest,
    draftDigest: skill.draftDigest,
    approvalDigest: skill.approvalDigest,
    replayDigest: entry.lastReplay.report.replayDigest,
    targetDigest: entry.source.targetDigest,
    capabilities: [...skill.capabilityManifest],
    parameters: skill.parameters.map((parameter) => ({ ...parameter })),
  });
}

function renderSkillMd(entry) {
  const skill = validateReviewedRecordedSkill(entry.skill);
  const parameterNames = skill.parameters.map((parameter) => parameter.name);
  const targetOption =
    entry.source.adapter === "url-origin"
      ? "--url <reviewed-url> [--storage-state <playwright-storage-state.json>]"
      : "--fixture <self-contained-html-file>";
  const usage = [
    `cc skill recording replay ${skill.name} ${targetOption}`,
    ...parameterNames.map((name) => `  --input ${name}=<value>`),
  ].join(" \\\n");
  return `---
name: ${skill.name}
display-name: ${yamlString(`Recorded: ${skill.name}`)}
description: ${yamlString(skill.description || "Reviewed and replay-validated UI workflow")}
version: 1.0.0
category: automation
tags: [recorded, ui, replay]
user-invocable: true
handler: handler.js
isolation: true
capabilities: [${skill.capabilityManifest.join(", ")}]
---

# ${skill.name}

This Skill is generated from a reviewed Record & Replay workflow. Its actions,
capabilities, environment binding, and successful replay digest are immutable.

## Execution contract

1. Ask the user for the original reviewed browser target and, when required,
   an ephemeral matching Playwright storage-state file.
2. Ask for every declared parameter; never persist sensitive parameter values.
3. Run the exact governed replay command below. Do not reproduce the actions as
   arbitrary browser JavaScript or relax the reviewed network policy.

\`\`\`bash
${usage}
\`\`\`

The command revalidates the stored draft, approval, target digest, environment,
capabilities, and terminal evidence before reporting success.
`;
}

function renderHandler(payload) {
  return `/**
 * Execution identity marker for recorded Skill ${payload.name}.
 *
 * The CLI never imports this module. The authoritative workflow remains in the
 * owner-private Record & Replay store and executes only through the governed
 * \`cc skill recording replay\` command.
 */
export default Object.freeze({
  skill: ${JSON.stringify(payload.name)},
  executionMode: "record-replay-cli",
  entryDigest: ${JSON.stringify(payload.entryDigest)},
  replayDigest: ${JSON.stringify(payload.replayDigest)},
});
`;
}

function packageContents(entry) {
  const payload = packagePayload(entry);
  return Object.freeze({
    "SKILL.md": renderSkillMd(entry),
    "handler.js": renderHandler(payload),
    "recorded-skill.json": `${JSON.stringify(payload, null, 2)}\n`,
  });
}

function packageDigest(contents) {
  return digest(
    Object.fromEntries(
      PACKAGE_FILES.map((file) => [
        file,
        `sha256:${createHash("sha256").update(contents[file]).digest("hex")}`,
      ]),
    ),
  );
}

function readInstalledPackage(target) {
  const entry = lstatSync(target);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw packageError(
      "CC_RECORD_PACKAGE_PATH_UNSAFE",
      "recorded skill package target is unsafe",
    );
  }
  const names = readdirSync(target).sort();
  if (JSON.stringify(names) !== JSON.stringify([...PACKAGE_FILES].sort())) {
    throw packageError(
      "CC_RECORD_INSTALL_MODIFIED",
      "installed recorded skill contains modified files",
    );
  }
  const contents = {};
  for (const name of PACKAGE_FILES) {
    const file = join(target, name);
    const fileEntry = lstatSync(file);
    if (
      !fileEntry.isFile() ||
      fileEntry.isSymbolicLink() ||
      fileEntry.size > MAX_PACKAGE_FILE_BYTES
    ) {
      throw packageError(
        "CC_RECORD_INSTALL_MODIFIED",
        "installed recorded skill file is unsafe",
      );
    }
    contents[name] = readFileSync(file, "utf8");
  }
  let payload;
  try {
    payload = JSON.parse(contents["recorded-skill.json"]);
  } catch {
    throw packageError(
      "CC_RECORD_INSTALL_MODIFIED",
      "installed recorded skill metadata is invalid",
    );
  }
  if (
    payload.schema !== PACKAGE_SCHEMA ||
    payload.name !== assertName(payload.name) ||
    !SHA256_PATTERN.test(String(payload.entryDigest || "")) ||
    !SHA256_PATTERN.test(String(payload.replayDigest || ""))
  ) {
    throw packageError(
      "CC_RECORD_INSTALL_MODIFIED",
      "installed recorded skill metadata is invalid",
    );
  }
  return Object.freeze({
    payload,
    contents,
    packageDigest: packageDigest(contents),
  });
}

export function resolveRecordedSkillInstallTarget({
  name,
  scope = "project",
  projectRoot,
  userDataDir,
} = {}) {
  const safeName = assertName(name);
  let skillsRoot;
  let authorityRoot;
  if (scope === "global") {
    authorityRoot = resolve(userDataDir || getElectronUserDataDir());
    skillsRoot = resolve(authorityRoot, "skills");
  } else if (scope === "project") {
    const root = projectRoot || findProjectRoot();
    if (!root) {
      throw packageError(
        "CC_RECORD_PROJECT_REQUIRED",
        "project installation requires a ChainlessChain project",
      );
    }
    authorityRoot = resolve(root);
    skillsRoot = resolve(authorityRoot, ".chainlesschain", "skills");
  } else {
    throw packageError(
      "CC_RECORD_PACKAGE_ARGUMENT_INVALID",
      "installation scope is invalid",
    );
  }
  assertNoExistingSymlinkBetween(authorityRoot, skillsRoot);
  mkdirSync(skillsRoot, { recursive: true, mode: 0o700 });
  const target = assertNoSymlinkTraversal(
    skillsRoot,
    join(skillsRoot, safeName),
  );
  return Object.freeze({ scope, skillsRoot, target });
}

export function installRecordedSkillPackage(entry, options = {}) {
  const location = resolveRecordedSkillInstallTarget({
    name: entry?.name,
    ...options,
  });
  const contents = packageContents(entry);
  const expectedDigest = packageDigest(contents);
  if (existsSync(location.target)) {
    const installed = readInstalledPackage(location.target);
    if (
      installed.payload.name === entry.name &&
      installed.payload.entryDigest === entry.entryDigest &&
      installed.packageDigest === expectedDigest
    ) {
      return Object.freeze({
        ...location,
        packageDigest: expectedDigest,
        created: false,
      });
    }
    throw packageError(
      "CC_RECORD_INSTALL_CONFLICT",
      "a different skill already occupies the install target",
    );
  }
  const staging = join(
    location.skillsRoot,
    `.${entry.name}.record-replay-${process.pid}-${randomUUID()}`,
  );
  assertNoSymlinkTraversal(location.skillsRoot, staging);
  mkdirSync(staging, { mode: 0o700 });
  try {
    for (const name of PACKAGE_FILES) {
      const target = join(staging, name);
      const handle = openSync(target, "wx", 0o600);
      try {
        writeFileSync(handle, contents[name], "utf8");
      } finally {
        closeSync(handle);
      }
    }
    renameSync(staging, location.target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({
    ...location,
    packageDigest: expectedDigest,
    created: true,
  });
}

export function revokeRecordedSkillPackage({
  name,
  scope,
  expectedPackageDigest,
  ...options
} = {}) {
  const staged = stageRecordedSkillPackageRevocation({
    name,
    scope,
    expectedPackageDigest,
    ...options,
  });
  staged.commit();
  return Object.freeze({
    scope: staged.scope,
    skillsRoot: staged.skillsRoot,
    target: staged.target,
    removed: staged.staged,
  });
}

export function stageRecordedSkillPackageRevocation({
  name,
  scope,
  expectedPackageDigest,
  ...options
} = {}) {
  const location = resolveRecordedSkillInstallTarget({
    name,
    scope,
    ...options,
  });
  if (!existsSync(location.target)) {
    return Object.freeze({
      ...location,
      staged: false,
      commit() {},
      rollback() {},
    });
  }
  const installed = readInstalledPackage(location.target);
  if (
    installed.payload.name !== assertName(name) ||
    installed.packageDigest !== expectedPackageDigest
  ) {
    throw packageError(
      "CC_RECORD_INSTALL_MODIFIED",
      "installed recorded skill changed after enablement; refusing automatic removal",
    );
  }
  const quarantine = join(
    location.skillsRoot,
    `.${name}.record-replay-revoked-${randomUUID()}`,
  );
  assertNoSymlinkTraversal(location.skillsRoot, quarantine);
  renameSync(location.target, quarantine);
  let settled = false;
  return Object.freeze({
    ...location,
    staged: true,
    commit() {
      if (settled) return;
      rmSync(quarantine, { recursive: true, force: true });
      settled = true;
    },
    rollback() {
      if (settled) return;
      if (existsSync(location.target)) {
        throw packageError(
          "CC_RECORD_INSTALL_CONFLICT",
          "recorded skill target was replaced during revocation rollback",
        );
      }
      renameSync(quarantine, location.target);
      settled = true;
    },
  });
}

export function inspectRecordedSkillPackage(options = {}) {
  const location = resolveRecordedSkillInstallTarget(options);
  if (!existsSync(location.target)) return null;
  const installed = readInstalledPackage(location.target);
  return Object.freeze({
    ...location,
    name: installed.payload.name,
    entryDigest: installed.payload.entryDigest,
    replayDigest: installed.payload.replayDigest,
    packageDigest: installed.packageDigest,
  });
}
