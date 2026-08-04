/**
 * Canonical, public (secret-free) IDE capability manifest.
 *
 * Host runtimes intentionally keep their native registration formats
 * (VS Code package.json/registerCommand, JetBrains plugin.xml/actions and the
 * existing Desktop keyboard-shortcut registry).  This manifest is the single
 * reviewable contract those public surfaces are validated against.
 */

import { buildCompatFixture } from "./capability-manifest.js";

const freeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

const BRIDGE_TOOL_FEATURES = [
  ["getSelection", "selection"],
  ["getActiveFile", "active_file"],
  ["getDiagnostics", "diagnostics"],
  ["getOpenEditors", "open_editors"],
  ["openDiff", "native_diff"],
  ["openMultiDiff", "multi_file_diff"],
  ["getTerminalOutput", "terminal_output"],
  ["getPreviewState", "preview_state"],
  ["getTestResults", "test_results"],
  ["getCoverage", "coverage"],
  ["getDebugState", "debug_state"],
  ["executeCode", "notebook_execute"],
  ["getHover", "semantic_hover"],
  ["goToDefinition", "semantic_definition"],
  ["findReferences", "semantic_references"],
  ["renamePreview", "semantic_rename"],
  ["getCallHierarchy", "semantic_call_hierarchy"],
  ["getSymbolInfo", "semantic_symbols"],
  ["getProjectModel", "project_model"],
];

const VSCODE_COMMANDS = [
  "chainlesschain.ide.showStatus",
  "chainlesschain.ide.restart",
  "chainlesschain.ide.openDashboard",
  "chainlesschain.complete.trigger",
  "chainlesschain.ide.doctor",
  "chainlesschain.ide.exportDiagnostics",
  "chainlesschain.team.monitor",
  "chainlesschain.session.prStatus",
  "chainlesschain.background.agents",
  "chainlesschain.sessions.workbench",
  "chainlesschain.remote.control",
  "chainlesschain.usage.show",
  "chainlesschain.plugins.manage",
  "chainlesschain.worktree.tasks",
  "chainlesschain.chrome.connector",
  "chainlesschain.artifacts.show",
  "chainlesschain.policy.show",
  "chainlesschain.workspace.scanAutoExec",
  "chainlesschain.remote.doctor",
  "chainlesschain.lens.explain",
  "chainlesschain.lens.refactor",
  "chainlesschain.diff.accept",
  "chainlesschain.diff.reject",
  "chainlesschain.memory.init",
  "chainlesschain.memory.files",
  "chainlesschain.llm.configure",
  "chainlesschain.llm.configureVision",
  "chainlesschain.chat.insertReference",
  "chainlesschain.chat.fixDiagnostics",
  "chainlesschain.chat.explainSelection",
  "chainlesschain.chat.refactorSelection",
  "chainlesschain.chat.newConversation",
  "chainlesschain.chat.reopenClosedSession",
  "chainlesschain.inlineChat.open",
  "chainlesschain.inlineChat.explain",
  "chainlesschain.inlineChat.refactor",
  "chainlesschain.inlineChat.fix",
  "chainlesschain.inlineChat.generateDocs",
  "chainlesschain.inlineChat.generateTests",
  "chainlesschain.plan.approve",
  "chainlesschain.plan.requestChanges",
  "chainlesschain.plan.regenerate",
  "chainlesschain.plan.reject",
  "chainlesschain.preview.start",
  "chainlesschain.preview.stop",
  "chainlesschain.cli.upgrade",
  "chainlesschain.cli.checkUpdate",
  "chainlesschain.cli.whatsNew",
  "chainlesschain.cli.installManaged",
  "chainlesschain.cli.rollbackManaged",
];

const JETBRAINS_ACTIONS = [
  "chainlesschain.ide.ShowStatus",
  "chainlesschain.ide.ShowActivity",
  "chainlesschain.ide.OpenDashboard",
  "chainlesschain.team.Monitor",
  "chainlesschain.session.PrStatus",
  "chainlesschain.bg.Agents",
  "chainlesschain.remote.Control",
  "chainlesschain.sessions.Workbench",
  "chainlesschain.usage.Show",
  "chainlesschain.artifacts.Browse",
  "chainlesschain.policy.Viewer",
  "chainlesschain.plugins.Manage",
  "chainlesschain.worktree.Tasks",
  "chainlesschain.chrome.Connector",
  "chainlesschain.workspace.ScanAutoExec",
  "chainlesschain.managedCli.Install",
  "chainlesschain.managedCli.Rollback",
  "chainlesschain.ide.DiagnoseBridge",
  "chainlesschain.ide.ExportDiagnostics",
  "chainlesschain.ide.RestartBridge",
  "chainlesschain.cli.whatsNew",
  "chainlesschain.ide.ConfigureLlm",
  "chainlesschain.ide.ConfigureVisionModel",
  "chainlesschain.chat.newConversation",
  "chainlesschain.chat.reopenClosedConversation",
  "chainlesschain.completion.trigger",
  "chainlesschain.chat.explainSelection",
  "chainlesschain.chat.refactorSelection",
  "chainlesschain.chat.insertFileReference",
  "chainlesschain.memory.init",
  "chainlesschain.memory.files",
  "chainlesschain.preview.start",
  "chainlesschain.preview.stop",
];

const DESKTOP_SHORTCUT_KEYS = [
  "Ctrl+S",
  "Ctrl+F",
  "Ctrl+Shift+F",
  "Ctrl+P",
  "Ctrl+K",
  "Ctrl+B",
  "Ctrl+`",
  "Ctrl+/",
  "Ctrl+D",
  "Ctrl+Shift+K",
  "Alt+Up",
  "Alt+Down",
  "Ctrl+Z",
  "Ctrl+Shift+Z",
  "Ctrl+N",
  "Ctrl+W",
  "Ctrl+Shift+T",
  "Ctrl+Tab",
  "Ctrl+Shift+Tab",
  "Esc",
  "F2",
  "Delete",
];

export const PUBLIC_IDE_CAPABILITY_MANIFEST = freeze({
  schema: "chainlesschain.public-ide-capabilities/v1",
  schemaVersion: 1,
  minimumCliVersion: "0.162.47",
  protocol: buildCompatFixture(),
  bridge: {
    schemaVersion: 1,
    toolFeatures: BRIDGE_TOOL_FEATURES,
  },
  surfaces: {
    cli: {
      commandManifest: "packages/cli/src/command-manifest.json",
      commandHelpIndex: "packages/cli/src/command-help-index.json",
      requiredCommands: ["doctor", "ide"],
      doctorCommands: ["doctor", "ide doctor"],
    },
    vscode: {
      commandContribution: "packages/vscode-extension/package.json",
      runtimeRegistration: "packages/vscode-extension/src/extension.js",
      bridgeCapabilities: "packages/vscode-extension/src/ide-capabilities.js",
      minimumCliVersionSource: "packages/vscode-extension/src/version-check.js",
      doctorImplementation: "packages/vscode-extension/src/ide-doctor.js",
      readme: "packages/vscode-extension/README.md",
      commands: VSCODE_COMMANDS,
      doctorCommands: [
        "chainlesschain.ide.doctor",
        "chainlesschain.remote.doctor",
      ],
    },
    jetbrains: {
      actionDescriptor:
        "packages/jetbrains-plugin/src/main/resources/META-INF/plugin.xml",
      bridgeCapabilities:
        "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/IdeCapabilities.java",
      minimumCliVersionSource:
        "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/RuntimeCompatibility.java",
      doctorImplementation:
        "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/DiagnoseBridgeAction.java",
      readme: "packages/jetbrains-plugin/README.md",
      actions: JETBRAINS_ACTIONS,
      doctorActions: ["chainlesschain.ide.DiagnoseBridge"],
    },
    desktop: {
      commandRegistry:
        "desktop-app-vue/src/renderer/utils/keyboard-shortcuts.ts",
      registryConsumer:
        "desktop-app-vue/src/renderer/components/common/CommandPalette.vue",
      defaultShortcutKeys: DESKTOP_SHORTCUT_KEYS,
      registryContract: [
        "register",
        "registerMultiple",
        "getAllCommands",
        "show-command-palette",
      ],
      // These are existing independent surfaces, not new registries. Recording
      // them keeps this first slice honest while the later P0-0 convergence
      // work replaces their placeholder handlers with canonical consumers.
      unconvergedSurfaces: [
        "desktop-app-vue/src/renderer/shell/CommandPalette.vue",
        "desktop-app-vue/src/renderer/utils/globalSearchManager.ts",
      ],
    },
  },
});

export const PUBLIC_IDE_MANIFEST_OUTPUT =
  "docs/cli/PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json";

export const README_BLOCK_START =
  "<!-- chainlesschain-public-ide-capabilities:start -->";
export const README_BLOCK_END =
  "<!-- chainlesschain-public-ide-capabilities:end -->";

export function renderPublicIdeCapabilityManifest(
  manifest = PUBLIC_IDE_CAPABILITY_MANIFEST,
) {
  return `${JSON.stringify(
    {
      _generated:
        "packages/cli/scripts/gen-public-ide-capability-manifest.mjs - do not edit by hand",
      ...manifest,
    },
    null,
    2,
  )}\n`;
}

export function renderPublicIdeReadmeBlock(
  host,
  manifest = PUBLIC_IDE_CAPABILITY_MANIFEST,
) {
  const surface = manifest.surfaces[host];
  if (!surface || (host !== "vscode" && host !== "jetbrains")) {
    throw new Error(`Unsupported README host: ${host}`);
  }
  const entries = host === "vscode" ? surface.commands : surface.actions;
  const entryLabel =
    host === "vscode" ? "VS Code commands" : "JetBrains actions";
  const doctorEntries =
    host === "vscode" ? surface.doctorCommands : surface.doctorActions;
  const lines = [
    README_BLOCK_START,
    "",
    "## Public capability contract (generated)",
    "",
    "This summary is pinned to the repository's versioned, secret-free",
    "[`PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json`](../../docs/cli/PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json).",
    `The base IDE/Doctor contract requires \`cc >= ${manifest.minimumCliVersion}\`; feature-specific sections below may require a newer CLI.`,
    "",
    `- ${entryLabel}: **${entries.length}** registered entries`,
    `- Doctor entries: ${doctorEntries.map((id) => `\`${id}\``).join(", ")}`,
    `- Bridge capability schema: **v${manifest.bridge.schemaVersion}** (${manifest.bridge.toolFeatures.length} mapped tools)`,
    "- Drift check: `npm run ide:capabilities:check` from the repository root",
    "",
    `<details><summary>${entryLabel}</summary>`,
    "",
    ...entries.map((id) => `- \`${id}\``),
    "",
    "</details>",
    README_BLOCK_END,
  ];
  return `${lines.join("\n")}\n`;
}
