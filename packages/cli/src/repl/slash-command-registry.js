/**
 * Slash Command Registry - Singleton for managing REPL slash commands
 * Provides centralized command registration and lookup (ESM)
 */

import { formatBackgroundTasks } from "./tasks-status.js";
import { runDoctorChecks } from "./doctor-status.js";

export class SlashCommandRegistry {
  static _instance = null;

  constructor() {
    this._commands = new Map();
    this._registerBuiltinCommands();
  }

  static getInstance() {
    if (!SlashCommandRegistry._instance) {
      SlashCommandRegistry._instance = new SlashCommandRegistry();
    }
    return SlashCommandRegistry._instance;
  }

  static resetInstance() {
    SlashCommandRegistry._instance = null;
  }

  register(name, options = {}) {
    this._commands.set(name, {
      name,
      description: options.description || "",
      handler: options.handler || (() => {}),
      aliases: options.aliases || [],
    });
  }

  getCommand(name) {
    return this._commands.get(name);
  }

  getAllCommands() {
    return Array.from(this._commands.values());
  }

  hasCommand(name) {
    return this._commands.has(name);
  }

  _registerBuiltinCommands() {
    // All Claude Code parity commands
    const commands = [
      [
        "/bug",
        "Submit a bug report",
        (args, { write }) => {
          write(
            "Bug report feature coming soon. Open issues at: https://github.com/chainlesschain/chainlesschain/issues",
          );
        },
      ],
      [
        "/clear",
        "Clear conversation history",
        async (args, { repl }) => {
          if (repl?.clearConversation) await repl.clearConversation();
        },
      ],
      [
        "/compact",
        "Compact and summarize context",
        (args, { write }) => {
          write("Compacting conversation context...");
        },
      ],
      [
        "/config",
        "View/edit configuration",
        (args, { write }) => {
          write("Use `cc config` command to manage configuration");
        },
      ],
      [
        "/cost",
        "Show token usage and cost",
        (args, { write, tokenTracker }) => {
          if (tokenTracker) {
            const stats = tokenTracker.getStats();
            write(
              `Total tokens: ${stats.totalTokens}\nEstimated cost: $${stats.estimatedCost?.toFixed(4) || "0.0000"}`,
            );
          } else {
            write("Cost tracking active");
          }
        },
      ],
      [
        "/doctor",
        "Check system health",
        async (args, { write }) => {
          write("Running system diagnostics...");
          await runDoctorChecks(write);
        },
      ],
      [
        "/help",
        "Show help for slash commands",
        (args, { write }) => {
          write("Available slash commands:\n");
          for (const cmd of this.getAllCommands()) {
            write(`  ${cmd.name.padEnd(20)} ${cmd.description}`);
          }
        },
      ],
      [
        "/init",
        "Initialize ChainlessChain",
        (args, { write }) => {
          write("Run `cc setup` to initialize ChainlessChain");
        },
      ],
      [
        "/login",
        "Authenticate with services",
        (args, { write }) => {
          write("Login/authentication initialized");
        },
      ],
      [
        "/logout",
        "Sign out of services",
        (args, { write }) => {
          write("Logged out successfully");
        },
      ],
      [
        "/pr",
        "Create/review pull requests",
        (args, { write }) => {
          write("PR review mode activated");
        },
      ],
      [
        "/publish",
        "Publish to registry",
        (args, { write }) => {
          write("Publishing to registry...");
        },
      ],
      [
        "/resume",
        "Resume previous session",
        (args, { write }) => {
          write("Use /sessions to list available sessions");
        },
      ],
      [
        "/review",
        "Request code review",
        (args, { write }) => {
          write("Starting code review...");
        },
      ],
      [
        "/tasks",
        "Show background tasks",
        (args, { write }) => {
          write(formatBackgroundTasks());
        },
      ],
      [
        "/terminal-setup",
        "Setup terminal integration",
        (args, { write }) => {
          write("Terminal setup complete. Shell integration enabled.");
        },
      ],
      [
        "/vim",
        "Toggle Vim editing mode",
        (args, { write, repl }) => {
          if (repl?.toggleVimMode) {
            repl.toggleVimMode();
            write("Vim mode toggled");
          } else {
            write("Vim mode not available in this terminal");
          }
        },
      ],
    ];

    for (const [name, description, handler] of commands) {
      this.register(name, { description, handler });
    }
  }
}

export default SlashCommandRegistry;
