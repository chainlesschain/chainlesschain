/**
 * Agentic AI assistant - Claude Code style
 * chainlesschain agent [--model] [--provider]
 *
 * User describes what they want in natural language.
 * AI reads files, writes code, runs commands, and explains what it's doing.
 */

import { startAgentRepl } from "../repl/agent-repl.js";
import { loadConfig } from "../lib/config-manager.js";

export function registerAgentCommand(program) {
  program
    .command("agent")
    .alias("a")
    .description(
      "Start an agentic AI session (reads/writes files, runs commands)",
    )
    .option("--model <model>", "Model name")
    .option(
      "--provider <provider>",
      "LLM provider (ollama, openai, volcengine, deepseek, ...)",
    )
    .option("--base-url <url>", "API base URL")
    .option("--api-key <key>", "API key")
    .option("--session <id>", "Resume a previous agent session")
    .action(async (options) => {
      const config = loadConfig();
      await startAgentRepl({
        model: options.model || config.llm?.model || "qwen2:7b",
        provider: options.provider || config.llm?.provider || "ollama",
        baseUrl: options.baseUrl || config.llm?.baseUrl,
        apiKey: options.apiKey || config.llm?.apiKey,
        sessionId: options.session,
      });
    });
}
