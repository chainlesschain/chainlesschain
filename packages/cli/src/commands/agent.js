/**
 * Agentic AI assistant - Claude Code style
 * chainlesschain agent [--model] [--provider]
 *
 * User describes what they want in natural language.
 * AI reads files, writes code, runs commands, and explains what it's doing.
 */

import { startAgentRepl } from "../repl/agent-repl.js";

export function registerAgentCommand(program) {
  program
    .command("agent")
    .alias("a")
    .description(
      "Start an agentic AI session (reads/writes files, runs commands)",
    )
    .option("--model <model>", "Model name", "qwen2:7b")
    .option(
      "--provider <provider>",
      "LLM provider (ollama, openai, volcengine, deepseek, ...)",
      "ollama",
    )
    .option("--base-url <url>", "API base URL")
    .option("--api-key <key>", "API key")
    .option("--session <id>", "Resume a previous agent session")
    .action(async (options) => {
      await startAgentRepl({
        model: options.model,
        provider: options.provider,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        sessionId: options.session,
      });
    });
}
