/**
 * Interactive AI chat command
 * chainlesschain chat [--model] [--provider] [--agent]
 */

import { createAgentRuntimeFactory } from "../runtime/runtime-factory.js";

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
      const factory = createAgentRuntimeFactory();
      const runtimeOptions = {
        model: options.model,
        provider: options.provider,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        sessionId: options.session,
      };

      if (options.agent) {
        await factory.createAgentRuntime(runtimeOptions).startAgentSession();
      } else {
        await factory.createChatRuntime(runtimeOptions).startChatSession();
      }
    });
}
