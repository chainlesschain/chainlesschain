/** Read-only full-round collection. Never reads model credentials or dispatches. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  listZipEntries,
  readZipEntry,
} from "../../vscode-extension/scripts/verify-vsix.mjs";
import {
  loadNativePackageSet,
  selectNativeSamples,
} from "./verify01-native-task-campaign.mjs";
import { nativeProviderCells } from "./verify01-native-round-matrix.mjs";
import { assertNativeProviderIdentity } from "./verify01-native-provider-profile.mjs";
import { DIAGNOSTIC } from "./verify01-volcengine-task-diagnostic.mjs";

const repository = "chainlesschain/chainlesschain";
const packageFile =
  "docs/research/cli/verify01-package-sets/2026-11-03-volcengine-139.json";
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

async function main() {
  const { values } = parseArgs({
    options: {
      "run-id": { type: "string" },
      source: { type: "string" },
      "output-dir": { type: "string" },
      "in-workflow": { type: "boolean", default: false },
    },
  });
  assert.match(values["run-id"] ?? "", /^[1-9][0-9]+$/u);
  assert.match(values.source ?? "", /^[a-f0-9]{40}$/u);
  assert.ok(values["output-dir"]);
  const output = path.resolve(values["output-dir"]);
  fs.mkdirSync(output, { recursive: true });
  const request = (route) =>
    execFileSync("gh", ["api", `repos/${repository}${route}`], {
      timeout: 120000,
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
    });
  const api = (route) => JSON.parse(request(route).toString("utf8"));
  const run = api(`/actions/runs/${values["run-id"]}`);
  assert.equal(run.head_sha, values.source);
  assert.equal(run.path, ".github/workflows/verify01-native-task-campaign.yml");
  assert.equal(run.event, "workflow_dispatch");
  assert.equal(run.run_attempt, 1);
  assert.ok(
    run.status === "completed" ||
      (values["in-workflow"] && run.status === "in_progress"),
  );
  const packages = loadNativePackageSet(packageFile);
  assert.equal(
    hash(execFileSync("git", ["show", `${values.source}:${packageFile}`])),
    packages.packageSetDigest,
  );
  const plan = read(
    "docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
  );
  const rows = [
    ["win32", "windows-latest"],
    ["linux", "ubuntu-24.04"],
    ["darwin", "macos-15"],
  ].flatMap(([platform, os]) =>
    ["cli", "vscode", "jetbrains"].map((entry) => ({
      group: `${platform}-${entry}`,
      os,
      entry,
    })),
  );
  const cells = nativeProviderCells(rows, plan, undefined, "volcengine", {
    isolateJetbrains: true,
  });
  const listed = api(
    `/actions/runs/${run.id}/artifacts?per_page=100`,
  ).artifacts;
  const artifacts = [],
    results = [],
    missing = [];
  const save = (name, bytes) => {
    const file = path.resolve(output, name);
    assert.ok(file.startsWith(output + path.sep));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  };
  for (const cell of cells) {
    const expected = selectNativeSamples(
      plan,
      cell.group.split("-")[0],
      cell.entry,
      cell.sample_ids ? cell.sample_ids.split(",") : undefined,
    ).map((s) => s.id);
    const summaries = {};
    for (const kind of ["delivery", "acceptance"]) {
      const name = `verify01-native-${kind}-${cell.cell_id}-${values.source}`;
      const matches = listed.filter((a) => a.name === name);
      assert.ok(matches.length <= 1);
      if (!matches.length) {
        missing.push(name);
        continue;
      }
      const artifact = matches[0];
      assert.equal(artifact.expired, false);
      assert.equal(artifact.workflow_run.id, run.id);
      assert.equal(artifact.workflow_run.head_sha, values.source);
      const zip = request(`/actions/artifacts/${artifact.id}/zip`);
      assert.equal(zip.length, artifact.size_in_bytes);
      assert.equal(hash(zip), artifact.digest);
      const entries = listZipEntries(zip);
      assert.ok(entries.has("summary.json"));
      const bytes = readZipEntry(zip, entries.get("summary.json"));
      const summary = JSON.parse(bytes.toString("utf8"));
      assert.equal(summary.executionSourceCommit, values.source);
      assert.equal(summary.packageSetDigest, packages.packageSetDigest);
      assert.deepEqual(
        [...summary.selectedSampleIds].sort(),
        [...expected].sort(),
      );
      save(`raw/${name}/summary.json`, bytes);
      if (kind === "delivery") {
        assertNativeProviderIdentity(
          summary,
          "volcengine",
          values.source,
          packages,
          {
            revisionBinding: null,
            projectCommit: DIAGNOSTIC.projectCommit,
            planDigest: DIAGNOSTIC.planDigest,
          },
        );
      } else {
        assert.equal(summary.deliverySourceCommit, values.source);
        assert.equal(summary.acceptanceHost, "linux-docker");
        for (const row of summary.samples) {
          for (const stage of ["setup", "check"]) {
            if (!row[stage]?.receiptPath) continue;
            const entry = entries.get(row[stage].receiptPath);
            assert.ok(entry);
            const receipt = readZipEntry(zip, entry);
            assert.equal(hash(receipt), row[stage].receiptDigest);
            save(`receipts/${row.sampleId}-${stage}.json`, receipt);
          }
        }
      }
      summaries[kind] = { summary, digest: hash(bytes) };
      artifacts.push({
        id: artifact.id,
        name,
        digest: artifact.digest,
        summaryDigest: hash(bytes),
      });
    }
    if (summaries.acceptance) {
      assert.ok(
        summaries.delivery,
        "Acceptance requires its original delivery",
      );
      assert.equal(
        summaries.acceptance.summary.sourceSummaryDigest,
        summaries.delivery.digest,
      );
    }
    for (const sampleId of expected) {
      const delivery = summaries.delivery?.summary.samples.find(
        (s) => s.sampleId === sampleId,
      );
      const acceptance = summaries.acceptance?.summary.samples.find(
        (s) => s.sampleId === sampleId,
      );
      if (acceptance?.passed) {
        assert.equal(acceptance.generationPassed, true);
        assert.equal(acceptance.candidateAcceptancePassed, true);
        assert.ok(acceptance.check?.receiptPath);
      }
      results.push({
        sampleId,
        group: cell.group,
        cellId: cell.cell_id,
        accepted: acceptance?.passed === true,
        candidateAcceptancePassed:
          acceptance?.candidateAcceptancePassed ?? null,
        generationPassed:
          acceptance?.generationPassed ?? delivery?.generationPassed ?? null,
        deliveryAvailable: Boolean(delivery),
        acceptanceAvailable: Boolean(acceptance),
        modelFailure: delivery?.model?.failureCategory ?? null,
        error: acceptance?.error ?? delivery?.error ?? null,
        setup: acceptance?.setup ?? null,
        check: acceptance?.check ?? null,
        broker: delivery?.brokerStatus ?? null,
        observedUsage: delivery?.model?.observedUsage ?? null,
      });
    }
  }
  assert.equal(results.length, 45);
  assert.equal(new Set(results.map((r) => r.sampleId)).size, 45);
  const count = (selected) => ({
    accepted: selected.filter((r) => r.accepted).length,
    total: selected.length,
  });
  const report = {
    schema: "chainlesschain.fresh-volcengine-native-results/v1",
    collectedAt: new Date().toISOString(),
    runId: run.id,
    url: run.html_url,
    executionSource: values.source,
    provider: "volcengine",
    model: DIAGNOSTIC.model,
    versions: packages.versions,
    packageSetDigest: packages.packageSetDigest,
    formalSample: false,
    historicalScoresUnchanged: true,
    completeEvidence:
      missing.length === 0 &&
      results.every((r) => r.deliveryAvailable && r.acceptanceAvailable),
    missingArtifacts: missing,
    missingSamples: results
      .filter((r) => !r.deliveryAvailable || !r.acceptanceAvailable)
      .map((r) => r.sampleId),
    ...count(results),
    tasks: count(results.filter((r) => !r.sampleId.startsWith("first-run-"))),
    firstRuns: count(
      results.filter((r) => r.sampleId.startsWith("first-run-")),
    ),
    groups: Object.fromEntries(
      rows.map((row) => [
        row.group,
        count(results.filter((r) => r.group === row.group)),
      ]),
    ),
    artifacts,
    samples: results,
  };
  save("results.json", JSON.stringify(report, null, 2) + "\n");
  const summary = `Volcengine ${DIAGNOSTIC.model}: ${report.accepted}/45 accepted; tasks ${report.tasks.accepted}/36; first runs ${report.firstRuns.accepted}/9. Missing artifacts: ${missing.length}. Historical scores unchanged.\n`;
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary.trim());
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
