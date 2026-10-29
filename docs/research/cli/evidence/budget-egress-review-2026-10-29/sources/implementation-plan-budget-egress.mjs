#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { FORMAL_BUDGET_RUNTIME_READINESS } from "../src/lib/formal-budget-transport.js";
import {
  scanNetworkSources,
  reviewNetworkSources,
} from "./lib/budget-egress-inventory.mjs";

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    check: { type: "boolean", default: false },
    "include-scripts": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(
    "Usage: node implementation-plan-budget-egress.mjs [--output <path>] [--check] [--include-scripts]\n--check rejects unreviewed/stale sources, parse errors and skipped symlinks. This static check never grants paid admission.",
  );
  process.exit(0);
}
if (!values.output && !values.check)
  throw new Error("--output is required unless --check is used");

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const definitions = [
  [
    "agent",
    ["agentLoop", "chatWithTools", "provider fetch"],
    ["runtime/headless-runner.js", "runtime/agent-core.js"],
    "Explicit host scope routes canonical in-process provider calls. Attest all launchers, fallbacks and host combinations before admission.",
  ],
  [
    "chat",
    [
      "startChatRepl / chat gateway",
      "streamOpenAI / streamAnthropic / streamOllama",
      "provider fetch",
    ],
    ["repl/chat-repl.js", "lib/chat-core.js", "lib/provider-stream.js"],
    "Explicit host scope routes ordinary Chat. Verify all gateway/REPL host lifetimes before admission.",
  ],
  [
    "compaction",
    [
      "compactConversationWithProvider / _getAutoCompactor",
      "llmQuery",
      "chatWithTools",
    ],
    [
      "harness/provider-backed-compaction.js",
      "harness/prompt-compressor.js",
      "runtime/agent-core.js",
    ],
    "Reserve semantic compaction independently and retain known usage when the context commit is rejected.",
  ],
  [
    "advisor",
    ["AdvisorRuntime", "chatWithTools"],
    ["lib/advisor-runtime.js"],
    "Unify the Advisor CostBudget with the formal budget lineage.",
  ],
  [
    "probe",
    ["probeLlmConnection", "fetchImpl"],
    ["lib/llm-connection-probe.js", "lib/llm-providers.js"],
    "Govern health probes and preserve missing or invalid usage as unresolved liability.",
  ],
  [
    "retry",
    ["_retryStreamingChat / stream retry", "fresh provider attempt"],
    [
      "lib/stream-retry.js",
      "lib/model-failure-policy.js",
      "runtime/agent-core.js",
    ],
    "Use a distinct reservation per attempt; do not retry unknown provider outcomes.",
  ],
  [
    "child",
    [
      "SubAgentContext / cowork",
      "createChatFn / child agentLoop",
      "provider fetch",
    ],
    [
      "lib/sub-agent-context.js",
      "lib/cowork-adapter.js",
      "lib/process-execution-broker/index.js",
    ],
    "Keep credentials and authority outside task descendants; prove they cannot bypass the governed egress.",
  ],
  [
    "additional-model-adapters",
    ["typed decision / hub model adapter", "provider transport"],
    [
      "lib/decision-layer/typesafe-provider.js",
      "lib/decision-layer/providers.js",
      "lib/hub-llm-client.js",
      "commands/ask.js",
      "lib/evolution/governed-hub-llm.js",
      "lib/evolution/governed-hub-resolver.js",
      "lib/evolution/governed-skill-synthesis-process-grader.js",
    ],
    "Decide and attest formal scope for additional model adapters before admitting any paid task.",
  ],
];
const relative = (file) =>
  path.relative(repository, file).replaceAll(path.sep, "/");
const sources = (files) =>
  files.map((file) => {
    const absolute = path.join(repository, "packages/cli/src", file);
    return {
      path: relative(absolute),
      digest: hash(fs.readFileSync(absolute)),
    };
  });
const categories = definitions.map(
  ([id, callChain, files, requiredIntegration]) => ({
    id,
    callChain,
    sources: sources(files),
    formalCoverage: "NOT_ATTESTED",
    hostScopeIntegration:
      id === "child"
        ? "IN_PROCESS_ONLY_DESCENDANTS_UNCOVERED"
        : id === "additional-model-adapters"
          ? "ASK_HUB_ROUTED_OPAQUE_SDK_EMBEDDINGS_AND_GRADER_LAUNCH_DENIED"
          : "CANONICAL_IN_PROCESS_ROUTES_ONLY",
    requiredIntegration,
  }),
);
const callChainMapped = new Set(
  categories.flatMap((row) => row.sources.map((source) => source.path)),
);
const auditRoots = [
  "packages/cli/src",
  ...(values["include-scripts"] ? ["packages/cli/scripts"] : []),
];
const scan = scanNetworkSources(repository, auditRoots);
const candidates = scan.networkCandidates;
const reviewPath = path.join(
  repository,
  "packages/cli/scripts/budget-egress-reviewed-sources.json",
);
const reviewBytes = fs.readFileSync(reviewPath);
const sourceReview = reviewNetworkSources(scan, JSON.parse(reviewBytes));
const report = {
  schema: "chainlesschain.implementation-plan-budget-egress-review/v2",
  capturedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  }).trim(),
  readiness: FORMAL_BUDGET_RUNTIME_READINESS,
  scope:
    "AST call candidates with conservative alias tracking and source-bound review. Not an interprocedural analysis or proof of dynamic SDK/descendant containment.",
  auditRoots,
  exclusions: [
    "__tests__",
    "node_modules",
    ".git",
    "comments, strings and generated template bodies",
  ],
  filesScanned: scan.filesScanned,
  sourceTreeDigest: scan.sourceTreeDigest,
  parseErrors: scan.parseErrors,
  skippedPaths: scan.skippedPaths,
  sourceReview: {
    catalogue: relative(reviewPath),
    digest: hash(reviewBytes),
    ...sourceReview,
  },
  exhaustive: false,
  runtimeCoverageVerified: false,
  scopedTransport: {
    enabledByDefault: false,
    protocols: ["openai-chat"],
    trustedHostSources: sources([
      "lib/formal-budget-provider-scope.js",
      "lib/formal-budget-transport.js",
      "lib/formal-budget-authority.js",
      "lib/formal-budget-lineage-registry.js",
      "lib/formal-budget-contract.js",
      "lib/formal-budget-errors.js",
    ]),
    isolationBoundary:
      "Async-local in-process calls only; no OS, SDK, worker or subprocess containment",
    formalAdmission: "UNCHANGED_NOT_ADMITTED",
    lineageRegistry: {
      enabledByDefault: false,
      guardedAuthoritiesRequireRegistry: true,
      automaticallyMigratesLegacyAuthorities: false,
      independentStorageProtectionVerified: false,
      registryRollbackResistanceVerified: false,
      physicalRegistryBinding: true,
      liveObservedHeadChecks: true,
      trustedRestartCheckpointSupport: true,
      trustedCheckpointAuthenticationVerified: false,
      trustedCheckpointBeforeEveryDispatchVerified: false,
      restartCheckpointPolicyEnforced: false,
      pinnedCheckpointHostPolicyAvailable: true,
      checkpointHostMode: "EXPLICIT_INITIALIZATION_ONLY",
      checkpointHostDispatchOrdering:
        "REGISTRY_COMMIT_HOST_DURABLE_ACK_AUTHORITY_COMMIT_FETCH",
      checkpointHostDeploymentVerified: false,
      mismatchRecovery: "STOP_FOR_EXTERNAL_RECONCILIATION_WITHOUT_RESET",
    },
    unsupportedAdapters: [
      "opaque Hub SDK and Desktop callbacks",
      "native and custom Hub embeddings",
      "governed skill synthesis grader child process",
      "external search services without a verified billing contract",
      "standalone paid model diagnostics and native diagnostic broker launch",
    ],
    unsupportedAdapterAction:
      "REJECT_BEFORE_ADAPTER_INVOCATION_OR_CHILD_LAUNCH",
    canonicalAgentToolBoundary: {
      formalScopeAction: "DENY_BEFORE_TOOL_ARGUMENT_OR_CONTEXT_INSPECTION",
      parallelReadBudgetFailuresPropagate: true,
      directToolExportsAndOsDescendantsContained: false,
      remoteServiceAndWorkerIsolationVerified: false,
    },
    diagnosticBoundarySources: [
      "context-token-volcengine-live-probe.mjs",
      "implementation-plan-volcengine-live.mjs",
      "pm-exploration-volcengine-live-probe.mjs",
      "verify01-volcengine-diagnostic-broker.mjs",
      "verify01-volcengine-task-diagnostic.mjs",
    ].map((file) => {
      const absolute = path.join(repository, "packages/cli/scripts", file);
      return {
        path: relative(absolute),
        digest: hash(fs.readFileSync(absolute)),
      };
    }),
  },
  historicalSharedCapUsd: 99,
  historicalLiabilityReconciled: false,
  outputUpperBoundVerified: false,
  categories,
  networkCandidates: candidates,
  unclassifiedCandidatePaths: candidates
    .filter(
      (row) =>
        sourceReview.rows.find((review) => review.path === row.path)?.status !==
        "REVIEWED",
    )
    .map((row) => row.path),
  callChainUnmappedCandidatePaths: candidates
    .filter((row) => !callChainMapped.has(row.path))
    .map((row) => row.path),
  remainingAuthorityChecks: [
    "host-enforced independent registry use, registry backup/rollback protection and recovery review",
    "every physical provider attempt",
    "cancellation and unknown usage reconciliation",
    "trusted credential host and descendant isolation",
    "account pricing, exchange rate and billing window",
  ],
};
if (values.output) {
  fs.mkdirSync(path.dirname(path.resolve(values.output)), { recursive: true });
  fs.writeFileSync(values.output, JSON.stringify(report, null, 2) + "\n");
}
console.log(
  JSON.stringify({
    categories: categories.length,
    candidateFiles: candidates.length,
    unclassifiedFiles: report.unclassifiedCandidatePaths.length,
    sourceReviewPassed: sourceReview.sourceReviewPassed,
    reviewIssues: sourceReview.issues,
    parseErrors: scan.parseErrors.length,
    paidReady: report.readiness.paidReady,
    runtimeCoverageVerified: false,
  }),
);
if (values.check && !sourceReview.sourceReviewPassed) process.exitCode = 1;
