#!/usr/bin/env node
/** All original task inputs, real public CLI, independent Docker checks.
 * Actual host is Linux CLI; designated frozen strata are retained separately.
 * Never creates frozen outcome observations or consumes a first-run sample.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  runTaskDiagnostic,
  redactDiagnostic,
  DIAGNOSTIC,
} from "./verify01-volcengine-task-diagnostic.mjs";
import { loadRepairManifest } from "./verify01-campaign-repair.mjs";

export const CAMPAIGN_GROUPS = Object.freeze([
  "win32-cli",
  "win32-vscode",
  "win32-jetbrains",
  "linux-cli",
  "linux-vscode",
  "linux-jetbrains",
  "darwin-cli",
  "darwin-vscode",
  "darwin-jetbrains",
]);
const root = fileURLToPath(new URL("../../../", import.meta.url));
export function selectCampaignTasks(group, plan) {
  assert.ok(
    group === "all" || CAMPAIGN_GROUPS.includes(group),
    "unknown campaign group",
  );
  const tasks = plan.samples.filter((sample) => sample.kind === "task");
  assert.equal(tasks.length, 36);
  assert.equal(new Set(tasks.map((sample) => sample.id)).size, 36);
  for (const expected of CAMPAIGN_GROUPS)
    assert.equal(
      tasks.filter((sample) => sample.stratum === `${expected}-volcengine`)
        .length,
      4,
    );
  const selected =
    group === "all"
      ? tasks
      : tasks.filter((sample) => sample.stratum === `${group}-volcengine`);
  return {
    originalTasks: selected.map((sample) => sample.id),
    designatedStrata: Object.fromEntries(
      selected.map((sample) => [sample.id, sample.stratum]),
    ),
  };
}

export function selectCampaignRepairTasks(group, plan, repair) {
  const selected = selectCampaignTasks(group, plan);
  const originalTasks = selected.originalTasks.filter((id) =>
    Object.hasOwn(repair.tasks, id),
  );
  assert.ok(
    originalTasks.length > 0,
    "no repair tasks selected for campaign group",
  );
  const planIds = new Set(selectCampaignTasks("all", plan).originalTasks);
  assert.ok(
    Object.keys(repair.tasks).every((id) => planIds.has(id)),
    "repair task outside frozen plan",
  );
  return {
    originalTasks,
    designatedStrata: Object.fromEntries(
      originalTasks.map((id) => [id, selected.designatedStrata[id]]),
    ),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "confirm-live": { type: "boolean", default: false },
      group: { type: "string", default: "all" },
      "output-dir": { type: "string" },
      "source-sha": { type: "string" },
      "image-id": { type: "string" },
      round: { type: "string", default: "1" },
      "repair-manifest": { type: "string" },
      "repair-manifest-digest": { type: "string" },
    },
  });
  assert.ok(values["confirm-live"], "--confirm-live is required");
  assert.ok(values["output-dir"], "--output-dir is required");
  assert.match(values.round, /^[1-9][0-9]?$/u);
  const plan = JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        "docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
      ),
      "utf8",
    ),
  );
  assert.equal(
    Boolean(values["repair-manifest"]),
    Boolean(values["repair-manifest-digest"]),
    "repair manifest and externally pinned digest are required together",
  );
  const repair = values["repair-manifest"]
    ? loadRepairManifest({
        repository: root,
        file: values["repair-manifest"],
        expectedDigest: values["repair-manifest-digest"],
        sourceSha: values["source-sha"],
        catalog: JSON.parse(
          fs.readFileSync(
            path.join(
              root,
              "docs/research/cli/verify01-plan-2026-10-13-volcengine/tasks.json",
            ),
            "utf8",
          ),
        ),
        projectCommit: DIAGNOSTIC.projectCommit,
        planDigest: DIAGNOSTIC.planDigest,
      })
    : null;
  const selected = repair
    ? selectCampaignRepairTasks(values.group, plan, repair)
    : selectCampaignTasks(values.group, plan);
  console.log(
    JSON.stringify({
      scope: repair ? "explicit-campaign-repair" : "original-36-task-campaign",
      group: values.group,
      actualEntry: "linux-cli",
      ...selected,
      formalSample: false,
    }),
  );
  const result = await runTaskDiagnostic({
    mode: repair ? "campaign-repair" : "original",
    repairManifest: values["repair-manifest"],
    repairManifestDigest: values["repair-manifest-digest"],
    campaignRound: Number(values.round),
    ...selected,
    outputDir: values["output-dir"],
    sourceSha: values["source-sha"],
    imageId: values["image-id"],
    key: process.env.VOLCENGINE_API_KEY,
  });
  if (!result.passed) process.exitCode = 1;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(
      redactDiagnostic(String(error.message), process.env.VOLCENGINE_API_KEY),
    );
    process.exitCode = 1;
  });
