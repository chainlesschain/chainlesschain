/**
 * Single-shot AI question command
 * chainlesschain ask "What is..." [--model qwen2:7b] [--provider ollama] [--json]
 */

import ora from "ora";
import chalk from "chalk";
import { logger } from "../lib/logger.js";

/**
 * Send a single question to an LLM provider
 * @param {string} question
 * @param {object} options
 * @returns {Promise<string>}
 */
async function queryLLM(question, options = {}) {
  const provider = options.provider || "ollama";
  const model = options.model || "qwen2:7b";
  const baseUrl = options.baseUrl || "http://localhost:11434";

  if (provider === "ollama") {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: question,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data.response;
  } else if (provider === "openai") {
    const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey)
      throw new Error("OpenAI API key required (--api-key or OPENAI_API_KEY)");

    const apiBase = options.baseUrl || "https://api.openai.com/v1";
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [{ role: "user", content: question }],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

export function registerAskCommand(program) {
  program
    .command("ask")
    .description("Ask a question to the AI (single-shot)")
    .argument("<question>", "The question to ask")
    .option("--model <model>", "Model name", "qwen2:7b")
    .option("--provider <provider>", "LLM provider (ollama, openai)", "ollama")
    .option("--base-url <url>", "API base URL")
    .option("--api-key <key>", "API key")
    .option("--json", "Output as JSON")
    .action(async (question, options) => {
      const spinner = ora("Thinking...").start();
      try {
        const answer = await queryLLM(question, {
          model: options.model,
          provider: options.provider,
          baseUrl: options.baseUrl,
          apiKey: options.apiKey,
        });

        spinner.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                question,
                answer,
                model: options.model,
                provider: options.provider,
              },
              null,
              2,
            ),
          );
        } else {
          logger.log(answer);
        }
      } catch (err) {
        spinner.fail(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
