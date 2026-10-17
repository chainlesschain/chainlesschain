import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  REPAIR_SCHEMA,
  REPAIR_FIXTURE_ROOT,
  repairDigest,
  validateRepairManifest,
  loadRepairManifest,
  campaignRepairPrompt,
} from "../scripts/verify01-campaign-repair.mjs";
import { selectCampaignRepairTasks } from "../scripts/verify01-volcengine-campaign.mjs";
const sourceSha = "a".repeat(40),
  projectCommit = "b".repeat(40),
  planDigest = `sha256:${"c".repeat(64)}`;
const seedBytes = Buffer.from("// preserved model candidate\n");
const task = {
  id: "verify-12",
  expectedFiles: ["packages/cli/__tests__/verify-12.test.js"],
  sourcePaths: ["packages/cli/src/lib/background-command-argv.js"],
  prompt: "Test argument boundaries.",
};
const catalog = {
  tasks: [
    task,
    {
      ...task,
      id: "verify-34",
      expectedFiles: ["docs/development/verify-34-outcome-runbook.md"],
    },
  ],
};
const manifest = () => ({
  schema: REPAIR_SCHEMA,
  projectCommit,
  planDigest,
  repairRound: 3,
  tasks: [
    {
      taskId: task.id,
      sourceRun: "39000000001",
      sourceCommit: "d".repeat(40),
      sourceRound: 2,
      attemptKind: "seeded-repair",
      seed: {
        file: `${REPAIR_FIXTURE_ROOT}candidate.txt`,
        digest: repairDigest(seedBytes),
        deliverable: task.expectedFiles[0],
      },
      feedback: {
        kind: "ordinary-checker-or-runtime",
        text: "Suite could not resolve its import; zero cases executed.",
        digest: repairDigest(
          "Suite could not resolve its import; zero cases executed.",
        ),
      },
    },
  ],
});
const validate = (value, overrides = {}) => {
  const bytes = Buffer.from(JSON.stringify(value));
  return validateRepairManifest(bytes, {
    expectedDigest: repairDigest(bytes),
    sourceSha,
    catalog,
    projectCommit,
    planDigest,
    readTracked: () => seedBytes,
    ...overrides,
  });
};

test("repair binds exact candidate, feedback, source run and execution commit", () => {
  const repair = validate(manifest());
  assert.equal(repair.tasks[task.id].seed.executionSourceCommit, sourceSha);
  assert.equal(repair.tasks[task.id].sourceRound, 2);
  assert.equal(repair.bindings[0].digest, repairDigest(seedBytes));
  const prompt = campaignRepairPrompt(
    task,
    { baselineTests: [] },
    repair.tasks[task.id],
  );
  assert.match(prompt, /repair round 3/u);
  assert.match(prompt, /NOT a first attempt/u);
  assert.match(prompt, /actual deliverable directory/u);
  assert.match(prompt, /at most 20 turns/u);
});

test("rejects altered manifest, altered feedback and altered candidate bytes", () => {
  assert.throws(
    () => validate(manifest(), { expectedDigest: `sha256:${"0".repeat(64)}` }),
    /manifest digest/u,
  );
  const changed = manifest();
  changed.tasks[0].feedback.text += " changed";
  assert.throws(() => validate(changed), /feedback digest/u);
  assert.throws(
    () =>
      validate(manifest(), {
        readTracked: () => Buffer.from("other candidate"),
      }),
    /candidate digest/u,
  );
});

test("rejects wrong catalog identity, deliverable, path and duplicate tasks", () => {
  for (const change of [
    (m) => {
      m.tasks[0].taskId = "verify-99";
    },
    (m) => {
      m.tasks[0].seed.deliverable =
        "packages/cli/src/lib/background-command-argv.js";
    },
    (m) => {
      m.tasks[0].seed.file = `${REPAIR_FIXTURE_ROOT}../outside.txt`;
    },
    (m) => {
      m.tasks[0].seed.file = "C:/outside.txt";
    },
    (m) => {
      m.tasks.push(m.tasks[0]);
    },
    (m) => {
      m.tasks[0].sourceRound = m.repairRound;
    },
    (m) => {
      m.projectCommit = "e".repeat(40);
    },
  ]) {
    const value = manifest();
    change(value);
    assert.throws(() => validate(value));
  }
});

test("unseeded network retry is explicit and document repair keeps its deliverable kind", () => {
  const value = manifest();
  Object.assign(value.tasks[0], {
    seed: null,
    attemptKind: "unseeded-network-retry",
    unseededReason: "pre-dispatch-network-failure",
    taskId: "verify-34",
  });
  const entry = validate(value).tasks["verify-34"];
  const prompt = campaignRepairPrompt(
    catalog.tasks[1],
    { doc: true, baselineTests: [] },
    entry,
  );
  assert.match(prompt, /unseeded retry/u);
  assert.match(prompt, /Markdown operating runbook/u);
  assert.doesNotMatch(prompt, /Deliver complete runnable independent Vitest/u);
  value.tasks[0].unseededReason = "checker-failed";
  assert.throws(() => validate(value), /prior network failure/u);
});

test("campaign repair selects only manifest tasks within the frozen designated group", () => {
  const plan = JSON.parse(
    fs.readFileSync(
      new URL(
        "../../../docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const repair = validate(manifest());
  assert.deepEqual(
    selectCampaignRepairTasks("win32-jetbrains", plan, repair).originalTasks,
    ["verify-12"],
  );
  assert.throws(
    () => selectCampaignRepairTasks("linux-cli", plan, repair),
    /no repair tasks/u,
  );
  assert.throws(
    () =>
      selectCampaignRepairTasks("all", plan, {
        tasks: { "verify-12": {}, "verify-99": {} },
      }),
    /outside frozen plan/u,
  );
});

test("disk loader refuses untracked or changed files despite a matching supplied hash", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-repair-binding-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  run(["init"]);
  const value = manifest(),
    file = `${REPAIR_FIXTURE_ROOT}manifest.json`;
  fs.mkdirSync(path.join(root, REPAIR_FIXTURE_ROOT), { recursive: true });
  fs.writeFileSync(path.join(root, value.tasks[0].seed.file), seedBytes);
  fs.writeFileSync(path.join(root, file), JSON.stringify(value));
  run(["add", "."]);
  run([
    "-c",
    "user.name=Offline Test",
    "-c",
    "user.email=offline@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "test: bind repair inputs",
  ]);
  const sha = run(["rev-parse", "HEAD"]);
  const options = {
    repository: root,
    file,
    expectedDigest: repairDigest(JSON.stringify(value)),
    sourceSha: sha,
    catalog,
    projectCommit,
    planDigest,
  };
  assert.equal(loadRepairManifest(options).executionSourceCommit, sha);
  fs.writeFileSync(path.join(root, value.tasks[0].seed.file), "changed");
  assert.throws(
    () => loadRepairManifest(options),
    /differs from execution commit/u,
  );
  const untracked = `${REPAIR_FIXTURE_ROOT}untracked.json`;
  fs.writeFileSync(path.join(root, untracked), JSON.stringify(value));
  assert.throws(() => loadRepairManifest({ ...options, file: untracked }));
});
