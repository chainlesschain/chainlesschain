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

  // New headless commands
  registerDbCommand(program);
  registerNoteCommand(program);
  registerChatCommand(program);
  registerAskCommand(program);
  registerLlmCommand(program);
  registerAgentCommand(program);
  registerSkillCommand(program);

  return program;
}
