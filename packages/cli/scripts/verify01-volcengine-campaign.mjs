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
} from "./verify01-volcengine-task-diagnostic.mjs";

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

async function main() {
  const { values } = parseArgs({
    options: {
      "confirm-live": { type: "boolean", default: false },
      group: { type: "string", default: "all" },
      "output-dir": { type: "string" },
      "source-sha": { type: "string" },
      "image-id": { type: "string" },
      round: { type: "string", default: "1" },
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
  const selected = selectCampaignTasks(values.group, plan);
  console.log(
    JSON.stringify({
      scope: "original-36-task-campaign",
      group: values.group,
      actualEntry: "linux-cli",
      ...selected,
      formalSample: false,
    }),
  );
  const result = await runTaskDiagnostic({
    mode: "original",
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
