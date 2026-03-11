/**
 * LLM management commands
 * chainlesschain llm list|test|models
 */

import ora from "ora";
import chalk from "chalk";
import { logger } from "../lib/logger.js";

export function registerLlmCommand(program) {
  const llm = program.command("llm").description("LLM provider management");

  // llm models - list available models
  llm
    .command("models")
    .description("List available models from the current provider")
    .option("--provider <provider>", "LLM provider", "ollama")
    .option("--base-url <url>", "API base URL", "http://localhost:11434")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const spinner = ora("Fetching models...").start();
      try {
        if (options.provider === "ollama") {
          const response = await fetch(`${options.baseUrl}/api/tags`);
          if (!response.ok) {
            throw new Error(`Ollama not reachable: ${response.status}`);
          }
          const data = await response.json();
          spinner.stop();

          if (options.json) {
            console.log(JSON.stringify(data.models, null, 2));
          } else {
            if (!data.models || data.models.length === 0) {
              logger.info("No models installed. Run: ollama pull qwen2:7b");
            } else {
              logger.log(chalk.bold(`Models (${data.models.length}):\n`));
              for (const m of data.models) {
                const size = m.size
                  ? chalk.gray(`(${(m.size / 1e9).toFixed(1)}GB)`)
                  : "";
                logger.log(`  ${chalk.cyan(m.name.padEnd(30))} ${size}`);
              }
            }
          }
        } else {
          spinner.fail(
            `Model listing not supported for provider: ${options.provider}`,
          );
        }
      } catch (err) {
        spinner.fail(`Failed to list models: ${err.message}`);
        process.exit(1);
      }
    });

  // llm test - test connectivity
  llm
    .command("test")
    .description("Test LLM provider connectivity")
    .option("--provider <provider>", "LLM provider", "ollama")
    .option("--model <model>", "Model to test", "qwen2:7b")
    .option("--base-url <url>", "API base URL", "http://localhost:11434")
    .option("--api-key <key>", "API key")
    .action(async (options) => {
      const spinner = ora(`Testing ${options.provider}...`).start();
      try {
        const start = Date.now();

        if (options.provider === "ollama") {
          const response = await fetch(`${options.baseUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: options.model,
              prompt: "Say hi in one word.",
              stream: false,
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();
          const elapsed = Date.now() - start;

          spinner.succeed(
            `${chalk.green("Connected")} to Ollama (${options.model}) in ${elapsed}ms`,
          );
          logger.log(
            `  Response: ${chalk.gray(data.response.trim().substring(0, 100))}`,
          );
        } else if (options.provider === "openai") {
          const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
          if (!apiKey) throw new Error("API key required");

          const url =
            options.baseUrl !== "http://localhost:11434"
              ? options.baseUrl
              : "https://api.openai.com/v1";

          const response = await fetch(`${url}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: options.model || "gpt-4o-mini",
              messages: [{ role: "user", content: "Say hi in one word." }],
              max_tokens: 10,
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();
          const elapsed = Date.now() - start;

          spinner.succeed(
            `${chalk.green("Connected")} to OpenAI (${options.model || "gpt-4o-mini"}) in ${elapsed}ms`,
          );
          logger.log(
            `  Response: ${chalk.gray(data.choices[0].message.content.trim())}`,
          );
        } else {
          spinner.fail(`Unknown provider: ${options.provider}`);
        }
      } catch (err) {
        spinner.fail(`Test failed: ${err.message}`);
        process.exit(1);
      }
    });
}
