<template>
  <a-layout class="app-shell">
    <a-layout-sider
      v-model:collapsed="sidebarCollapsed"
      :width="260"
      :collapsed-width="60"
      :collapsible="true"
      :trigger="null"
      class="shell-sider"
    >
      <ShellSidebar :collapsed="sidebarCollapsed" @toggle="toggleSidebar" />
    </a-layout-sider>

    <a-layout class="shell-main">
      <a-layout-content class="shell-content">
        <div class="conversation-region">
          <ConversationStream @open-artifact="artifactOpen = true" />
          <ShellComposer />
        </div>
        <div v-if="artifactOpen" class="artifact-region">
          <ArtifactPanel @close="closeArtifact" />
        </div>
      </a-layout-content>

      <a-layout-footer class="shell-footer">
        <ShellStatusBar />
      </a-layout-footer>
    </a-layout>

    <CommandPalette v-model:open="paletteOpen" />
    <AdminConsole v-model:open="adminOpen" />
    <PromptsPanel
      v-model:open="promptsPanelOpen"
      :prefill-text="promptsPrefill"
    />
    <GitHooksPanel
      v-model:open="gitHooksPanelOpen"
      :prefill-text="gitHooksPrefill"
    />
    <KnowledgeGraphPanel
      v-model:open="knowledgeGraphPanelOpen"
      :prefill-text="knowledgeGraphPrefill"
    />
    <WorkflowDesignerPanel
      v-model:open="workflowDesignerPanelOpen"
      :prefill-text="workflowDesignerPrefill"
    />
    <EnterpriseDashboardPanel
      v-model:open="enterpriseDashboardPanelOpen"
      :prefill-text="enterpriseDashboardPrefill"
    />
    <CrossChainBridgePanel
      v-model:open="crossChainBridgePanelOpen"
      :prefill-text="crossChainBridgePrefill"
    />
    <WalletPanel v-model:open="walletPanelOpen" :prefill-text="walletPrefill" />
    <AnalyticsDashboardPanel
      v-model:open="analyticsDashboardPanelOpen"
      :prefill-text="analyticsDashboardPrefill"
    />
    <DIDManagementPanel
      v-model:open="didManagementPanelOpen"
      :prefill-text="didManagementPrefill"
    />
  </a-layout>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useExtensionRegistryStore } from "../stores/extensionRegistry";
import { useArtifactStore } from "../stores/artifacts";
import { applyBrandTheme, clearBrandTheme } from "./theme-applier";
import { registerSlashHandler } from "./slash-dispatch";
import "./widgets";
import ShellSidebar from "./ShellSidebar.vue";
import ConversationStream from "./ConversationStream.vue";
import ShellComposer from "./ShellComposer.vue";
import ArtifactPanel from "./ArtifactPanel.vue";
import ShellStatusBar from "./ShellStatusBar.vue";
import CommandPalette from "./CommandPalette.vue";
import AdminConsole from "./AdminConsole.vue";
import PromptsPanel from "./PromptsPanel.vue";
import GitHooksPanel from "./GitHooksPanel.vue";
import KnowledgeGraphPanel from "./KnowledgeGraphPanel.vue";
import WorkflowDesignerPanel from "./WorkflowDesignerPanel.vue";
import EnterpriseDashboardPanel from "./EnterpriseDashboardPanel.vue";
import CrossChainBridgePanel from "./CrossChainBridgePanel.vue";
import WalletPanel from "./WalletPanel.vue";
import AnalyticsDashboardPanel from "./AnalyticsDashboardPanel.vue";
import DIDManagementPanel from "./DIDManagementPanel.vue";

const sidebarCollapsed = ref(false);
const artifactOpen = ref(false);
const paletteOpen = ref(false);
const adminOpen = ref(false);
const promptsPanelOpen = ref(false);
const promptsPrefill = ref("");
const gitHooksPanelOpen = ref(false);
const gitHooksPrefill = ref("");
const knowledgeGraphPanelOpen = ref(false);
const knowledgeGraphPrefill = ref("");
const workflowDesignerPanelOpen = ref(false);
const workflowDesignerPrefill = ref("");
const enterpriseDashboardPanelOpen = ref(false);
const enterpriseDashboardPrefill = ref("");
const crossChainBridgePanelOpen = ref(false);
const crossChainBridgePrefill = ref("");
const walletPanelOpen = ref(false);
const walletPrefill = ref("");
const analyticsDashboardPanelOpen = ref(false);
const analyticsDashboardPrefill = ref("");
const didManagementPanelOpen = ref(false);
const didManagementPrefill = ref("");

const registry = useExtensionRegistryStore();
const artifactStore = useArtifactStore();

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

function closeArtifact() {
  artifactOpen.value = false;
  artifactStore.close();
}

function handleKeydown(e: KeyboardEvent) {
  const isMod = e.ctrlKey || e.metaKey;
  if (isMod && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    paletteOpen.value = !paletteOpen.value;
    return;
  }
  if (isMod && e.shiftKey && (e.key === "a" || e.key === "A")) {
    e.preventDefault();
    adminOpen.value = !adminOpen.value;
  }
}

let appliedThemeVars: string[] = [];
let unregisterAdminHandler: (() => void) | null = null;
let unregisterPromptsHandler: (() => void) | null = null;
let unregisterGitHooksHandler: (() => void) | null = null;
let unregisterKnowledgeGraphHandler: (() => void) | null = null;
let unregisterWorkflowDesignerHandler: (() => void) | null = null;
let unregisterEnterpriseDashboardHandler: (() => void) | null = null;
let unregisterCrossChainBridgeHandler: (() => void) | null = null;
let unregisterWalletHandler: (() => void) | null = null;
let unregisterAnalyticsDashboardHandler: (() => void) | null = null;
let unregisterDIDManagementHandler: (() => void) | null = null;

onMounted(async () => {
  window.addEventListener("keydown", handleKeydown);
  unregisterAdminHandler = registerSlashHandler(
    "builtin:openAdminConsole",
    () => {
      adminOpen.value = true;
    },
  );
  unregisterPromptsHandler = registerSlashHandler(
    "builtin:openPromptsPanel",
    ({ args }) => {
      promptsPrefill.value = args ?? "";
      promptsPanelOpen.value = true;
    },
  );
  unregisterGitHooksHandler = registerSlashHandler(
    "builtin:openGitHooksPanel",
    ({ args }) => {
      gitHooksPrefill.value = args ?? "";
      gitHooksPanelOpen.value = true;
    },
  );
  unregisterKnowledgeGraphHandler = registerSlashHandler(
    "builtin:openKnowledgeGraphPanel",
    ({ args }) => {
      knowledgeGraphPrefill.value = args ?? "";
      knowledgeGraphPanelOpen.value = true;
    },
  );
  unregisterWorkflowDesignerHandler = registerSlashHandler(
    "builtin:openWorkflowDesignerPanel",
    ({ args }) => {
      workflowDesignerPrefill.value = args ?? "";
      workflowDesignerPanelOpen.value = true;
    },
  );
  unregisterEnterpriseDashboardHandler = registerSlashHandler(
    "builtin:openEnterpriseDashboardPanel",
    ({ args }) => {
      enterpriseDashboardPrefill.value = args ?? "";
      enterpriseDashboardPanelOpen.value = true;
    },
  );
  unregisterCrossChainBridgeHandler = registerSlashHandler(
    "builtin:openCrossChainBridgePanel",
    ({ args }) => {
      crossChainBridgePrefill.value = args ?? "";
      crossChainBridgePanelOpen.value = true;
    },
  );
  unregisterWalletHandler = registerSlashHandler(
    "builtin:openWalletPanel",
    ({ args }) => {
      walletPrefill.value = args ?? "";
      walletPanelOpen.value = true;
    },
  );
  unregisterAnalyticsDashboardHandler = registerSlashHandler(
    "builtin:openAnalyticsDashboardPanel",
    ({ args }) => {
      analyticsDashboardPrefill.value = args ?? "";
      analyticsDashboardPanelOpen.value = true;
    },
  );
  unregisterDIDManagementHandler = registerSlashHandler(
    "builtin:openDIDManagementPanel",
    ({ args }) => {
      didManagementPrefill.value = args ?? "";
      didManagementPanelOpen.value = true;
    },
  );
  await registry.refreshAll();
  appliedThemeVars = applyBrandTheme(registry.brandTheme);
  artifactStore.seedIfEmpty();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  clearBrandTheme(appliedThemeVars);
  unregisterAdminHandler?.();
  unregisterAdminHandler = null;
  unregisterPromptsHandler?.();
  unregisterPromptsHandler = null;
  unregisterGitHooksHandler?.();
  unregisterGitHooksHandler = null;
  unregisterKnowledgeGraphHandler?.();
  unregisterKnowledgeGraphHandler = null;
  unregisterWorkflowDesignerHandler?.();
  unregisterWorkflowDesignerHandler = null;
  unregisterEnterpriseDashboardHandler?.();
  unregisterEnterpriseDashboardHandler = null;
  unregisterCrossChainBridgeHandler?.();
  unregisterCrossChainBridgeHandler = null;
  unregisterWalletHandler?.();
  unregisterWalletHandler = null;
  unregisterAnalyticsDashboardHandler?.();
  unregisterAnalyticsDashboardHandler = null;
  unregisterDIDManagementHandler?.();
  unregisterDIDManagementHandler = null;
});
</script>

<style scoped>
.app-shell {
  height: 100vh;
  overflow: hidden;
}

.shell-sider {
  background: var(--shell-sider-bg, #fafafa);
  border-right: 1px solid var(--shell-border, #e8e8e8);
}

.shell-main {
  display: flex;
  flex-direction: column;
}

.shell-content {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  overflow: hidden;
}

.conversation-region {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--shell-bg, #ffffff);
}

.artifact-region {
  width: 420px;
  flex-shrink: 0;
  border-left: 1px solid var(--shell-border, #e8e8e8);
  background: var(--shell-artifact-bg, #fcfcfc);
  overflow-y: auto;
}

.shell-footer {
  height: 28px;
  line-height: 28px;
  padding: 0 12px;
  font-size: 12px;
  background: var(--shell-footer-bg, #f5f5f5);
  border-top: 1px solid var(--shell-border, #e8e8e8);
}
</style>
