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

import { providerFetch } from "../lib/formal-budget-provider-scope.js";
import ora from "ora";
import { randomUUID } from "node:crypto";
import { types as utilTypes } from "node:util";
import { captureAgentEvolutionRuntimeComposition } from "../lib/evolution/agent-evolution-runtime-composition-brand.js";
import { captureAgentEvolutionIngress } from "../lib/evolution/agent-evolution-ingress.js";
import { logger } from "../lib/logger.js";
import { BUILT_IN_PROVIDERS } from "../lib/llm-providers.js";
import { normalizeOllamaBaseUrl } from "../lib/ollama-base-url.js";
import {
  geminiGenerateContentUrl,
  geminiRequestBody,
  geminiResponseText,
  normalizeProviderBaseUrl,
  openAICompatibleBaseUrl,
} from "../lib/provider-protocol.js";
import { loadConfig } from "../lib/config-manager.js";
import { resolveLlmConnection } from "../lib/llm-connection-resolution.js";
import { expandFileRefs } from "../runtime/file-ref-expander.js";

const ANDROID_LOCAL_OLLAMA_URL = "http://127.0.0.1:18484";

/**
 * Expand `@path` file references in the question (Claude-Code parity), unless
 * disabled. Returns the (possibly augmented) prompt plus any warnings for
 * typo'd paths. Exported so the wiring is unit-testable without a live LLM.
 *
 * @param {string} question
 * @param {object} [opts] { cwd, enabled }
 * @returns {{ prompt:string, warnings:string[] }}
 */
export function expandQuestionRefs(
  question,
  { cwd = process.cwd(), enabled = true } = {},
) {
  if (!enabled) return { prompt: question, warnings: [] };
  const { prompt, warnings } = expandFileRefs(question, { cwd });
  return { prompt, warnings };
}

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

export function resolveAskOptions(
  options = {},
  config = {},
  env = process.env,
) {
  const connection = resolveLlmConnection(options, [config.llm || {}], { env });
  const provider = connection.provider;
  const resolved = {
    model: connection.model || (provider === "ollama" ? "qwen2:7b" : null),
    provider,
    apiKey: connection.apiKey,
    baseUrl: connection.baseUrl,
  };
  if (provider === "ollama") {
    resolved.baseUrl = resolveOllamaBaseUrl({
      options,
      env,
      config:
        config.llm?.provider === "ollama" &&
        connection.endpointSources.includes(config.llm)
          ? config
          : {},
    });
  }
  return resolved;
}

/**
 * Send a single question to an LLM provider.
 * @param {string} question
 * @param {object} options
 * @returns {Promise<string>}
 */
/**
 * Pull the assistant message out of an OpenAI-compatible chat-completion
 * response. A 200 reply can still carry an error body or empty `choices`
 * (e.g. content filtering), and `data.choices[0].message.content` then throws
 * a cryptic "Cannot read properties of undefined". Surface a clear error
 * instead. An empty-string completion is valid and returned as-is.
 *
 * @param {object} data    parsed JSON response body
 * @param {string} [provider] for the error message
 * @returns {string}
 */
export function extractCompletion(data, provider = "provider") {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    const apiErr = data?.error?.message || data?.error;
    throw new Error(
      `${provider} returned no completion (unexpected response shape)` +
        (apiErr ? `: ${apiErr}` : ""),
    );
  }
  return content;
}

export async function queryLLM(
  question,
  options = {},
  evolutionIngress = null,
) {
  const provider = options.provider || "ollama";
  const model =
    options.model || BUILT_IN_PROVIDERS[provider]?.models?.[0] || "qwen2:7b";
  const messages = [{ role: "user", content: question }];
  const providerMessages =
    evolutionIngress === null
      ? messages
      : (
          await captureAgentEvolutionIngress(
            evolutionIngress,
          ).prepareModelRequest({
            messages,
            tools: [],
          })
        ).messages;

  // Claude-Code 2.1.183 parity: warn (stderr only, so --json/stdout stays
  // clean) if the requested model is a provider-retired snapshot. Suppressed
  // under vitest so it never pollutes spawned-bin test stderr.
  if (!process.env.VITEST && !process.env.VITEST_WORKER_ID) {
    try {
      const { maybeWarnDeprecatedModel } = await import(
        "../lib/model-deprecation.js"
      );
      maybeWarnDeprecatedModel({ model });
    } catch {
      /* fail-open: a deprecation notice must never affect the query */
    }
  }

  if (provider === "ollama") {
    const baseUrl = normalizeOllamaBaseUrl(options.baseUrl);
    // Use /api/chat (modern Ollama API + only endpoint Android LocalLlmServer
    // implements). Non-streaming mode keeps the response shape simple.
    const response = await providerFetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: providerMessages,
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
  if (provider === "anthropic") {
    const response = await providerFetch(
      `${normalizeProviderBaseUrl(apiBase)}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: providerMessages,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `anthropic error: ${response.status} ${response.statusText}`,
      );
    }
    const data = await response.json();
    return (
      data.content
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("") || ""
    );
  }

  if (provider === "gemini") {
    const response = await providerFetch(
      geminiGenerateContentUrl(apiBase, model),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(geminiRequestBody(providerMessages)),
      },
    );
    if (!response.ok) {
      throw new Error(
        `gemini error: ${response.status} ${response.statusText}`,
      );
    }
    const data = await response.json();
    return geminiResponseText(data);
  }

  const response = await providerFetch(
    `${openAICompatibleBaseUrl(provider, apiBase)}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || providerDef.models[0],
        messages: providerMessages,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `${provider} error: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  return extractCompletion(data, provider);
}

export function registerAskCommand(program, dependencies = {}) {
  if (
    !dependencies ||
    typeof dependencies !== "object" ||
    Array.isArray(dependencies) ||
    utilTypes.isProxy(dependencies)
  ) {
    throw new TypeError("Ask command dependencies must be a plain object");
  }
  const descriptor = Object.getOwnPropertyDescriptor(
    dependencies,
    "evolutionCompositionFactory",
  );
  if (
    descriptor &&
    (!Object.hasOwn(descriptor, "value") ||
      typeof descriptor.value !== "function")
  ) {
    throw new TypeError(
      "Ask evolutionCompositionFactory must be a function data property",
    );
  }
  const evolutionCompositionFactory = descriptor?.value ?? null;
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
    .option(
      "--no-file-refs",
      "Do not expand @path file references in the question",
    )
    .option("--json", "Output as JSON")
    .action(async (question, options) => {
      const config = loadConfig();
      const resolvedOptions = resolveAskOptions(options, config);
      const { provider } = resolvedOptions;
      // baseUrl resolution only applies the Android-local override path for
      // provider=ollama (LocalLlmServer is Ollama-compat). For other providers
      // we use the existing precedence: --base-url > config.llm.baseUrl >
      // provider default.
      // Expand @path references (e.g. `cc ask "summarize @notes.md"`) before
      // sending to the model. The original question is preserved for --json
      // output; only the LLM sees the injected file contents.
      const { prompt: expandedQuestion, warnings } = expandQuestionRefs(
        question,
        { enabled: options.fileRefs !== false },
      );
      for (const w of warnings) {
        process.stderr.write(`[@ref] ${w}\n`);
      }

      const spinner = ora("Thinking...").start();
      try {
        let ingress = null;
        if (evolutionCompositionFactory !== null) {
          const runId = `ask-${randomUUID()}`;
          const composition = captureAgentEvolutionRuntimeComposition(
            await evolutionCompositionFactory(
              Object.freeze({
                mode: "ask",
                runId,
                taskId: runId,
                cwd: process.cwd(),
              }),
            ),
          );
          ingress = composition.evolutionIngress;
          if (
            composition.runId !== runId ||
            ingress.runId !== runId ||
            composition.tenantId !== ingress.tenantId
          ) {
            throw new Error(
              "Ask evolution composition is not bound to the requested Run",
            );
          }
          await ingress.start();
          await ingress.ingestUserPrompt({
            content: expandedQuestion,
            source: "ask",
          });
        }
        const answer = await queryLLM(
          expandedQuestion,
          resolvedOptions,
          ingress,
        );
        if (ingress !== null) {
          await ingress.ingestAgentEvent({
            type: "response-complete",
            content: answer,
          });
          await ingress.complete();
        }

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
