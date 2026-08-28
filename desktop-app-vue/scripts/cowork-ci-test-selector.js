#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(PROJECT_ROOT, "..");
const CLI_ROOT = path.join(REPO_ROOT, "packages", "cli");
const PROJECT_PREFIX = "desktop-app-vue/";
const CI_VITEST_FLAGS = [
  "--reporter=default",
  "--silent=passed-only",
  "--pool=forks",
  "--maxWorkers=2",
];
const CLI_CI_VITEST_FLAGS = ["--reporter=default", "--silent=passed-only"];
const CRITICAL_TESTS = [
  "tests/unit/llm/llm-service.test.js",
  "tests/unit/did/did-manager.test.js",
];
const CI_GATE_INTEGRITY_TEST = "scripts/__tests__/ci-gate-integrity.test.mjs";
const P1_10_CONFORMANCE_MATRIX_TEST =
  "scripts/__tests__/p1-10-conformance-matrix.test.mjs";
const OPEN_SOURCE_GAP_AUDIT =
  "docs/CODEX_OPEN_SOURCE_GAP_ANALYSIS_2026-08-24.md";
const CI_GATE_INTEGRITY_TRIGGERS = new Set([
  ".github/workflows/test.yml",
  "desktop-app-vue/scripts/cowork-ci-test-selector.js",
  OPEN_SOURCE_GAP_AUDIT,
  CI_GATE_INTEGRITY_TEST,
]);
const CLI_WINDOWS_SANDBOX_CONTRACT_TESTS = [
  "__tests__/unit/windows-sandbox-adapter-global-teardown-contract.test.js",
  "__tests__/unit/windows-sandbox-adapter-temp-root.test.js",
];
const CLI_CONTRACT_TEST_MAPPINGS = new Map([
  [
    "packages/cli/src/lib/graph-kernel/compiler.js",
    ["__tests__/unit/graph-kernel-compiler.test.js"],
  ],
  [
    "packages/cli/__tests__/unit/team-command-broker.test.js",
    ["__tests__/unit/team-command-broker.test.js"],
  ],
  [
    "packages/cli/__tests__/unit/team-runner-scope.test.js",
    ["__tests__/unit/team-runner-scope.test.js"],
  ],
  [
    "packages/cli/__tests__/unit/windows-sandbox-adapter-global-teardown-contract.test.js",
    [CLI_WINDOWS_SANDBOX_CONTRACT_TESTS[0]],
  ],
  [
    "packages/cli/__tests__/unit/windows-sandbox-adapter-temp-root.test.js",
    [CLI_WINDOWS_SANDBOX_CONTRACT_TESTS[1]],
  ],
  [
    "packages/cli/test/fixtures/windows-sandbox-global-teardown/contract-case.mjs",
    [CLI_WINDOWS_SANDBOX_CONTRACT_TESTS[0]],
  ],
  [
    "packages/cli/test/helpers/windows-sandbox-adapter-temp-root.js",
    CLI_WINDOWS_SANDBOX_CONTRACT_TESTS,
  ],
]);
const IDE_DEDICATED_GATE_PREFIXES = [
  "packages/vscode-extension/",
  "packages/jetbrains-plugin/",
];
const FULL_UNIT_TRIGGERS = new Set([
  ".cowork/ci-test-config.json",
  "package.json",
  "package-lock.json",
  "tests/setup.ts",
  "vitest.config.js",
  "vitest.config.mjs",
  "vitest.config.ts",
]);
const CONTENT_INTEGRATION_WIRING_TEST =
  "tests/unit/api/rss-email-production-wiring.test.js";
const STANDALONE_SIGNALING_BOUNDS_TEST =
  "tests/unit/p2p/standalone-signaling-server-bounds.test.js";
const IPFS_PRODUCTION_WIRING_TEST =
  "tests/unit/ipfs/ipfs-production-wiring.test.js";
const IPFS_TRANSPORT_CONTRACT_TESTS = [
  IPFS_PRODUCTION_WIRING_TEST,
  "src/main/ipfs/__tests__/ipfs-boundaries.test.js",
  "src/main/ipfs/__tests__/ipfs-content-runtime.test.js",
  "src/main/ipfs/__tests__/ipfs-manager.test.js",
  "src/main/ipfs/__tests__/ipfs-ipc.test.js",
];
const GRAPH_DEBUGGER_CONTRACT_TESTS = [
  "tests/unit/components/graphRunDebuggerUtils.test.js",
  "tests/unit/components/graphDebugHistoryCrossProduct.test.js",
  "tests/unit/components/GraphRunDebugger.smoke.test.js",
  "tests/unit/components/GraphRunDebugger.wiring.test.js",
  "tests/unit/pages/useAiChatHarnessGraph.test.js",
  "tests/unit/pages/AIChatPage.test.js",
];
const GRAPH_DEBUGGER_MAIN_CONTRACT_TESTS = [
  "src/main/ai-engine/code-agent/__tests__/app-server-pilot.test.js",
  "src/main/ai-engine/code-agent/__tests__/desktop-graph-execution-adapter.test.js",
  "src/main/workflow/__tests__/workflow-graph-authority.test.js",
  "src/main/workflow/__tests__/workflow-ipc-graph-history.test.js",
  "tests/unit/ai-engine/agents/agents-ipc.test.js",
  "src/main/ai-engine/agents/__tests__/agent-coordinator-parallel.test.js",
  "src/main/ai-engine/agents/__tests__/agent-coordinator-execution-contract.test.js",
  "src/main/ai-engine/agents/__tests__/agent-coordinator-eviction.test.js",
  "src/main/ai-engine/agents/__tests__/agent-coordinator-sessions-eviction.test.js",
  "tests/unit/ai-engine/agents/agent-coordinator-select.test.js",
];
const SKILL_SUPPLY_CHAIN_CONTRACT_TESTS = [
  "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-capability-catalog.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-egress-broker.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-environment-broker.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-git-process-handlers.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-local-service-broker.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-network-diagnostics-broker.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-process-broker.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/bundled-skill-specialized-network.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/external-skill-executor.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/skill-execution-security.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/skill-md-parser.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/markdown-skill.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/skill-loader.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/skill-loader-unit.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/skill-lazy-load.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/skill-sync-security.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-skill-creator.test.js",
];
const BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS = [
  ...SKILL_SUPPLY_CHAIN_CONTRACT_TESTS,
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-github-manager.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-google-workspace.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-free-model-manager.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-news-monitor.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-notion.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-tavily-search.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-weather.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-youtube-summarizer.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-api-gateway.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-obsidian.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-self-improving-agent.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-summarizer.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-brainstorming.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-humanizer.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-terraform-iac.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-ultrathink.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-create-pr.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-git-worktree.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-k8s-deployer.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/v1.2.0-pr-reviewer.test.js",
  "src/main/ai-engine/cowork/skills/__tests__/pdh-im-collect.test.js",
  "tests/unit/ai-engine/cowork/create-pr-injection.test.js",
  "tests/unit/ai-engine/cowork/git-worktree-injection.test.js",
  "tests/unit/ai-engine/cowork/k8s-deployer-injection.test.js",
  "tests/unit/ai-engine/cowork/pr-reviewer-injection.test.js",
  "src/main/ai-engine/cowork/skills/builtin/code-runner/__tests__/code-runner-security.test.js",
  "src/main/ai-engine/cowork/__tests__/self-improving-agent-handler.test.js",
  "src/main/ai-engine/cowork/__tests__/workflow-skills.test.js",
  "tests/unit/ai-engine/skill-handlers.test.js",
  "tests/unit/ai-engine/color-picker-handler.test.js",
  "tests/unit/ai-engine/humanizer-handler.test.js",
];
const SOURCE_PREFIX_CONTRACT_TEST_MAPPINGS = [
  [
    "src/main/ai-engine/cowork/skills/builtin/",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
];

const COLLAB_RUNTIME_CONTRACT_TESTS = [
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
const YJS_ORG_INTEGRATION_CONTRACT_TESTS = [
  ...COLLAB_RUNTIME_CONTRACT_TESTS,
  "tests/unit/enterprise/org-knowledge-sync.test.js",
];
const FEDERATED_TRANSPORT_CONTRACT_TESTS = [
  "src/main/federated/__tests__/model-parameter-sync-boundaries.test.js",
  "src/main/federated/__tests__/federated-learning-manager.test.js",
  "src/main/ipc/__tests__/phase-modules.test.js",
];
const SOCIAL_COLLAB_CONTRACT_TESTS = [
  "src/main/social/__tests__/collab-sync-boundaries.test.js",
  "src/main/social/__tests__/collab-engine.test.js",
  "src/main/social/__tests__/collab-awareness.test.js",
  "src/main/ipc/__tests__/phase-modules.test.js",
];
const P2P_FOUNDATION_BOUNDARY_TESTS = [
  "src/main/p2p/__tests__/p2p-stream-boundaries.test.js",
  "src/main/p2p/__tests__/device-sync-boundaries.test.js",
  "src/main/p2p/__tests__/p2p-manager-dispatch.test.js",
  "src/main/p2p/__tests__/p2p-gossip-roundtrip.test.js",
  "src/main/p2p/__tests__/connection-pool.test.js",
  "tests/unit/p2p/connection-pool-reacquire-active.test.js",
];
const DID_FOUNDATION_LIFECYCLE_TESTS = [
  "tests/unit/did/did-manager.test.js",
  "tests/unit/did/did-cache.test.js",
  "tests/unit/did/did-updater.test.js",
  "src/main/did/__tests__/did-manager-keystore.test.js",
];
const MTC_RUNTIME_BOUNDARY_TESTS = [
  "src/main/mtc/__tests__/mtc-runtime-boundaries.test.js",
  "src/main/mtc/__tests__/channel-event-batch.test.js",
  "src/main/mtc/__tests__/channel-envelope-distribution.test.js",
  "src/main/mtc/__tests__/mtc-federation-manager.test.js",
  "src/main/mtc/__tests__/auto-archive-scheduler.test.js",
  "src/main/mtc/__tests__/mtc-federation-roundtrip.test.js",
];
const GOSSIP_CONTRACT_TESTS = [
  "src/main/social/__tests__/gossip-boundaries.test.js",
  "src/main/social/__tests__/gossip-channel-receiver.integration.test.js",
  "src/main/p2p/__tests__/p2p-gossip-roundtrip.test.js",
];
const MESH_SOCIAL_CONTRACT_TESTS = [
  "src/main/social/__tests__/mesh-social-boundaries.test.js",
  "src/main/ipc/__tests__/phase-modules.test.js",
];
const SOCIAL_STARTUP_POLICY_TESTS = [
  "src/main/bootstrap/__tests__/social-startup-policy.test.js",
  "src/main/bootstrap/__tests__/social-manager-lifecycle.test.js",
  "src/main/ipc/__tests__/phase-modules.test.js",
];
const SOCIAL_SOURCE_LISTENER_CONTRACT_TESTS = [
  "src/main/social/__tests__/owned-source-listeners.test.js",
  "src/main/social/__tests__/friend-manager.test.js",
  "src/main/social/__tests__/post-manager.test.js",
  "src/main/social/__tests__/community-manager.test.js",
  "src/main/social/__tests__/channel-manager.test.js",
  "src/main/sync/__tests__/p2p-sync-engine-lifecycle.test.js",
  "src/main/organization/__tests__/org-p2p-network-lifecycle.test.js",
  "src/main/organization/__tests__/organization-manager-lifecycle.test.js",
];
const SOCIAL_ENTERPRISE_LIFECYCLE_TESTS = [
  "src/main/sync/__tests__/p2p-sync-engine-lifecycle.test.js",
  "src/main/organization/__tests__/did-invitation-manager-lifecycle.test.js",
  "src/main/organization/__tests__/org-p2p-network-lifecycle.test.js",
  "src/main/organization/__tests__/organization-manager-lifecycle.test.js",
  "src/main/collaboration/__tests__/collaboration-manager-lifecycle.test.js",
];
const DEEP_LINK_LIFECYCLE_TESTS = [
  "src/main/system/__tests__/deep-link-handler-lifecycle.test.js",
];
const SOCIAL_WIRING_LIFECYCLE_TESTS = [
  "src/main/bootstrap/__tests__/mtc-auto-bridge.integration.test.js",
  "src/main/social/__tests__/gossip-channel-receiver.integration.test.js",
];
const DESKTOP_PACKAGED_GRAPH_FIXTURE_TEST =
  "src/main/ai-engine/code-agent/__tests__/desktop-packaged-graph-fixture.test.js";
const REPO_SOURCE_CONTRACT_TEST_MAPPINGS = new Map([
  ["signaling-server/index.js", [STANDALONE_SIGNALING_BOUNDS_TEST]],
  ["signaling-server/boundaries.js", [STANDALONE_SIGNALING_BOUNDS_TEST]],
  [
    "signaling-server/offline-message-store.js",
    [STANDALONE_SIGNALING_BOUNDS_TEST],
  ],
  [
    "tests/fixtures/graph-debug-history/blocked-root-revision-v1.json",
    ["tests/unit/components/graphDebugHistoryCrossProduct.test.js"],
  ],
]);
const REPO_NODE_CONTRACT_TEST_MAPPINGS = new Map(
  [
    "tests/fixtures/p1-10-conformance-matrix.json",
    "scripts/p1-10-external-evidence-gate.mjs",
    P1_10_CONFORMANCE_MATRIX_TEST,
  ].map((source) => [source, [P1_10_CONFORMANCE_MATRIX_TEST]]),
);
const SOURCE_CONTRACT_TEST_MAPPINGS = new Map([
  ["electron-builder.yml", SKILL_SUPPLY_CHAIN_CONTRACT_TESTS],
  ["forge.config.js", SKILL_SUPPLY_CHAIN_CONTRACT_TESTS],
  [
    "src/main/collaboration/__tests__/fixtures/yjs-crash-writer.mjs",
    COLLAB_RUNTIME_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/code-agent/__tests__/fixtures/desktop-graph-kill-writer.cjs",
    [DESKTOP_PACKAGED_GRAPH_FIXTURE_TEST],
  ],
  ...[
    "src/main/ai-engine/code-agent/__tests__/fixtures/packaged-electron-graph/main.cjs",
    "src/main/ai-engine/code-agent/__tests__/fixtures/packaged-electron-graph/preload.cjs",
    "src/main/ai-engine/code-agent/__tests__/fixtures/packaged-electron-graph/renderer.html",
    "src/main/ai-engine/code-agent/__tests__/fixtures/packaged-electron-graph/package.json",
    "scripts/graph-packaged-electron-journey.mjs",
  ].map((fixturePath) => [fixturePath, [DESKTOP_PACKAGED_GRAPH_FIXTURE_TEST]]),
  [
    "src/main/index.js",
    [
      CONTENT_INTEGRATION_WIRING_TEST,
      ...COLLAB_RUNTIME_CONTRACT_TESTS,
      ...FEDERATED_TRANSPORT_CONTRACT_TESTS,
      ...SOCIAL_COLLAB_CONTRACT_TESTS,
      ...P2P_FOUNDATION_BOUNDARY_TESTS,
      ...DID_FOUNDATION_LIFECYCLE_TESTS,
      ...MTC_RUNTIME_BOUNDARY_TESTS,
      ...GOSSIP_CONTRACT_TESTS,
      ...SOCIAL_STARTUP_POLICY_TESTS,
      ...SOCIAL_ENTERPRISE_LIFECYCLE_TESTS,
      ...DEEP_LINK_LIFECYCLE_TESTS,
      ...SOCIAL_WIRING_LIFECYCLE_TESTS,
    ],
  ],
  [
    "src/preload/index.js",
    [
      CONTENT_INTEGRATION_WIRING_TEST,
      ...COLLAB_RUNTIME_CONTRACT_TESTS,
      ...GRAPH_DEBUGGER_MAIN_CONTRACT_TESTS,
    ],
  ],
  [
    "src/main/ai-engine/code-agent/app-server-pilot.js",
    GRAPH_DEBUGGER_MAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/code-agent/desktop-graph-execution-adapter.js",
    GRAPH_DEBUGGER_MAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/agents/agent-coordinator.js",
    GRAPH_DEBUGGER_MAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/agents/agents-ipc.js",
    GRAPH_DEBUGGER_MAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/workflow/workflow-pipeline.js",
    GRAPH_DEBUGGER_MAIN_CONTRACT_TESTS,
  ],
  ["src/main/workflow/workflow-ipc.js", GRAPH_DEBUGGER_MAIN_CONTRACT_TESTS],
  [
    "src/main/ai-engine/cowork/skills/skill-execution-security.js",
    SKILL_SUPPLY_CHAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/bundled-skill-capability-catalog.js",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/bundled-skill-egress-broker.js",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/bundled-skill-environment-broker.js",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/bundled-skill-local-service-broker.js",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/bundled-skill-network-diagnostics-broker.js",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/bundled-skill-process-broker.js",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "scripts/sync-bundled-skill-capabilities.mjs",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/builtin/brainstorming/SKILL.md",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/builtin/brainstorming/handler.js",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/builtin/color-picker/SKILL.md",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/builtin/color-picker/handler.js",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/builtin/humanizer/SKILL.md",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/builtin/humanizer/handler.js",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/builtin/terraform-iac/SKILL.md",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/builtin/terraform-iac/handler.js",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/builtin/text-transformer/SKILL.md",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/builtin/text-transformer/handler.js",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/builtin/ultrathink/SKILL.md",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/builtin/ultrathink/handler.js",
    BUNDLED_SKILL_CAPABILITY_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/external-skill-executor.js",
    SKILL_SUPPLY_CHAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/runtime/external-skill-worker.js",
    SKILL_SUPPLY_CHAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/skill-md-parser.js",
    SKILL_SUPPLY_CHAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/skill-loader.js",
    SKILL_SUPPLY_CHAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/index.js",
    SKILL_SUPPLY_CHAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/markdown-skill.js",
    SKILL_SUPPLY_CHAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/skills-ipc.js",
    SKILL_SUPPLY_CHAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/skill-sync-manager.js",
    SKILL_SUPPLY_CHAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/skill-sync-ipc.js",
    SKILL_SUPPLY_CHAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/skills/builtin/skill-creator/handler.js",
    SKILL_SUPPLY_CHAIN_CONTRACT_TESTS,
  ],
  [
    "src/main/ai-engine/cowork/cowork-ipc.js",
    SKILL_SUPPLY_CHAIN_CONTRACT_TESTS,
  ],
  ["src/main/ipfs/ipfs-boundaries.js", IPFS_TRANSPORT_CONTRACT_TESTS],
  ["src/main/ipfs/ipfs-content-runtime.js", IPFS_TRANSPORT_CONTRACT_TESTS],
  ["src/main/ipfs/ipfs-manager.js", IPFS_TRANSPORT_CONTRACT_TESTS],
  ["src/main/ipfs/ipfs-ipc.js", IPFS_TRANSPORT_CONTRACT_TESTS],
  [
    "src/renderer/components/graph/graphRunDebuggerUtils.js",
    GRAPH_DEBUGGER_CONTRACT_TESTS,
  ],
  [
    "src/renderer/components/graph/GraphRunDebugger.vue",
    GRAPH_DEBUGGER_CONTRACT_TESTS,
  ],
  ["src/renderer/pages/useAiChatHarness.js", GRAPH_DEBUGGER_CONTRACT_TESTS],
  ["src/renderer/pages/AIChatPage.vue", GRAPH_DEBUGGER_CONTRACT_TESTS],
  ["src/renderer/pages/WorkflowMonitorPage.vue", GRAPH_DEBUGGER_CONTRACT_TESTS],
  ["src/renderer/shell/AgentDashboardPanel.vue", GRAPH_DEBUGGER_CONTRACT_TESTS],
  [
    "src/main/ipc/phases/phase-21-30-enterprise.js",
    [IPFS_PRODUCTION_WIRING_TEST],
  ],
  [
    "src/main/collaboration/collab-boundaries.js",
    COLLAB_RUNTIME_CONTRACT_TESTS,
  ],
  [
    "src/main/collaboration/yjs-collab-manager.js",
    YJS_ORG_INTEGRATION_CONTRACT_TESTS,
  ],
  [
    "src/main/collaboration/realtime-collab-manager.js",
    COLLAB_RUNTIME_CONTRACT_TESTS,
  ],
  [
    "src/main/collaboration/org-knowledge-sync-manager.js",
    YJS_ORG_INTEGRATION_CONTRACT_TESTS,
  ],
  [
    "src/main/collaboration/realtime-collab-ipc.js",
    COLLAB_RUNTIME_CONTRACT_TESTS,
  ],
  ["src/main/collab/collab-session-manager.js", COLLAB_RUNTIME_CONTRACT_TESTS],
  [
    "src/main/federated/federated-transport-boundaries.js",
    FEDERATED_TRANSPORT_CONTRACT_TESTS,
  ],
  [
    "src/main/federated/model-parameter-sync.js",
    FEDERATED_TRANSPORT_CONTRACT_TESTS,
  ],
  [
    "src/main/federated/federated-learning-manager.js",
    FEDERATED_TRANSPORT_CONTRACT_TESTS,
  ],
  [
    "src/main/ipc/phases/phase-31-ai-models.js",
    FEDERATED_TRANSPORT_CONTRACT_TESTS,
  ],
  ...[
    "src/main/social/social-collab-boundaries.js",
    "src/main/social/social-collab-transport.js",
    "src/main/social/collab-sync.js",
    "src/main/social/collab-social-ipc.js",
  ].map((sourcePath) => [sourcePath, SOCIAL_COLLAB_CONTRACT_TESTS]),
  ...[
    "src/main/bootstrap/social-initializer.js",
    "src/main/bootstrap/index.js",
  ].map((sourcePath) => [
    sourcePath,
    [
      ...SOCIAL_COLLAB_CONTRACT_TESTS,
      ...P2P_FOUNDATION_BOUNDARY_TESTS,
      ...DID_FOUNDATION_LIFECYCLE_TESTS,
      ...MTC_RUNTIME_BOUNDARY_TESTS,
      ...GOSSIP_CONTRACT_TESTS,
      ...MESH_SOCIAL_CONTRACT_TESTS,
      ...SOCIAL_STARTUP_POLICY_TESTS,
      ...SOCIAL_ENTERPRISE_LIFECYCLE_TESTS,
      ...SOCIAL_WIRING_LIFECYCLE_TESTS,
    ],
  ]),
  ...[
    "src/main/bootstrap/social-startup-policy.js",
    "src/main/bootstrap/social-manager-lifecycle.js",
  ].map((sourcePath) => [sourcePath, SOCIAL_STARTUP_POLICY_TESTS]),
  ...[
    "src/main/sync/p2p-sync-engine.js",
    "src/main/organization/did-invitation-manager.js",
    "src/main/organization/org-p2p-network.js",
    "src/main/organization/organization-manager.js",
    "src/main/collaboration/collaboration-manager.js",
    "src/main/collaboration/collaboration-server-lifecycle.js",
  ].map((sourcePath) => [sourcePath, SOCIAL_ENTERPRISE_LIFECYCLE_TESTS]),
  ...[
    "src/main/p2p/p2p-manager.js",
    "src/main/p2p/p2p-stream-boundaries.js",
    "src/main/p2p/device-sync-manager.js",
    "src/main/p2p/device-sync-boundaries.js",
  ].map((sourcePath) => [sourcePath, P2P_FOUNDATION_BOUNDARY_TESTS]),
  ["src/main/p2p/connection-pool.js", P2P_FOUNDATION_BOUNDARY_TESTS],
  ...[
    "src/main/did/did-manager.js",
    "src/main/did/did-cache.js",
    "src/main/did/did-updater.js",
  ].map((sourcePath) => [sourcePath, DID_FOUNDATION_LIFECYCLE_TESTS]),
  ...[
    "src/main/mtc/mtc-runtime-boundaries.js",
    "src/main/mtc/channel-event-batch.js",
    "src/main/mtc/channel-envelope-distribution.js",
    "src/main/mtc/mtc-federation-manager.js",
    "src/main/mtc/auto-archive-scheduler.js",
  ].map((sourcePath) => [sourcePath, MTC_RUNTIME_BOUNDARY_TESTS]),
  [
    "src/main/social/owned-source-listeners.js",
    [
      ...SOCIAL_SOURCE_LISTENER_CONTRACT_TESTS,
      ...P2P_FOUNDATION_BOUNDARY_TESTS,
    ],
  ],
  ["src/main/system/deep-link-handler.js", DEEP_LINK_LIFECYCLE_TESTS],
  ...[
    "src/main/social/gossip-boundaries.js",
    "src/main/social/gossip-protocol.js",
  ].map((sourcePath) => [sourcePath, GOSSIP_CONTRACT_TESTS]),
  ...[
    "src/main/social/mesh-social-boundaries.js",
    "src/main/social/mesh-social.js",
    "src/main/social/future-ipc.js",
  ].map((sourcePath) => [sourcePath, MESH_SOCIAL_CONTRACT_TESTS]),
  [
    "src/main/ipc/phases/phase-3-4-social.js",
    [
      ...SOCIAL_COLLAB_CONTRACT_TESTS,
      ...MESH_SOCIAL_CONTRACT_TESTS,
      ...SOCIAL_STARTUP_POLICY_TESTS,
    ],
  ],
  ["src/main/collab/collab-ipc.js", COLLAB_RUNTIME_CONTRACT_TESTS],
  [
    "src/main/ipc/phases/phase-33-40-collab-ops.js",
    COLLAB_RUNTIME_CONTRACT_TESTS,
  ],
  ["src/renderer/stores/collab.ts", COLLAB_RUNTIME_CONTRACT_TESTS],
  ["src/renderer/utils/yjs-ipc-provider.ts", COLLAB_RUNTIME_CONTRACT_TESTS],
  [
    "src/renderer/pages/email/AccountManager.vue",
    [
      CONTENT_INTEGRATION_WIRING_TEST,
      "tests/unit/pages/AccountManager.test.js",
    ],
  ],
  [
    "src/renderer/pages/email/EmailComposer.vue",
    [CONTENT_INTEGRATION_WIRING_TEST, "tests/unit/pages/EmailComposer.test.js"],
  ],
  [
    "src/renderer/pages/email/EmailReader.vue",
    [CONTENT_INTEGRATION_WIRING_TEST, "tests/unit/pages/EmailReader.test.js"],
  ],
  [
    "src/renderer/pages/rss/ArticleReader.vue",
    [CONTENT_INTEGRATION_WIRING_TEST, "tests/unit/pages/ArticleReader.test.js"],
  ],
  [
    "src/renderer/pages/rss/FeedList.vue",
    [CONTENT_INTEGRATION_WIRING_TEST, "tests/unit/pages/FeedList.test.js"],
  ],
  [
    "src/renderer/types/electron.d.ts",
    [
      CONTENT_INTEGRATION_WIRING_TEST,
      ...COLLAB_RUNTIME_CONTRACT_TESTS,
      ...GRAPH_DEBUGGER_MAIN_CONTRACT_TESTS,
    ],
  ],
]);

class SelectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SelectionError";
    this.code = code;
    this.details = details;
  }
}

function toPosix(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isSafeRepositoryRelativePath(filePath) {
  const normalized = toPosix(filePath);
  return (
    Boolean(normalized) &&
    !path.posix.isAbsolute(normalized) &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  );
}

function validateBaseRef(baseRef) {
  if (
    typeof baseRef !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(baseRef) ||
    baseRef.includes("..") ||
    baseRef.includes("@{") ||
    baseRef.includes("//") ||
    baseRef.endsWith("/") ||
    baseRef.endsWith(".") ||
    baseRef.endsWith(".lock")
  ) {
    throw new SelectionError(
      "INVALID_BASE_REF",
      `Unsafe or invalid base ref: ${JSON.stringify(baseRef)}`,
    );
  }

  return baseRef;
}

function validateBaseSha(baseSha) {
  if (
    typeof baseSha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(baseSha) ||
    /^0{40}$/.test(baseSha)
  ) {
    throw new SelectionError(
      "INVALID_BASE_SHA",
      `Unsafe or invalid base SHA: ${JSON.stringify(baseSha)}`,
    );
  }

  return baseSha;
}

function getChangedFilesCI({
  baseRef = process.env.GITHUB_BASE_REF || "main",
  baseSha = process.env.COWORK_PUSH_BASE_SHA || "",
  repoRoot = REPO_ROOT,
  spawn = spawnSync,
} = {}) {
  const comparison = baseSha
    ? `${validateBaseSha(baseSha)}...HEAD`
    : `origin/${validateBaseRef(baseRef)}...HEAD`;
  const result = spawn(
    "git",
    ["diff", "--name-only", "--diff-filter=ACDMRTUXB", comparison, "--"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
    },
  );

  if (result.error) {
    throw new SelectionError(
      "GIT_DIFF_SPAWN_FAILED",
      `Unable to start git diff: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new SelectionError(
      "GIT_DIFF_FAILED",
      `git diff exited with ${String(result.status)}`,
      { stderr: String(result.stderr || "").trim() },
    );
  }

  const changedFiles = String(result.stdout || "")
    .split(/\r?\n/)
    .map((file) => toPosix(file.trim()))
    .filter(Boolean);

  if (changedFiles.length === 0) {
    throw new SelectionError(
      "NO_CHANGED_FILES",
      "The base comparison produced no changed files; refusing a no-op pass.",
      { comparison },
    );
  }

  return changedFiles;
}

function projectRelativePath(repoRelativePath) {
  const normalized = toPosix(repoRelativePath);
  if (!isSafeRepositoryRelativePath(normalized)) {
    return null;
  }
  if (!normalized.startsWith(PROJECT_PREFIX)) {
    return null;
  }
  return normalized.slice(PROJECT_PREFIX.length);
}

function isVitestFile(projectRelativeFile) {
  return (
    /^(tests\/unit|src)\/.*\.test\.(?:js|ts|jsx|tsx)$/.test(
      projectRelativeFile,
    ) && !projectRelativeFile.includes("/tests/e2e/")
  );
}

function candidateTestsForSource(
  projectRelativeFile,
  { projectRoot = PROJECT_ROOT } = {},
) {
  const extension = path.posix.extname(projectRelativeFile);
  if (![".js", ".ts", ".jsx", ".tsx", ".vue"].includes(extension)) {
    return [];
  }

  const dirname = path.posix.dirname(projectRelativeFile);
  const basename = path.posix.basename(projectRelativeFile, extension);
  const testExtensions = extension === ".vue" ? [".js", ".ts"] : [extension];
  const candidates = new Set();

  for (const testExtension of testExtensions) {
    candidates.add(`${dirname}/${basename}.test${testExtension}`);
    candidates.add(`${dirname}/__tests__/${basename}.test${testExtension}`);
  }

  for (const sourcePrefix of ["src/main/", "src/renderer/", "src/shared/"]) {
    if (!projectRelativeFile.startsWith(sourcePrefix)) {
      continue;
    }
    const mirrored = projectRelativeFile.slice(sourcePrefix.length);
    const mirrorDir = path.posix.dirname(mirrored);
    for (const testExtension of testExtensions) {
      candidates.add(
        `tests/unit/${mirrorDir}/${basename}.test${testExtension}`,
      );
      candidates.add(
        `tests/unit/${mirrorDir}/__tests__/${basename}.test${testExtension}`,
      );
    }
  }

  const candidateDirectories = new Set(
    [...candidates].map((candidate) => path.posix.dirname(candidate)),
  );
  for (const directory of candidateDirectories) {
    const absoluteDirectory = path.join(projectRoot, ...directory.split("/"));
    if (!fs.existsSync(absoluteDirectory)) {
      continue;
    }

    let entries;
    try {
      entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      throw new SelectionError(
        "TEST_DISCOVERY_FAILED",
        `Unable to inspect related test directory ${JSON.stringify(directory)}: ${error.message}`,
      );
    }

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const match = entry.name.match(/^(.*)\.test\.(?:js|ts|jsx|tsx)$/);
      if (!match) {
        continue;
      }
      const testStem = match[1];
      if (
        testStem === basename ||
        testStem.startsWith(`${basename}-`) ||
        testStem.startsWith(`${basename}.`)
      ) {
        candidates.add(`${directory}/${entry.name}`);
      }
    }
  }

  return [...candidates].sort();
}

function createSelection(
  changedFiles,
  { projectRoot = PROJECT_ROOT, cliRoot = CLI_ROOT, repoRoot = REPO_ROOT } = {},
) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    throw new SelectionError(
      "NO_CHANGED_FILES",
      "At least one changed file is required for test selection.",
    );
  }

  const selectedDesktopTests = new Set();
  const selectedCliTests = new Set();
  const selectedIntegrityTests = new Set();
  const mappings = [];
  const unmappedFiles = [];
  let desktopMapped = false;
  let fullDesktopUnit = false;

  for (const changedFile of changedFiles) {
    const normalized = toPosix(changedFile);
    if (!isSafeRepositoryRelativePath(normalized)) {
      unmappedFiles.push(normalized);
      continue;
    }
    if (CI_GATE_INTEGRITY_TRIGGERS.has(normalized)) {
      const absoluteTest = path.join(
        repoRoot,
        ...CI_GATE_INTEGRITY_TEST.split("/"),
      );
      if (!fs.existsSync(absoluteTest)) {
        unmappedFiles.push(normalized);
        continue;
      }
      selectedIntegrityTests.add(CI_GATE_INTEGRITY_TEST);
      mappings.push({
        file: normalized,
        suite: "ci-gate-integrity",
        tests: [CI_GATE_INTEGRITY_TEST],
      });
      continue;
    }

    const repoNodeTests = REPO_NODE_CONTRACT_TEST_MAPPINGS.get(normalized);
    if (repoNodeTests) {
      const missingTests = repoNodeTests.filter(
        (testFile) =>
          !fs.existsSync(path.join(repoRoot, ...testFile.split("/"))),
      );
      if (missingTests.length > 0) {
        unmappedFiles.push(normalized);
        mappings.push({
          file: normalized,
          suite: "ci-gate-integrity",
          reason: "mapped-test-not-present",
          missingTests,
        });
        continue;
      }
      for (const testFile of repoNodeTests) {
        selectedIntegrityTests.add(testFile);
      }
      mappings.push({
        file: normalized,
        suite: "ci-gate-integrity",
        tests: [...repoNodeTests],
      });
      continue;
    }

    const cliContractTests = CLI_CONTRACT_TEST_MAPPINGS.get(normalized);
    if (cliContractTests) {
      const missingTests = cliContractTests.filter(
        (testFile) =>
          !fs.existsSync(path.join(cliRoot, ...testFile.split("/"))),
      );
      if (missingTests.length > 0) {
        unmappedFiles.push(normalized);
        mappings.push({
          file: normalized,
          suite: "cli-unit",
          reason: "mapped-test-not-present",
          missingTests,
        });
        continue;
      }
      for (const testFile of cliContractTests) {
        selectedCliTests.add(testFile);
      }
      mappings.push({
        file: normalized,
        suite: "cli-unit",
        tests: [...cliContractTests],
      });
      continue;
    }

    const repoContractTests =
      REPO_SOURCE_CONTRACT_TEST_MAPPINGS.get(normalized);
    if (repoContractTests) {
      const missingTests = repoContractTests.filter(
        (testFile) =>
          !fs.existsSync(path.join(projectRoot, ...testFile.split("/"))),
      );
      if (missingTests.length > 0) {
        unmappedFiles.push(normalized);
        mappings.push({
          file: normalized,
          suite: "desktop-unit",
          reason: "mapped-test-not-present",
          missingTests,
        });
        continue;
      }
      desktopMapped = true;
      for (const testFile of repoContractTests) {
        selectedDesktopTests.add(testFile);
      }
      mappings.push({
        file: normalized,
        suite: "desktop-unit",
        tests: [...repoContractTests],
      });
      continue;
    }

    if (
      IDE_DEDICATED_GATE_PREFIXES.some((prefix) =>
        normalized.startsWith(prefix),
      )
    ) {
      desktopMapped = true;
      mappings.push({
        file: normalized,
        suite: "desktop-unit",
        tests: [],
        reason: "covered-by-ide-dedicated-gates",
      });
      continue;
    }
    const relativeFile = projectRelativePath(normalized);

    if (!relativeFile) {
      unmappedFiles.push(normalized);
      continue;
    }

    desktopMapped = true;
    if (FULL_UNIT_TRIGGERS.has(relativeFile)) {
      fullDesktopUnit = true;
      mappings.push({ file: normalized, suite: "desktop-unit", mode: "full" });
      continue;
    }

    const contractTests =
      SOURCE_CONTRACT_TEST_MAPPINGS.get(relativeFile) ||
      SOURCE_PREFIX_CONTRACT_TEST_MAPPINGS.find(([prefix]) =>
        relativeFile.startsWith(prefix),
      )?.[1];
    if (contractTests) {
      const missingTests = contractTests.filter(
        (testFile) =>
          !fs.existsSync(path.join(projectRoot, ...testFile.split("/"))),
      );
      if (missingTests.length > 0) {
        unmappedFiles.push(normalized);
        mappings.push({
          file: normalized,
          suite: "desktop-unit",
          reason: "mapped-test-not-present",
          missingTests,
        });
        continue;
      }
      for (const testFile of contractTests) {
        selectedDesktopTests.add(testFile);
      }
      mappings.push({
        file: normalized,
        suite: "desktop-unit",
        tests: [...contractTests],
      });
      continue;
    }

    if (isVitestFile(relativeFile)) {
      const absoluteTest = path.join(projectRoot, ...relativeFile.split("/"));
      if (fs.existsSync(absoluteTest)) {
        selectedDesktopTests.add(relativeFile);
        mappings.push({
          file: normalized,
          suite: "desktop-unit",
          tests: [relativeFile],
        });
      } else {
        // A deleted or renamed test can invalidate more than itself.
        fullDesktopUnit = true;
        mappings.push({
          file: normalized,
          suite: "desktop-unit",
          mode: "full",
          reason: "changed-test-not-present",
        });
      }
      continue;
    }

    if (relativeFile.startsWith("src/")) {
      const relatedTests = candidateTestsForSource(relativeFile, {
        projectRoot,
      }).filter((testFile) =>
        fs.existsSync(path.join(projectRoot, ...testFile.split("/"))),
      );

      if (relatedTests.length === 0) {
        unmappedFiles.push(normalized);
        continue;
      }

      for (const testFile of relatedTests) {
        selectedDesktopTests.add(testFile);
      }
      mappings.push({
        file: normalized,
        suite: "desktop-unit",
        tests: relatedTests,
      });
      continue;
    }

    // Non-source project changes can affect bundling, fixtures, or runtime
    // discovery. Treat them as a full unit-suite trigger instead of a no-op.
    fullDesktopUnit = true;
    mappings.push({
      file: normalized,
      suite: "desktop-unit",
      mode: "full",
      reason: "project-support-file",
    });
  }

  if (unmappedFiles.length > 0) {
    throw new SelectionError(
      "UNMAPPED_CHANGED_FILES",
      "One or more changed files could not be mapped safely; the workflow must run its fallback suite.",
      { unmappedFiles, mappings },
    );
  }

  if (desktopMapped && !fullDesktopUnit) {
    for (const criticalTest of CRITICAL_TESTS) {
      if (fs.existsSync(path.join(projectRoot, ...criticalTest.split("/")))) {
        selectedDesktopTests.add(criticalTest);
      }
    }
  }

  const testSuites = [];
  if (selectedIntegrityTests.size > 0) {
    testSuites.push({
      suite: "ci-gate-integrity",
      runner: "node-test",
      root: ".",
      mode: "targeted",
      selectedTests: [...selectedIntegrityTests].sort(),
    });
  }
  if (selectedCliTests.size > 0) {
    testSuites.push({
      suite: "cli-unit",
      runner: "vitest",
      root: "packages/cli",
      mode: "targeted",
      selectedTests: [...selectedCliTests].sort(),
    });
  }
  if (desktopMapped) {
    testSuites.push({
      suite: "desktop-unit",
      runner: "vitest",
      root: "desktop-app-vue",
      mode: fullDesktopUnit ? "full" : "targeted",
      selectedTests: fullDesktopUnit
        ? ["tests/unit", "src"]
        : [...selectedDesktopTests].sort(),
    });
  }

  if (
    testSuites.length === 0 ||
    testSuites.some(
      (testSuite) =>
        testSuite.mode !== "full" && testSuite.selectedTests.length === 0,
    )
  ) {
    throw new SelectionError(
      "EMPTY_SELECTION",
      "The selector produced no executable tests; refusing a no-op pass.",
      { mappings },
    );
  }

  const isSingleSuite = testSuites.length === 1;
  const selectedTests = isSingleSuite
    ? testSuites[0].selectedTests
    : testSuites
        .flatMap((testSuite) =>
          testSuite.selectedTests.map((testFile) =>
            testSuite.root === "." ? testFile : `${testSuite.root}/${testFile}`,
          ),
        )
        .sort();

  return {
    schemaVersion: 1,
    status: "selected",
    suite: isSingleSuite ? testSuites[0].suite : "unit-matrix",
    mode: testSuites.some((testSuite) => testSuite.mode === "full")
      ? "full"
      : "targeted",
    changedFiles: changedFiles.map(toPosix),
    selectedTests,
    testSuites,
    mappings,
  };
}

function resolveVitestEntrypoint({ explicit, searchRoots, fallbackRoot }) {
  let vitestEntrypoint = explicit;
  if (!vitestEntrypoint) {
    try {
      const vitestPackage = require.resolve("vitest/package.json", {
        paths: searchRoots,
      });
      vitestEntrypoint = path.join(path.dirname(vitestPackage), "vitest.mjs");
    } catch {
      // Keep dry-run planning dependency-free. A real invocation still starts
      // Node with this explicit path and propagates its non-zero missing-module
      // exit instead of falling back to a shell or reporting success.
      vitestEntrypoint = path.join(
        fallbackRoot,
        "node_modules",
        "vitest",
        "vitest.mjs",
      );
    }
  }
  return vitestEntrypoint;
}

function commandsForSelection(selection, options = {}) {
  const testSuites = Array.isArray(selection.testSuites)
    ? selection.testSuites
    : [
        {
          suite: selection.suite,
          runner: "vitest",
          root: "desktop-app-vue",
          mode: selection.mode,
          selectedTests: selection.selectedTests,
        },
      ];

  return testSuites.map((testSuite) => {
    if (testSuite.runner === "node-test") {
      return {
        suite: testSuite.suite,
        cwd: REPO_ROOT,
        executable: process.execPath,
        args: ["--test", ...testSuite.selectedTests],
      };
    }

    const isCliSuite = testSuite.suite === "cli-unit";
    const suiteRoot = isCliSuite ? CLI_ROOT : PROJECT_ROOT;
    const explicitEntrypoint = isCliSuite
      ? options.cliVitestEntrypoint ||
        process.env.COWORK_CLI_VITEST_ENTRYPOINT ||
        options.vitestEntrypoint
      : options.desktopVitestEntrypoint ||
        process.env.COWORK_VITEST_ENTRYPOINT ||
        options.vitestEntrypoint;
    const vitestEntrypoint = resolveVitestEntrypoint({
      explicit: explicitEntrypoint,
      searchRoots: [suiteRoot, REPO_ROOT],
      fallbackRoot: isCliSuite ? REPO_ROOT : PROJECT_ROOT,
    });

    return {
      suite: testSuite.suite,
      cwd: suiteRoot,
      executable: process.execPath,
      args: [
        vitestEntrypoint,
        "run",
        ...testSuite.selectedTests,
        ...(isCliSuite ? CLI_CI_VITEST_FLAGS : CI_VITEST_FLAGS),
      ],
    };
  });
}

function commandForSelection(selection, options = {}) {
  const commands = commandsForSelection(selection, options);
  if (commands.length !== 1) {
    throw new SelectionError(
      "MULTIPLE_TEST_COMMANDS",
      "The selection contains multiple suites; execute every planned command.",
      { suites: commands.map((command) => command.suite) },
    );
  }
  return commands[0];
}

function appendGitHubOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`, "utf8");
}

function emitMachineResult(payload) {
  const serialized = JSON.stringify(payload);
  console.log(`COWORK_TEST_SELECTION_JSON=${serialized}`);
  appendGitHubOutput("test-mode", payload.mode || "fail-closed");
  appendGitHubOutput(
    "test-count",
    String(
      Array.isArray(payload.selectedTests) ? payload.selectedTests.length : 0,
    ),
  );
  appendGitHubOutput("selection-json", serialized);
}

function parseArgs(argv) {
  const parsed = { changedFiles: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      parsed.dryRun = true;
    } else if (argument === "--json") {
      parsed.json = true;
    } else if (argument === "--base") {
      index += 1;
      if (!argv[index]) {
        throw new SelectionError("INVALID_ARGUMENT", "--base requires a value");
      }
      parsed.baseRef = argv[index];
    } else if (argument === "--base-sha") {
      index += 1;
      if (!argv[index]) {
        throw new SelectionError(
          "INVALID_ARGUMENT",
          "--base-sha requires a value",
        );
      }
      parsed.baseSha = argv[index];
    } else if (argument === "--changed-file") {
      index += 1;
      if (!argv[index]) {
        throw new SelectionError(
          "INVALID_ARGUMENT",
          "--changed-file requires a value",
        );
      }
      parsed.changedFiles.push(argv[index]);
    } else {
      throw new SelectionError(
        "INVALID_ARGUMENT",
        `Unknown argument: ${argument}`,
      );
    }
  }
  return parsed;
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  const spawn = dependencies.spawn || spawnSync;

  try {
    const args = parseArgs(argv);
    const changedFiles =
      args.changedFiles.length > 0
        ? args.changedFiles
        : getChangedFilesCI({
            baseRef: args.baseRef,
            baseSha: args.baseSha,
            spawn,
          });
    const selection = createSelection(changedFiles);
    const commands = commandsForSelection(selection);
    const selectedPayload = {
      ...selection,
      commands,
      ...(commands.length === 1 ? { command: commands[0] } : {}),
    };

    if (!args.json) {
      console.log(
        `Selected ${selection.mode} ${selection.suite} coverage for ${selection.changedFiles.length} changed file(s).`,
      );
      for (const command of commands) {
        console.log(
          `Command (${command.suite}): ${command.executable} ${command.args.join(" ")}`,
        );
      }
    }

    if (args.dryRun) {
      emitMachineResult({ ...selectedPayload, status: "dry-run" });
      return 0;
    }

    const childEnvironment = { ...process.env };
    delete childEnvironment.GITHUB_OUTPUT;
    for (const command of commands) {
      const result = spawn(command.executable, command.args, {
        cwd: command.cwd,
        env: childEnvironment,
        stdio: "inherit",
        windowsHide: true,
      });
      if (result.error) {
        emitMachineResult({
          ...selectedPayload,
          status: "failed",
          failedSuite: command.suite,
          code: "TEST_SPAWN_FAILED",
          message: `Unable to start selected ${command.suite} suite: ${result.error.message}`,
          exitCode: 1,
          signal: null,
        });
        return 1;
      }

      const exitCode = Number.isInteger(result.status) ? result.status : 1;
      if (exitCode !== 0) {
        emitMachineResult({
          ...selectedPayload,
          status: "failed",
          failedSuite: command.suite,
          exitCode,
          signal: result.signal || null,
        });
        return exitCode;
      }
    }

    emitMachineResult({
      ...selectedPayload,
      status: "passed",
      exitCode: 0,
      signal: null,
    });
    return 0;
  } catch (error) {
    const payload = {
      schemaVersion: 1,
      status: "fail-closed",
      code: error.code || "SELECTION_FAILED",
      message: error.message,
      details: error.details || {},
    };
    console.error(`CI test selection failed closed: ${payload.message}`);
    emitMachineResult(payload);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  SelectionError,
  candidateTestsForSource,
  commandForSelection,
  commandsForSelection,
  createSelection,
  getChangedFilesCI,
  main,
  parseArgs,
  projectRelativePath,
  validateBaseSha,
  validateBaseRef,
};
