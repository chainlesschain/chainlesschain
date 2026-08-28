import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, "..", "..");
const desktopRoot = path.join(repoRoot, "desktop-app-vue");
const selectorPath = path.join(
  desktopRoot,
  "scripts",
  "cowork-ci-test-selector.js",
);
const selector = require(selectorPath);
const TestRunner = require(path.join(desktopRoot, "scripts", "test-runner.js"));
const AutoFixRunner = require(
  path.join(desktopRoot, "scripts", "auto-fix-runner.js"),
);
const cliWindowsSandboxContractChanges = [
  "packages/cli/__tests__/unit/windows-sandbox-adapter-global-teardown-contract.test.js",
  "packages/cli/__tests__/unit/windows-sandbox-adapter-temp-root.test.js",
  "packages/cli/test/fixtures/windows-sandbox-global-teardown/contract-case.mjs",
  "packages/cli/test/helpers/windows-sandbox-adapter-temp-root.js",
];
const cliWindowsSandboxContractTests = [
  "__tests__/unit/windows-sandbox-adapter-global-teardown-contract.test.js",
  "__tests__/unit/windows-sandbox-adapter-temp-root.test.js",
];

function extractNodeVerdict(workflow, stepName) {
  const escapedStepName = stepName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = workflow.match(
    new RegExp(`name: ${escapedStepName}[\\s\\S]*?node -e "([^"\\r\\n]+)"`),
  );
  assert.ok(match, `Unable to find inline Node verdict for ${stepName}`);
  return match[1];
}

function runNodeVerdict(source, environment) {
  return spawnSync(process.execPath, ["-e", source], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

function extractYamlScript(workflow, anchor) {
  const anchoredWorkflow = workflow.slice(workflow.indexOf(anchor));
  const lines = anchoredWorkflow.split(/\r?\n/);
  const scriptLineIndex = lines.findIndex(
    (line) => line.trim() === "script: |",
  );
  assert.notEqual(
    scriptLineIndex,
    -1,
    `Unable to find script block for ${anchor}`,
  );

  const scriptIndent = lines[scriptLineIndex].match(/^\s*/)[0].length;
  const contentIndent = scriptIndent + 2;
  const scriptLines = [];

  for (const line of lines.slice(scriptLineIndex + 1)) {
    if (line.trim() === "") {
      scriptLines.push("");
      continue;
    }
    if (line.match(/^\s*/)[0].length <= scriptIndent) {
      break;
    }
    scriptLines.push(line.slice(contentIndent));
  }

  return scriptLines.join("\n");
}

test("root compatibility entry points fail loudly instead of passing", () => {
  for (const scriptName of [
    "cowork-ci-test-selector.js",
    "test-runner.js",
    "auto-fix-runner.js",
  ]) {
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, "scripts", scriptName)],
      { cwd: repoRoot, encoding: "utf8" },
    );

    assert.equal(result.status, 2, `${scriptName} must not report success`);
    assert.match(result.stderr, /desktop-app-vue|WRONG_ENTRY_POINT/);
  }
});

test("selector invokes git diff with validated argument arrays", () => {
  let invocation;
  const changedFiles = selector.getChangedFilesCI({
    baseRef: "feature/safe-ref",
    // Isolate the base-ref contract from COWORK_PUSH_BASE_SHA injected by
    // push workflows. A real push must still prefer that exact SHA.
    baseSha: "",
    spawn(command, args, options) {
      invocation = { command, args, options };
      return {
        status: 0,
        stdout:
          "desktop-app-vue/tests/unit/auth/sso-session-cache-eviction.test.js\n",
        stderr: "",
      };
    },
  });

  assert.deepEqual(changedFiles, [
    "desktop-app-vue/tests/unit/auth/sso-session-cache-eviction.test.js",
  ]);
  assert.equal(invocation.command, "git");
  assert.deepEqual(invocation.args, [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    "origin/feature/safe-ref...HEAD",
    "--",
  ]);
  assert.equal(invocation.options.shell, undefined);
  assert.throws(
    () => selector.validateBaseRef("main; echo injected"),
    (error) => error.code === "INVALID_BASE_REF",
  );

  const pushBaseSha = "a".repeat(40);
  const pushChangedFiles = selector.getChangedFilesCI({
    baseSha: pushBaseSha,
    spawn(command, args) {
      invocation = { command, args };
      return {
        status: 0,
        stdout: ".github/workflows/test.yml\n",
        stderr: "",
      };
    },
  });
  assert.deepEqual(pushChangedFiles, [".github/workflows/test.yml"]);
  assert.deepEqual(invocation.args, [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    `${pushBaseSha}...HEAD`,
    "--",
  ]);
  assert.throws(
    () => selector.validateBaseSha("main; echo injected"),
    (error) => error.code === "INVALID_BASE_SHA",
  );
  assert.throws(
    () => selector.validateBaseSha("0".repeat(40)),
    (error) => error.code === "INVALID_BASE_SHA",
  );
});

test("selector maps repository-root paths to executable desktop unit tests", () => {
  const selection = selector.createSelection([
    "desktop-app-vue/src/main/auth/sso-session-manager.js",
  ]);

  assert.equal(selection.suite, "desktop-unit");
  assert.equal(selection.mode, "targeted");
  assert.ok(
    selection.selectedTests.includes(
      "src/main/auth/__tests__/sso-session-manager.test.js",
    ),
  );
  assert.ok(selection.selectedTests.every((file) => !file.includes("\\")));

  const contentIntegrationSelection = selector.createSelection([
    "desktop-app-vue/src/main/index.js",
    "desktop-app-vue/src/preload/index.js",
    "desktop-app-vue/src/renderer/pages/email/EmailReader.vue",
    "desktop-app-vue/src/renderer/pages/rss/FeedList.vue",
    "desktop-app-vue/src/renderer/types/electron.d.ts",
  ]);
  assert.ok(
    contentIntegrationSelection.selectedTests.includes(
      "tests/unit/api/rss-email-production-wiring.test.js",
    ),
  );
  assert.ok(
    contentIntegrationSelection.selectedTests.includes(
      "tests/unit/pages/EmailReader.test.js",
    ),
  );
  assert.ok(
    contentIntegrationSelection.selectedTests.includes(
      "tests/unit/pages/FeedList.test.js",
    ),
  );
  assert.equal(contentIntegrationSelection.mode, "targeted");

  const standaloneSignalingSelection = selector.createSelection([
    "signaling-server/index.js",
    "signaling-server/boundaries.js",
    "signaling-server/offline-message-store.js",
  ]);
  assert.equal(standaloneSignalingSelection.suite, "desktop-unit");
  assert.equal(standaloneSignalingSelection.mode, "targeted");
  assert.ok(
    standaloneSignalingSelection.selectedTests.includes(
      "tests/unit/p2p/standalone-signaling-server-bounds.test.js",
    ),
  );

  const ipfsSelection = selector.createSelection([
    "desktop-app-vue/src/main/ipc/phases/phase-21-30-enterprise.js",
    "desktop-app-vue/src/main/ipfs/ipfs-boundaries.js",
    "desktop-app-vue/src/main/ipfs/ipfs-content-runtime.js",
    "desktop-app-vue/src/main/ipfs/ipfs-manager.js",
    "desktop-app-vue/src/main/ipfs/ipfs-ipc.js",
  ]);
  for (const relatedTest of [
    "tests/unit/ipfs/ipfs-production-wiring.test.js",
    "src/main/ipfs/__tests__/ipfs-boundaries.test.js",
    "src/main/ipfs/__tests__/ipfs-content-runtime.test.js",
    "src/main/ipfs/__tests__/ipfs-manager.test.js",
    "src/main/ipfs/__tests__/ipfs-ipc.test.js",
  ]) {
    assert.ok(
      ipfsSelection.selectedTests.includes(relatedTest),
      `missing IPFS contract ${relatedTest}`,
    );
  }
  for (const ipfsSource of [
    "desktop-app-vue/src/main/ipfs/ipfs-boundaries.js",
    "desktop-app-vue/src/main/ipfs/ipfs-content-runtime.js",
    "desktop-app-vue/src/main/ipfs/ipfs-manager.js",
    "desktop-app-vue/src/main/ipfs/ipfs-ipc.js",
  ]) {
    const sourceSelection = selector.createSelection([ipfsSource]);
    for (const relatedTest of [
      "tests/unit/ipfs/ipfs-production-wiring.test.js",
      "src/main/ipfs/__tests__/ipfs-boundaries.test.js",
      "src/main/ipfs/__tests__/ipfs-content-runtime.test.js",
      "src/main/ipfs/__tests__/ipfs-manager.test.js",
      "src/main/ipfs/__tests__/ipfs-ipc.test.js",
    ]) {
      assert.ok(
        sourceSelection.selectedTests.includes(relatedTest),
        `${ipfsSource} must select ${relatedTest}`,
      );
    }
  }

  for (const graphDebuggerSource of [
    "desktop-app-vue/src/renderer/components/graph/graphRunDebuggerUtils.js",
    "desktop-app-vue/src/renderer/components/graph/GraphRunDebugger.vue",
    "desktop-app-vue/src/renderer/pages/useAiChatHarness.js",
    "desktop-app-vue/src/renderer/pages/AIChatPage.vue",
    "desktop-app-vue/src/renderer/pages/WorkflowMonitorPage.vue",
    "desktop-app-vue/src/renderer/shell/AgentDashboardPanel.vue",
  ]) {
    const sourceSelection = selector.createSelection([graphDebuggerSource]);
    for (const relatedTest of [
      "tests/unit/components/graphRunDebuggerUtils.test.js",
      "tests/unit/components/graphDebugHistoryCrossProduct.test.js",
      "tests/unit/components/GraphRunDebugger.smoke.test.js",
      "tests/unit/components/GraphRunDebugger.wiring.test.js",
      "tests/unit/pages/useAiChatHarnessGraph.test.js",
      "tests/unit/pages/AIChatPage.test.js",
    ]) {
      assert.ok(
        sourceSelection.selectedTests.includes(relatedTest),
        `${graphDebuggerSource} must select ${relatedTest}`,
      );
    }
  }

  for (const graphHistorySource of [
    "desktop-app-vue/src/main/ai-engine/code-agent/app-server-pilot.js",
    "desktop-app-vue/src/main/ai-engine/code-agent/desktop-graph-execution-adapter.js",
    "desktop-app-vue/src/main/ai-engine/agents/agent-coordinator.js",
    "desktop-app-vue/src/main/ai-engine/agents/agents-ipc.js",
    "desktop-app-vue/src/main/workflow/workflow-pipeline.js",
    "desktop-app-vue/src/main/workflow/workflow-ipc.js",
  ]) {
    const sourceSelection = selector.createSelection([graphHistorySource]);
    for (const relatedTest of [
      "src/main/ai-engine/code-agent/__tests__/app-server-pilot.test.js",
      "src/main/ai-engine/code-agent/__tests__/desktop-graph-execution-adapter.test.js",
      "src/main/workflow/__tests__/workflow-graph-authority.test.js",
      "src/main/workflow/__tests__/workflow-ipc-graph-history.test.js",
      "tests/unit/ai-engine/agents/agents-ipc.test.js",
      "src/main/ai-engine/agents/__tests__/agent-coordinator-execution-contract.test.js",
    ]) {
      assert.ok(
        sourceSelection.selectedTests.includes(relatedTest),
        `${graphHistorySource} must select ${relatedTest}`,
      );
    }
  }

  const skillSupplyChainTests = [
    "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-capability-catalog.test.js",
    "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-egress-broker.test.js",
    "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-environment-broker.test.js",
    "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-network-diagnostics-broker.test.js",
    "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-process-broker.test.js",
    "src/main/ai-engine/cowork/skills/__tests__/skill-execution-security.test.js",
    "src/main/ai-engine/cowork/skills/__tests__/skill-md-parser.test.js",
    "src/main/ai-engine/cowork/skills/__tests__/markdown-skill.test.js",
    "src/main/ai-engine/cowork/skills/__tests__/skill-loader.test.js",
    "src/main/ai-engine/cowork/skills/__tests__/skill-loader-unit.test.js",
    "src/main/ai-engine/cowork/skills/__tests__/skill-lazy-load.test.js",
    "src/main/ai-engine/cowork/skills/__tests__/skill-sync-security.test.js",
    "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-skill-creator.test.js",
  ];
  for (const skillSupplyChainSource of [
    "desktop-app-vue/src/main/ai-engine/cowork/skills/skill-execution-security.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-capability-catalog.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-egress-broker.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-environment-broker.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-network-diagnostics-broker.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-process-broker.js",
    "desktop-app-vue/scripts/sync-bundled-skill-capabilities.mjs",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/skill-md-parser.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/skill-loader.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/markdown-skill.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/skills-ipc.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/skill-sync-manager.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/skill-sync-ipc.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/skill-creator/handler.js",
    "desktop-app-vue/src/main/ai-engine/cowork/cowork-ipc.js",
  ]) {
    const sourceSelection = selector.createSelection([skillSupplyChainSource]);
    for (const relatedTest of skillSupplyChainTests) {
      assert.ok(
        sourceSelection.selectedTests.includes(relatedTest),
        `${skillSupplyChainSource} must select ${relatedTest}`,
      );
    }
  }

  for (const bundledSkillCapabilitySource of [
    "desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-capability-catalog.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-egress-broker.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-environment-broker.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-network-diagnostics-broker.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-process-broker.js",
    "desktop-app-vue/scripts/sync-bundled-skill-capabilities.mjs",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/api-gateway/SKILL.md",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/api-gateway/handler.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/brainstorming/SKILL.md",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/brainstorming/handler.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/color-picker/SKILL.md",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/color-picker/handler.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/humanizer/SKILL.md",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/humanizer/handler.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/terraform-iac/SKILL.md",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/terraform-iac/handler.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/text-transformer/SKILL.md",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/text-transformer/handler.js",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/ultrathink/SKILL.md",
    "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/ultrathink/handler.js",
  ]) {
    const sourceSelection = selector.createSelection([
      bundledSkillCapabilitySource,
    ]);
    for (const relatedTest of [
      "src/main/ai-engine/cowork/skills/__tests__/skill-execution-security.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-capability-catalog.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-egress-broker.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-environment-broker.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-network-diagnostics-broker.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-process-broker.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-create-pr.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-git-worktree.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-k8s-deployer.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-pr-reviewer.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/pdh-im-collect.test.js",
      "tests/unit/ai-engine/cowork/create-pr-injection.test.js",
      "tests/unit/ai-engine/cowork/git-worktree-injection.test.js",
      "tests/unit/ai-engine/cowork/k8s-deployer-injection.test.js",
      "tests/unit/ai-engine/cowork/pr-reviewer-injection.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-github-manager.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-google-workspace.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-obsidian.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-self-improving-agent.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-news-monitor.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-notion.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-tavily-search.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-weather.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-youtube-summarizer.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-brainstorming.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-humanizer.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-terraform-iac.test.js",
      "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-ultrathink.test.js",
      "src/main/ai-engine/cowork/skills/builtin/code-runner/__tests__/code-runner-security.test.js",
      "src/main/ai-engine/cowork/__tests__/self-improving-agent-handler.test.js",
      "src/main/ai-engine/cowork/__tests__/workflow-skills.test.js",
      "tests/unit/ai-engine/skill-handlers.test.js",
      "tests/unit/ai-engine/color-picker-handler.test.js",
      "tests/unit/ai-engine/humanizer-handler.test.js",
    ]) {
      assert.ok(
        sourceSelection.selectedTests.includes(relatedTest),
        `${bundledSkillCapabilitySource} must select ${relatedTest}`,
      );
    }
  }

  const collabContractTests = [
    "src/main/collaboration/__tests__/collab-boundaries.test.js",
    "src/main/collaboration/__tests__/collab-recovery-conformance.test.js",
    "src/main/collaboration/__tests__/collab-retained-state.test.js",
    "src/main/collaboration/__tests__/org-knowledge-sync-manager.test.js",
    "src/main/collaboration/__tests__/realtime-collab-manager.test.js",
    "src/main/collaboration/__tests__/yjs-collab-ipc.test.js",
    "src/main/collaboration/__tests__/yjs-collab-loaddocument.test.js",
    "src/main/collab/__tests__/collab.test.js",
    "src/main/ipc/__tests__/phase-modules.test.js",
    "src/main/ipc/__tests__/phase-34-collab-wiring.test.js",
    "src/preload/__tests__/legacy-ipc-policy.test.js",
    "src/renderer/stores/__tests__/collab.test.ts",
    "src/renderer/utils/__tests__/yjs-ipc-provider.test.ts",
  ];
  const collabSources = [
    "desktop-app-vue/src/main/index.js",
    "desktop-app-vue/src/main/collaboration/__tests__/fixtures/yjs-crash-writer.mjs",
    "desktop-app-vue/src/main/collaboration/collab-boundaries.js",
    "desktop-app-vue/src/main/collaboration/yjs-collab-manager.js",
    "desktop-app-vue/src/main/collaboration/realtime-collab-manager.js",
    "desktop-app-vue/src/main/collaboration/org-knowledge-sync-manager.js",
    "desktop-app-vue/src/main/collaboration/realtime-collab-ipc.js",
    "desktop-app-vue/src/main/collab/collab-session-manager.js",
    "desktop-app-vue/src/main/collab/collab-ipc.js",
    "desktop-app-vue/src/main/ipc/phases/phase-33-40-collab-ops.js",
    "desktop-app-vue/src/preload/index.js",
    "desktop-app-vue/src/renderer/stores/collab.ts",
    "desktop-app-vue/src/renderer/utils/yjs-ipc-provider.ts",
    "desktop-app-vue/src/renderer/types/electron.d.ts",
  ];
  const collabSelection = selector.createSelection(collabSources);
  assert.equal(collabSelection.mode, "targeted");
  for (const relatedTest of collabContractTests) {
    assert.ok(
      collabSelection.selectedTests.includes(relatedTest),
      `missing collaboration contract ${relatedTest}`,
    );
  }
  for (const collabSource of collabSources) {
    const sourceSelection = selector.createSelection([collabSource]);
    for (const relatedTest of collabContractTests) {
      assert.ok(
        sourceSelection.selectedTests.includes(relatedTest),
        `${collabSource} must select ${relatedTest}`,
      );
    }
  }

  const orgKnowledgeSyncContract =
    "tests/unit/enterprise/org-knowledge-sync.test.js";
  for (const yjsOrgSource of [
    "desktop-app-vue/src/main/collaboration/yjs-collab-manager.js",
    "desktop-app-vue/src/main/collaboration/org-knowledge-sync-manager.js",
  ]) {
    const sourceSelection = selector.createSelection([yjsOrgSource]);
    assert.ok(
      sourceSelection.selectedTests.includes(orgKnowledgeSyncContract),
      `${yjsOrgSource} must select ${orgKnowledgeSyncContract}`,
    );
  }

  const federatedTransportContracts = [
    "src/main/federated/__tests__/model-parameter-sync-boundaries.test.js",
    "src/main/federated/__tests__/federated-learning-manager.test.js",
    "src/main/ipc/__tests__/phase-modules.test.js",
  ];
  const federatedTransportSources = [
    "desktop-app-vue/src/main/index.js",
    "desktop-app-vue/src/main/federated/federated-transport-boundaries.js",
    "desktop-app-vue/src/main/federated/model-parameter-sync.js",
    "desktop-app-vue/src/main/federated/federated-learning-manager.js",
    "desktop-app-vue/src/main/ipc/phases/phase-31-ai-models.js",
  ];
  for (const source of federatedTransportSources) {
    const sourceSelection = selector.createSelection([source]);
    for (const contract of federatedTransportContracts) {
      assert.ok(
        sourceSelection.selectedTests.includes(contract),
        `${source} must select ${contract}`,
      );
    }
  }

  const socialCollabContracts = [
    "src/main/social/__tests__/collab-sync-boundaries.test.js",
    "src/main/social/__tests__/collab-engine.test.js",
    "src/main/social/__tests__/collab-awareness.test.js",
    "src/main/ipc/__tests__/phase-modules.test.js",
  ];
  const socialCollabSources = [
    "desktop-app-vue/src/main/index.js",
    "desktop-app-vue/src/main/social/social-collab-boundaries.js",
    "desktop-app-vue/src/main/social/social-collab-transport.js",
    "desktop-app-vue/src/main/social/collab-sync.js",
    "desktop-app-vue/src/main/social/collab-social-ipc.js",
    "desktop-app-vue/src/main/bootstrap/social-initializer.js",
    "desktop-app-vue/src/main/bootstrap/index.js",
    "desktop-app-vue/src/main/ipc/phases/phase-3-4-social.js",
  ];
  for (const source of socialCollabSources) {
    const sourceSelection = selector.createSelection([source]);
    for (const contract of socialCollabContracts) {
      assert.ok(
        sourceSelection.selectedTests.includes(contract),
        `${source} must select ${contract}`,
      );
    }
  }

  const gossipContracts = [
    "src/main/social/__tests__/gossip-boundaries.test.js",
    "src/main/social/__tests__/gossip-channel-receiver.integration.test.js",
    "src/main/p2p/__tests__/p2p-gossip-roundtrip.test.js",
  ];
  const gossipSources = [
    "desktop-app-vue/src/main/index.js",
    "desktop-app-vue/src/main/social/gossip-boundaries.js",
    "desktop-app-vue/src/main/social/gossip-protocol.js",
    "desktop-app-vue/src/main/bootstrap/social-initializer.js",
    "desktop-app-vue/src/main/bootstrap/index.js",
  ];
  for (const source of gossipSources) {
    const sourceSelection = selector.createSelection([source]);
    for (const contract of gossipContracts) {
      assert.ok(
        sourceSelection.selectedTests.includes(contract),
        `${source} must select ${contract}`,
      );
    }
  }

  const meshSocialContracts = [
    "src/main/social/__tests__/mesh-social-boundaries.test.js",
    "src/main/ipc/__tests__/phase-modules.test.js",
  ];
  const meshSocialSources = [
    "desktop-app-vue/src/main/social/mesh-social-boundaries.js",
    "desktop-app-vue/src/main/social/mesh-social.js",
    "desktop-app-vue/src/main/social/future-ipc.js",
    "desktop-app-vue/src/main/bootstrap/social-initializer.js",
    "desktop-app-vue/src/main/bootstrap/index.js",
    "desktop-app-vue/src/main/ipc/phases/phase-3-4-social.js",
  ];
  for (const source of meshSocialSources) {
    const sourceSelection = selector.createSelection([source]);
    for (const contract of meshSocialContracts) {
      assert.ok(
        sourceSelection.selectedTests.includes(contract),
        `${source} must select ${contract}`,
      );
    }
  }

  const socialStartupPolicyContracts = [
    "src/main/bootstrap/__tests__/social-startup-policy.test.js",
    "src/main/bootstrap/__tests__/social-manager-lifecycle.test.js",
    "src/main/ipc/__tests__/phase-modules.test.js",
  ];
  const socialStartupPolicySources = [
    "desktop-app-vue/src/main/index.js",
    "desktop-app-vue/src/main/bootstrap/social-startup-policy.js",
    "desktop-app-vue/src/main/bootstrap/social-manager-lifecycle.js",
    "desktop-app-vue/src/main/bootstrap/social-initializer.js",
    "desktop-app-vue/src/main/bootstrap/index.js",
    "desktop-app-vue/src/main/ipc/phases/phase-3-4-social.js",
  ];
  for (const source of socialStartupPolicySources) {
    const sourceSelection = selector.createSelection([source]);
    for (const contract of socialStartupPolicyContracts) {
      assert.ok(
        sourceSelection.selectedTests.includes(contract),
        `${source} must select ${contract}`,
      );
    }
  }

  const socialSourceListenerContracts = [
    "src/main/social/__tests__/owned-source-listeners.test.js",
    "src/main/social/__tests__/friend-manager.test.js",
    "src/main/social/__tests__/post-manager.test.js",
    "src/main/social/__tests__/community-manager.test.js",
    "src/main/social/__tests__/channel-manager.test.js",
    "src/main/sync/__tests__/p2p-sync-engine-lifecycle.test.js",
    "src/main/organization/__tests__/org-p2p-network-lifecycle.test.js",
    "src/main/organization/__tests__/organization-manager-lifecycle.test.js",
    "src/main/p2p/__tests__/p2p-stream-boundaries.test.js",
    "src/main/p2p/__tests__/device-sync-boundaries.test.js",
    "src/main/p2p/__tests__/p2p-manager-dispatch.test.js",
    "src/main/p2p/__tests__/p2p-gossip-roundtrip.test.js",
  ];
  const socialSourceListenerSelection = selector.createSelection([
    "desktop-app-vue/src/main/social/owned-source-listeners.js",
  ]);
  for (const contract of socialSourceListenerContracts) {
    assert.ok(
      socialSourceListenerSelection.selectedTests.includes(contract),
      `owned-source-listeners.js must select ${contract}`,
    );
  }

  const p2pFoundationBoundaryContracts = [
    "src/main/p2p/__tests__/p2p-stream-boundaries.test.js",
    "src/main/p2p/__tests__/device-sync-boundaries.test.js",
    "src/main/p2p/__tests__/p2p-manager-dispatch.test.js",
    "src/main/p2p/__tests__/p2p-gossip-roundtrip.test.js",
    "src/main/p2p/__tests__/connection-pool.test.js",
    "tests/unit/p2p/connection-pool-reacquire-active.test.js",
  ];
  for (const source of [
    "desktop-app-vue/src/main/index.js",
    "desktop-app-vue/src/main/bootstrap/social-initializer.js",
    "desktop-app-vue/src/main/bootstrap/index.js",
    "desktop-app-vue/src/main/p2p/p2p-manager.js",
    "desktop-app-vue/src/main/p2p/p2p-stream-boundaries.js",
    "desktop-app-vue/src/main/p2p/device-sync-manager.js",
    "desktop-app-vue/src/main/p2p/device-sync-boundaries.js",
    "desktop-app-vue/src/main/p2p/connection-pool.js",
  ]) {
    const sourceSelection = selector.createSelection([source]);
    for (const contract of p2pFoundationBoundaryContracts) {
      assert.ok(
        sourceSelection.selectedTests.includes(contract),
        `${source} must select ${contract}`,
      );
    }
  }

  const didFoundationLifecycleContracts = [
    "tests/unit/did/did-manager.test.js",
    "tests/unit/did/did-cache.test.js",
    "tests/unit/did/did-updater.test.js",
    "src/main/did/__tests__/did-manager-keystore.test.js",
  ];
  for (const source of [
    "desktop-app-vue/src/main/index.js",
    "desktop-app-vue/src/main/bootstrap/social-initializer.js",
    "desktop-app-vue/src/main/bootstrap/index.js",
    "desktop-app-vue/src/main/did/did-manager.js",
    "desktop-app-vue/src/main/did/did-cache.js",
    "desktop-app-vue/src/main/did/did-updater.js",
  ]) {
    const sourceSelection = selector.createSelection([source]);
    for (const contract of didFoundationLifecycleContracts) {
      assert.ok(
        sourceSelection.selectedTests.includes(contract),
        `${source} must select ${contract}`,
      );
    }
  }

  const mtcRuntimeBoundaryContracts = [
    "src/main/mtc/__tests__/mtc-runtime-boundaries.test.js",
    "src/main/mtc/__tests__/channel-event-batch.test.js",
    "src/main/mtc/__tests__/channel-envelope-distribution.test.js",
    "src/main/mtc/__tests__/mtc-federation-manager.test.js",
    "src/main/mtc/__tests__/auto-archive-scheduler.test.js",
    "src/main/mtc/__tests__/mtc-federation-roundtrip.test.js",
  ];
  for (const source of [
    "desktop-app-vue/src/main/index.js",
    "desktop-app-vue/src/main/bootstrap/social-initializer.js",
    "desktop-app-vue/src/main/bootstrap/index.js",
    "desktop-app-vue/src/main/mtc/mtc-runtime-boundaries.js",
    "desktop-app-vue/src/main/mtc/channel-event-batch.js",
    "desktop-app-vue/src/main/mtc/channel-envelope-distribution.js",
    "desktop-app-vue/src/main/mtc/mtc-federation-manager.js",
    "desktop-app-vue/src/main/mtc/auto-archive-scheduler.js",
  ]) {
    const sourceSelection = selector.createSelection([source]);
    for (const contract of mtcRuntimeBoundaryContracts) {
      assert.ok(
        sourceSelection.selectedTests.includes(contract),
        `${source} must select ${contract}`,
      );
    }
  }

  const socialEnterpriseLifecycleContracts = [
    "src/main/sync/__tests__/p2p-sync-engine-lifecycle.test.js",
    "src/main/organization/__tests__/did-invitation-manager-lifecycle.test.js",
    "src/main/organization/__tests__/org-p2p-network-lifecycle.test.js",
    "src/main/organization/__tests__/organization-manager-lifecycle.test.js",
    "src/main/collaboration/__tests__/collaboration-manager-lifecycle.test.js",
  ];
  for (const source of [
    "desktop-app-vue/src/main/index.js",
    "desktop-app-vue/src/main/bootstrap/social-initializer.js",
    "desktop-app-vue/src/main/bootstrap/index.js",
    "desktop-app-vue/src/main/sync/p2p-sync-engine.js",
    "desktop-app-vue/src/main/organization/did-invitation-manager.js",
    "desktop-app-vue/src/main/organization/org-p2p-network.js",
    "desktop-app-vue/src/main/organization/organization-manager.js",
    "desktop-app-vue/src/main/collaboration/collaboration-manager.js",
    "desktop-app-vue/src/main/collaboration/collaboration-server-lifecycle.js",
  ]) {
    const sourceSelection = selector.createSelection([source]);
    for (const contract of socialEnterpriseLifecycleContracts) {
      assert.ok(
        sourceSelection.selectedTests.includes(contract),
        `${source} must select ${contract}`,
      );
    }
  }

  const deepLinkLifecycleContract =
    "src/main/system/__tests__/deep-link-handler-lifecycle.test.js";
  for (const source of [
    "desktop-app-vue/src/main/index.js",
    "desktop-app-vue/src/main/system/deep-link-handler.js",
  ]) {
    const sourceSelection = selector.createSelection([source]);
    assert.ok(
      sourceSelection.selectedTests.includes(deepLinkLifecycleContract),
      `${source} must select ${deepLinkLifecycleContract}`,
    );
  }

  const socialWiringLifecycleContracts = [
    "src/main/bootstrap/__tests__/mtc-auto-bridge.integration.test.js",
    "src/main/social/__tests__/gossip-channel-receiver.integration.test.js",
  ];
  for (const source of [
    "desktop-app-vue/src/main/index.js",
    "desktop-app-vue/src/main/bootstrap/social-initializer.js",
    "desktop-app-vue/src/main/bootstrap/index.js",
  ]) {
    const sourceSelection = selector.createSelection([source]);
    for (const contract of socialWiringLifecycleContracts) {
      assert.ok(
        sourceSelection.selectedTests.includes(contract),
        `${source} must select ${contract}`,
      );
    }
  }

  const graphFixtureMappings = new Map([
    [
      "desktop-app-vue/src/main/ai-engine/code-agent/__tests__/fixtures/desktop-graph-kill-writer.cjs",
      "src/main/ai-engine/code-agent/__tests__/desktop-packaged-graph-fixture.test.js",
    ],
    ...["main.cjs", "preload.cjs", "renderer.html", "package.json"].map(
      (fixtureName) => [
        `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/fixtures/packaged-electron-graph/${fixtureName}`,
        "src/main/ai-engine/code-agent/__tests__/desktop-packaged-graph-fixture.test.js",
      ],
    ),
    [
      "desktop-app-vue/scripts/graph-packaged-electron-journey.mjs",
      "src/main/ai-engine/code-agent/__tests__/desktop-packaged-graph-fixture.test.js",
    ],
  ]);
  for (const [fixturePath, contractTest] of graphFixtureMappings) {
    const fixtureSelection = selector.createSelection([fixturePath]);
    assert.equal(fixtureSelection.mode, "targeted");
    assert.ok(
      fixtureSelection.selectedTests.includes(contractTest),
      `${fixturePath} must select ${contractTest}`,
    );
  }

  const command = selector.commandForSelection(selection, {
    vitestEntrypoint: "C:/safe/vitest.mjs",
  });
  assert.equal(command.executable, process.execPath);
  assert.equal(command.args[0], "C:/safe/vitest.mjs");
  assert.equal(command.args[1], "run");

  const coordinatorSelection = selector.createSelection([
    "desktop-app-vue/src/main/ai-engine/agents/agent-coordinator.js",
  ]);
  for (const relatedTest of [
    "src/main/ai-engine/agents/__tests__/agent-coordinator-parallel.test.js",
    "src/main/ai-engine/agents/__tests__/agent-coordinator-eviction.test.js",
    "src/main/ai-engine/agents/__tests__/agent-coordinator-sessions-eviction.test.js",
    "tests/unit/ai-engine/agents/agent-coordinator-select.test.js",
  ]) {
    assert.ok(
      coordinatorSelection.selectedTests.includes(relatedTest),
      `missing related test ${relatedTest}`,
    );
  }

  const fullSelection = selector.createSelection([
    "desktop-app-vue/package.json",
  ]);
  assert.equal(fullSelection.mode, "full");
  assert.deepEqual(fullSelection.selectedTests, ["tests/unit", "src"]);

  const ideSelection = selector.createSelection([
    "packages/vscode-extension/package.json",
    "packages/jetbrains-plugin/build.gradle.kts",
  ]);
  assert.equal(ideSelection.mode, "targeted");
  assert.deepEqual(ideSelection.selectedTests, [
    "tests/unit/did/did-manager.test.js",
    "tests/unit/llm/llm-service.test.js",
  ]);
  assert.ok(
    ideSelection.mappings.every(
      (mapping) => mapping.reason === "covered-by-ide-dedicated-gates",
    ),
  );

  const ideCommand = selector.commandForSelection(ideSelection, {
    vitestEntrypoint: "C:/safe/vitest.mjs",
  });
  assert.ok(ideCommand.args.includes("--pool=forks"));
  assert.ok(ideCommand.args.includes("--maxWorkers=2"));
  assert.ok(!ideCommand.args.includes("--pool=threads"));
});

test("selector maps P1-10 conformance inventory to its repository node gate", () => {
  for (const source of [
    "tests/fixtures/p1-10-conformance-matrix.json",
    "scripts/p1-10-external-evidence-gate.mjs",
    "scripts/__tests__/p1-10-conformance-matrix.test.mjs",
  ]) {
    const selection = selector.createSelection([source]);
    assert.equal(selection.suite, "ci-gate-integrity");
    assert.ok(
      selection.selectedTests.includes(
        "scripts/__tests__/p1-10-conformance-matrix.test.mjs",
      ),
      `${source} must select the P1-10 conformance matrix gate`,
    );
  }
});

test("selector maps exact Windows sandbox support paths to CLI contracts", () => {
  const selection = selector.createSelection(cliWindowsSandboxContractChanges);

  assert.equal(selection.suite, "cli-unit");
  assert.equal(selection.mode, "targeted");
  assert.deepEqual(selection.selectedTests, cliWindowsSandboxContractTests);
  assert.deepEqual(selection.testSuites, [
    {
      suite: "cli-unit",
      runner: "vitest",
      root: "packages/cli",
      mode: "targeted",
      selectedTests: cliWindowsSandboxContractTests,
    },
  ]);

  const expectedTestsByChange = new Map([
    [cliWindowsSandboxContractChanges[0], [cliWindowsSandboxContractTests[0]]],
    [cliWindowsSandboxContractChanges[1], [cliWindowsSandboxContractTests[1]]],
    [cliWindowsSandboxContractChanges[2], [cliWindowsSandboxContractTests[0]]],
    [cliWindowsSandboxContractChanges[3], cliWindowsSandboxContractTests],
  ]);
  for (const mapping of selection.mappings) {
    assert.equal(mapping.suite, "cli-unit");
    assert.deepEqual(mapping.tests, expectedTestsByChange.get(mapping.file));
  }

  const command = selector.commandForSelection(selection, {
    vitestEntrypoint: "C:/safe/vitest.mjs",
  });
  assert.equal(command.cwd, path.join(repoRoot, "packages", "cli"));
  assert.equal(command.executable, process.execPath);
  assert.deepEqual(command.args.slice(0, 2), ["C:/safe/vitest.mjs", "run"]);
  assert.deepEqual(
    command.args.filter((argument) => argument.endsWith(".test.js")),
    cliWindowsSandboxContractTests,
  );
  assert.ok(!command.args.includes("--pool=threads"));
});

test("selector maps graph compiler changes to the CLI compiler contract", () => {
  const compilerPath = "packages/cli/src/lib/graph-kernel/compiler.js";
  const compilerTest = "__tests__/unit/graph-kernel-compiler.test.js";
  const selection = selector.createSelection([compilerPath]);

  assert.equal(selection.suite, "cli-unit");
  assert.equal(selection.mode, "targeted");
  assert.deepEqual(selection.selectedTests, [compilerTest]);
  assert.deepEqual(selection.mappings, [
    {
      file: compilerPath,
      suite: "cli-unit",
      tests: [compilerTest],
    },
  ]);
});

test("selector maps team authority contract updates to exact CLI tests", () => {
  const changedTests = [
    "packages/cli/__tests__/unit/team-command-broker.test.js",
    "packages/cli/__tests__/unit/team-runner-scope.test.js",
  ];
  const expectedTests = [
    "__tests__/unit/team-command-broker.test.js",
    "__tests__/unit/team-runner-scope.test.js",
  ];
  const selection = selector.createSelection(changedTests);

  assert.equal(selection.suite, "cli-unit");
  assert.equal(selection.mode, "targeted");
  assert.deepEqual(selection.selectedTests, expectedTests);
  assert.deepEqual(
    selection.mappings.map((mapping) => mapping.tests),
    expectedTests.map((testFile) => [testFile]),
  );
});

test("selector changes run integrity and CLI contracts without desktop fallback", () => {
  const selection = selector.createSelection([
    ...cliWindowsSandboxContractChanges,
    "desktop-app-vue/scripts/cowork-ci-test-selector.js",
    "scripts/__tests__/ci-gate-integrity.test.mjs",
  ]);

  assert.equal(selection.suite, "unit-matrix");
  assert.equal(selection.mode, "targeted");
  assert.deepEqual(
    selection.testSuites.map((testSuite) => testSuite.suite),
    ["ci-gate-integrity", "cli-unit"],
  );
  assert.ok(
    selection.testSuites.every(
      (testSuite) => testSuite.suite !== "desktop-unit",
    ),
  );

  const commands = selector.commandsForSelection(selection, {
    cliVitestEntrypoint: "C:/safe/cli-vitest.mjs",
  });
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0], {
    suite: "ci-gate-integrity",
    cwd: repoRoot,
    executable: process.execPath,
    args: ["--test", "scripts/__tests__/ci-gate-integrity.test.mjs"],
  });
  assert.equal(commands[1].suite, "cli-unit");
  assert.equal(commands[1].cwd, path.join(repoRoot, "packages", "cli"));
  assert.deepEqual(commands[1].args.slice(0, 2), [
    "C:/safe/cli-vitest.mjs",
    "run",
  ]);
  assert.throws(
    () => selector.commandForSelection(selection),
    (error) => error.code === "MULTIPLE_TEST_COMMANDS",
  );
});

test("open-source gap audit evidence stays on the integrity gate", () => {
  const auditFile = "docs/CODEX_OPEN_SOURCE_GAP_ANALYSIS_2026-08-24.md";
  const auditSelection = selector.createSelection([auditFile]);

  assert.equal(auditSelection.suite, "ci-gate-integrity");
  assert.equal(auditSelection.mode, "targeted");
  assert.deepEqual(auditSelection.selectedTests, [
    "scripts/__tests__/ci-gate-integrity.test.mjs",
  ]);
  assert.deepEqual(auditSelection.mappings, [
    {
      file: auditFile,
      suite: "ci-gate-integrity",
      tests: ["scripts/__tests__/ci-gate-integrity.test.mjs"],
    },
  ]);

  const combinedSelection = selector.createSelection([
    auditFile,
    "desktop-app-vue/scripts/cowork-ci-test-selector.js",
    "desktop-app-vue/src/main/ipfs/ipfs-boundaries.js",
  ]);
  assert.equal(combinedSelection.suite, "unit-matrix");
  assert.equal(combinedSelection.mode, "targeted");
  assert.deepEqual(
    combinedSelection.testSuites.map((testSuite) => testSuite.suite),
    ["ci-gate-integrity", "desktop-unit"],
  );
  assert.ok(
    combinedSelection.testSuites.every(
      (testSuite) => testSuite.mode === "targeted",
    ),
  );
});

test("selector fails closed for an unmapped change or failed detection", () => {
  assert.throws(
    () => selector.createSelection(["packages/cli/src/index.js"]),
    (error) =>
      error.code === "UNMAPPED_CHANGED_FILES" &&
      error.details.unmappedFiles.includes("packages/cli/src/index.js"),
  );
  assert.throws(
    () =>
      selector.createSelection([
        "packages/vscode-extension/../../packages/cli/src/index.js",
      ]),
    (error) =>
      error.code === "UNMAPPED_CHANGED_FILES" &&
      error.details.unmappedFiles.includes(
        "packages/vscode-extension/../../packages/cli/src/index.js",
      ),
  );

  assert.throws(
    () =>
      selector.getChangedFilesCI({
        spawn() {
          return { status: 128, stdout: "", stderr: "missing base" };
        },
      }),
    (error) => error.code === "GIT_DIFF_FAILED",
  );
});

test("IDE selector delegation stays bound to both dedicated PR workflows", () => {
  const workflowFiles = [
    ".github/workflows/ide-extensions.yml",
    ".github/workflows/ide-arm64-validation.yml",
  ];
  const delegatedPaths = [
    '      - "packages/vscode-extension/**"',
    '      - "packages/jetbrains-plugin/**"',
  ];

  for (const workflowFile of workflowFiles) {
    const workflow = fs.readFileSync(path.join(repoRoot, workflowFile), "utf8");
    for (const delegatedPath of delegatedPaths) {
      assert.ok(
        workflow.split(delegatedPath).length - 1 >= 2,
        `${workflowFile} must cover ${delegatedPath.trim()} on push and pull_request`,
      );
    }
  }
});

test("selector CLI emits machine-readable output and non-zero fail-closed status", () => {
  const known = spawnSync(
    process.execPath,
    [
      selectorPath,
      "--dry-run",
      "--json",
      "--changed-file",
      "desktop-app-vue/tests/unit/auth/sso-session-cache-eviction.test.js",
    ],
    { cwd: desktopRoot, encoding: "utf8" },
  );
  assert.equal(known.status, 0, known.stderr);
  const machineLine = known.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("COWORK_TEST_SELECTION_JSON="));
  assert.ok(machineLine);
  const payload = JSON.parse(
    machineLine.slice("COWORK_TEST_SELECTION_JSON=".length),
  );
  assert.equal(payload.status, "dry-run");
  assert.equal(payload.suite, "desktop-unit");
  assert.ok(payload.selectedTests.length > 0);

  const unknown = spawnSync(
    process.execPath,
    [
      selectorPath,
      "--dry-run",
      "--json",
      "--changed-file",
      "packages/cli/src/index.js",
    ],
    { cwd: desktopRoot, encoding: "utf8" },
  );
  assert.equal(unknown.status, 2);
  assert.match(unknown.stdout, /"status":"fail-closed"/);
});

test("CLI suite spawn failures cannot downgrade to desktop fallback", (t) => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-selector-output-"),
  );
  t.after(() => fsp.rm(temporaryRoot, { recursive: true, force: true }));
  const githubOutput = path.join(temporaryRoot, "github-output.txt");
  const output = [];
  const originalLog = console.log;
  const originalGitHubOutput = process.env.GITHUB_OUTPUT;
  console.log = (...values) => output.push(values.join(" "));
  process.env.GITHUB_OUTPUT = githubOutput;

  let exitCode;
  let spawnOptions;
  try {
    exitCode = selector.main(
      [
        "--json",
        "--changed-file",
        "packages/cli/test/helpers/windows-sandbox-adapter-temp-root.js",
      ],
      {
        spawn(_command, _args, options) {
          spawnOptions = options;
          return { error: new Error("spawn denied") };
        },
      },
    );
  } finally {
    console.log = originalLog;
    if (originalGitHubOutput === undefined) {
      delete process.env.GITHUB_OUTPUT;
    } else {
      process.env.GITHUB_OUTPUT = originalGitHubOutput;
    }
  }

  assert.equal(exitCode, 1);
  const machineLine = output.find((line) =>
    line.startsWith("COWORK_TEST_SELECTION_JSON="),
  );
  assert.ok(machineLine);
  const payload = JSON.parse(
    machineLine.slice("COWORK_TEST_SELECTION_JSON=".length),
  );
  assert.equal(payload.status, "failed");
  assert.equal(payload.mode, "targeted");
  assert.equal(payload.failedSuite, "cli-unit");
  assert.equal(payload.code, "TEST_SPAWN_FAILED");
  assert.equal(
    Object.hasOwn(spawnOptions.env, "GITHUB_OUTPUT"),
    false,
    "nested tests must not overwrite the selector step outputs",
  );
  assert.match(fs.readFileSync(githubOutput, "utf8"), /test-mode=targeted/);
});

test("test runner records spawn failures and returns a failing aggregate code", async (t) => {
  const temporaryRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "cc-ci-test-runner-"),
  );
  t.after(() => fsp.rm(temporaryRoot, { recursive: true, force: true }));

  const runner = new TestRunner({
    cwd: temporaryRoot,
    spawn() {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", new Error("spawn denied")));
      return child;
    },
  });
  const result = await runner.runTestSuite("Unit", "npm", ["run", "test:unit"]);

  assert.equal(result.passed, false);
  assert.equal(runner.results.unit.error, "spawn denied");
  assert.equal(await runner.generateReport(), 1);
});

test("test runner is wired to real suite commands", async () => {
  const runner = new TestRunner();
  const calls = [];
  runner.runTestSuite = async (name, command, args) => {
    calls.push({ name, command, args });
    const result = { name, passed: true, exitCode: 0, duration: 0 };
    runner.results[name.toLowerCase().replace(/\s+/g, "")] = result;
    return result;
  };
  runner.generateReport = async () => 0;

  assert.equal(await runner.runAll(), 0);
  assert.deepEqual(
    calls.map((call) => [call.name, call.command, call.args]),
    [
      ["Unit", "npm", ["run", "test:unit"]],
      ["Integration", "npm", ["run", "test:integration"]],
      ["Database", "node", ["scripts/test-database.js"]],
      ["UKey", "node", ["scripts/test-ukey.js"]],
      ["Performance", "npm", ["run", "test:performance"]],
    ],
  );
});

test("UKey smoke skips unsupported hosts and propagates real failures", () => {
  const script = fs.readFileSync(
    path.join(desktopRoot, "scripts", "test-ukey.js"),
    "utf8",
  );

  assert.match(script, /process\.platform !== ["']win32["']/);
  assert.match(script, /UKey hardware smoke SKIPPED/);
  assert.match(script, /no XinJinKe device detected/);
  assert.match(script, /catch \(error\)[\s\S]*?throw error/);
  assert.match(script, /process\.exitCode = 1/);
  assert.equal(
    (script.match(/assertSmoke\(\s*verifyResult\.success/g) ?? []).length,
    1,
  );
  assert.match(script, /assertSmoke\(\s*decrypted === testData/);
  assert.match(script, /assertSmoke\(verified/);
  assert.match(script, /assertSmoke\(!isUnlocked/);
  assert.match(script, /assertSmoke\(\s*testValue === ["']testValue["']/);
  assert.ok((script.match(/throw error;/g) ?? []).length >= 4);
  assert.doesNotMatch(script, /runTests\(\)\.catch\(console\.error\)/);
});

test("sharp-loading main-process tests stay out of the jsdom canvas process", () => {
  const nodeEnvironmentTests = [
    "desktop-app-vue/tests/unit/media/image-engine.test.js",
    "desktop-app-vue/src/main/blockchain/__tests__/order-export.test.js",
    "desktop-app-vue/src/main/ai-engine/__tests__/real-implementations-reminder.test.js",
    "desktop-app-vue/src/main/remote/__tests__/remote-gateway.test.js",
    "desktop-app-vue/tests/remote/integration/remote-integration.test.js",
  ];

  for (const relativePath of nodeEnvironmentTests) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.match(
      source,
      /^\/\/ @vitest-environment node/m,
      `${relativePath} must not load sharp in Vitest's jsdom/canvas process`,
    );
  }
});

test("auto-fix command is diagnostic-only and fails when no safe fix exists", async (t) => {
  const temporaryRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "cc-ci-auto-fix-"),
  );
  t.after(() => fsp.rm(temporaryRoot, { recursive: true, force: true }));
  const resultsDirectory = path.join(temporaryRoot, "test-results");
  const sentinelDirectory = path.join(temporaryRoot, "node_modules");
  const sentinel = path.join(sentinelDirectory, "sentinel.txt");
  await fsp.mkdir(resultsDirectory, { recursive: true });
  await fsp.mkdir(sentinelDirectory, { recursive: true });
  await fsp.writeFile(sentinel, "preserve", "utf8");
  await fsp.writeFile(
    path.join(resultsDirectory, "test-report.json"),
    JSON.stringify({
      results: {
        unit: {
          name: "Unit",
          passed: false,
          exitCode: 1,
          error: "Cannot find module example",
        },
      },
    }),
    "utf8",
  );

  const runner = new AutoFixRunner({ cwd: temporaryRoot });
  assert.equal(await runner.run(), 2);
  assert.equal(await fsp.readFile(sentinel, "utf8"), "preserve");
  const report = JSON.parse(
    await fsp.readFile(
      path.join(resultsDirectory, "auto-fix-report.json"),
      "utf8",
    ),
  );
  assert.equal(report.mode, "diagnostic-only");
  assert.deepEqual(report.mutationsApplied, []);
  assert.equal(report.diagnostics[0].safeAutomaticFixAvailable, false);

  const retryRunner = new TestRunner({
    cwd: temporaryRoot,
    reportSuffix: "retry",
  });
  retryRunner.results.unit = {
    name: "Unit",
    passed: true,
    exitCode: 0,
    duration: 1,
  };
  assert.equal(await retryRunner.generateReport(), 0);
  const primaryReportAfterRetry = JSON.parse(
    await fsp.readFile(path.join(resultsDirectory, "test-report.json"), "utf8"),
  );
  const retryReport = JSON.parse(
    await fsp.readFile(
      path.join(resultsDirectory, "test-report-retry.json"),
      "utf8",
    ),
  );
  assert.equal(primaryReportAfterRetry.results.unit.passed, false);
  assert.equal(retryReport.results.unit.passed, true);
  const reportAfterRetry = JSON.parse(
    await fsp.readFile(
      path.join(resultsDirectory, "auto-fix-report.json"),
      "utf8",
    ),
  );
  assert.deepEqual(reportAfterRetry, report);
});

test("standalone CLI dependency install vendors exact checkout packages", () => {
  const installer = fs.readFileSync(
    path.join(
      repoRoot,
      ".github",
      "scripts",
      "ci-install-cli-production-deps.sh",
    ),
    "utf8",
  );
  const cliManifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "packages", "cli", "package.json")),
  );
  const internalPackages = Object.keys(cliManifest.dependencies).filter(
    (name) => name.startsWith("@chainlesschain/"),
  );

  for (const packageName of internalPackages) {
    const directoryName = packageName.slice("@chainlesschain/".length);
    assert.ok(
      installer.includes(`"$repo_root/packages/${directoryName}"`),
      `${packageName} must be installed from the exact checkout`,
    );
  }
  assert.match(installer, /expectedVersion !== manifest\.version/);
  assert.match(installer, /--install-links/);
  assert.match(installer, /--workspaces=false/);
  assert.match(installer, /ci-npm-retry\.sh/);
  assert.match(installer, /isSymbolicLink\(\)/);
  assert.match(installer, /"\$mode" == "--pack-candidates"/);

  const testWorkflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "test.yml"),
    "utf8",
  );
  assert.match(
    testWorkflow,
    /name: Pack CLI and exact internal dependency candidates[\s\S]*?ci-install-cli-production-deps\.sh[\s\S]*?--pack-candidates/,
  );
  assert.match(
    testWorkflow,
    /name: Global install from tarball \(exercises postinstall\)[\s\S]*?npm install -g "\$RUNNER_TEMP\/cli-global-install-candidates\/"\*\.tgz/,
  );
  assert.match(
    testWorkflow,
    /name: Global install from tarball \(exercises postinstall\)[\s\S]*?npm_config_build_from_source: "true"[\s\S]*?NODE_GYP_FORCE_PYTHON:/,
  );
});

test("workflow uses step outcomes and a final non-zero verdict", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "test-automation-full.yml"),
    "utf8",
  );

  assert.match(workflow, /^name: Full Test Automation with Diagnostics/m);
  assert.doesNotMatch(workflow, /Attempt auto-fix|无法自动修复|尝试运行/);
  assert.match(
    workflow,
    /name: Install dependencies[\s\S]*?ci-npm-retry\.sh" \\\n\s+npm install --legacy-peer-deps/,
  );
  assert.match(
    workflow,
    /name: Install packages\/cli production dependencies standalone[\s\S]*?working-directory: \.\/packages\/cli[\s\S]*?ci-install-cli-production-deps\.sh/,
  );
  assert.match(workflow, /Re-run tests for failure diagnosis/);
  assert.match(workflow, /TEST_REPORT_SUFFIX: retry/);
  assert.ok(
    workflow.indexOf("id: failure-diagnostics") <
      workflow.indexOf("id: retry-tests"),
  );
  assert.ok(
    workflow.indexOf("id: retry-tests") <
      workflow.indexOf("name: Upload test results"),
  );
  assert.match(workflow, /test-results\/auto-fix-report\.json/);
  assert.match(
    workflow,
    /Verify CI gate integrity contracts\s+run: node --test scripts\/__tests__\/ci-gate-integrity\.test\.mjs/,
  );
  assert.match(
    workflow,
    /id: primary-tests[\s\S]*?run: node scripts\/test-runner\.js[\s\S]*?continue-on-error: true/,
  );
  assert.match(
    workflow,
    /id: failure-diagnostics\s+if: steps\.primary-tests\.outcome == 'failure'[\s\S]*?continue-on-error: true/,
  );
  assert.match(
    workflow,
    /id: retry-tests\s+if: steps\.primary-tests\.outcome == 'failure'[\s\S]*?continue-on-error: true/,
  );
  assert.match(
    workflow,
    /name: Enforce comprehensive test result\s+if: always\(\)/,
  );
  assert.match(
    workflow,
    /PRIMARY_TEST_OUTCOME: \$\{\{ steps\.primary-tests\.outcome \}\}/,
  );
  assert.match(
    workflow,
    /RETRY_TEST_OUTCOME: \$\{\{ steps\.retry-tests\.outcome \}\}/,
  );
  assert.match(workflow, /process\.exit\(1\)/);
  assert.match(workflow, /const dedupeMarker = `<!-- automated-test-failure:/);
  assert.match(workflow, /github\.paginate\(github\.rest\.issues\.listForRepo/);
  assert.match(workflow, /labels: 'automated-detection,test-failure'/);
  assert.match(workflow, /state: 'open'/);
  assert.match(workflow, /issues\.createComment\(/);
  assert.match(workflow, /Recorded repeated failure in issue/);
  assert.doesNotMatch(workflow, /title: `自动测试失败 - \$\{date\}`/);

  const verdict = extractNodeVerdict(
    workflow,
    "Enforce comprehensive test result",
  );
  assert.equal(
    runNodeVerdict(verdict, {
      PRIMARY_TEST_OUTCOME: "success",
      RETRY_TEST_OUTCOME: "skipped",
    }).status,
    0,
  );
  for (const retryOutcome of ["success", "failure", "skipped"]) {
    assert.equal(
      runNodeVerdict(verdict, {
        PRIMARY_TEST_OUTCOME: "failure",
        RETRY_TEST_OUTCOME: retryOutcome,
      }).status,
      1,
    );
  }
});

test("failure issue reporter updates an existing scope instead of duplicating it", async () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "test-automation-full.yml"),
    "utf8",
  );
  const script = extractYamlScript(workflow, "name: Create Issue on Failure");
  const runReporter = new Function(
    "github",
    "context",
    "core",
    `return (async () => { ${script} })();`,
  );
  const marker =
    "<!-- automated-test-failure:Full Test Automation with Diagnostics:refs/heads/main -->";
  const context = {
    serverUrl: "https://github.com",
    repo: { owner: "chainlesschain", repo: "chainlesschain" },
    runId: 12345,
    ref: "refs/heads/main",
    sha: "abc123",
    actor: "chainlesschain",
    workflow: "Full Test Automation with Diagnostics",
    payload: {},
  };

  async function execute(openIssues) {
    const calls = { create: [], createComment: [], list: [], notices: [] };
    const listForRepo = () => {};
    const github = {
      paginate: async (endpoint, options) => {
        assert.equal(endpoint, listForRepo);
        calls.list.push(options);
        return openIssues;
      },
      rest: {
        issues: {
          listForRepo,
          create: async (options) => calls.create.push(options),
          createComment: async (options) => calls.createComment.push(options),
        },
      },
    };
    await runReporter(github, context, {
      notice: (message) => calls.notices.push(message),
    });
    return calls;
  }

  const repeated = await execute([{ number: 247, body: marker }]);
  assert.equal(repeated.create.length, 0);
  assert.equal(repeated.createComment.length, 1);
  assert.equal(repeated.createComment[0].issue_number, 247);
  assert.match(repeated.createComment[0].body, /不再重复建单/);
  assert.match(repeated.notices[0], /issue #247/);

  const firstOccurrence = await execute([]);
  assert.equal(firstOccurrence.createComment.length, 0);
  assert.equal(firstOccurrence.create.length, 1);
  assert.equal(firstOccurrence.list[0].state, "open");
  assert.equal(
    firstOccurrence.list[0].labels,
    "automated-detection,test-failure",
  );
  assert.match(firstOccurrence.create[0].title, /main/);
  assert.match(firstOccurrence.create[0].body, /automated-test-failure/);
});

test("unit workflow distinguishes selected-test failures from fail-closed fallback", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "test.yml"),
    "utf8",
  );
  assert.match(
    workflow,
    /name: Install packages\/cli production dependencies standalone[\s\S]*?working-directory: \.\/packages\/cli[\s\S]*?ci-install-cli-production-deps\.sh/,
  );
  assert.match(
    workflow,
    /name: Checkout code[\s\S]*?uses: actions\/checkout@v5[\s\S]*?fetch-depth: 0/,
  );
  assert.match(workflow, /timeout-minutes: 75/);
  assert.match(
    workflow,
    /COWORK_PUSH_BASE_SHA: \$\{\{ github\.event_name == 'push' && github\.event\.before \|\| '' \}\}/,
  );
  assert.match(
    workflow,
    /id: fallback-tests\s+if: steps\.test-selector\.outcome == 'failure' && steps\.test-selector\.outputs\.test-mode == 'fail-closed'/,
  );
  assert.match(workflow, /npm exec --offline -- vitest run tests\/unit src/);
  assert.match(workflow, /--pool=forks --maxWorkers=2/);
  assert.doesNotMatch(workflow, /--pool=threads/);
  assert.doesNotMatch(workflow, /src\/main\/\*\*\/__tests__/);
  const fullSuiteWorkflow = workflow.slice(workflow.indexOf("full-tests:"));
  assert.match(
    fullSuiteWorkflow,
    /name: Install packages\/cli production dependencies standalone[\s\S]*?working-directory: \.\/packages\/cli[\s\S]*?name: Run all unit tests/,
  );
  const verdict = extractNodeVerdict(
    workflow,
    "Enforce selector or fallback result",
  );

  const selectedTestFailed = runNodeVerdict(verdict, {
    SELECTOR_OUTCOME: "failure",
    SELECTOR_MODE: "targeted",
    FALLBACK_OUTCOME: "skipped",
  });
  assert.equal(selectedTestFailed.status, 1);

  const fallbackPassed = runNodeVerdict(verdict, {
    SELECTOR_OUTCOME: "failure",
    SELECTOR_MODE: "fail-closed",
    FALLBACK_OUTCOME: "success",
  });
  assert.equal(fallbackPassed.status, 0, fallbackPassed.stderr);

  for (const fallbackOutcome of ["failure", "skipped"]) {
    const fallbackDidNotPass = runNodeVerdict(verdict, {
      SELECTOR_OUTCOME: "failure",
      SELECTOR_MODE: "fail-closed",
      FALLBACK_OUTCOME: fallbackOutcome,
    });
    assert.equal(fallbackDidNotPass.status, 1);
  }
});

test("PDH workflow bounds native test concurrency on Windows", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "test.yml"),
    "utf8",
  );
  const pdhWorkflow = workflow.slice(
    workflow.indexOf("  pdh-tests:"),
    workflow.indexOf("  full-tests:"),
  );

  assert.match(pdhWorkflow, /if \[\[ "\$RUNNER_OS" == "Windows" \]\]; then/);
  assert.match(pdhWorkflow, /VITEST_ARGS\+=\(--pool=forks --maxWorkers=2\)/);
  assert.match(
    pdhWorkflow,
    /npx vitest run --reporter=default "\$\{VITEST_ARGS\[@\]\}"/,
  );
});

test("legacy Linux release builds the embedded web panel before packaging", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "release-linux-packages.yml"),
    "utf8",
  );
  const installPanel = workflow.indexOf(
    "name: Install embedded web panel dependencies",
  );
  const buildPanel = workflow.indexOf("name: Build embedded web panel");
  const buildPackages = workflow.indexOf("name: Build Linux packages");

  assert.ok(installPanel >= 0);
  assert.ok(buildPanel > installPanel);
  assert.ok(buildPackages > buildPanel);
  assert.match(
    workflow,
    /name: Install embedded web panel dependencies[\s\S]*?working-directory: packages\/web-panel[\s\S]*?npm ci --legacy-peer-deps[\s\S]*?name: Build embedded web panel[\s\S]*?working-directory: packages\/web-panel[\s\S]*?npm run build/,
  );
});

test("Android MobSF gate uses an immutable image and the supported REST API", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "android-build.yml"),
    "utf8",
  );
  const securityScan = workflow.slice(workflow.indexOf("  security-scan:"));

  assert.match(workflow, /- "packages\/agent-protocol\/\*\*"/);
  assert.doesNotMatch(securityScan, /continue-on-error:\s*true/);
  assert.doesNotMatch(securityScan, /manage\.py\s+scan/);
  assert.doesNotMatch(securityScan, /mobile-security-framework-mobsf:latest/);
  assert.match(
    securityScan,
    /mobile-security-framework-mobsf@sha256:[a-f0-9]{64}/,
  );
  for (const endpoint of ["upload", "scan", "report_json"]) {
    assert.match(securityScan, new RegExp(`/api/v1/${endpoint}`));
  }
  assert.match(securityScan, /jq --exit-status/);
  assert.match(securityScan, /name: Upload MobSF Report/);
});

test("Android remaining-module unit tests are a blocking non-duplicating gate", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "android-tests.yml"),
    "utf8",
  );
  const aggregateStart = workflow.indexOf(
    "- name: Run Remaining Module Tests and Generate Report",
  );
  const aggregateEnd = workflow.indexOf(
    "- name: Upload Test Results",
    aggregateStart,
  );

  assert.ok(aggregateStart >= 0);
  assert.ok(aggregateEnd > aggregateStart);
  const aggregateStep = workflow.slice(aggregateStart, aggregateEnd);
  assert.match(aggregateStep, /if:\s*always\(\)/);
  assert.match(aggregateStep, /timeout-minutes: 45/);
  assert.doesNotMatch(aggregateStep, /\.\/gradlew\s+testDebugUnitTest\b/);
  for (const moduleName of [
    "core-ui",
    "core-agent-protocol",
    "core-test-helpers",
    "data-knowledge",
    "data-ai",
    "feature-ai",
    "feature-p2p",
    "feature-family-guard",
    "wear-app",
  ]) {
    assert.match(
      aggregateStep,
      new RegExp(`:${moduleName}:testDebugUnitTest\\b`),
    );
  }
  for (const alreadyCoveredModule of [
    "app",
    "core-common",
    "core-database",
    "core-security",
    "core-did",
    "core-e2ee",
    "core-blockchain",
    "core-network",
    "core-p2p",
  ]) {
    assert.doesNotMatch(
      aggregateStep,
      new RegExp(`:${alreadyCoveredModule}:testDebugUnitTest\\b`),
    );
  }
  assert.match(aggregateStep, /--parallel --max-workers=4 --no-daemon/);
  assert.doesNotMatch(aggregateStep, /continue-on-error:\s*true/);
});

test("Android lint is a blocking gate", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "android-tests.yml"),
    "utf8",
  );
  const lintStart = workflow.indexOf("- name: Run Lint");
  const lintEnd = workflow.indexOf("- name: Upload Lint Results", lintStart);

  assert.ok(lintStart >= 0);
  assert.ok(lintEnd > lintStart);
  const lintStep = workflow.slice(lintStart, lintEnd);
  assert.match(lintStep, /\.\/gradlew lintDebug --continue --no-daemon/);
  assert.doesNotMatch(lintStep, /continue-on-error:\s*true/);
});

test("Android file scan foreground worker declares its WorkManager service type", () => {
  const worker = fs.readFileSync(
    path.join(
      repoRoot,
      "android-app",
      "feature-file-browser",
      "src",
      "main",
      "java",
      "com",
      "chainlesschain",
      "android",
      "feature",
      "filebrowser",
      "worker",
      "FileScanWorker.kt",
    ),
    "utf8",
  );
  const manifest = fs.readFileSync(
    path.join(
      repoRoot,
      "android-app",
      "feature-file-browser",
      "src",
      "main",
      "AndroidManifest.xml",
    ),
    "utf8",
  );

  assert.match(worker, /ServiceInfo\.FOREGROUND_SERVICE_TYPE_DATA_SYNC/);
  assert.match(
    manifest,
    /android:name="androidx\.work\.impl\.foreground\.SystemForegroundService"/,
  );
  assert.match(manifest, /android:foregroundServiceType="dataSync"/);
  assert.match(manifest, /tools:node="merge"/);
});

test("Android local terminal owns the permission needed for DNS discovery", () => {
  const sourceRoot = path.join(
    repoRoot,
    "android-app",
    "feature-local-terminal",
    "src",
    "main",
  );
  const environment = fs.readFileSync(
    path.join(
      sourceRoot,
      "java",
      "com",
      "chainlesschain",
      "android",
      "feature",
      "localterminal",
      "PtyEnvironment.kt",
    ),
    "utf8",
  );
  const manifest = fs.readFileSync(
    path.join(sourceRoot, "AndroidManifest.xml"),
    "utf8",
  );

  assert.match(environment, /\.activeNetwork\b/);
  assert.match(environment, /\.getLinkProperties\(/);
  assert.match(
    manifest,
    /android:name="android\.permission\.ACCESS_NETWORK_STATE"/,
  );
});

test("Android lint regressions keep P2P, performance, and project fixes", () => {
  const androidRoot = path.join(repoRoot, "android-app");
  const p2pRoot = path.join(androidRoot, "feature-p2p", "src", "main");
  const p2pManifest = fs.readFileSync(
    path.join(p2pRoot, "AndroidManifest.xml"),
    "utf8",
  );
  const p2pNavigation = fs.readFileSync(
    path.join(
      p2pRoot,
      "java",
      "com",
      "chainlesschain",
      "android",
      "feature",
      "p2p",
      "navigation",
      "P2PNavigation.kt",
    ),
    "utf8",
  );
  const performanceRepository = fs.readFileSync(
    path.join(
      androidRoot,
      "feature-performance",
      "src",
      "main",
      "java",
      "com",
      "chainlesschain",
      "android",
      "feature",
      "performance",
      "data",
      "repository",
      "PerformanceRepository.kt",
    ),
    "utf8",
  );
  const projectNavigation = fs.readFileSync(
    path.join(
      androidRoot,
      "feature-project",
      "src",
      "main",
      "java",
      "com",
      "chainlesschain",
      "android",
      "feature",
      "project",
      "navigation",
      "ProjectNavigation.kt",
    ),
    "utf8",
  );

  assert.match(
    p2pManifest,
    /android:name="android\.permission\.POST_NOTIFICATIONS"/,
  );
  assert.match(
    p2pManifest,
    /android:name="android\.permission\.FOREGROUND_SERVICE_DATA_SYNC"/,
  );
  assert.match(
    p2pManifest,
    /android:name="androidx\.work\.impl\.foreground\.SystemForegroundService"/,
  );
  assert.match(p2pManifest, /android:foregroundServiceType="dataSync"/);
  assert.match(p2pNavigation, /\.collectAsState\(\)/);
  assert.doesNotMatch(p2pNavigation, /viewModel\.[A-Za-z]+\.value/);
  assert.doesNotMatch(performanceRepository, /\.removeLast\(\)/);
  assert.match(performanceRepository, /\.removeAt\(current\.lastIndex\)/);
  assert.match(
    projectNavigation,
    /remember\(backStackEntry\)\s*\{\s*navController\.getBackStackEntry\(ProjectRoute\.LIST\)/,
  );
});

test("Android local terminal unit fake cannot block the test scheduler", () => {
  const testSource = fs.readFileSync(
    path.join(
      repoRoot,
      "android-app",
      "feature-local-terminal",
      "src",
      "test",
      "java",
      "com",
      "chainlesschain",
      "android",
      "feature",
      "localterminal",
      "LocalPtyClientTest.kt",
    ),
    "utf8",
  );

  assert.match(testSource, /readQueue\.poll\(\)\s*\?:\s*ReadEvent\.Eof/);
  assert.doesNotMatch(testSource, /readQueue\.take\(\)/);
});

test("Android coverage produces real reports without masking test failures", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "android-tests.yml"),
    "utf8",
  );
  const coverageStart = workflow.indexOf("  code-coverage:");
  const coverageEnd = workflow.indexOf("  test-summary:", coverageStart);
  assert.ok(coverageStart >= 0);
  assert.ok(coverageEnd > coverageStart);
  const coverage = workflow.slice(coverageStart, coverageEnd);

  const generationStart = coverage.indexOf("- name: Generate Coverage Report");
  const generationEnd = coverage.indexOf(
    "- name: Upload Coverage to Codecov",
    generationStart,
  );
  const generation = coverage.slice(generationStart, generationEnd);
  assert.match(
    generation,
    /\.\/gradlew jacocoTestReport --parallel --max-workers=4 --no-daemon/,
  );
  assert.doesNotMatch(generation, /continue-on-error:\s*true/);
  assert.match(coverage, /jacoco\/jacocoTestReport\/jacocoTestReport\.xml/);
  assert.match(coverage, /if-no-files-found: error/);
  assert.match(coverage, /Audit Coverage Thresholds \(advisory\)/);
});

test("Android aggregate gates reject failed, cancelled, or skipped dependencies", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "android-tests.yml"),
    "utf8",
  );
  const summaryStart = workflow.indexOf("  test-summary:");
  const summaryEnd = workflow.indexOf("  lint-and-detekt:", summaryStart);
  const summary = workflow.slice(summaryStart, summaryEnd);
  assert.match(summary, /name: Enforce Test Gate Results/);
  for (const result of [
    "UNIT_RESULT",
    "INSTRUMENTED_RESULT",
    "COVERAGE_RESULT",
  ]) {
    assert.ok(summary.includes(`"$${result}" != "success"`));
  }

  const buildStart = workflow.indexOf("  build-status:");
  const buildStatus = workflow.slice(buildStart);
  for (const dependency of [
    "unit-tests",
    "instrumented-tests",
    "code-coverage",
    "lint-and-detekt",
  ]) {
    assert.ok(
      buildStatus.includes(
        '"${{ needs.' + dependency + '.result }}" != "success"',
      ),
    );
  }
  assert.doesNotMatch(buildStatus, /Some jobs were skipped or cancelled/);
});

test("Android emulator matrix runs real instrumented tests from the project directory", () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "android-tests.yml"),
    "utf8",
  );
  const matrixStart = workflow.indexOf("  instrumented-tests:");
  const matrixEnd = workflow.indexOf("  code-coverage:", matrixStart);
  assert.ok(matrixStart >= 0);
  assert.ok(matrixEnd > matrixStart);
  const matrix = workflow.slice(matrixStart, matrixEnd);

  assert.doesNotMatch(matrix, /continue-on-error:\s*true/);
  assert.doesNotMatch(matrix, /connectedAndroidTest --tests/);
  assert.doesNotMatch(
    matrix,
    /(P2PIntegrationTest|SocialPostUITest|ProjectEditorUITest)/,
  );
  assert.doesNotMatch(matrix, /^\s+cd android-app\s*$/m);
  assert.match(
    matrix,
    /cd android-app && \.\/gradlew :core-e2ee:connectedDebugAndroidTest/,
  );
  assert.match(matrix, /-Pandroid\.testInstrumentationRunnerArguments\.class=/);
});
