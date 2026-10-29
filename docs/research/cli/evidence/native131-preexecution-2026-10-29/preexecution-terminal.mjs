import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const PREFIX =
  "docs/research/cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18";
const ARCHIVE = "docs/research/cli/evidence/native131-preexecution-2026-10-29/";
const SOURCE = "8e72ccf5b30cff3f6edb8ed8c9c326e72c3c6304";
const RUN = "40886343743";
const PLAN = `${PREFIX}/next-package-131-easy-first-20261029-plan.json`;
const SUCCESSOR = `${PREFIX}/next-package-131-preflight-repair-20261029-plan.json`;
const PACKAGE =
  "docs/research/cli/verify01-package-sets/2026-10-29-review-131.json";
const WORKFLOW = ".github/workflows/verify01-native-task-campaign.yml";
const HASHES = {
  plan: "0ef9a3640f8a67fb399e47e99f9bd5466f637fba0954b3fade4f9a2b2e718519",
  packageSet:
    "120f53d500bfc9b923cc713bea8f6040c28ad92df8ba3490ce914197aa0ccd81",
  workflow: "650a30daa24f3962fcbfeb15b2b9fd8ac54f85dc5c61926d8f0445cbdaca5a78",
  context: "bd0f235282e66bc3cd4446b46396bbbcb2d9646901ef66f448507069af091d3e",
  intent: "b19deb1be93a0649259794d3be6bd91a17a7cee658fc4bf2350b51f0ebef6419",
  request: "703c543e8899697dc590ad0a8c7b74e5e5f174d0c7ed89e00f27b0387f256154",
  resolved: "b74c9e9e1ddfd01681bbc2a3f0c89437880774f228076e08173346c1d533a2fd",
  ledger: "52125b9fa17811f52bb80ce483f5998b77cc652a6ed0dde405cab448b7a718fa",
};
const SHARD = {
  shardId: "win32-cli--verify-10",
  group: "win32-cli",
  sampleIds: ["verify-10"],
};
const EVIDENCE_KEYS = [
  "plan",
  "packageSet",
  "context",
  "intent",
  "request",
  "resolved",
  "ledger",
  "run",
  "jobs",
  "artifacts",
  "workflow",
  "log",
];
const CERTIFICATE_KEYS = [
  "schema",
  "outcome",
  "sourceCommit",
  "runId",
  "runAttempt",
  "shardId",
  "group",
  "sampleIds",
  "planPath",
  "planDigest",
  "packageSetPath",
  "packageSetDigest",
  "successorPlanPath",
  "generationExecution",
  "acceptanceExecution",
  "billingAssessed",
  "liabilitiesPreserved",
  "evidence",
];
const sha256 = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const keysEqual = (object, keys) =>
  object !== null &&
  typeof object === "object" &&
  !Array.isArray(object) &&
  isDeepStrictEqual(Object.keys(object).sort(), [...keys].sort());

// Deliberately only this observed run, source, attempt, journal and failure.
// The caller must additionally verify the original ledger with its strict
// verifier, refresh remote evidence, and enforce the unique successor use.
// No IO, subprocesses, model calls or billing assessment occur here.
export function verifyPreexecutionTerminal({
  certificate,
  readBytes,
  gitBytes,
  need,
}) {
  const check = (condition, code) =>
    need(Boolean(condition), `preexecution:${code}`);
  check(keysEqual(certificate, CERTIFICATE_KEYS), "certificate-shape");
  const fixed = {
    schema: "chainlesschain.native-preexecution-terminal/v1",
    outcome: "VALIDATION_FAILED_BEFORE_GENERATION",
    sourceCommit: SOURCE,
    runId: RUN,
    runAttempt: 1,
    ...SHARD,
    planPath: PLAN,
    planDigest: `sha256:${HASHES.plan}`,
    packageSetPath: PACKAGE,
    packageSetDigest: `sha256:${HASHES.packageSet}`,
    successorPlanPath: SUCCESSOR,
    generationExecution: "NOT_STARTED",
    acceptanceExecution: "NOT_STARTED",
    billingAssessed: false,
    liabilitiesPreserved: true,
  };
  for (const [key, value] of Object.entries(fixed)) {
    check(isDeepStrictEqual(certificate[key], value), `certificate-${key}`);
  }
  check(keysEqual(certificate.evidence, EVIDENCE_KEYS), "evidence-shape");
  const raw = {},
    data = {},
    paths = new Set();
  for (const key of EVIDENCE_KEYS) {
    const entry = certificate.evidence[key];
    check(keysEqual(entry, ["path", "digest", "bytes"]), `${key}-entry`);
    check(
      typeof entry.path === "string" &&
        entry.path.startsWith(ARCHIVE) &&
        /^[a-zA-Z0-9/_.-]+$/.test(entry.path) &&
        !entry.path.split("/").some((part) => ["", ".", ".."].includes(part)) &&
        !paths.has(entry.path),
      `${key}-path`,
    );
    paths.add(entry.path);
    check(
      Number.isSafeInteger(entry.bytes) &&
        entry.bytes > 0 &&
        /^sha256:[a-f0-9]{64}$/.test(entry.digest),
      `${key}-metadata`,
    );
    raw[key] = readBytes(entry.path);
    check(
      Buffer.isBuffer(raw[key]) &&
        raw[key].length === entry.bytes &&
        sha256(raw[key]) === entry.digest,
      `${key}-bytes`,
    );
    if (HASHES[key])
      check(entry.digest === `sha256:${HASHES[key]}`, `${key}-original-digest`);
    if (!["workflow", "log"].includes(key)) {
      try {
        data[key] = JSON.parse(raw[key].toString("utf8"));
      } catch {
        check(false, `${key}-json`);
      }
      check(
        data[key] !== null &&
          typeof data[key] === "object" &&
          !Array.isArray(data[key]),
        `${key}-object`,
      );
    }
  }
  for (const [key, path] of [
    ["plan", PLAN],
    ["packageSet", PACKAGE],
    ["workflow", WORKFLOW],
  ]) {
    const committed = gitBytes(SOURCE, path);
    check(
      Buffer.isBuffer(committed) && raw[key].equals(committed),
      `${key}-committed-bytes`,
    );
  }
  const {
    plan,
    context,
    intent,
    request,
    resolved,
    ledger,
    run,
    jobs,
    artifacts,
  } = data;
  check(
    context.schema === "chainlesschain.native-dispatch-journal/v1" &&
      context.repository === "chainlesschain/chainlesschain" &&
      context.workflow === "verify01-native-task-campaign.yml" &&
      context.branch === "main" &&
      context.sourceCommit === SOURCE &&
      context.reviewChanges === true,
    "journal-context",
  );
  for (const key of [
    "planPath",
    "planDigest",
    "packageSetPath",
    "packageSetDigest",
  ])
    check(
      context[key] === certificate[key] && ledger[key] === certificate[key],
      `journal-${key}`,
    );
  check(
    isDeepStrictEqual(context.executionShards, plan.executionShards) &&
      isDeepStrictEqual(context.versions, plan.versions) &&
      isDeepStrictEqual(intent.binding, context) &&
      isDeepStrictEqual(intent.shard, SHARD) &&
      isDeepStrictEqual(intent.beforeRunIds, []),
    "journal-intent",
  );
  check(
    request.outcome === "returned-success" &&
      request.processExitCode === 0 &&
      isDeepStrictEqual(request.httpStatuses, []),
    "journal-request",
  );
  check(
    isDeepStrictEqual(resolved, {
      shardId: SHARD.shardId,
      group: SHARD.group,
      runId: RUN,
      sourceCommit: SOURCE,
    }),
    "journal-resolved",
  );
  check(
    Date.parse(intent.createdAt) < Date.parse(run.created_at) &&
      Date.parse(run.created_at) <= Date.parse(request.observedAt),
    "journal-time",
  );
  check(
    ledger.status === "IN_PROGRESS" &&
      ledger.billingAssessed === false &&
      ledger.partialDispatch === true &&
      ledger.plannedNewSamples === 11 &&
      ledger.runs.length === 1,
    "ledger-terminal-shape",
  );
  const originalRun = ledger.runs[0];
  check(
    keysEqual(originalRun, [
      "shardId",
      "group",
      "runId",
      "sourceCommit",
      "selectedSampleIds",
      "status",
      "remoteState",
      "remoteStatus",
      "conclusion",
      "activeJobs",
      "evidence",
    ]),
    "ledger-run-fields",
  );
  check(
    originalRun.runId === RUN &&
      originalRun.sourceCommit === SOURCE &&
      originalRun.shardId === SHARD.shardId &&
      originalRun.group === SHARD.group &&
      isDeepStrictEqual(originalRun.selectedSampleIds, SHARD.sampleIds) &&
      originalRun.status === "IN_PROGRESS" &&
      originalRun.remoteStatus === "completed" &&
      originalRun.conclusion === "failure" &&
      isDeepStrictEqual(originalRun.activeJobs, []) &&
      isDeepStrictEqual(originalRun.evidence, []),
    "ledger-no-generated-records",
  );
  check(
    isDeepStrictEqual(ledger.counts, {
      generationRecordsCollected: 0,
      acceptanceRecordsCollected: 0,
      candidateAcceptancePassed: 0,
      endToEndPassed: 0,
      reusedAcceptedDeliverables: 34,
      cumulativeAcceptedDeliverables: 34,
    }),
    "ledger-counts",
  );
  check(
    ledger.samples.length === 11 &&
      ledger.samples.every(
        (sample, index) =>
          sample.generationObserved === false &&
          sample.status ===
            (index === 0 ? "PENDING_EXECUTION" : "PENDING_DISPATCH") &&
          sample.sampleId === plan.executionShards[index].sampleIds[0] &&
          keysEqual(sample, [
            "sampleId",
            "taskId",
            "kind",
            "group",
            "status",
            "generationObserved",
          ]),
      ),
    "ledger-pending-samples",
  );

  check(
    String(run.id) === RUN &&
      run.run_attempt === 1 &&
      run.head_sha === SOURCE &&
      run.head_branch === "main" &&
      run.path === WORKFLOW &&
      run.event === "workflow_dispatch" &&
      run.status === "completed" &&
      run.conclusion === "failure",
    "remote-run",
  );
  check(
    keysEqual(jobs, ["total_count", "jobs"]) &&
      jobs.total_count === 3 &&
      Array.isArray(jobs.jobs) &&
      jobs.jobs.length === 3,
    "complete-jobs",
  );
  const expectedNames = new Map([
    [123490986288, "validate"],
    [123493049619, "Linux acceptance of ${{ matrix.group }} deliveries"],
    [
      123493050050,
      "Native ${{ matrix.group }} (${{ (((inputs.sample_ids != '') && 'selected samples') || 'five independent samples') }})",
    ],
  ]);
  check(new Set(jobs.jobs.map((job) => job.id)).size === 3, "unique-jobs");
  for (const job of jobs.jobs) {
    check(
      expectedNames.has(job.id) &&
        job.name === expectedNames.get(job.id) &&
        String(job.run_id) === RUN &&
        job.run_attempt === 1 &&
        job.head_sha === SOURCE &&
        job.head_branch === "main" &&
        job.status === "completed" &&
        job.run_url ===
          `https://api.github.com/repos/chainlesschain/chainlesschain/actions/runs/${RUN}` &&
        job.url ===
          `https://api.github.com/repos/chainlesschain/chainlesschain/actions/jobs/${job.id}`,
      "job-identity",
    );
    if (job.id === 123490986288) {
      check(
        job.conclusion === "failure" &&
          job.runner_id === 1000432703 &&
          job.runner_name === "GitHub Actions 1000432703",
        "validate-failure",
      );
      const steps = [
        [1, "Set up job", "success"],
        [2, "Run actions/checkout@v5", "success"],
        [3, "Run actions/setup-node@v5", "success"],
        [4, "Prepare operator workspace dependency", "success"],
        [
          5,
          "Validate exact sample selection, candidate binding and host controls",
          "failure",
        ],
        [6, "Select requested native hosts", "skipped"],
        [11, "Post Run actions/setup-node@v5", "skipped"],
        [12, "Post Run actions/checkout@v5", "success"],
        [13, "Complete job", "success"],
      ];
      check(
        Array.isArray(job.steps) &&
          job.steps.length === steps.length &&
          job.steps.every(
            (step, index) =>
              step.status === "completed" &&
              isDeepStrictEqual(
                [step.number, step.name, step.conclusion],
                steps[index],
              ),
          ),
        "validate-steps",
      );
    } else {
      check(
        job.conclusion === "skipped" &&
          [
            "runner_id",
            "runner_name",
            "runner_group_id",
            "runner_group_name",
          ].every((key) => job[key] === null) &&
          Array.isArray(job.steps) &&
          job.steps.length === 0,
        "downstream-not-started",
      );
    }
  }
  check(
    keysEqual(artifacts, ["total_count", "artifacts"]) &&
      artifacts.total_count === 0 &&
      Array.isArray(artifacts.artifacts) &&
      artifacts.artifacts.length === 0,
    "no-artifacts",
  );
  const workflow = raw.workflow.toString("utf8");
  const generate = workflow.indexOf("\n  generate:");
  const accept = workflow.indexOf("\n  accept:");
  const secret = workflow.indexOf("secrets.CC_LLM_API_KEY");
  const invocation = workflow.indexOf(
    "node packages/cli/scripts/verify01-native-task-campaign.mjs",
  );
  check(
    generate > 0 &&
      accept > generate &&
      secret > generate &&
      secret < accept &&
      workflow.split("secrets.CC_LLM_API_KEY").length === 2 &&
      invocation > generate &&
      invocation < accept,
    "workflow-paid-scope",
  );
  const log = raw.log.toString("utf8");
  for (const fragment of [
    "not ok 67 - dispatcher review opt-in preserves legacy argv and is journal-bound",
    "verify01-native-task-campaign.node-test.mjs:313:1",
    "failureType: 'testCodeFailure'",
    "source.indexOf(\"context['reviewChanges'] = True\") <",
    "source.indexOf(\"directory = WORK / 'next-package-dispatch'\"),",
    "code: 'ERR_ASSERTION'",
  ])
    check(log.includes(fragment), "known-validation-failure");
  check(
    (log.match(/\bnot ok \d+ - /g) || []).length === 1 &&
      (log.match(/# fail 1(?:\r?\n|$)/g) || []).length === 1 &&
      !/# fail (?!1(?:\r?\n|$))\d+/.test(log),
    "single-validation-failure",
  );
  return {
    outcome: fixed.outcome,
    runId: RUN,
    sourceCommit: SOURCE,
    runAttempt: 1,
    shardId: SHARD.shardId,
    generationExecution: "NOT_STARTED",
    acceptanceExecution: "NOT_STARTED",
    billingAssessed: false,
    liabilitiesPreserved: true,
    successorPlanPath: SUCCESSOR,
    // Compare fresh full remote responses to these archived parsed responses.
    expected: { run, jobs, artifacts },
  };
}
