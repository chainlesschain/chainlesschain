#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { FORMAL_BUDGET_RUNTIME_READINESS } from "../src/lib/formal-budget-transport.js";
import { MODEL_CAPABILITY_CATALOG_VERSION } from "../src/lib/model-context-catalog.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const packages = ["cli", "context-memory-kernel", "vscode-extension"];
const workPackages = [
  [
    "BASE-01",
    [
      "MODEL-03",
      "MODEL-04",
      "PERF-03",
      "IDE-READY-02",
      "IDE-ONBOARD-02",
      "IDE-COLD-02",
    ],
    ["src/lib/model-capabilities.js", "src/lib/execution-location-contract.js"],
  ],
  [
    "MODEL-05",
    ["MODEL-03", "MODEL-04"],
    [
      "src/lib/model-context-catalog.js",
      "src/lib/model-capabilities.js",
      "src/lib/llm-pricing.js",
      "src/lib/openai-responses.js",
      "src/lib/model-catalog-review.js",
      "src/lib/llm-config-defaults.js",
      "src/lib/usage-pricing-context.js",
      "src/runtime/provider-stream-state.js",
      "src/runtime/agent-core.js",
      "src/runtime/headless-runner.js",
      "src/runtime/headless-stream.js",
      "src/repl/agent-repl.js",
    ],
  ],
  [
    "RUN-03",
    [],
    [
      "src/lib/goal-condition-engine.js",
      "src/lib/workflow-engine.js",
      "src/lib/session-input-receipt.js",
    ],
  ],
  [
    "IDE-03",
    ["IDE-READY-02", "IDE-ONBOARD-02", "IDE-COLD-02"],
    [
      "../vscode-extension/src/chat/chat-events.js",
      "../jetbrains-plugin/src/main/java/com/chainlesschain/ide/ChatEvents.java",
    ],
  ],
  [
    "CTX-03",
    [],
    [
      "src/lib/skill-loader.js",
      "src/lib/skill-budget.js",
      "src/lib/context-source-ledger.js",
      "src/lib/skill-retrieval-router.js",
      "src/runtime/coding-agent-contract-shared.cjs",
      "src/runtime/agent-core.js",
    ],
  ],
  [
    "MCP-03",
    ["MCP-02"],
    [
      "src/runtime/mcp-tool-search.js",
      "src/harness/mcp-client.js",
      "src/lib/plugin-runtime/reload.js",
    ],
  ],
  [
    "BUDGET-03",
    [],
    [
      "src/lib/formal-budget-authority.js",
      "src/lib/formal-budget-transport.js",
      "src/lib/formal-budget-contract.js",
    ],
  ],
  [
    "PERF-04",
    ["PERF-03"],
    [
      "src/lib/context-memory-kernel/memory-query-index.js",
      "src/lib/context-memory-kernel/segmented-memory-port.js",
    ],
  ],
  [
    "VERIFY-03",
    ["VERIFY-02", "VERIFY-IDE-02"],
    [
      "src/lib/eval/verify01-contracts.js",
      "src/lib/eval/verify01-execution.js",
    ],
  ],
  [
    "RELEASE-03",
    [],
    [
      "../../.github/workflows/cli-ci.yml",
      "../../.github/workflows/cli-strict-sandbox.yml",
    ],
  ],
  [
    "COMPAT-03",
    ["CODEX-02"],
    [
      "src/lib/codex-app-server-adapter.js",
      "../../.github/workflows/codex-app-server-compatibility.yml",
    ],
  ],
  ["PLATFORM-03", ["PLATFORM-02"], ["src/lib/execution-location-contract.js"]],
  ["CLOUD-03", ["CLOUD-02"], ["src/lib/execution-location-contract.js"]],
];

/** Capture identities only; source presence cannot confer capability or release admission. */
export function captureImplementationPlanStatus(repository = root) {
  const git = (args) =>
    execFileSync("git", args, {
      cwd: repository,
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
  const file = (relative) => {
    const resolved = path.resolve(repository, "packages/cli", relative);
    if (!resolved.startsWith(path.resolve(repository) + path.sep))
      throw new Error("Source escapes repository");
    return {
      path: path.relative(repository, resolved).replaceAll(path.sep, "/"),
      digest:
        "sha256:" +
        createHash("sha256").update(fs.readFileSync(resolved)).digest("hex"),
    };
  };
  const versions = Object.fromEntries(
    packages.map((name) => [
      name,
      JSON.parse(
        fs.readFileSync(
          path.join(repository, "packages", name, "package.json"),
          "utf8",
        ),
      ).version,
    ]),
  );
  const jetbrains = fs
    .readFileSync(
      path.join(repository, "packages/jetbrains-plugin/build.gradle.kts"),
      "utf8",
    )
    .match(/^version = "([^"]+)"/m)?.[1];
  const tracked = git([
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    "packages/cli",
    "packages/vscode-extension",
    "packages/jetbrains-plugin",
  ]);
  return {
    schema: "chainlesschain.implementation-plan-baseline/v1",
    capturedAt: new Date().toISOString(),
    sourceCommit: git(["rev-parse", "HEAD"]),
    sourceDirty: !!tracked,
    packages: { ...versions, "jetbrains-plugin": jetbrains },
    sourceVersionsOnly: true,
    publicReleaseVerified: false,
    modelCatalogVersion: MODEL_CAPABILITY_CATALOG_VERSION,
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      osRelease: os.release(),
      cpuModel: os.cpus()[0]?.model,
      totalMemoryBytes: os.totalmem(),
    },
    workPackages: workPackages.map(([id, previousIds, sources]) => ({
      id,
      previousIds,
      previousImplementationStatus: previousIds.length
        ? "SOURCE_PRESENT_VALIDATION_OPEN"
        : null,
      sources: sources.map(file),
      completionStatus: "NOT_ATTESTED",
    })),
    formalBudget: {
      ...FORMAL_BUDGET_RUNTIME_READINESS,
      originalSharedCapUsd: 99,
      historicalLiabilityReconciled: false,
      diagnosticAllowanceResetsFormalCap: false,
      outputUpperBoundVerified: false,
      unknownCancellationUsageReconciled: false,
    },
    formalEvaluation: {
      tasks: 36,
      firstRuns: 9,
      executionStatus: "NOT_RUN",
      nativeAdmission: "NOT_ADMITTED",
      promotion: "HOLD",
    },
    validationRequired: [
      "exact-commit release matrix",
      "historical budget reconciliation and every paid egress",
      "target native and nine installation hosts",
      "independent human checkers",
      "account invoice",
      "active 8h/24h run and accessibility users",
    ],
  };
}

export async function capturePublicPlanVersions() {
  const endpoints = [
    [
      "cli",
      "https://registry.npmjs.org/chainlesschain/latest",
      "chainlesschain",
    ],
    [
      "context-memory-kernel",
      "https://registry.npmjs.org/@chainlesschain%2fcontext-memory-kernel/latest",
      "@chainlesschain/context-memory-kernel",
    ],
    [
      "vscode-extension",
      "https://open-vsx.org/api/chainlesschain/chainlesschain-ide/latest",
      null,
    ],
  ];
  const packages = [];
  for (const [id, url, name] of endpoints) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Public package readback failed: ${id} HTTP ${response.status}`,
      );
    const bytes = await response.text();
    if (Buffer.byteLength(bytes) > 1024 * 1024)
      throw new Error("Public metadata exceeds limit");
    const value = JSON.parse(bytes);
    if ((name && value.name !== name) || typeof value.version !== "string")
      throw new Error("Public package identity mismatch");
    packages.push({
      id,
      endpoint: url,
      version: value.version,
      metadataDigest:
        "sha256:" + createHash("sha256").update(bytes).digest("hex"),
      integrity: value.dist?.integrity || null,
      publicVersionVisible: true,
      downloadedArtifactVerified: false,
    });
  }
  return {
    capturedAt: new Date().toISOString(),
    packages,
    jetbrains: { status: "NOT_CAPTURED" },
    releaseMatrixVerified: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      output: { type: "string" },
      "public-readback": { type: "boolean" },
    },
  });
  const report = captureImplementationPlanStatus();
  if (values["public-readback"])
    report.publicReadback = await capturePublicPlanVersions();
  if (values.output) {
    fs.mkdirSync(path.dirname(path.resolve(values.output)), {
      recursive: true,
    });
    fs.writeFileSync(values.output, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(
    JSON.stringify({
      sourceCommit: report.sourceCommit,
      sourceDirty: report.sourceDirty,
      packages: report.packages,
      workPackages: report.workPackages.length,
      paidReady: report.formalBudget.paidReady,
      formalEvaluation: report.formalEvaluation,
    }),
  );
}
