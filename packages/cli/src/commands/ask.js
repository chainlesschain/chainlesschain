/**
 * Single-shot AI question command
 * chainlesschain ask "What is..." [--model] [--provider] [--json]
 *
 * Android local-model integration:
 *   The Android in-APK LocalLlmServer (pdh/llm/LocalLlmServer.kt) exposes
 *   an Ollama-compat HTTP server on 127.0.0.1:18484 with /api/chat + /api/tags.
 *   `cc ask` honors three opt-in mechanisms (priority order) so users can
 *   choose whether the Android local model is the default:
 *     1. `--base-url` flag (one-shot, explicit)
 *     2. `CC_HUB_OLLAMA_URL` env var (Android LocalCcRunner injects this)
 *     3. `--prefer-android-local` flag (one-shot toggle to 127.0.0.1:18484)
 *     4. `config.llm.preferAndroidLocal=true` (persistent user toggle:
 *        `cc config set llm.preferAndroidLocal true`)
 *     5. `config.llm.baseUrl`
 *     6. Hardcoded http://localhost:11434
 *
 * Endpoint:
 *   For provider=ollama we now use POST /api/chat (works on standard Ollama
 *   AND Android LocalLlmServer, which only implements chat). Pre-v5.0.3.85
 *   used /api/generate, which broke against the Android server.
 */

import ora from "ora";
import { logger } from "../lib/logger.js";
import { BUILT_IN_PROVIDERS } from "../lib/llm-providers.js";
import { loadConfig } from "../lib/config-manager.js";

const ANDROID_LOCAL_OLLAMA_URL = "http://127.0.0.1:18484";

/**
 * Resolve effective Ollama base URL given CLI options, env, and config.
 * Exported for unit testing.
 */
export function resolveOllamaBaseUrl({
  options = {},
  env = process.env,
  config = {},
} = {}) {
  if (options.baseUrl) return options.baseUrl;
  if (env.CC_HUB_OLLAMA_URL && env.CC_HUB_OLLAMA_URL.trim()) {
    return env.CC_HUB_OLLAMA_URL.trim();
  }
  if (options.preferAndroidLocal === true) return ANDROID_LOCAL_OLLAMA_URL;
  if (config.llm && config.llm.preferAndroidLocal === true) {
    return ANDROID_LOCAL_OLLAMA_URL;
  }
  if (config.llm && config.llm.baseUrl) return config.llm.baseUrl;
  return "http://localhost:11434";
}

/**
 * Send a single question to an LLM provider.
 * @param {string} question
 * @param {object} options
 * @returns {Promise<string>}
 */
async function queryLLM(question, options = {}) {
  const provider = options.provider || "ollama";
  const model = options.model || "qwen2:7b";

  if (provider === "ollama") {
    const baseUrl = options.baseUrl || "http://localhost:11434";
    // Use /api/chat (modern Ollama API + only endpoint Android LocalLlmServer
    // implements). Non-streaming mode keeps the response shape simple.
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: question }],
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    // Android LocalLlmServer returns {error} on inference failure with HTTP 200
    // (mirroring Ollama convention). Surface it explicitly.
    if (data.error) {
      throw new Error(`Ollama backend error: ${data.error}`);
    }
    return data.message?.content ?? "";
  }

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
  if (!apiKey) {
    throw new Error(
      `API key required for ${provider} (--api-key or ${providerDef.apiKeyEnv})`,
    );
  }

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
    .option(
      "--prefer-android-local",
      "Route ollama provider at the Android in-APK LocalLlmServer (127.0.0.1:18484). One-shot equivalent of `cc config set llm.preferAndroidLocal true`.",
    )
    .option("--json", "Output as JSON")
    .action(async (question, options) => {
      const config = loadConfig();
      const provider = options.provider || config.llm?.provider || "ollama";
      const resolvedOptions = {
        model: options.model || config.llm?.model || "qwen2:7b",
        provider,
        apiKey: options.apiKey || config.llm?.apiKey,
      };
      // baseUrl resolution only applies the Android-local override path for
      // provider=ollama (LocalLlmServer is Ollama-compat). For other providers
      // we use the existing precedence: --base-url > config.llm.baseUrl >
      // provider default.
      if (provider === "ollama") {
        resolvedOptions.baseUrl = resolveOllamaBaseUrl({
          options,
          env: process.env,
          config,
        });
      } else {
        resolvedOptions.baseUrl = options.baseUrl || config.llm?.baseUrl;
      }

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
                model: resolvedOptions.model,
                provider: resolvedOptions.provider,
                baseUrl: resolvedOptions.baseUrl,
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
