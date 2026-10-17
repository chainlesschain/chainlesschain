import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CAMPAIGN_GROUPS,
  selectCampaignTasks,
} from "../scripts/verify01-volcengine-campaign.mjs";
import { originalTaskPrompt } from "../scripts/verify01-volcengine-task-diagnostic.mjs";
const read = (file) =>
  JSON.parse(
    fs.readFileSync(
      new URL(
        `../../../docs/research/cli/verify01-plan-2026-10-13-volcengine/${file}`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const plan = read("plan.json");
const catalog = read("tasks.json");

test("nine disjoint groups execute exactly the 36 original tasks without first-run substitution", () => {
  const selected = CAMPAIGN_GROUPS.flatMap(
    (group) => selectCampaignTasks(group, plan).originalTasks,
  );
  assert.equal(selected.length, 36);
  assert.equal(new Set(selected).size, 36);
  assert.deepEqual(
    [...selected].sort(),
    catalog.tasks.map((task) => task.id).sort(),
  );
  assert.equal(selectCampaignTasks("all", plan).originalTasks.length, 36);
  assert.throws(() => selectCampaignTasks("first-run-linux-cli", plan));
  assert.throws(() =>
    selectCampaignTasks("all", { samples: plan.samples.slice(1) }),
  );
});

test("original verify-04 and verify-22 receive no repaired candidates or previous checker feedback", () => {
  for (const id of ["verify-04", "verify-22"]) {
    const task = catalog.tasks.find((task) => task.id === id);
    const prompt = originalTaskPrompt(task, {
      baselineTests: ["baseline.test.js"],
    });
    assert.ok(prompt.startsWith(task.prompt));
    assert.doesNotMatch(
      prompt,
      /39045268929|39043024352|GPT6_PRICING_TERMS|_collect calls|Ordinary checker feedback|repair round/u,
    );
    assert.match(prompt, /unseeded attempt/u);
    assert.match(prompt, /not a frozen cross-platform\/IDE sample/u);
  }
});

test("documentation task retains its Markdown deliverable and is never asked to write Vitest", () => {
  const task = catalog.tasks.find((task) => task.id === "verify-34");
  const prompt = originalTaskPrompt(task, { doc: true, baselineTests: [] });
  assert.match(prompt, /substantive Markdown operating runbook/u);
  assert.match(prompt, /docs\/development\/verify-34-outcome-runbook\.md/u);
  assert.doesNotMatch(prompt, /complete independent runnable Vitest/u);
});
