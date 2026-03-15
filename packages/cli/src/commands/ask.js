/**
 * Single-shot AI question command
 * chainlesschain ask "What is..." [--model] [--provider] [--json]
 */

import ora from "ora";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { BUILT_IN_PROVIDERS } from "../lib/llm-providers.js";
import { loadConfig } from "../lib/config-manager.js";

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
  } else {
    // OpenAI-compatible providers (openai, volcengine, deepseek, dashscope, mistral, gemini)
    const providerDef = BUILT_IN_PROVIDERS[provider];
    if (!providerDef) {
      throw new Error(
        `Unsupported provider: ${provider}. Supported: ollama, openai, volcengine, deepseek, dashscope, gemini, mistral, anthropic`,
      );
    }

    const apiKey =
      options.apiKey ||
      (providerDef.apiKeyEnv ? process.env[providerDef.apiKeyEnv] : null);
    if (!apiKey)
      throw new Error(
        `API key required for ${provider} (--api-key or ${providerDef.apiKeyEnv})`,
      );

    const apiBase = options.baseUrl || providerDef.baseUrl;
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || providerDef.models[0],
        messages: [{ role: "user", content: question }],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `${provider} error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }
}

export function registerAskCommand(program) {
  program
    .command("ask")
    .description("Ask a question to the AI (single-shot)")
    .argument("<question>", "The question to ask")
    .option("--model <model>", "Model name")
    .option(
      "--provider <provider>",
      "LLM provider (ollama, openai, volcengine, deepseek, ...)",
    )
    .option("--base-url <url>", "API base URL")
    .option("--api-key <key>", "API key")
    .option("--json", "Output as JSON")
    .action(async (question, options) => {
      const config = loadConfig();
      const resolvedOptions = {
        model: options.model || config.llm?.model || "qwen2:7b",
        provider: options.provider || config.llm?.provider || "ollama",
        baseUrl: options.baseUrl || config.llm?.baseUrl,
        apiKey: options.apiKey || config.llm?.apiKey,
      };
      const spinner = ora("Thinking...").start();
      try {
        const answer = await queryLLM(question, resolvedOptions);

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
