/**
 * Interactive AI chat command
 * chainlesschain chat [--model qwen2:7b] [--provider ollama] [--agent]
 */

import { startChatRepl } from "../repl/chat-repl.js";
import { startAgentRepl } from "../repl/agent-repl.js";

export function registerChatCommand(program) {
  program
    .command("chat")
    .description("Start an interactive AI chat session")
    .option("--model <model>", "Model name", "qwen2:7b")
    .option("--provider <provider>", "LLM provider (ollama, openai)", "ollama")
    .option("--base-url <url>", "API base URL")
    .option("--api-key <key>", "API key")
    .option(
      "--agent",
      "Agentic mode - AI can read/write files and run commands (like Claude Code)",
    )
    .action(async (options) => {
      const replOptions = {
        model: options.model,
        provider: options.provider,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
      };

      if (options.agent) {
        await startAgentRepl(replOptions);
      } else {
        await startChatRepl(replOptions);
      }
    });
}
