import { Command } from "commander";
import { VERSION } from "./constants.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerStartCommand } from "./commands/start.js";
import { registerStopCommand } from "./commands/stop.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerServicesCommand } from "./commands/services.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerDbCommand } from "./commands/db.js";
import { registerNoteCommand } from "./commands/note.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerAskCommand } from "./commands/ask.js";
import { registerLlmCommand } from "./commands/llm.js";
import {
  registerAgentCommand,
  registerSubAgentV2Command,
  registerExecBackendV2Command,
  registerTodoV2Command,
  registerAutoAgentV2Command,
} from "./commands/agent.js";
import { registerOrchGovCommand } from "./commands/orchgov.js";
import { registerTopicClsCommand } from "./commands/topiccls.js";
import { registerItBudgetCommand } from "./commands/itbudget.js";
import { registerPlanModeCommand } from "./commands/planmode.js";
import { registerPermCommand } from "./commands/perm.js";
import { registerUprofCommand } from "./commands/uprof.js";
import { registerSvcContCommand } from "./commands/svccont.js";
import { registerTmsCommand } from "./commands/tms.js";
import { registerSlotfillCommand } from "./commands/slotfill.js";
import { registerWebfetchCommand } from "./commands/webfetch.js";
import { registerMeminjCommand } from "./commands/meminj.js";
import { registerSeshsearchCommand } from "./commands/seshsearch.js";
import { registerSeshtailCommand } from "./commands/seshtail.js";
import { registerSeshuCommand } from "./commands/seshu.js";
import { registerSeshhookCommand } from "./commands/seshhook.js";
import { registerMcpscafCommand } from "./commands/mcpscaf.js";
import { registerFflagCommand } from "./commands/fflag.js";
import { registerPromcompCommand } from "./commands/promcomp.js";
import { registerCcronCommand } from "./commands/ccron.js";
import { registerVcheckCommand } from "./commands/vcheck.js";
import { registerPdfpCommand } from "./commands/pdfp.js";
import { registerBm25Command } from "./commands/bm25.js";
import { registerComptCommand } from "./commands/compt.js";
import { registerSganalCommand } from "./commands/sganal.js";
import { registerStreamCommand } from "./commands/stream.js";
import { registerSkillCommand } from "./commands/skill.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerTokensCommand } from "./commands/tokens.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { registerPermMemCommand } from "./commands/permmem.js";
import { registerRCacheCommand } from "./commands/rcache.js";
import { registerSessionCommand } from "./commands/session.js";
import { registerConsolCommand } from "./commands/consol.js";
import { registerImportCommand } from "./commands/import.js";
import { registerExportCommand } from "./commands/export.js";
import { registerGitCommand } from "./commands/git.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerBrowseCommand } from "./commands/browse.js";
import { registerInstinctCommand } from "./commands/instinct.js";
import { registerDidCommand } from "./commands/did.js";
import { registerEncryptCommand } from "./commands/encrypt.js";
import { registerAuthCommand } from "./commands/auth.js";
import { registerAuditCommand } from "./commands/audit.js";
import { registerP2pCommand } from "./commands/p2p.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerWalletCommand } from "./commands/wallet.js";
import { registerOrgCommand } from "./commands/org.js";
import { registerPluginCommand } from "./commands/plugin.js";
import { registerInitCommand } from "./commands/init.js";
import { registerPersonaCommand } from "./commands/persona.js";
import { registerCoworkCommand } from "./commands/cowork.js";

// Phase 6: Advanced AI & Hooks
import { registerHookCommand } from "./commands/hook.js";
import { registerWorkflowCommand } from "./commands/workflow.js";
import { registerHmemoryCommand } from "./commands/hmemory.js";
import { registerA2aCommand } from "./commands/a2a.js";

// Phase 7: Security & Evolution
import { registerSandboxCommand } from "./commands/sandbox.js";
import { registerEvolutionCommand } from "./commands/evolution.js";
import { registerLearningCommand } from "./commands/learning.js";

// Phase 7: EvoMap Federation + DAO Governance
import { registerDaoCommand } from "./commands/dao.js";

// Phase 8: Blockchain & Enterprise
import { registerEconomyCommand } from "./commands/economy.js";
import { registerZkpCommand } from "./commands/zkp.js";
import { registerBiCommand } from "./commands/bi.js";

// Phase 8: Security & Compliance
import { registerComplianceCommand } from "./commands/compliance.js";
import { registerDlpCommand } from "./commands/dlp.js";
import { registerSiemCommand } from "./commands/siem.js";
import { registerPqcCommand } from "./commands/pqc.js";

// Phase 8: Communication Bridges
import { registerNostrCommand } from "./commands/nostr.js";
import { registerMatrixCommand } from "./commands/matrix.js";
import { registerActivityPubCommand } from "./commands/activitypub.js";
import { registerScimCommand } from "./commands/scim.js";

// Phase 8: Infrastructure & Hardening
import { registerTerraformCommand } from "./commands/terraform.js";
import { registerHardeningCommand } from "./commands/hardening.js";
import { registerStressCommand } from "./commands/stress.js";
import { registerReputationCommand } from "./commands/reputation.js";
import { registerSlaCommand } from "./commands/sla.js";

// Phase 8: Social Platform
import { registerSocialCommand } from "./commands/social.js";

// Phase 9: Low-Code & Multi-Agent
import { registerLowcodeCommand } from "./commands/lowcode.js";

// EvoMap: Gene Exchange Protocol
import { registerEvoMapCommand } from "./commands/evomap.js";

// CLI-Anything: Agent-Native Software Integration
import { registerCliAnythingCommand } from "./commands/cli-anything.js";

// WebSocket Server Interface
import { registerServeCommand } from "./commands/serve.js";

// Web UI
import { registerUiCommand } from "./commands/ui.js";

// Video Editing Agent (CutClaw-inspired)
import { registerVideoCommand } from "./commands/video.js";

// Orchestration Layer: ChainlessChain → Claude Code/Codex agents → CI → Notify
import { registerOrchestrateCommand } from "./commands/orchestrate.js";

// Phase 62: Tech Learning Engine
import { registerTechCommand } from "./commands/tech.js";

// Phase 63: Autonomous Developer
import { registerDevCommand } from "./commands/dev.js";

// Phase 64: Collaboration Governance
import { registerCollabCommand } from "./commands/collab.js";

// Phase 65: Skill Marketplace
import { registerMarketplaceCommand } from "./commands/marketplace.js";

// Phase 66: Token Incentive
import { registerIncentiveCommand } from "./commands/incentive.js";

// Phase 94: Enterprise Knowledge Graph
import { registerKgCommand } from "./commands/kg.js";

// Phase 97: Multi-Tenant SaaS Engine
import { registerTenantCommand } from "./commands/tenant.js";

// Phase 54: AI Community Governance
import { registerGovernanceCommand } from "./commands/governance.js";

// Phase 48: Smart Content Recommendation
import { registerRecommendCommand } from "./commands/recommend.js";

// Phase 89: Cross-Chain Interoperability
import { registerCrossChainCommand } from "./commands/crosschain.js";

// Phase 91: Privacy Computing
import { registerPrivacyCommand } from "./commands/privacy.js";

// Phase 67: Decentralized Inference Network
import { registerInferenceCommand } from "./commands/inference.js";

// Phase 68-71: Trust & Security
import { registerTrustCommand } from "./commands/trust.js";
import { registerFusionCommand } from "./commands/fusion.js";
import { registerInfraCommand } from "./commands/infra.js";
// Phase 86: Code Generation Agent 2.0
import { registerCodegenCommand } from "./commands/codegen.js";
// Phase 25: Autonomous Ops (AIOps)
import { registerOpsCommand } from "./commands/ops.js";
// Phase 80: Database Evolution Framework
import { registerDbEvoCommand } from "./commands/dbevo.js";
// Phase 84: Multimodal Perception Engine
import { registerPerceptionCommand } from "./commands/perception.js";
// Phase 58: Federation Hardening
import { registerFederationCommand } from "./commands/federation.js";
// Phase 28: Natural Language Programming
import { registerNlProgCommand } from "./commands/nlprog.js";
// Phase 20: Model Quantization
import { registerQuantizationCommand } from "./commands/quantization.js";
// Phase 63: Universal Runtime
import { registerRuntimeCommand } from "./commands/runtime.js";
// Phase 17: IPFS decentralized storage
import { registerIpfsCommand } from "./commands/ipfs.js";
// Phase 27: Multimodal Collaboration
import { registerMultimodalCommand } from "./commands/multimodal.js";
// Phase 22: Performance auto-tuning
import { registerPerfCommand } from "./commands/perf.js";
// Phase 24: Decentralized Agent Network
import { registerAgentNetworkCommand } from "./commands/agent-network.js";
// Phase 55: DID v2.0 — W3C DID + Verifiable Presentations + social recovery
import { registerDIDv2Command } from "./commands/did-v2.js";
// Phase 26: Development Pipeline Orchestration (7-stage AI pipeline + gates)
import { registerPipelineCommand } from "./commands/pipeline.js";
// Phase 64: Plugin Ecosystem 2.0 (registry + deps + install + AI review + publish + revenue)
import { registerPluginEcosystemCommand } from "./commands/plugin-ecosystem.js";
// Phase 96: Workflow Automation Engine (12 SaaS connectors + 5 triggers + DAG execution)
import { registerAutomationCommand } from "./commands/automation.js";
// Phase 14: SSO Enterprise Authentication (SAML / OAuth2 / OIDC + session lifecycle + DID bridge)
import { registerSsoCommand } from "./commands/sso.js";

export function createProgram() {
  const program = new Command();

  program
    .name("chainlesschain")
    .description(
      "CLI for ChainlessChain - install, configure, and manage your personal AI management system",
    )
    .version(VERSION, "-v, --version")
    .option("--verbose", "Enable verbose output")
    .option("--quiet", "Suppress non-essential output");

  // Project initialization & persona
  registerInitCommand(program);
  registerPersonaCommand(program);

  // Existing commands
  registerSetupCommand(program);
  registerStartCommand(program);
  registerStopCommand(program);
  registerStatusCommand(program);
  registerServicesCommand(program);
  registerConfigCommand(program);
  registerUpdateCommand(program);
  registerDoctorCommand(program);

  // Headless commands
  registerDbCommand(program);
  registerNoteCommand(program);
  registerChatCommand(program);
  registerAskCommand(program);
  registerLlmCommand(program);
  registerAgentCommand(program);
  registerSubAgentV2Command(program);
  registerExecBackendV2Command(program);
  registerTodoV2Command(program);
  registerAutoAgentV2Command(program);
  registerOrchGovCommand(program);
  registerTopicClsCommand(program);
  registerItBudgetCommand(program);
  registerPlanModeCommand(program);
  registerPermCommand(program);
  registerUprofCommand(program);
  registerSvcContCommand(program);
  registerTmsCommand(program);
  registerSlotfillCommand(program);
  registerWebfetchCommand(program);
  registerMeminjCommand(program);
  registerSeshsearchCommand(program);
  registerSeshtailCommand(program);
  registerSeshuCommand(program);
  registerSeshhookCommand(program);
  registerMcpscafCommand(program);
  registerFflagCommand(program);
  registerPromcompCommand(program);
  registerCcronCommand(program);
  registerVcheckCommand(program);
  registerPdfpCommand(program);
  registerBm25Command(program);
  registerComptCommand(program);
  registerSganalCommand(program);
  registerStreamCommand(program);
  registerSkillCommand(program);

  // Phase 1: AI intelligence layer
  registerSearchCommand(program);
  registerTokensCommand(program);
  registerMemoryCommand(program);
  registerPermMemCommand(program);
  registerRCacheCommand(program);
  registerSessionCommand(program);
  registerConsolCommand(program);

  // Phase 2: Knowledge & content management
  registerImportCommand(program);
  registerExportCommand(program);
  registerGitCommand(program);

  // Phase 3: MCP & external integration
  registerMcpCommand(program);
  registerBrowseCommand(program);
  registerInstinctCommand(program);

  // Phase 4: Security & identity
  registerDidCommand(program);
  registerEncryptCommand(program);
  registerAuthCommand(program);
  registerAuditCommand(program);

  // Phase 5: P2P, blockchain & enterprise
  registerP2pCommand(program);
  registerSyncCommand(program);
  registerWalletCommand(program);
  registerOrgCommand(program);
  registerPluginCommand(program);

  // Multi-agent collaboration
  registerCoworkCommand(program);

  // Phase 6: Advanced AI & Hooks
  registerHookCommand(program);
  registerWorkflowCommand(program);
  registerHmemoryCommand(program);
  registerA2aCommand(program);

  // Phase 7: Security & Evolution
  registerSandboxCommand(program);
  registerEvolutionCommand(program);
  registerLearningCommand(program);

  // Phase 7: EvoMap Federation + DAO Governance
  registerDaoCommand(program);

  // Phase 8: Blockchain & Enterprise
  registerEconomyCommand(program);
  registerZkpCommand(program);
  registerBiCommand(program);

  // Phase 8: Security & Compliance
  registerComplianceCommand(program);
  registerDlpCommand(program);
  registerSiemCommand(program);
  registerPqcCommand(program);

  // Phase 8: Communication Bridges
  registerNostrCommand(program);
  registerMatrixCommand(program);
  registerActivityPubCommand(program);
  registerScimCommand(program);

  // Phase 8: Infrastructure & Hardening
  registerTerraformCommand(program);
  registerHardeningCommand(program);
  registerStressCommand(program);
  registerReputationCommand(program);
  registerSlaCommand(program);

  // Phase 8: Social Platform
  registerSocialCommand(program);

  // Phase 9: Low-Code & Multi-Agent
  registerLowcodeCommand(program);

  // EvoMap: Gene Exchange Protocol
  registerEvoMapCommand(program);

  // CLI-Anything: Agent-Native Software Integration
  registerCliAnythingCommand(program);

  // WebSocket Server Interface
  registerServeCommand(program);

  // Web UI
  registerUiCommand(program);

  // Orchestration Layer
  registerOrchestrateCommand(program);

  // Video Editing Agent
  registerVideoCommand(program);

  // Phase 62: Tech Learning Engine
  registerTechCommand(program);

  // Phase 63: Autonomous Developer
  registerDevCommand(program);

  // Phase 64: Collaboration Governance
  registerCollabCommand(program);

  // Phase 65: Skill Marketplace
  registerMarketplaceCommand(program);

  // Phase 66: Token Incentive
  registerIncentiveCommand(program);

  // Phase 94: Enterprise Knowledge Graph
  registerKgCommand(program);

  // Phase 97: Multi-Tenant SaaS Engine
  registerTenantCommand(program);

  // Phase 54: AI Community Governance
  registerGovernanceCommand(program);

  // Phase 48: Smart Content Recommendation
  registerRecommendCommand(program);

  // Phase 89: Cross-Chain Interoperability
  registerCrossChainCommand(program);

  // Phase 91: Privacy Computing
  registerPrivacyCommand(program);

  // Phase 67: Decentralized Inference Network
  registerInferenceCommand(program);

  // Phase 68-71: Trust & Security
  registerTrustCommand(program);
  registerFusionCommand(program);
  registerInfraCommand(program);
  registerCodegenCommand(program);
  registerOpsCommand(program);
  registerDbEvoCommand(program);
  registerPerceptionCommand(program);
  registerFederationCommand(program);
  registerNlProgCommand(program);
  registerQuantizationCommand(program);
  registerRuntimeCommand(program);
  registerIpfsCommand(program);
  registerMultimodalCommand(program);
  registerPerfCommand(program);
  registerAgentNetworkCommand(program);
  registerDIDv2Command(program);
  registerPipelineCommand(program);
  registerPluginEcosystemCommand(program);
  registerAutomationCommand(program);
  registerSsoCommand(program);

  return program;
}
