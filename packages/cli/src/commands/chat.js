/**
 * Interactive AI chat command
 * chainlesschain chat [--model] [--provider] [--agent]
 */

import { startChatRepl } from "../repl/chat-repl.js";
import { startAgentRepl } from "../repl/agent-repl.js";
import { loadConfig } from "../lib/config-manager.js";

export function registerChatCommand(program) {
  program
    .command("chat")
    .description("Start an interactive AI chat session")
    .option("--model <model>", "Model name")
    .option(
      "--provider <provider>",
      "LLM provider (ollama, openai, volcengine, deepseek, ...)",
    )
    .option("--base-url <url>", "API base URL")
    .option("--api-key <key>", "API key")
    .option(
      "--agent",
      "Agentic mode - AI can read/write files and run commands (like Claude Code)",
    )
    .option("--session <id>", "Resume a previous session (agent mode)")
    .action(async (options) => {
      const config = loadConfig();
      const replOptions = {
        model: options.model || config.llm?.model || "qwen2:7b",
        provider: options.provider || config.llm?.provider || "ollama",
        baseUrl: options.baseUrl || config.llm?.baseUrl,
        apiKey: options.apiKey || config.llm?.apiKey,
        sessionId: options.session,
      };

      if (options.agent) {
        await startAgentRepl(replOptions);
      } else {
        await startChatRepl(replOptions);
      }
    });
}
