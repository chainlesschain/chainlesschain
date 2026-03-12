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
import { registerAgentCommand } from "./commands/agent.js";
import { registerSkillCommand } from "./commands/skill.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerTokensCommand } from "./commands/tokens.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { registerSessionCommand } from "./commands/session.js";
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
import { registerCoworkCommand } from "./commands/cowork.js";

// Phase 6: Advanced AI & Hooks
import { registerHookCommand } from "./commands/hook.js";
import { registerWorkflowCommand } from "./commands/workflow.js";
import { registerHmemoryCommand } from "./commands/hmemory.js";
import { registerA2aCommand } from "./commands/a2a.js";

// Phase 7: Security & Evolution
import { registerSandboxCommand } from "./commands/sandbox.js";
import { registerEvolutionCommand } from "./commands/evolution.js";

// Phase 8: Blockchain & Enterprise
import { registerEconomyCommand } from "./commands/economy.js";
import { registerZkpCommand } from "./commands/zkp.js";
import { registerBiCommand } from "./commands/bi.js";

// Phase 9: Low-Code & Multi-Agent
import { registerLowcodeCommand } from "./commands/lowcode.js";

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

  // Project initialization
  registerInitCommand(program);

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
  registerSkillCommand(program);

  // Phase 1: AI intelligence layer
  registerSearchCommand(program);
  registerTokensCommand(program);
  registerMemoryCommand(program);
  registerSessionCommand(program);

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

  // Phase 8: Blockchain & Enterprise
  registerEconomyCommand(program);
  registerZkpCommand(program);
  registerBiCommand(program);

  // Phase 9: Low-Code & Multi-Agent
  registerLowcodeCommand(program);

  return program;
}
