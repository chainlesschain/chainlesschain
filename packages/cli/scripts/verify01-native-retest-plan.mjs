#!/usr/bin/env node
/** Offline retest selection. Never dispatch workflows or execute candidates. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadNativePackageSet } from "./verify01-native-task-campaign.mjs";
import { verifyLatestPackageRound } from "../../../docs/research/cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/verify-latest-package-round.mjs";
import { verifyFetchDiagnosticFollowup } from "../../../docs/research/cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/verify-fetch-diagnostic-followup.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
export const NATIVE_EVIDENCE_ROOT =
  "docs/research/cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18";
export const DEFAULT_NATIVE_PACKAGE_SET =
  "docs/research/cli/verify01-package-sets/2026-10-18-latest.json";
const packageDirectory = "docs/research/cli/verify01-package-sets/";
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function containedFile(root, relative) {
  assert.equal(typeof relative, "string");
  assert.ok(
    relative.length &&
      !/[\\:]/u.test(relative) &&
      !path.posix.isAbsolute(relative),
    "repository-relative file required",
  );
  const parts = relative.split("/");
  assert.ok(parts.every((part) => part && part !== "." && part !== ".."));
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    assert.ok(!stat.isSymbolicLink(), "evidence links are not allowed");
    assert.ok(
      index === parts.length - 1 ? stat.isFile() : stat.isDirectory(),
      "regular evidence path required",
    );
  }
  return current;
}

export function validateNativePackageSetFile(
  relative = DEFAULT_NATIVE_PACKAGE_SET,
  repositoryRoot = repository,
) {
  assert.equal(typeof relative, "string");
  assert.ok(
    relative.startsWith(packageDirectory) &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/u.test(
        relative.slice(packageDirectory.length),
      ),
    "package-set must be a committed manifest under docs/research/cli/verify01-package-sets",
  );
  return loadNativePackageSet(containedFile(repositoryRoot, relative));
}

/** Only these two existing ledgers have established strict evidence validators.
 * Do not discover arbitrary JSON or trust a free-standing acceptance boolean.
 * A shared read cache gives both validators and selection one evidence snapshot.
 */
export function loadVerifiedNativeAcceptedSamples({
  repositoryRoot = repository,
  requireComplete = true,
} = {}) {
  const root = path.join(repositoryRoot, NATIVE_EVIDENCE_ROOT);
  const cache = new Map();
  const readEvidence = (name) => {
    if (!cache.has(name))
      cache.set(name, fs.readFileSync(containedFile(root, name)));
    return cache.get(name);
  };
  const options = {
    root,
    repository: repositoryRoot,
    readEvidence,
    requireComplete,
  };
  verifyLatestPackageRound(options);
  verifyFetchDiagnosticFollowup(options);
  const latest = JSON.parse(readEvidence("latest-package-round.json"));
  const followup = JSON.parse(readEvidence("fetch-diagnostics-followup.json"));
  const historical = JSON.parse(
    readEvidence("native-verified-deliveries.json"),
  );
  const acceptedIds = new Set(
    historical
      .filter((row) => row.candidateAcceptancePassed === true)
      .map((row) => row.sampleId),
  );
  for (const ledger of [latest, followup]) {
    for (const row of ledger.samples) {
      if (row.candidateAcceptancePassed === true) acceptedIds.add(row.sampleId);
    }
  }
  return {
    acceptedIds,
    latest,
    baselineEvidence: [
      "latest-package-round.json",
      "fetch-diagnostics-followup.json",
      "native-verified-deliveries.json",
    ].map((name) => ({
      path: `${NATIVE_EVIDENCE_ROOT}/${name}`,
      digest: hash(readEvidence(name)),
    })),
  };
}

export function validateNextNativePackageSet(selected, previous) {
  assert.notEqual(
    selected.packageSetDigest,
    previous.packageSetDigest,
    "next-version retests require a new package set",
  );
  const newer = (left, right) => {
    assert.match(left, /^\d+\.\d+\.\d+$/u);
    const a = left.split(".").map(Number),
      b = right.split(".").map(Number);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  };
  assert.ok(
    newer(selected.versions.cli, previous.versions.cli) > 0,
    "next-version retests require a newer published CLI version",
  );
  for (const entry of ["vscode", "jetbrains"]) {
    assert.ok(
      newer(selected.versions[entry], previous.versions[entry]) >= 0,
      "IDE package versions must not regress",
    );
  }
}

export function assertUnfinishedNativeSamples(sampleIds, options = {}) {
  assert.ok(
    Array.isArray(sampleIds) && sampleIds.length,
    "Further model requests require explicit unfinished sample_ids; do not rerun whole groups",
  );
  const { acceptedIds, latest } = loadVerifiedNativeAcceptedSamples(options);
  const repeated = sampleIds.filter((id) => acceptedIds.has(id));
  assert.equal(
    repeated.length,
    0,
    "Reuse already accepted deliverables instead of model generation: " +
      repeated.join(","),
  );
  validateNextNativePackageSet(
    validateNativePackageSetFile(options.versionsFile, options.repositoryRoot),
    latest,
  );
}

export function unfinishedNativeGroups(plan, acceptedIds) {
  assert.ok(acceptedIds instanceof Set);
  assert.equal(
    new Set(plan.samples.map((row) => row.id)).size,
    plan.samples.length,
  );
  const planned = new Set(plan.samples.map((row) => row.id));
  for (const id of acceptedIds)
    assert.ok(planned.has(id), "accepted sample outside frozen plan");
  const groups = new Map();
  for (const sample of plan.samples) {
    if (acceptedIds.has(sample.id)) continue;
    const match =
      /^(win32|linux|darwin)-(cli|vscode|jetbrains)-volcengine$/u.exec(
        sample.stratum,
      );
    assert.ok(match, "unknown native group");
    const group = `${match[1]}-${match[2]}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(sample.id);
  }
  return [...groups].map(([group, sampleIds]) => ({ group, sampleIds }));
}

export function nativeExecutionShards(groups) {
  return groups.flatMap(({ group, sampleIds }) =>
    group.endsWith("-jetbrains")
      ? sampleIds.map((sampleId) => ({
          shardId: `${group}--${sampleId}`,
          group,
          sampleIds: [sampleId],
        }))
      : [{ shardId: group, group, sampleIds: [...sampleIds] }],
  );
}

export function createNativeRetestPlan({
  versionsFile,
  roundName,
  repositoryRoot = repository,
}) {
  assert.match(roundName, /^next-package-[a-z0-9][a-z0-9-]{0,70}$/u);
  const selected = validateNativePackageSetFile(versionsFile, repositoryRoot);
  const baseline = loadVerifiedNativeAcceptedSamples({ repositoryRoot });
  validateNextNativePackageSet(selected, baseline.latest);
  const frozenPlan = JSON.parse(
    fs.readFileSync(
      containedFile(
        repositoryRoot,
        "docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
      ),
    ),
  );
  const groups = unfinishedNativeGroups(frozenPlan, baseline.acceptedIds);
  const evidenceRoot = path.join(repositoryRoot, NATIVE_EVIDENCE_ROOT);
  const ledgerName = `${roundName}.json`;
  const planName = `${roundName}-plan.json`;
  for (const name of [ledgerName, planName, roundName]) {
    assert.ok(
      !fs.existsSync(path.join(evidenceRoot, name)),
      "new round must not overwrite an existing ledger, plan, or archive",
    );
  }
  const result = {
    schema: "chainlesschain.native-package-retest-plan/v1",
    status: "PREPARED_NOT_DISPATCHED",
    billingAssessed: false,
    packageSetPath: versionsFile,
    packageSetDigest: selected.packageSetDigest,
    versions: selected.versions,
    frozenProjectCommit: frozenPlan.commitSha,
    baselineEvidence: baseline.baselineEvidence,
    reusedAcceptedSampleIds: [...baseline.acceptedIds].sort(),
    plannedNewSamples: groups.reduce(
      (total, group) => total + group.sampleIds.length,
      0,
    ),
    groups,
    executionShards: nativeExecutionShards(groups),
    ledgerPath: `${NATIVE_EVIDENCE_ROOT}/${ledgerName}`,
    archivePrefix: `${NATIVE_EVIDENCE_ROOT}/${roundName}`,
    policy:
      "Publish and verify the pinned package set before dispatch. Generate only these unfinished IDs. Keep original ledgers and accepted files unchanged. This plan does not record execution or acceptance.",
  };
  fs.writeFileSync(
    path.join(evidenceRoot, planName),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      "versions-file": { type: "string" },
      "round-name": { type: "string" },
    },
  });
  assert.ok(
    values["versions-file"] && values["round-name"],
    "--versions-file and --round-name are required",
  );
  console.log(
    JSON.stringify(
      createNativeRetestPlan({
        versionsFile: values["versions-file"],
        roundName: values["round-name"],
      }),
    ),
  );
}
