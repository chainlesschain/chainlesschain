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
import { registerPackCommand } from "./commands/pack.js";

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
// MTC: Merkle Tree Certificates (Phase 1 Week 3)
import { registerMtcCommand } from "./commands/mtc.js";
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

// Iter16 V2 governance overlays (appended to existing parent commands)
import { registerAuditGovV2Commands } from "./commands/audit.js";
import { registerKgovV2Commands } from "./commands/kg.js";
import { registerSboxGovV2Commands } from "./commands/sandbox.js";
import { registerSlagovV2Commands } from "./commands/sla.js";
import { registerStrgovV2Commands } from "./commands/stress.js";
import { registerTfgovV2Commands } from "./commands/terraform.js";
import { registerRepgovV2Commands } from "./commands/reputation.js";
import { registerMktgovV2Commands } from "./commands/marketplace.js";

// Iter17 V2 governance overlays
import { registerChatgovV2Commands } from "./commands/chat.js";
import { registerCcbgovV2Commands } from "./commands/orchestrate.js";
import { registerCmgrV2Commands } from "./commands/compliance.js";
import { registerCwLearnV2Commands } from "./commands/cowork.js";
import { registerCwwfV2Commands } from "./commands/cowork.js";
import { registerPcgovV2Commands } from "./commands/privacy.js";
import { registerIncgovV2Commands } from "./commands/incentive.js";
import { registerHardgovV2Commands } from "./commands/hardening.js";

// Iter18 V2 governance overlays
import { registerAiopsgovV2Commands } from "./commands/ops.js";
import { registerMmgovV2Commands } from "./commands/multimodal.js";
import { registerInstgovV2Commands } from "./commands/instinct.js";
import { registerTnsgovV2Commands } from "./commands/tenant.js";
import { registerQntgovV2Commands } from "./commands/quantization.js";
import { registerTrustgovV2Commands } from "./commands/trust.js";
import { registerNlpgovV2Commands } from "./commands/nlprog.js";
import { registerPercgovV2Commands } from "./commands/perception.js";

// Iter19 V2 governance overlays
import { registerCdagovV2Commands } from "./commands/codegen.js";
import { registerCogovV2Commands } from "./commands/collab.js";
import { registerCommgovV2Commands } from "./commands/governance.js";
import { registerDidgovV2Commands } from "./commands/did.js";
import { registerSsogovV2Commands } from "./commands/sso.js";
import { registerOrggovV2Commands } from "./commands/org.js";
import { registerScimgovV2Commands } from "./commands/scim.js";
import { registerSyncgovV2Commands } from "./commands/sync.js";

// Iter20 V2 governance overlays
import { registerAnetgovV2Commands } from "./commands/agent-network.js";
import { registerBagovV2Commands } from "./commands/browse.js";
import { registerDlpgovV2Commands } from "./commands/dlp.js";
import { registerEvgovV2Commands } from "./commands/evomap.js";
import { registerFedgovV2Commands } from "./commands/federation.js";
import { registerIpfsgovV2Commands } from "./commands/ipfs.js";
import { registerP2pgovV2Commands } from "./commands/p2p.js";
import { registerWalgovV2Commands } from "./commands/wallet.js";

// Iter21 V2 governance overlays
import { registerApgovV2Commands } from "./commands/activitypub.js";
import { registerMatgovV2Commands } from "./commands/matrix.js";
import { registerNosgovV2Commands } from "./commands/nostr.js";
import { registerBigovV2Commands } from "./commands/bi.js";
import { registerMemgovV2Commands } from "./commands/memory.js";
import { registerSesgovV2Commands } from "./commands/session.js";
import { registerHookgovV2Commands } from "./commands/hook.js";
import { registerWfgovV2Commands } from "./commands/workflow.js";

// Iter22 V2 governance overlays
import { registerAugovV2Commands } from "./commands/automation.js";
import { registerShgovV2Commands } from "./commands/cowork.js";
import { registerDv2govV2Commands } from "./commands/did-v2.js";
import { registerKexpgovV2Commands } from "./commands/export.js";
import { registerKimpgovV2Commands } from "./commands/import.js";
import { registerLlmgovV2Commands } from "./commands/llm.js";
import { registerPqcgovV2Commands } from "./commands/pqc.js";
import { registerSmgovV2Commands } from "./commands/social.js";

// Iter23 V2 governance overlays
import { registerRcgovV2Commands } from "./commands/rcache.js";
import { registerTechgovV2Commands } from "./commands/tech.js";
import { registerRtgovV2Commands } from "./commands/runtime.js";
import { registerNtgovV2Commands } from "./commands/note.js";
import { registerPmgovV2Commands } from "./commands/permmem.js";
import { registerPfgovV2Commands } from "./commands/fusion.js";
import { registerDbevogovV2Commands } from "./commands/dbevo.js";
import { registerDigovV2Commands } from "./commands/infra.js";

// Iter24 V2 governance overlays
import { registerRcmdgovV2Commands } from "./commands/recommend.js";
import { registerMcpgovV2Commands } from "./commands/mcp.js";
import { registerEcogovV2Commands } from "./commands/plugin-ecosystem.js";
import { registerSklgovV2Commands } from "./commands/skill.js";
import { registerToktgovV2Commands } from "./commands/tokens.js";
import { registerDevgovV2Commands } from "./commands/dev.js";
import { registerTigovV2Commands } from "./commands/compliance.js";
import { registerUebgovV2Commands } from "./commands/compliance.js";

// Iter25 V2 governance overlays
import { registerCttgovV2Commands } from "./commands/cowork.js";
import { registerCtmgovV2Commands } from "./commands/cowork.js";
import { registerClibgovV2Commands } from "./commands/cli-anything.js";
import { registerArgovV2Commands } from "./commands/orchestrate.js";
import { registerSaregovV2Commands } from "./commands/agent.js";
import { registerTodogovV2Commands } from "./commands/agent.js";
import { registerEbgovV2Commands } from "./commands/agent.js";
import { registerEvfedgovV2Commands } from "./commands/evomap.js";

// Iter26 V2 governance overlays
import { registerPlannergovV2Commands } from "./commands/planmode.js";
import { registerCtxenggovV2Commands } from "./commands/cli-anything.js";
import { registerSactxgovV2Commands } from "./commands/agent.js";
import { registerIagovV2Commands } from "./commands/chat.js";
import { registerWfexgovV2Commands } from "./commands/workflow.js";
import { registerPadgovV2Commands } from "./commands/plugin.js";
import { registerHlgovV2Commands } from "./commands/memory.js";
import { registerWebuigovV2Commands } from "./commands/ui.js";

// Iter27 V2 governance overlays
import { registerDlgovV2Commands } from "./commands/setup.js";
import { registerSmcpgovV2Commands } from "./commands/skill.js";
import { registerCmcpgovV2Commands } from "./commands/cowork.js";
import { registerStixgovV2Commands } from "./commands/compliance.js";
import { registerSapgovV2Commands } from "./commands/agent.js";
import { registerCobsgovV2Commands } from "./commands/cowork.js";
import { registerPmgrgovV2Commands } from "./commands/start.js";
import { registerWscgovV2Commands } from "./commands/chat.js";
import { registerEvcligovV2Commands } from "./commands/evomap.js";
import { registerPoptgovV2Commands } from "./commands/llm.js";
import { registerScsgovV2Commands } from "./commands/config.js";
import { registerSmgrgovV2Commands } from "./commands/services.js";
import { registerCeadgovV2Commands } from "./commands/cowork.js";
import { registerPstrmgovV2Commands } from "./commands/stream.js";
import { registerCohtgovV2Commands } from "./commands/cowork.js";
import { registerCadpgovV2Commands } from "./commands/cowork.js";

// Iter28 V2 governance overlays
import { registerA2apV2Commands } from "./commands/a2a.js";
import { registerAcrdV2Commands } from "./commands/orchestrate.js";
import { registerAecoV2Commands } from "./commands/economy.js";
import { registerAutagV2Commands } from "./commands/agent.js";
import { registerCcoreV2Commands } from "./commands/chat.js";
import { registerCmpmV2Commands } from "./commands/compliance.js";
import { registerCrchV2Commands } from "./commands/crosschain.js";
import { registerCryV2Commands } from "./commands/encrypt.js";
import { registerDaomV2Commands } from "./commands/dao.js";
import { registerEsysV2Commands } from "./commands/evolution.js";
import { registerEmgrV2Commands } from "./commands/evomap.js";
import { registerHmemV2Commands } from "./commands/hmemory.js";
import { registerInfnetV2Commands } from "./commands/inference.js";
import { registerKgV2Commands } from "./commands/kg.js";
import { registerPmodeV2Commands } from "./commands/planmode.js";
import { registerPipoV2Commands } from "./commands/pipeline.js";

/**
 * @param {object} [opts]
 * @param {Set<string>} [opts.allowedCommands]  When set, only these top-level
 *   command names survive. Env var CC_PROJECT_ALLOWED_SUBCOMMANDS provides the
 *   same filter at runtime (packed exe project mode — comma-separated list).
 *   opts.allowedCommands takes precedence over the env var.
 */
export function createProgram(opts = {}) {
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

  // Standalone Executable Bundling
  registerPackCommand(program);

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
  registerMtcCommand(program);
  registerMultimodalCommand(program);
  registerPerfCommand(program);
  registerAgentNetworkCommand(program);
  registerDIDv2Command(program);
  registerPipelineCommand(program);
  registerPluginEcosystemCommand(program);
  registerAutomationCommand(program);
  registerSsoCommand(program);

  // Iter16 V2 governance overlays (must run after parent commands above)
  registerAuditGovV2Commands(program);
  registerKgovV2Commands(program);
  registerSboxGovV2Commands(program);
  registerSlagovV2Commands(program);
  registerStrgovV2Commands(program);
  registerTfgovV2Commands(program);
  registerRepgovV2Commands(program);
  registerMktgovV2Commands(program);

  // Iter17 V2 governance overlays
  registerChatgovV2Commands(program);
  registerCcbgovV2Commands(program);
  registerCmgrV2Commands(program);
  registerCwLearnV2Commands(program);
  registerCwwfV2Commands(program);
  registerPcgovV2Commands(program);
  registerIncgovV2Commands(program);
  registerHardgovV2Commands(program);

  // Iter18 V2 governance overlays
  registerAiopsgovV2Commands(program);
  registerMmgovV2Commands(program);
  registerInstgovV2Commands(program);
  registerTnsgovV2Commands(program);
  registerQntgovV2Commands(program);
  registerTrustgovV2Commands(program);
  registerNlpgovV2Commands(program);
  registerPercgovV2Commands(program);

  // Iter19 V2 governance overlays
  registerCdagovV2Commands(program);
  registerCogovV2Commands(program);
  registerCommgovV2Commands(program);
  registerDidgovV2Commands(program);
  registerSsogovV2Commands(program);
  registerOrggovV2Commands(program);
  registerScimgovV2Commands(program);
  registerSyncgovV2Commands(program);

  // Iter20 V2 governance overlays
  registerAnetgovV2Commands(program);
  registerBagovV2Commands(program);
  registerDlpgovV2Commands(program);
  registerEvgovV2Commands(program);
  registerFedgovV2Commands(program);
  registerIpfsgovV2Commands(program);
  registerP2pgovV2Commands(program);
  registerWalgovV2Commands(program);

  // Iter21 V2 governance overlays
  registerApgovV2Commands(program);
  registerMatgovV2Commands(program);
  registerNosgovV2Commands(program);
  registerBigovV2Commands(program);
  registerMemgovV2Commands(program);
  registerSesgovV2Commands(program);
  registerHookgovV2Commands(program);
  registerWfgovV2Commands(program);

  // Iter22 V2 governance overlays
  registerAugovV2Commands(program);
  registerShgovV2Commands(program);
  registerDv2govV2Commands(program);
  registerKexpgovV2Commands(program);
  registerKimpgovV2Commands(program);
  registerLlmgovV2Commands(program);
  registerPqcgovV2Commands(program);
  registerSmgovV2Commands(program);

  // Iter23 V2 governance overlays
  registerRcgovV2Commands(program);
  registerTechgovV2Commands(program);
  registerRtgovV2Commands(program);
  registerNtgovV2Commands(program);
  registerPmgovV2Commands(program);
  registerPfgovV2Commands(program);
  registerDbevogovV2Commands(program);
  registerDigovV2Commands(program);

  // Iter24 V2 governance overlays
  registerRcmdgovV2Commands(program);
  registerMcpgovV2Commands(program);
  registerEcogovV2Commands(program);
  registerSklgovV2Commands(program);
  registerToktgovV2Commands(program);
  registerDevgovV2Commands(program);
  registerTigovV2Commands(program);
  registerUebgovV2Commands(program);

  // Iter25 V2 governance overlays
  registerCttgovV2Commands(program);
  registerCtmgovV2Commands(program);
  registerClibgovV2Commands(program);
  registerArgovV2Commands(program);
  registerSaregovV2Commands(program);
  registerTodogovV2Commands(program);
  registerEbgovV2Commands(program);
  registerEvfedgovV2Commands(program);

  // Iter26 V2 governance overlays
  registerPlannergovV2Commands(program);
  registerCtxenggovV2Commands(program);
  registerSactxgovV2Commands(program);
  registerIagovV2Commands(program);
  registerWfexgovV2Commands(program);
  registerPadgovV2Commands(program);
  registerHlgovV2Commands(program);
  registerWebuigovV2Commands(program);

  // Iter27 V2 governance overlays
  registerDlgovV2Commands(program);
  registerSmcpgovV2Commands(program);
  registerCmcpgovV2Commands(program);
  registerStixgovV2Commands(program);
  registerSapgovV2Commands(program);
  registerCobsgovV2Commands(program);
  registerPmgrgovV2Commands(program);
  registerWscgovV2Commands(program);
  registerEvcligovV2Commands(program);
  registerPoptgovV2Commands(program);
  registerScsgovV2Commands(program);
  registerSmgrgovV2Commands(program);
  registerCeadgovV2Commands(program);
  registerPstrmgovV2Commands(program);
  registerCohtgovV2Commands(program);
  registerCadpgovV2Commands(program);

  // Iter28 V2 governance overlays
  registerA2apV2Commands(program);
  registerAcrdV2Commands(program);
  registerAecoV2Commands(program);
  registerAutagV2Commands(program);
  registerCcoreV2Commands(program);
  registerCmpmV2Commands(program);
  registerCrchV2Commands(program);
  registerCryV2Commands(program);
  registerDaomV2Commands(program);
  registerEsysV2Commands(program);
  registerEmgrV2Commands(program);
  registerHmemV2Commands(program);
  registerInfnetV2Commands(program);
  registerKgV2Commands(program);
  registerPmodeV2Commands(program);
  registerPipoV2Commands(program);

  // Phase 3a: project-mode command whitelist.
  // In a packed project-mode exe, CC_PROJECT_ALLOWED_SUBCOMMANDS (set by the
  // entry script from BAKED.projectAllowedSubcommands) restricts which top-level
  // commands are visible. opts.allowedCommands (a Set<string>) is preferred for
  // programmatic/test use and takes precedence over the env var.
  const allowedSet =
    opts.allowedCommands instanceof Set
      ? opts.allowedCommands
      : process.env.CC_PROJECT_ALLOWED_SUBCOMMANDS
        ? new Set(
            process.env.CC_PROJECT_ALLOWED_SUBCOMMANDS.split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        : null;

  if (allowedSet && allowedSet.size > 0) {
    program.commands = program.commands.filter((cmd) =>
      allowedSet.has(cmd.name()),
    );
  }

  return program;
}
