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
      <a-layout-header class="shell-header">
        <LanguageSwitcher class="shell-header-language" />
      </a-layout-header>

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
    <ProjectsPanel
      v-model:open="projectsPanelOpen"
      :prefill-text="projectsPrefill"
    />
    <P2PMessagingPanel
      v-model:open="p2pMessagingPanelOpen"
      :prefill-text="p2pMessagingPrefill"
    />
    <CommunityPanel
      v-model:open="communityPanelOpen"
      :prefill-text="communityPrefill"
    />
    <AIChatPanel v-model:open="aiChatPanelOpen" :prefill-text="aiChatPrefill" />
    <SettingsPanel
      v-model:open="settingsPanelOpen"
      :prefill-text="settingsPrefill"
    />
    <FriendsPanel
      v-model:open="friendsPanelOpen"
      :prefill-text="friendsPrefill"
    />
    <MemoryBankPanel
      v-model:open="memoryBankPanelOpen"
      :prefill-text="memoryBankPrefill"
    />
    <CallHistoryPanel
      v-model:open="callHistoryPanelOpen"
      :prefill-text="callHistoryPrefill"
    />
    <GraphQLExplorerPanel
      v-model:open="graphqlExplorerPanelOpen"
      :prefill-text="graphqlExplorerPrefill"
    />
    <SessionManagerPanel
      v-model:open="sessionManagerPanelOpen"
      :prefill-text="sessionManagerPrefill"
    />
    <PermanentMemoryPanel
      v-model:open="permanentMemoryPanelOpen"
      :prefill-text="permanentMemoryPrefill"
    />
    <WebAuthnPanel
      v-model:open="webauthnPanelOpen"
      :prefill-text="webauthnPrefill"
    />
    <ZKPCredentialsPanel
      v-model:open="zkpCredentialsPanelOpen"
      :prefill-text="zkpCredentialsPrefill"
    />
    <FederatedLearningPanel
      v-model:open="federatedLearningPanelOpen"
      :prefill-text="federatedLearningPrefill"
    />
    <IPFSClusterPanel
      v-model:open="ipfsClusterPanelOpen"
      :prefill-text="ipfsClusterPrefill"
    />
    <SkillPerformancePanel
      v-model:open="skillPerformancePanelOpen"
      :prefill-text="skillPerformancePrefill"
    />
    <DeploymentMonitorPanel
      v-model:open="deploymentMonitorPanelOpen"
      :prefill-text="deploymentMonitorPrefill"
    />
    <AutonomousOpsPanel
      v-model:open="autonomousOpsPanelOpen"
      :prefill-text="autonomousOpsPrefill"
    />
    <AgentDashboardPanel
      v-model:open="agentDashboardPanelOpen"
      :prefill-text="agentDashboardPrefill"
    />
    <EnterpriseAuditPanel
      v-model:open="enterpriseAuditPanelOpen"
      :prefill-text="enterpriseAuditPrefill"
    />
    <SkillPipelinePanel
      v-model:open="skillPipelinePanelOpen"
      :prefill-text="skillPipelinePrefill"
    />
    <TimeMachinePanel
      v-model:open="timeMachinePanelOpen"
      :prefill-text="timeMachinePrefill"
    />
    <AutonomousAgentPanel
      v-model:open="autonomousAgentPanelOpen"
      :prefill-text="autonomousAgentPrefill"
    />
    <FederatedNetworkPanel
      v-model:open="federatedNetworkPanelOpen"
      :prefill-text="federatedNetworkPrefill"
    />
    <ComplianceDashboardPanel
      v-model:open="complianceDashboardPanelOpen"
      :prefill-text="complianceDashboardPrefill"
    />
    <ToolsExplorerPanel
      v-model:open="toolsExplorerPanelOpen"
      :prefill-text="toolsExplorerPrefill"
    />
    <TagManagerPanel
      v-model:open="tagManagerPanelOpen"
      :prefill-text="tagManagerPrefill"
    />
    <CoworkDashboardPanel
      v-model:open="coworkDashboardPanelOpen"
      :prefill-text="coworkDashboardPrefill"
    />
    <SSOConfigurationPanel
      v-model:open="ssoConfigurationPanelOpen"
      :prefill-text="ssoConfigurationPrefill"
    />
    <OrganizationsPanel
      v-model:open="organizationsPanelOpen"
      :prefill-text="organizationsPrefill"
    />
    <NLProgrammingPanel
      v-model:open="nlProgrammingPanelOpen"
      :prefill-text="nlProgrammingPrefill"
    />
    <VideoEditingPanel
      v-model:open="videoEditingPanelOpen"
      :prefill-text="videoEditingPrefill"
    />
    <KnowledgeListPanel
      v-model:open="knowledgeListPanelOpen"
      :prefill-text="knowledgeListPrefill"
    />
    <SessionCorePanel
      v-model:open="sessionCorePanelOpen"
      :prefill-text="sessionCorePrefill"
    />
    <CommandLogsPanel
      v-model:open="commandLogsPanelOpen"
      :prefill-text="commandLogsPrefill"
    />
    <InstalledPluginsPanel
      v-model:open="installedPluginsPanelOpen"
      :prefill-text="installedPluginsPrefill"
    />
    <ErrorMonitorPanel
      v-model:open="errorMonitorPanelOpen"
      :prefill-text="errorMonitorPrefill"
    />
    <IdentityLinkingPanel
      v-model:open="identityLinkingPanelOpen"
      :prefill-text="identityLinkingPrefill"
    />
    <TerminalPanel
      v-model:open="terminalPanelOpen"
      :prefill-text="terminalPrefill"
    />
    <DatabasePerformancePanel
      v-model:open="dbPerformancePanelOpen"
      :prefill-text="dbPerformancePrefill"
    />
    <LLMPerformancePanel
      v-model:open="llmPerformancePanelOpen"
      :prefill-text="llmPerformancePrefill"
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
import ProjectsPanel from "./ProjectsPanel.vue";
import P2PMessagingPanel from "./P2PMessagingPanel.vue";
import CommunityPanel from "./CommunityPanel.vue";
import AIChatPanel from "./AIChatPanel.vue";
import SettingsPanel from "./SettingsPanel.vue";
import FriendsPanel from "./FriendsPanel.vue";
import MemoryBankPanel from "./MemoryBankPanel.vue";
import CallHistoryPanel from "./CallHistoryPanel.vue";
import GraphQLExplorerPanel from "./GraphQLExplorerPanel.vue";
import SessionManagerPanel from "./SessionManagerPanel.vue";
import PermanentMemoryPanel from "./PermanentMemoryPanel.vue";
import WebAuthnPanel from "./WebAuthnPanel.vue";
import ZKPCredentialsPanel from "./ZKPCredentialsPanel.vue";
import FederatedLearningPanel from "./FederatedLearningPanel.vue";
import IPFSClusterPanel from "./IPFSClusterPanel.vue";
import SkillPerformancePanel from "./SkillPerformancePanel.vue";
import DeploymentMonitorPanel from "./DeploymentMonitorPanel.vue";
import AutonomousOpsPanel from "./AutonomousOpsPanel.vue";
import AgentDashboardPanel from "./AgentDashboardPanel.vue";
import EnterpriseAuditPanel from "./EnterpriseAuditPanel.vue";
import SkillPipelinePanel from "./SkillPipelinePanel.vue";
import TimeMachinePanel from "./TimeMachinePanel.vue";
import AutonomousAgentPanel from "./AutonomousAgentPanel.vue";
import FederatedNetworkPanel from "./FederatedNetworkPanel.vue";
import ComplianceDashboardPanel from "./ComplianceDashboardPanel.vue";
import ToolsExplorerPanel from "./ToolsExplorerPanel.vue";
import TagManagerPanel from "./TagManagerPanel.vue";
import CoworkDashboardPanel from "./CoworkDashboardPanel.vue";
import SSOConfigurationPanel from "./SSOConfigurationPanel.vue";
import OrganizationsPanel from "./OrganizationsPanel.vue";
import NLProgrammingPanel from "./NLProgrammingPanel.vue";
import VideoEditingPanel from "./VideoEditingPanel.vue";
import KnowledgeListPanel from "./KnowledgeListPanel.vue";
import SessionCorePanel from "./SessionCorePanel.vue";
import CommandLogsPanel from "./CommandLogsPanel.vue";
import InstalledPluginsPanel from "./InstalledPluginsPanel.vue";
import ErrorMonitorPanel from "./ErrorMonitorPanel.vue";
import IdentityLinkingPanel from "./IdentityLinkingPanel.vue";
import TerminalPanel from "./TerminalPanel.vue";
import DatabasePerformancePanel from "./DatabasePerformancePanel.vue";
import LLMPerformancePanel from "./LLMPerformancePanel.vue";
import LanguageSwitcher from "../components/LanguageSwitcher.vue";

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
const projectsPanelOpen = ref(false);
const projectsPrefill = ref("");
const p2pMessagingPanelOpen = ref(false);
const p2pMessagingPrefill = ref("");
const communityPanelOpen = ref(false);
const communityPrefill = ref("");
const aiChatPanelOpen = ref(false);
const aiChatPrefill = ref("");
const settingsPanelOpen = ref(false);
const settingsPrefill = ref("");
const friendsPanelOpen = ref(false);
const friendsPrefill = ref("");
const memoryBankPanelOpen = ref(false);
const memoryBankPrefill = ref("");
const callHistoryPanelOpen = ref(false);
const callHistoryPrefill = ref("");
const graphqlExplorerPanelOpen = ref(false);
const graphqlExplorerPrefill = ref("");
const sessionManagerPanelOpen = ref(false);
const sessionManagerPrefill = ref("");
const permanentMemoryPanelOpen = ref(false);
const permanentMemoryPrefill = ref("");
const webauthnPanelOpen = ref(false);
const webauthnPrefill = ref("");
const zkpCredentialsPanelOpen = ref(false);
const zkpCredentialsPrefill = ref("");
const federatedLearningPanelOpen = ref(false);
const federatedLearningPrefill = ref("");
const ipfsClusterPanelOpen = ref(false);
const ipfsClusterPrefill = ref("");
const skillPerformancePanelOpen = ref(false);
const skillPerformancePrefill = ref("");
const deploymentMonitorPanelOpen = ref(false);
const deploymentMonitorPrefill = ref("");
const autonomousOpsPanelOpen = ref(false);
const autonomousOpsPrefill = ref("");
const agentDashboardPanelOpen = ref(false);
const agentDashboardPrefill = ref("");
const enterpriseAuditPanelOpen = ref(false);
const enterpriseAuditPrefill = ref("");
const skillPipelinePanelOpen = ref(false);
const skillPipelinePrefill = ref("");
const timeMachinePanelOpen = ref(false);
const timeMachinePrefill = ref("");
const autonomousAgentPanelOpen = ref(false);
const autonomousAgentPrefill = ref("");
const federatedNetworkPanelOpen = ref(false);
const federatedNetworkPrefill = ref("");
const complianceDashboardPanelOpen = ref(false);
const complianceDashboardPrefill = ref("");
const toolsExplorerPanelOpen = ref(false);
const toolsExplorerPrefill = ref("");
const tagManagerPanelOpen = ref(false);
const tagManagerPrefill = ref("");
const coworkDashboardPanelOpen = ref(false);
const coworkDashboardPrefill = ref("");
const ssoConfigurationPanelOpen = ref(false);
const ssoConfigurationPrefill = ref("");
const organizationsPanelOpen = ref(false);
const organizationsPrefill = ref("");
const nlProgrammingPanelOpen = ref(false);
const nlProgrammingPrefill = ref("");
const videoEditingPanelOpen = ref(false);
const videoEditingPrefill = ref("");
const knowledgeListPanelOpen = ref(false);
const knowledgeListPrefill = ref("");
const sessionCorePanelOpen = ref(false);
const sessionCorePrefill = ref("");
const commandLogsPanelOpen = ref(false);
const commandLogsPrefill = ref("");
const installedPluginsPanelOpen = ref(false);
const installedPluginsPrefill = ref("");
const errorMonitorPanelOpen = ref(false);
const errorMonitorPrefill = ref("");
const identityLinkingPanelOpen = ref(false);
const identityLinkingPrefill = ref("");
const terminalPanelOpen = ref(false);
const terminalPrefill = ref("");
const dbPerformancePanelOpen = ref(false);
const dbPerformancePrefill = ref("");
const llmPerformancePanelOpen = ref(false);
const llmPerformancePrefill = ref("");

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
let unregisterProjectsHandler: (() => void) | null = null;
let unregisterP2PMessagingHandler: (() => void) | null = null;
let unregisterCommunityHandler: (() => void) | null = null;
let unregisterAIChatHandler: (() => void) | null = null;
let unregisterSettingsHandler: (() => void) | null = null;
let unregisterFriendsHandler: (() => void) | null = null;
let unregisterMemoryBankHandler: (() => void) | null = null;
let unregisterCallHistoryHandler: (() => void) | null = null;
let unregisterGraphqlExplorerHandler: (() => void) | null = null;
let unregisterSessionManagerHandler: (() => void) | null = null;
let unregisterPermanentMemoryHandler: (() => void) | null = null;
let unregisterWebAuthnHandler: (() => void) | null = null;
let unregisterZKPCredentialsHandler: (() => void) | null = null;
let unregisterFederatedLearningHandler: (() => void) | null = null;
let unregisterIPFSClusterHandler: (() => void) | null = null;
let unregisterSkillPerformanceHandler: (() => void) | null = null;
let unregisterDeploymentMonitorHandler: (() => void) | null = null;
let unregisterAutonomousOpsHandler: (() => void) | null = null;
let unregisterAgentDashboardHandler: (() => void) | null = null;
let unregisterEnterpriseAuditHandler: (() => void) | null = null;
let unregisterSkillPipelineHandler: (() => void) | null = null;
let unregisterTimeMachineHandler: (() => void) | null = null;
let unregisterAutonomousAgentHandler: (() => void) | null = null;
let unregisterFederatedNetworkHandler: (() => void) | null = null;
let unregisterComplianceDashboardHandler: (() => void) | null = null;
let unregisterToolsExplorerHandler: (() => void) | null = null;
let unregisterTagManagerHandler: (() => void) | null = null;
let unregisterCoworkDashboardHandler: (() => void) | null = null;
let unregisterSSOConfigurationHandler: (() => void) | null = null;
let unregisterOrganizationsHandler: (() => void) | null = null;
let unregisterNLProgrammingHandler: (() => void) | null = null;
let unregisterVideoEditingHandler: (() => void) | null = null;
let unregisterKnowledgeListHandler: (() => void) | null = null;
let unregisterSessionCoreHandler: (() => void) | null = null;
let unregisterCommandLogsHandler: (() => void) | null = null;
let unregisterInstalledPluginsHandler: (() => void) | null = null;
let unregisterErrorMonitorHandler: (() => void) | null = null;
let unregisterIdentityLinkingHandler: (() => void) | null = null;
let unregisterTerminalHandler: (() => void) | null = null;
let unregisterDbPerformanceHandler: (() => void) | null = null;
let unregisterLlmPerformanceHandler: (() => void) | null = null;

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
  unregisterProjectsHandler = registerSlashHandler(
    "builtin:openProjectsPanel",
    ({ args }) => {
      projectsPrefill.value = args ?? "";
      projectsPanelOpen.value = true;
    },
  );
  unregisterP2PMessagingHandler = registerSlashHandler(
    "builtin:openP2PMessagingPanel",
    ({ args }) => {
      p2pMessagingPrefill.value = args ?? "";
      p2pMessagingPanelOpen.value = true;
    },
  );
  unregisterCommunityHandler = registerSlashHandler(
    "builtin:openCommunityPanel",
    ({ args }) => {
      communityPrefill.value = args ?? "";
      communityPanelOpen.value = true;
    },
  );
  unregisterAIChatHandler = registerSlashHandler(
    "builtin:openAIChatPanel",
    ({ args }) => {
      aiChatPrefill.value = args ?? "";
      aiChatPanelOpen.value = true;
    },
  );
  unregisterSettingsHandler = registerSlashHandler(
    "builtin:openSettingsPanel",
    ({ args }) => {
      settingsPrefill.value = args ?? "";
      settingsPanelOpen.value = true;
    },
  );
  unregisterFriendsHandler = registerSlashHandler(
    "builtin:openFriendsPanel",
    ({ args }) => {
      friendsPrefill.value = args ?? "";
      friendsPanelOpen.value = true;
    },
  );
  unregisterMemoryBankHandler = registerSlashHandler(
    "builtin:openMemoryBankPanel",
    ({ args }) => {
      memoryBankPrefill.value = args ?? "";
      memoryBankPanelOpen.value = true;
    },
  );
  unregisterCallHistoryHandler = registerSlashHandler(
    "builtin:openCallHistoryPanel",
    ({ args }) => {
      callHistoryPrefill.value = args ?? "";
      callHistoryPanelOpen.value = true;
    },
  );
  unregisterGraphqlExplorerHandler = registerSlashHandler(
    "builtin:openGraphqlExplorerPanel",
    ({ args }) => {
      graphqlExplorerPrefill.value = args ?? "";
      graphqlExplorerPanelOpen.value = true;
    },
  );
  unregisterSessionManagerHandler = registerSlashHandler(
    "builtin:openSessionManagerPanel",
    ({ args }) => {
      sessionManagerPrefill.value = args ?? "";
      sessionManagerPanelOpen.value = true;
    },
  );
  unregisterPermanentMemoryHandler = registerSlashHandler(
    "builtin:openPermanentMemoryPanel",
    ({ args }) => {
      permanentMemoryPrefill.value = args ?? "";
      permanentMemoryPanelOpen.value = true;
    },
  );
  unregisterWebAuthnHandler = registerSlashHandler(
    "builtin:openWebAuthnPanel",
    ({ args }) => {
      webauthnPrefill.value = args ?? "";
      webauthnPanelOpen.value = true;
    },
  );
  unregisterZKPCredentialsHandler = registerSlashHandler(
    "builtin:openZKPCredentialsPanel",
    ({ args }) => {
      zkpCredentialsPrefill.value = args ?? "";
      zkpCredentialsPanelOpen.value = true;
    },
  );
  unregisterFederatedLearningHandler = registerSlashHandler(
    "builtin:openFederatedLearningPanel",
    ({ args }) => {
      federatedLearningPrefill.value = args ?? "";
      federatedLearningPanelOpen.value = true;
    },
  );
  unregisterIPFSClusterHandler = registerSlashHandler(
    "builtin:openIPFSClusterPanel",
    ({ args }) => {
      ipfsClusterPrefill.value = args ?? "";
      ipfsClusterPanelOpen.value = true;
    },
  );
  unregisterSkillPerformanceHandler = registerSlashHandler(
    "builtin:openSkillPerformancePanel",
    ({ args }) => {
      skillPerformancePrefill.value = args ?? "";
      skillPerformancePanelOpen.value = true;
    },
  );
  unregisterDeploymentMonitorHandler = registerSlashHandler(
    "builtin:openDeploymentMonitorPanel",
    ({ args }) => {
      deploymentMonitorPrefill.value = args ?? "";
      deploymentMonitorPanelOpen.value = true;
    },
  );
  unregisterAutonomousOpsHandler = registerSlashHandler(
    "builtin:openAutonomousOpsPanel",
    ({ args }) => {
      autonomousOpsPrefill.value = args ?? "";
      autonomousOpsPanelOpen.value = true;
    },
  );
  unregisterAgentDashboardHandler = registerSlashHandler(
    "builtin:openAgentDashboardPanel",
    ({ args }) => {
      agentDashboardPrefill.value = args ?? "";
      agentDashboardPanelOpen.value = true;
    },
  );
  unregisterEnterpriseAuditHandler = registerSlashHandler(
    "builtin:openEnterpriseAuditPanel",
    ({ args }) => {
      enterpriseAuditPrefill.value = args ?? "";
      enterpriseAuditPanelOpen.value = true;
    },
  );
  unregisterSkillPipelineHandler = registerSlashHandler(
    "builtin:openSkillPipelinePanel",
    ({ args }) => {
      skillPipelinePrefill.value = args ?? "";
      skillPipelinePanelOpen.value = true;
    },
  );
  unregisterTimeMachineHandler = registerSlashHandler(
    "builtin:openTimeMachinePanel",
    ({ args }) => {
      timeMachinePrefill.value = args ?? "";
      timeMachinePanelOpen.value = true;
    },
  );
  unregisterAutonomousAgentHandler = registerSlashHandler(
    "builtin:openAutonomousAgentPanel",
    ({ args }) => {
      autonomousAgentPrefill.value = args ?? "";
      autonomousAgentPanelOpen.value = true;
    },
  );
  unregisterFederatedNetworkHandler = registerSlashHandler(
    "builtin:openFederatedNetworkPanel",
    ({ args }) => {
      federatedNetworkPrefill.value = args ?? "";
      federatedNetworkPanelOpen.value = true;
    },
  );
  unregisterComplianceDashboardHandler = registerSlashHandler(
    "builtin:openComplianceDashboardPanel",
    ({ args }) => {
      complianceDashboardPrefill.value = args ?? "";
      complianceDashboardPanelOpen.value = true;
    },
  );
  unregisterToolsExplorerHandler = registerSlashHandler(
    "builtin:openToolsExplorerPanel",
    ({ args }) => {
      toolsExplorerPrefill.value = args ?? "";
      toolsExplorerPanelOpen.value = true;
    },
  );
  unregisterTagManagerHandler = registerSlashHandler(
    "builtin:openTagManagerPanel",
    ({ args }) => {
      tagManagerPrefill.value = args ?? "";
      tagManagerPanelOpen.value = true;
    },
  );
  unregisterCoworkDashboardHandler = registerSlashHandler(
    "builtin:openCoworkDashboardPanel",
    ({ args }) => {
      coworkDashboardPrefill.value = args ?? "";
      coworkDashboardPanelOpen.value = true;
    },
  );
  unregisterSSOConfigurationHandler = registerSlashHandler(
    "builtin:openSSOConfigurationPanel",
    ({ args }) => {
      ssoConfigurationPrefill.value = args ?? "";
      ssoConfigurationPanelOpen.value = true;
    },
  );
  unregisterOrganizationsHandler = registerSlashHandler(
    "builtin:openOrganizationsPanel",
    ({ args }) => {
      organizationsPrefill.value = args ?? "";
      organizationsPanelOpen.value = true;
    },
  );
  unregisterNLProgrammingHandler = registerSlashHandler(
    "builtin:openNLProgrammingPanel",
    ({ args }) => {
      nlProgrammingPrefill.value = args ?? "";
      nlProgrammingPanelOpen.value = true;
    },
  );
  unregisterVideoEditingHandler = registerSlashHandler(
    "builtin:openVideoEditingPanel",
    ({ args }) => {
      videoEditingPrefill.value = args ?? "";
      videoEditingPanelOpen.value = true;
    },
  );
  unregisterKnowledgeListHandler = registerSlashHandler(
    "builtin:openKnowledgeListPanel",
    ({ args }) => {
      knowledgeListPrefill.value = args ?? "";
      knowledgeListPanelOpen.value = true;
    },
  );
  unregisterSessionCoreHandler = registerSlashHandler(
    "builtin:openSessionCorePanel",
    ({ args }) => {
      sessionCorePrefill.value = args ?? "";
      sessionCorePanelOpen.value = true;
    },
  );
  unregisterCommandLogsHandler = registerSlashHandler(
    "builtin:openCommandLogsPanel",
    ({ args }) => {
      commandLogsPrefill.value = args ?? "";
      commandLogsPanelOpen.value = true;
    },
  );
  unregisterInstalledPluginsHandler = registerSlashHandler(
    "builtin:openInstalledPluginsPanel",
    ({ args }) => {
      installedPluginsPrefill.value = args ?? "";
      installedPluginsPanelOpen.value = true;
    },
  );
  unregisterErrorMonitorHandler = registerSlashHandler(
    "builtin:openErrorMonitorPanel",
    ({ args }) => {
      errorMonitorPrefill.value = args ?? "";
      errorMonitorPanelOpen.value = true;
    },
  );
  unregisterIdentityLinkingHandler = registerSlashHandler(
    "builtin:openIdentityLinkingPanel",
    ({ args }) => {
      identityLinkingPrefill.value = args ?? "";
      identityLinkingPanelOpen.value = true;
    },
  );
  unregisterTerminalHandler = registerSlashHandler(
    "builtin:openTerminalPanel",
    ({ args }) => {
      terminalPrefill.value = args ?? "";
      terminalPanelOpen.value = true;
    },
  );
  unregisterDbPerformanceHandler = registerSlashHandler(
    "builtin:openDbPerformancePanel",
    ({ args }) => {
      dbPerformancePrefill.value = args ?? "";
      dbPerformancePanelOpen.value = true;
    },
  );
  unregisterLlmPerformanceHandler = registerSlashHandler(
    "builtin:openLlmPerformancePanel",
    ({ args }) => {
      llmPerformancePrefill.value = args ?? "";
      llmPerformancePanelOpen.value = true;
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
  unregisterProjectsHandler?.();
  unregisterProjectsHandler = null;
  unregisterP2PMessagingHandler?.();
  unregisterP2PMessagingHandler = null;
  unregisterCommunityHandler?.();
  unregisterCommunityHandler = null;
  unregisterAIChatHandler?.();
  unregisterAIChatHandler = null;
  unregisterSettingsHandler?.();
  unregisterSettingsHandler = null;
  unregisterFriendsHandler?.();
  unregisterFriendsHandler = null;
  unregisterMemoryBankHandler?.();
  unregisterMemoryBankHandler = null;
  unregisterCallHistoryHandler?.();
  unregisterCallHistoryHandler = null;
  unregisterGraphqlExplorerHandler?.();
  unregisterGraphqlExplorerHandler = null;
  unregisterSessionManagerHandler?.();
  unregisterSessionManagerHandler = null;
  unregisterPermanentMemoryHandler?.();
  unregisterPermanentMemoryHandler = null;
  unregisterWebAuthnHandler?.();
  unregisterWebAuthnHandler = null;
  unregisterZKPCredentialsHandler?.();
  unregisterZKPCredentialsHandler = null;
  unregisterFederatedLearningHandler?.();
  unregisterFederatedLearningHandler = null;
  unregisterIPFSClusterHandler?.();
  unregisterIPFSClusterHandler = null;
  unregisterSkillPerformanceHandler?.();
  unregisterSkillPerformanceHandler = null;
  unregisterDeploymentMonitorHandler?.();
  unregisterDeploymentMonitorHandler = null;
  unregisterAutonomousOpsHandler?.();
  unregisterAutonomousOpsHandler = null;
  unregisterAgentDashboardHandler?.();
  unregisterAgentDashboardHandler = null;
  unregisterEnterpriseAuditHandler?.();
  unregisterEnterpriseAuditHandler = null;
  unregisterSkillPipelineHandler?.();
  unregisterSkillPipelineHandler = null;
  unregisterTimeMachineHandler?.();
  unregisterTimeMachineHandler = null;
  unregisterAutonomousAgentHandler?.();
  unregisterAutonomousAgentHandler = null;
  unregisterFederatedNetworkHandler?.();
  unregisterFederatedNetworkHandler = null;
  unregisterComplianceDashboardHandler?.();
  unregisterComplianceDashboardHandler = null;
  unregisterToolsExplorerHandler?.();
  unregisterToolsExplorerHandler = null;
  unregisterTagManagerHandler?.();
  unregisterTagManagerHandler = null;
  unregisterCoworkDashboardHandler?.();
  unregisterCoworkDashboardHandler = null;
  unregisterSSOConfigurationHandler?.();
  unregisterSSOConfigurationHandler = null;
  unregisterOrganizationsHandler?.();
  unregisterOrganizationsHandler = null;
  unregisterNLProgrammingHandler?.();
  unregisterNLProgrammingHandler = null;
  unregisterVideoEditingHandler?.();
  unregisterVideoEditingHandler = null;
  unregisterKnowledgeListHandler?.();
  unregisterKnowledgeListHandler = null;
  unregisterSessionCoreHandler?.();
  unregisterSessionCoreHandler = null;
  unregisterCommandLogsHandler?.();
  unregisterCommandLogsHandler = null;
  unregisterInstalledPluginsHandler?.();
  unregisterInstalledPluginsHandler = null;
  unregisterErrorMonitorHandler?.();
  unregisterErrorMonitorHandler = null;
  unregisterIdentityLinkingHandler?.();
  unregisterIdentityLinkingHandler = null;
  unregisterTerminalHandler?.();
  unregisterTerminalHandler = null;
  unregisterDbPerformanceHandler?.();
  unregisterDbPerformanceHandler = null;
  unregisterLlmPerformanceHandler?.();
  unregisterLlmPerformanceHandler = null;
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

.shell-header {
  height: 40px;
  line-height: 40px;
  padding: 0 12px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  background: var(--shell-header-bg, transparent);
  border-bottom: 1px solid var(--shell-border, #e8e8e8);
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
