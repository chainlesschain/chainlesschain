#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { FORMAL_BUDGET_RUNTIME_READINESS } from "../src/lib/formal-budget-transport.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const definitions = [
  [
    "agent",
    ["agentLoop", "chatWithTools", "provider fetch"],
    ["runtime/headless-runner.js", "runtime/agent-core.js"],
    "Reserve each physical request, including provider fallback, before dispatch.",
  ],
  [
    "chat",
    [
      "startChatRepl / chat gateway",
      "streamOpenAI / streamAnthropic / streamOllama",
      "provider fetch",
    ],
    ["repl/chat-repl.js", "lib/chat-core.js"],
    "Connect ordinary Chat transports to the same host-owned authority.",
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
    ["lib/llm-connection-probe.js"],
    "Govern health probes and preserve missing or invalid usage as unresolved liability.",
  ],
  [
    "retry",
    ["_retryStreamingChat / stream retry", "fresh provider attempt"],
    ["lib/stream-retry.js", "runtime/agent-core.js"],
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
    ["lib/decision-layer/typesafe-provider.js", "lib/hub-llm-client.js"],
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
    requiredIntegration,
  }),
);
const classified = new Set(
  categories.flatMap((row) => row.sources.map((source) => source.path)),
);
const candidates = [];
function scan(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) scan(absolute);
    else if (item.isFile() && /\.(?:js|mjs|cjs)$/u.test(item.name)) {
      const bytes = fs.readFileSync(absolute);
      const text = bytes.toString("utf8");
      const calls = [
        ...text.matchAll(
          /\b(fetch|fetchImpl|https?\.(?:request|get)|undici\.request)\s*\(/gu,
        ),
      ].map((match) => ({
        line: text.slice(0, match.index).split("\n").length,
        callee: match[1],
      }));
      if (calls.length)
        candidates.push({
          path: relative(absolute),
          digest: hash(bytes),
          calls,
        });
    }
  }
}
scan(path.join(repository, "packages/cli/src"));
const report = {
  schema: "chainlesschain.implementation-plan-budget-egress-review/v1",
  capturedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  }).trim(),
  readiness: FORMAL_BUDGET_RUNTIME_READINESS,
  scope:
    "Static call-chain review and lexical network candidates in packages/cli/src; aliases, SDKs, dynamically loaded code, scripts and descendant egress still require runtime review.",
  exhaustive: false,
  runtimeCoverageVerified: false,
  historicalSharedCapUsd: 99,
  historicalLiabilityReconciled: false,
  outputUpperBoundVerified: false,
  categories,
  networkCandidates: candidates,
  unclassifiedCandidatePaths: candidates
    .filter((row) => !classified.has(row.path))
    .map((row) => row.path),
  remainingAuthorityChecks: [
    "database copy/rollback and concurrent lineage",
    "every physical provider attempt",
    "cancellation and unknown usage reconciliation",
    "trusted credential host and descendant isolation",
    "account pricing, exchange rate and billing window",
  ],
};
const { values } = parseArgs({ options: { output: { type: "string" } } });
if (!values.output) throw new Error("--output is required");
fs.mkdirSync(path.dirname(path.resolve(values.output)), { recursive: true });
fs.writeFileSync(values.output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    categories: categories.length,
    candidateFiles: candidates.length,
    unclassifiedFiles: report.unclassifiedCandidatePaths.length,
    paidReady: report.readiness.paidReady,
    runtimeCoverageVerified: false,
  }),
);
