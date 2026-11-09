"use strict";
// Explicit opt-in only. At most TWO inference requests with synthetic project
// and memory. Never logs credentials, headers, config or raw provider errors.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_OUT = path.join(
  ROOT,
  "docs/research/agents/evidence/dmm-volcengine-live-2026-11-06",
);
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
async function config() {
  const load = (file) =>
    import(pathToFileURL(path.join(ROOT, "packages/cli", file)).href);
  const { loadConfig } = await load("src/lib/config-manager.js");
  const { applyConfigLlmDefaults } = await load(
    "src/lib/llm-config-defaults.js",
  );
  const llm = loadConfig()?.llm || {},
    resolved = { provider: "volcengine" };
  applyConfigLlmDefaults(resolved, llm);
  resolved.apiKey ||= process.env.VOLCENGINE_API_KEY;
  const {
    volcengineEndpoint,
    ENDPOINT,
  } = require("../src/main/task/project-goal-volcengine-model");
  if (
    llm.provider !== "volcengine" ||
    resolved.provider !== "volcengine" ||
    !resolved.apiKey ||
    !resolved.model
  )
    throw new Error("CONFIGURATION_UNAVAILABLE");
  volcengineEndpoint(resolved.baseUrl || ENDPOINT);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/u.test(resolved.model))
    throw new Error("CONFIGURATION_UNAVAILABLE");
  return resolved;
}
const sourceFiles = [
  "desktop-app-vue/scripts/project-goal-volcengine-live.cjs",
  "desktop-app-vue/src/main/task/project-goal-volcengine-model.js",
  "desktop-app-vue/src/main/task/project-goal-model-drafts.js",
  "desktop-app-vue/src/main/task/__tests__/project-goal-volcengine-fixture.cjs",
  "desktop-app-vue/src/main/evolution/desktop-model-ingress.js",
  "packages/session-core/lib/project-goal-memory.js",
];
async function main() {
  const args = process.argv.slice(2);
  if (
    !["--inspect", "--confirm-live"].includes(args[0]) ||
    (args.length !== 1 &&
      !(args.length === 3 && args[1] === "--output-dir" && args[2]))
  )
    throw new Error("EXPLICIT_LIVE_FLAG_REQUIRED");
  const llm = await config();
  const safeConfig = {
    provider: llm.provider,
    model: llm.model,
    endpoint: "https://ark.cn-beijing.volces.com/api/v3",
    credentialPresent: true,
  };
  if (args[0] === "--inspect") {
    console.log(JSON.stringify(safeConfig));
    return;
  }
  const outputRoot = path.resolve(args[2] || DEFAULT_OUT);
  const evidenceRoot = path.resolve(
    ROOT,
    "docs/research/cli/evidence",
  );
  const relation = path.relative(evidenceRoot, outputRoot);
  if (
    !relation ||
    relation.startsWith(".." + path.sep) ||
    path.isAbsolute(relation)
  )
    throw new Error("OUTPUT_DIR_MUST_BE_UNDER_CLI_EVIDENCE");
  fs.mkdirSync(outputRoot, { recursive: true });
  // Each evidence directory is a single paid attempt. Re-running may spend
  // money, so it must use a new reviewed evidence directory in source.
  const reportPath = path.join(outputRoot, "live-results.json");
  const fd = fs.openSync(reportPath, "wx");
  const {
    createFixture,
  } = require("../src/main/task/__tests__/project-goal-volcengine-fixture.cjs");
  const report = {
    schema: "chainlesschain.dmm-volcengine-live/v1",
    startedAt: new Date().toISOString(),
    config: safeConfig,
    boundary:
      "Real Volcengine inference; synthetic project/Memory; signed TEST ingress; native confirmation callback approved by this opt-in runner; no Electron GUI or business task mutation.",
    limits: {
      maximumDispatches: 2,
      maximumOutputTokensPerCall: 512,
      timeoutMsPerCall: 30000,
      retries: 0,
    },
    // Frozen before inference. These criteria are deliberately separate from
    // the model response; the resulting drafts remain suggestions.
    criteria: [
      "Strict title/description JSON accepted as pending",
      "Overdue review follow-up is actionable",
      "No unverified completion claim",
      "Memory scenario incorporates AZURE-17 or Mira",
      "No task mutation; original ID never re-dispatched; revoked Memory invalidates output",
    ],
    sources: Object.fromEntries(
      sourceFiles.map((file) => [
        file,
        sha(fs.readFileSync(path.join(ROOT, file))),
      ]),
    ),
    cases: [],
    status: "running",
  };
  const persist = () => {
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, JSON.stringify(report, null, 2) + "\n", 0, "utf8");
    fs.fsyncSync(fd);
  };
  persist();
  try {
    for (const scenario of [
      { type: "task.description.update", useMemory: false },
      { type: "task.create", useMemory: true },
    ]) {
      const item = { ...scenario, startedAt: new Date().toISOString() };
      report.cases.push(item);
      persist();
      let f;
      try {
        f = await createFixture({
          apiKey: llm.apiKey,
          model: llm.model,
          ...scenario,
        });
        const result = await f.service.generate(f.request);
        item.state = result.state;
        item.error = result.error;
        item.dispatchAttempts = f.state.dispatchAttempts;
        const rows = f.db
          .prepare("SELECT record_json FROM cc_project_goal_usage")
          .all();
        item.usageLedger = rows.map((row) => JSON.parse(row.record_json));
        item.providerUsage = f.state.providerResults.map((r) => ({
          requestedModel: llm.model,
          returnedModel: r.returnedModel,
          usage: r.usage,
        }));
        assert.equal(result.state, "saved");
        const saved = f.service.read({ id: result.proposalId });
        item.syntheticDraft = {
          title: saved.proposal.title,
          description: saved.proposal.description,
        };
        item.evaluation = {
          strictPending: saved.state === "pending-confirmation",
          actionableFollowUp: /review|verif|follow.up|checklist/iu.test(
            saved.proposal.description,
          ),
          memoryRelevant:
            !scenario.useMemory ||
            /AZURE-17|Mira/u.test(saved.proposal.description),
        };
        assert.equal(item.evaluation.strictPending, true);
        // Durable replay and restart use the same database and original ID.
        assert.deepEqual(await f.service.generate(f.request), result);
        assert.equal(f.state.dispatchAttempts, 1);
        item.sameIdDispatches = f.state.dispatchAttempts;
        assert.equal(
          f.db.prepare("SELECT COUNT(*) AS n FROM project_tasks").get().n,
          1,
        );
        item.businessTasksUnchanged = true;
        if (scenario.useMemory) {
          f.revoke();
          let rejected = false;
          try {
            f.service.read({ id: result.proposalId });
          } catch {
            rejected = true;
          }
          assert.equal(rejected, true);
          item.memoryRevocationRejectsOutput = true;
        }
        item.passed = true;
      } catch (error) {
        item.passed = false;
        item.failureCode =
          typeof error?.code === "string" &&
          /^(?:GOAL_[A-Z_]+|CC_AGENT_EVOLUTION_INGRESS_FAILED)$/u.test(
            error.code,
          )
            ? error.code
            : "LIVE_CHECK_FAILED";
        report.status = "failed";
      } finally {
        f?.close();
        persist();
      }
      // No second paid attempt following any failure, even with a new ID.
      if (!item.passed) break;
    }
    report.finishedAt = new Date().toISOString();
    if (report.status !== "failed") report.status = "passed";
    persist();
    console.log(
      JSON.stringify({
        status: report.status,
        cases: report.cases.length,
        dispatchAttempts: report.cases.reduce(
          (n, r) => n + (r.dispatchAttempts || 0),
          0,
        ),
        evidence: path.relative(ROOT, reportPath),
      }),
    );
    if (report.status !== "passed") process.exitCode = 1;
  } finally {
    fs.closeSync(fd);
  }
}
main().catch(() => {
  console.error(
    "Volcengine evaluation stopped; configuration, credentials and raw provider errors are withheld.",
  );
  process.exitCode = 1;
});
