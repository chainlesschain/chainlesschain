import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateActivation,
  evidenceDigest,
} from "../src/lib/formal-budget-contract.js";
import {
  config,
  attest,
  verifyFixtureEvidence,
  NOW,
} from "./formal-budget-fixture.mjs";
import { outcomeDigest } from "../src/lib/eval/outcomes.js";

const directory = new URL(
  "../../../docs/research/cli/verify01-plan-2026-10-13-volcengine/",
  import.meta.url,
);
const json = (file) =>
  JSON.parse(fs.readFileSync(new URL(file, directory), "utf8"));
function frozenConfig() {
  const cfg = config();
  const bundle = {
    plan: json("plan.json"),
    catalog: json("tasks.json"),
    bindings: json("comparison-bindings.json"),
    expectedPlanDigest: fs
      .readFileSync(new URL("plan.sha256", directory), "utf8")
      .trim(),
  };
  cfg.plan.frozenBundle = bundle;
  cfg.plan.digest = bundle.expectedPlanDigest.slice(7);
  cfg.plan.tasks = bundle.plan.samples.map((s) => ({
    id: s.id,
    kind: s.kind === "task" ? "task" : "soak",
    contractId: "fixture-contract",
    capUsdMicros: s.costBudget * 1_000_000,
  }));
  cfg.contracts = [cfg.contracts[0]];
  cfg.contracts[0].model = "deepseek-v4-flash-ga-260731";
  cfg.contracts[0].endpoint =
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
  // Carry original nonzero spending and unresolved reservation facts; the
  // revision is not a fresh $99 allocation. This verifier is offline only.
  cfg.history.planDigest = cfg.plan.digest;
  cfg.history.tasks = cfg.plan.tasks.map((t, i) => ({
    id: t.id,
    spentUsdMicros: i === 0 ? 150000 : 0,
    reservedUsdMicros: i === 1 ? 100000 : 0,
    runsUsed: i < 2 ? 1 : 0,
    unknown: i === 1,
  }));
  return attest(cfg);
}
test("legacy dual-provider activation remains valid and single-provider unbound activation rejects", () => {
  const cfg = config();
  assert.deepEqual(validateActivation(cfg, verifyFixtureEvidence, NOW), cfg);
  cfg.plan.tasks.forEach((t) => {
    t.contractId = "fixture-contract";
  });
  assert.throws(
    () => validateActivation(attest(cfg), verifyFixtureEvidence, NOW),
    /18 Volcengine/,
  );
});
test("v3 digest cannot enter legacy 18+18 activation by omitting its frozen bundle", () => {
  const cfg = config();
  cfg.plan.digest = json("revision.json").planDigest.slice(7);
  cfg.history.planDigest = cfg.plan.digest;
  assert.throws(
    () => validateActivation(attest(cfg), verifyFixtureEvidence, NOW),
    /complete frozen bundle/,
  );
});
test("exact authorized v3 admits 36+9 assigned contracts without resetting history", () => {
  const cfg = frozenConfig();
  const result = validateActivation(cfg, verifyFixtureEvidence, NOW);
  assert.equal(result.plan.tasks.filter((t) => t.kind === "task").length, 36);
  assert.equal(result.plan.tasks.filter((t) => t.kind === "soak").length, 9);
  assert.equal(result.plan.limitUsdMicros, 99000000);
  assert.equal(result.history.tasks[0].spentUsdMicros, 150000);
  assert.equal(result.history.tasks[1].reservedUsdMicros, 100000);
  assert.equal(result.history.tasks[1].unknown, true);
});
for (const [name, mutate] of [
  [
    "unrecognized plan digest",
    (c) => {
      c.plan.frozenBundle.expectedPlanDigest = "sha256:" + "f".repeat(64);
    },
  ],
  [
    "changed provider",
    (c) => {
      c.contracts[0].provider = "openai";
    },
  ],
  [
    "changed model",
    (c) => {
      c.contracts[0].model = "other";
    },
  ],
  [
    "changed endpoint",
    (c) => {
      c.contracts[0].endpoint =
        "https://fixture.invalid/api/v3/chat/completions";
    },
  ],
  [
    "renamed task",
    (c) => {
      c.plan.tasks[0].id = "extra-task";
      c.history.tasks[0].id = "extra-task";
    },
  ],
  [
    "soak billed as task",
    (c) => {
      c.plan.tasks[36].kind = "task";
    },
  ],
  [
    "raised cap",
    (c) => {
      c.plan.tasks[0].capUsdMicros += 1;
    },
  ],
  [
    "rewritten comparison",
    (c) => {
      c.plan.frozenBundle.bindings.comparisons["linux-cli-volcengine"].model =
        "other";
    },
  ],
  [
    "rewritten prompt",
    (c) => {
      c.plan.frozenBundle.catalog.tasks[0].prompt += " changed";
    },
  ],
  [
    "rehash of changed plan",
    (c) => {
      c.plan.frozenBundle.plan.samples[0].stratum = "linux-cli-volcengine";
      c.plan.frozenBundle.expectedPlanDigest = outcomeDigest(
        c.plan.frozenBundle.plan,
      );
      c.plan.digest = c.plan.frozenBundle.expectedPlanDigest.slice(7);
      c.history.planDigest = c.plan.digest;
    },
  ],
  [
    "lineage changed",
    (c) => {
      c.history.lineageId = "new-lineage";
    },
  ],
])
  test(`v3 rejects ${name} even when offline receipts are refreshed`, () => {
    const cfg = frozenConfig();
    mutate(cfg);
    attest(cfg);
    assert.throws(() => validateActivation(cfg, verifyFixtureEvidence, NOW));
  });
test("new bundle cannot reuse legacy or omitted evidence receipts", () => {
  const cfg = frozenConfig();
  cfg.evidence.plan.sha256 = evidenceDigest(config().plan);
  assert.throws(() => validateActivation(cfg, verifyFixtureEvidence, NOW), {
    code: "CC_BUDGET_EVIDENCE_REQUIRED",
  });
  delete cfg.evidence.plan;
  assert.throws(() => validateActivation(cfg, verifyFixtureEvidence, NOW), {
    code: "CC_BUDGET_EVIDENCE_REQUIRED",
  });
});
