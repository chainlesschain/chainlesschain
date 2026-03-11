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

  return program;
}
