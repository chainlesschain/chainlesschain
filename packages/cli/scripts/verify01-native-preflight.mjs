#!/usr/bin/env node
/** Versioned read-only native preparation. Never executes frozen code, creates
 * observations, accepts execution receipts, or grants review admission. */
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { outcomeDigest } from "../src/lib/eval/outcomes.js";
import {
  readBytes,
  validateVerify01Bundle,
} from "../src/lib/eval/verify01-contracts.js";
import {
  readNativeReviewBundle,
  resolveNativeReviewTarget,
} from "./verify01-native-review-admission.mjs";
import { VERIFY01_REVIEW_SPECS } from "./verify01-review-specs.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const reviewedCommit = "b2aa3aba082873570e85dce39b00754e5504ff37";
const unit = "packages/cli/__tests__/unit/";
const journalSource =
  "packages/cli/src/lib/process-execution-broker/process-ownership-journal.js";
const journalSourceDigest =
  "sha256:6f92ebbd6cd30eb4dd3e0c6b26049cada324f655bccabf19406e36311c9880e4";
// Static inventory of the actual 24 native task baselines at reviewedCommit.
// Changed bytes require another source review; absent guards prove no execution.
const reviewedBaselines = {
  [`${unit}model-capabilities.test.js`]:
    "sha256:0048e1987772f0ff063720d566f8578599059a6eca977896e2e77db546995edf",
  [`${unit}model-release-contract.test.js`]:
    "sha256:537a04f7145ce745fbc7eb0398f7700dd391a66e37eb2f036cdc5d0a09ea1f8a",
  [`${unit}llm-pricing.test.js`]:
    "sha256:5eb409d50a09cf30916e642956b6600ac08e9320c00c6e67ea856b94efc267d0",
  [`${unit}session-transcript-history.test.js`]:
    "sha256:100442776e62ff71c3594adbc6e06cd8c88f63f25f1bc17dea720646a2b225e0",
  [`${unit}session-branch.test.js`]:
    "sha256:5021526b3171eca1645212f796144853b4a43a389592b2ea56c355213a8781d9",
  [`${unit}session-history-origins.test.js`]:
    "sha256:9ea1bde1f3f2611ed88348ea47bfcace71aad7f1662c88960cff22c9cbab660a",
  [`${unit}background-agent-list-index.test.js`]:
    "sha256:d355ba8f94dbf77028466425c501cb74f28ce473b5a8c26d5f0c46feb7eb63a1",
  [`${unit}background-interaction-journal.test.js`]:
    "sha256:5a2b7ed477a67ccc5c7e773449f310336d3f6bff138606fb24727c0210fd20c7",
  [`${unit}background-command-argv.test.js`]:
    "sha256:c8af5d1c432e20d000e7a2af1c1195e15c538e424e63b1fdf7d64de9faf1361a",
  [`${unit}settings-source-observation.test.js`]:
    "sha256:ceebb691a0a2a78c725265235a15606e1ed04cf2fd309fab2248e9c12488b0fb",
  [`${unit}process-ownership-journal.test.js`]:
    "sha256:6ffd16023eb0ea46e992333af6360e7b7ec9ecf6fc5870fbd3bea30b4160f2fc",
  [`${unit}process-ownership-quarantine.test.js`]:
    "sha256:a02eeeb0f484563a191f5c275979aae9b42f099c447b94649f1e3ce75fe8c221",
  [`${unit}headless-stream-approvals.test.js`]:
    "sha256:c952533d14d984f3aade6cf14eddcb2d6c15e5ae3b73caaf790690c43316fef6",
  [`${unit}permission-decision.test.js`]:
    "sha256:80a7246e56786d86fef6b5facc26f32bb4f2c43c6f4dd84b2c90f9d6b2f0ae81",
  [`${unit}segmented-memory-port.test.js`]:
    "sha256:b8cda9af3714ffb85f67cd98d8d9b2c080f3127c4dc4d00eb7ea2930a67ba3af",
  [`${unit}vscode-ext-draft-store.test.js`]:
    "sha256:916c745439ab33c502afa109e1a1513f36f7fe903819e6c6d5785d55d0f05349",
  [`${unit}vscode-ext-question-drafts.test.js`]:
    "sha256:3280716890b5c66eb0ca9d5995c92d16e5e57a6a742843e77ac908566c1a83cf",
  [`${unit}vscode-ext-chat-mode.test.js`]:
    "sha256:454f02dbce547213b076302f8c8a27ac02c3aa147e8b50f3a0124fa5e1745dc6",
  [`${unit}vscode-ext-image-decode-budget.test.js`]:
    "sha256:49bd7c2e821252eeced06258785855c84acd397776f9ac0dce052883f44d5742",
  [`${unit}task-outcome-report.test.js`]:
    "sha256:af94bf5720106dc19ddfa98f87af39c330db4381841bd795e4d2aa314bc5c5fb",
  [`${unit}fallback-model.test.js`]:
    "sha256:2f7767a2f517059f3988ed7a374823d1f574eb9d4a03cc04f4b1e9288bb33890",
  "packages/cli/__tests__/integration/orchestrator-workflow.test.js":
    "sha256:c003c36bdcb1cd0ebfd3a652bf05483d7f2adb9714daf29eb276daa20abd0d62",
  [`${unit}background-launch-profile.test.js`]:
    "sha256:5580c107d964d1d64967ecb007ad281b81bbf1fc1fb5b812105f1d94c1d04d3a",
};
const guards = {
  [`${unit}process-ownership-journal.test.js`]: {
    scope: "suite",
    name: "durable process ownership journal",
    anchor: 'describe.skipIf(process.platform !== "linux")(',
    condition: "platform !== linux",
    skippedPlatforms: ["win32", "darwin"],
  },
  [`${unit}segmented-memory-port.test.js`]: {
    scope: "test",
    name: "reports post-publication failure when durable removal of superseded shards cannot be synced",
    anchor: 'it.skipIf(process.platform === "win32")(',
    condition: "platform === win32",
    skippedPlatforms: ["win32"],
  },
  [`${unit}settings-source-observation.test.js`]: {
    scope: "test",
    name: "rejects a real final file symlink",
    anchor: 'it.skipIf(process.platform === "win32")(',
    condition: "platform === win32",
    skippedPlatforms: ["win32"],
  },
};
const requireCondition = (condition, detail) => {
  if (!condition) throw new Error(`Native preflight: ${detail}`);
};
const blocker = (code, detail) => ({ code, detail });
const sourceMetadata = ({ path, digest }) => ({ path, digest });
const runtimeHost = () => ({
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  osRelease: os.release(),
});

function baselinePortability(input, commit, platform) {
  const { bytes, ...source } = input;
  const known =
    commit === reviewedCommit &&
    reviewedBaselines[source.path] === source.digest;
  const rule = guards[source.path];
  if (!known)
    return { ...source, status: "SOURCE_REVIEW_REQUIRED", guards: [] };
  if (!rule)
    return {
      ...source,
      status: "NO_STATIC_PLATFORM_GUARD_IDENTIFIED",
      guards: [],
    };
  const text = bytes.toString("utf8");
  requireCondition(
    text.split(rule.anchor).length === 2 && text.includes(rule.name),
    "reviewed frozen guard inventory is inconsistent",
  );
  const activeOnTarget = rule.skippedPlatforms.includes(platform);
  return {
    ...source,
    status: activeOnTarget
      ? rule.scope === "suite"
        ? "ENTIRE_BASELINE_SKIPPED_ON_TARGET"
        : "KNOWN_PARTIAL_BASELINE_SKIP"
      : "KNOWN_GUARD_INACTIVE_ON_TARGET",
    guards: [
      {
        scope: rule.scope,
        name: rule.name,
        anchor: rule.anchor,
        condition: rule.condition,
        line: text.slice(0, text.indexOf(rule.anchor)).split("\n").length,
        activeOnTarget,
      },
    ],
  };
}

/** Host overrides and reader injection support operator inspection and tests;
 * they are declarations, never host attestations or review execution evidence. */
export function inspectNativePreflight(bundle, options = {}) {
  const validated = validateVerify01Bundle(bundle);
  requireCondition(
    options &&
      Object.keys(options).every((key) =>
        ["platforms", "sampleIds", "host", "readFrozenBlob"].includes(key),
      ),
    "unsupported inspection option; execution/readiness receipts are not accepted",
  );
  const {
    platforms = ["win32", "darwin"],
    sampleIds,
    host = runtimeHost(),
    readFrozenBlob = (commit, file) =>
      execFileSync("git", ["-C", repository, "show", `${commit}:${file}`], {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      }),
  } = options;
  requireCondition(
    Array.isArray(platforms) &&
      platforms.length > 0 &&
      new Set(platforms).size === platforms.length &&
      platforms.every((value) => ["win32", "darwin"].includes(value)),
    "unique Windows/macOS native target platforms required",
  );
  requireCondition(
    host &&
      ["platform", "arch", "node", "osRelease"].every(
        (key) => typeof host[key] === "string" && host[key].length > 0,
      ) &&
      typeof readFrozenBlob === "function",
    "host identity and frozen source reader required",
  );
  const specs = new Map(
    VERIFY01_REVIEW_SPECS.map((spec) => [spec.taskId, spec]),
  );
  requireCondition(
    specs.size === 36 && VERIFY01_REVIEW_SPECS.length === 36,
    "review specification population changed",
  );
  // Authenticate all 36 task target rows before selecting the native subset.
  const targets = new Map(
    bundle.plan.samples
      .filter((s) => s.kind === "task")
      .map((sample) => [sample.id, resolveNativeReviewTarget(bundle, sample)]),
  );
  const ids =
    sampleIds ??
    [...targets]
      .filter(([, target]) => platforms.includes(target.platform))
      .map(([id]) => id);
  requireCondition(
    Array.isArray(ids) &&
      ids.length > 0 &&
      new Set(ids).size === ids.length &&
      ids.every((id) => typeof id === "string"),
    "selected tasks missing or duplicated",
  );
  const sources = new Map();
  const read = (file) => {
    requireCondition(
      typeof file === "string" &&
        !/[\\:*?<>|]/u.test(file) &&
        !file.includes("\u0000") &&
        file.split("/").every((part) => part && part !== "." && part !== ".."),
      "exact relative frozen source path required",
    );
    if (!sources.has(file)) {
      const bytes = readFrozenBlob(bundle.catalog.projectCommit, file);
      requireCondition(
        Buffer.isBuffer(bytes) &&
          bytes.length > 0 &&
          bytes.length <= 1024 * 1024,
        "bounded nonempty frozen source bytes required",
      );
      sources.set(file, { path: file, digest: evalDigest(bytes), bytes });
    }
    return sources.get(file);
  };
  const tasks = ids.map((id) => {
    const sample = validated.samples.get(id);
    requireCondition(
      sample?.kind === "task" && targets.has(id),
      "selection must contain frozen tasks, never first-run samples",
    );
    const target = targets.get(id);
    requireCondition(
      platforms.includes(target.platform),
      "selected sample is outside the requested native platforms",
    );
    const spec = specs.get(sample.taskId);
    requireCondition(spec, "task has no reviewed specification");
    const blockers = [];
    const osMatches =
      target.platform === "win32"
        ? target.os === "Windows 11 24H2" &&
          /^10\.0\.26100(?:\.\d+)?$/u.test(host.osRelease)
        : target.os === "macOS 15" && /^24\.\d+\.\d+$/u.test(host.osRelease);
    if (
      host.platform !== target.platform ||
      host.arch !== target.arch ||
      host.node !== target.node ||
      !osMatches
    )
      blockers.push(
        blocker(
          "FROZEN_RUNTIME_MISMATCH",
          `Target ${target.os}/${target.platform}/${target.arch}/${target.node}; inspected host ${host.osRelease}/${host.platform}/${host.arch}/${host.node}.`,
        ),
      );
    const baselines = spec.baselineTests.map((file) =>
      baselinePortability(
        read(file),
        bundle.catalog.projectCommit,
        target.platform,
      ),
    );
    for (const baseline of baselines) {
      if (baseline.status === "SOURCE_REVIEW_REQUIRED")
        blockers.push(blocker("FROZEN_SOURCE_REVIEW_REQUIRED", baseline.path));
      if (baseline.status === "ENTIRE_BASELINE_SKIPPED_ON_TARGET")
        blockers.push(
          blocker(
            "BASELINE_PLATFORM_UNSUPPORTED",
            `${baseline.path} has no executed cases on ${target.platform}; all-pending baselines cannot pass.`,
          ),
        );
    }
    const sourcePaths = spec.sourcePath
      ? [spec.sourcePath]
      : validated.tasks.get(sample.taskId).sourcePaths;
    const taskSources = sourcePaths.map((file) => sourceMetadata(read(file)));
    let implementationPortability = { status: "NOT_ASSESSED" };
    if (sourcePaths.includes(journalSource)) {
      const source = read(journalSource);
      const anchor =
        'if (process.platform !== "linux" || !path.isAbsolute(directory))';
      const known =
        bundle.catalog.projectCommit === reviewedCommit &&
        source.digest === journalSourceDigest;
      implementationPortability = {
        path: journalSource,
        digest: source.digest,
        status: known ? "UNSUPPORTED_ON_TARGET" : "SOURCE_REVIEW_REQUIRED",
        supportedPlatform: known ? "linux" : null,
        guard: known
          ? {
              anchor,
              line: source.bytes
                .toString("utf8")
                .slice(0, source.bytes.toString("utf8").indexOf(anchor))
                .split("\n").length,
            }
          : null,
      };
      blockers.push(
        blocker(
          known
            ? "IMPLEMENTATION_PLATFORM_UNSUPPORTED"
            : "FROZEN_SOURCE_REVIEW_REQUIRED",
          known
            ? "Frozen ownership journal implementation rejects non-Linux hosts."
            : "Ownership journal implementation bytes require a new static review.",
        ),
      );
    }
    // Source preparation cannot satisfy any of these execution prerequisites.
    blockers.push(
      blocker(
        "TRUSTED_TOOLCHAIN_NOT_IMPLEMENTED",
        "Actual frozen toolchain loading, ABI and review execution need native receipts.",
      ),
      blocker(
        "LOCKED_TEST_SUPPORT_NOT_IMPLEMENTED",
        "Frozen setup/globalSetup/config must execute inside a protected native tree.",
      ),
      blocker(
        "PROTECTED_STORAGE_NOT_IMPLEMENTED",
        "Protected journal/CAS, flush and crash recovery need a native backend; fixed-canary reads cannot satisfy them.",
      ),
      blocker(
        "FULL_NATIVE_EXECUTION_NOT_OBSERVED",
        "Baseline, candidate, mutant and process settlement receipts are not assessed by this read-only preflight.",
      ),
    );
    return {
      sampleId: id,
      taskId: sample.taskId,
      stratum: sample.stratum,
      comparisonDigest: sample.comparisonDigest,
      target: { ...target },
      targetDigest: outcomeDigest(target),
      baselines,
      taskSources,
      implementationPortability,
      portabilityBasis:
        "static-frozen-source-only; imports and setup not executed",
      observedTestCounts: null,
      status: "NOT_READY",
      blockers,
    };
  });
  const firstRuns = bundle.plan.samples.filter(
    (sample) => sample.kind !== "task",
  );
  const frozenTestSupport = [
    "packages/cli/test/global-setup/windows-sandbox-adapter-temp-root.js",
    "packages/cli/test/setup/windows-sandbox-adapter-cleanup.js",
    "packages/cli/test/setup/agent-evolution-test-boundary.js",
  ].map((file) => sourceMetadata(read(file)));
  const currentSources = [
    "verify01-native-preflight.mjs",
    "verify01-native-review-admission.mjs",
    "verify01-review-specs.mjs",
    "verify01-review-runtime.mjs",
  ].map((name) => ({
    path: `packages/cli/scripts/${name}`,
    digest: evalDigest(
      readBytes(fileURLToPath(new URL(`./${name}`, import.meta.url))),
    ),
  }));
  return {
    schema: "chainlesschain.verify01-native-preflight/v1",
    scope: "read-only-operator-preparation",
    status: "NOT_READY",
    planDigest: bundle.expectedPlanDigest,
    catalogDigest: outcomeDigest(bundle.catalog),
    projectCommit: bundle.catalog.projectCommit,
    specsDigest: outcomeDigest(VERIFY01_REVIEW_SPECS),
    currentSources,
    staticInventoryCommit: reviewedCommit,
    staticInventoryDigest: outcomeDigest({
      reviewedBaselines,
      guards,
      journalSourceDigest,
    }),
    sourceReadBasis: options.readFrozenBlob
      ? "operator-supplied-reader"
      : "frozen-git-blobs",
    host: { ...host },
    hostBasis: options.host ? "operator-input" : "local-runtime-observation",
    hostAttested: false,
    selectedPlatforms: [...platforms],
    plannedTasks: targets.size,
    selectedTasks: tasks.length,
    perPlatform: platforms.map((platform) => ({
      platform,
      selectedTasks: tasks.filter((task) => task.target.platform === platform)
        .length,
      readyTasks: 0,
    })),
    firstRuns: {
      planned: firstRuns.length,
      observations: 0,
      status: "NOT_ASSESSED",
      sampleIds: firstRuns.map((sample) => sample.id),
    },
    frozenTestSupport,
    frozenSources: [...sources.values()].map(sourceMetadata),
    tasks,
    readyTasks: 0,
    fullReviewPackReady: false,
    executionStatus: "NOT_RUN",
    capabilityCapture: { status: "NOT_ASSESSED" },
    formalSample: false,
    providerAssessed: false,
    observationsCreated: false,
    independentHumanReview: false,
    productionAttested: false,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        "plan-dir": { type: "string" },
        platforms: { type: "string" },
        samples: { type: "string" },
        help: { type: "boolean" },
      },
    });
    if (values.help)
      console.log(
        "Read-only native preflight; no execution or admission.\n--plan-dir DIR [--platforms win32,darwin] [--samples verify-01,verify-17]",
      );
    else {
      requireCondition(
        typeof values["plan-dir"] === "string" && values["plan-dir"].length > 0,
        "explicit --plan-dir required; no legacy plan is selected implicitly",
      );
      console.log(
        JSON.stringify(
          inspectNativePreflight(readNativeReviewBundle(values["plan-dir"]), {
            platforms: values.platforms?.split(","),
            sampleIds: values.samples?.split(","),
          }),
          null,
          2,
        ),
      );
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`Native preflight rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
