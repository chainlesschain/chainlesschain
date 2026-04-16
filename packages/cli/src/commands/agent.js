/**
 * Agentic AI assistant - Claude Code style
 * chainlesschain agent [--model] [--provider]
 *
 * User describes what they want in natural language.
 * AI reads files, writes code, runs commands, and explains what it's doing.
 */

import { createAgentRuntimeFactory } from "../runtime/runtime-factory.js";

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
    .option("--agent-id <id>", "Agent id for scoped memory recall")
    .option("--recall-limit <n>", "Top-K memories to inject into system prompt")
    .option("--recall-query <q>", "Query string for startup memory recall")
    .option("--no-recall-memory", "Disable startup memory recall")
    .option("--no-stream", "Disable streamed response rendering")
    .option(
      "--no-park-on-exit",
      "Close the session-core handle on exit instead of parking it",
    )
    .option(
      "--bundle <path>",
      "Agent bundle directory (chainless-agent.toml + AGENTS.md + skills/ + mcp.json + USER.md)",
    )
    .action(async (options) => {
      const runtime = createAgentRuntimeFactory().createAgentRuntime({
        model: options.model,
        provider: options.provider,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        sessionId: options.session,
        agentId: options.agentId,
        recallLimit: options.recallLimit,
        recallQuery: options.recallQuery,
        recallMemory: options.recallMemory, // false when --no-recall-memory
        noStream: options.stream === false, // true when --no-stream
        parkOnExit: options.parkOnExit, // false when --no-park-on-exit
        bundlePath: options.bundle || null,
      });
      await runtime.startAgentSession();
    });
}
