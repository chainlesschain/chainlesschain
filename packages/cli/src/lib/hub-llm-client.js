/**
 * hub-llm-client — build a hub LLMClient from the user's cc config / env so
 * standalone `cc hub ask` can use a configured CLOUD provider instead of the
 * Ollama-only default.
 *
 * Why this exists: the standalone CLI hub (personal-data-hub-wiring.js
 * `initHub`) hard-binds OllamaClient unless a caller injects an override.
 * Only the desktop web-shell does that (CcLLMAdapter wrapping LLMManager), so
 * a machine without Ollama installed can't run `cc hub ask` at all — the RAG
 * retrieval works but the final LLM call fails. This adapter gives the CLI the
 * same "honor the user's active provider" behavior the desktop has.
 *
 * Privacy: OPT-IN ONLY via env `CC_HUB_LLM`. When unset, this returns null and
 * the caller keeps the safe local-Ollama default (the §11.2 privacy promise:
 * personal data stays on-device unless the user explicitly opts in). The
 * client always reports `isLocal: false`, so the AnalysisEngine still refuses
 * to USE it unless the `ask` command is given `--accept-non-local`
 * (or env `CC_HUB_ALLOW_NON_LOCAL`). Two independent gates: this one chooses
 * the backend, that one authorizes sending data off-device.
 *
 *   CC_HUB_LLM unset / ollama / local / off / 0  -> null (local Ollama default)
 *   CC_HUB_LLM = config | auto | on | 1          -> config.llm.{provider,model,baseUrl,apiKey}
 *   CC_HUB_LLM = <provider>                       -> that provider; reuse config
 *                                                    creds when config.llm.provider
 *                                                    matches, else provider default
 *                                                    baseUrl + key from env/config
 *
 * Returns null (→ caller falls back to OllamaClient) when it can't build a
 * usable cloud client: provider resolves to ollama, or a cloud provider has no
 * API key. Never throws at build time — a bad CC_HUB_LLM just keeps the local
 * default rather than bricking `cc hub`.
 *
 * Contract (mirrors pdh OllamaClient): `{ name, isLocal, chat(messages, opts)
 * -> { text, usage?, model? } }`. messages = [{ role, content }] (the hub
 * stitches system + user-with-facts and hands them off opaque).
 */

"use strict";

import { BUILT_IN_PROVIDERS } from "./llm-providers.js";

const LOCAL_SENTINELS = new Set([
  "",
  "ollama",
  "local",
  "off",
  "0",
  "false",
  "no",
]);
const CONFIG_SENTINELS = new Set(["config", "auto", "on", "1", "true", "yes"]);

/**
 * @param {{config?: object, env?: object}} [args]
 * @returns {{name:string,isLocal:boolean,chat:Function}|null}
 */
export function buildCliHubLLM({ config = {}, env = process.env } = {}) {
  const raw = String(env.CC_HUB_LLM || "")
    .trim()
    .toLowerCase();
  if (LOCAL_SENTINELS.has(raw)) return null;

  const cfgLlm = (config && config.llm) || {};
  let provider, model, baseUrl, apiKey;

  if (CONFIG_SENTINELS.has(raw)) {
    provider = String(cfgLlm.provider || "").toLowerCase();
    model = cfgLlm.model;
    baseUrl = cfgLlm.baseUrl;
    apiKey = cfgLlm.apiKey;
  } else {
    provider = raw;
    // Reuse the saved credentials only when they belong to the requested
    // provider; otherwise fall back to provider defaults + env key.
    const sameProvider =
      String(cfgLlm.provider || "").toLowerCase() === provider;
    model = sameProvider ? cfgLlm.model : null;
    baseUrl = sameProvider ? cfgLlm.baseUrl : null;
    apiKey = sameProvider ? cfgLlm.apiKey : null;
  }

  if (!provider || provider === "ollama") return null;

  const def = BUILT_IN_PROVIDERS[provider] || null;
  const resolvedBase = baseUrl || (def && def.baseUrl) || null;
  const resolvedModel = model || (def && def.models && def.models[0]) || null;
  const resolvedKey =
    apiKey || (def && def.apiKeyEnv ? env[def.apiKeyEnv] : null) || null;

  if (!resolvedBase || !resolvedModel) return null;
  if (!resolvedKey) return null; // every supported cloud provider needs a key

  const isAnthropic = provider === "anthropic";
  return {
    name: `${provider}:${resolvedModel}`,
    isLocal: false,
    async chat(messages, opts = {}) {
      if (isAnthropic) {
        return anthropicChat({
          base: resolvedBase,
          key: resolvedKey,
          model: resolvedModel,
          messages,
          opts,
        });
      }
      return openAiCompatChat({
        base: resolvedBase,
        key: resolvedKey,
        model: resolvedModel,
        messages,
        opts,
      });
    },
  };
}

function trimBase(base) {
  return String(base).replace(/\/+$/, "");
}

function normUsage(u) {
  if (!u) return undefined;
  return {
    promptTokens: u.prompt_tokens ?? u.promptTokens,
    completionTokens: u.completion_tokens ?? u.completionTokens,
    totalTokens: u.total_tokens ?? u.totalTokens,
  };
}

/**
 * OpenAI-compatible /chat/completions (openai, volcengine, deepseek,
 * dashscope, mistral, gemini-compat, and any custom baseUrl that speaks it).
 */
export async function openAiCompatChat({
  base,
  key,
  model,
  messages,
  opts = {},
  fetchImpl = fetch,
}) {
  const body = { model, messages };
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  const maxTokens = opts.maxTokens ?? opts.max_tokens;
  if (Number.isFinite(maxTokens)) body.max_tokens = maxTokens;

  const resp = await fetchImpl(`${trimBase(base)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(
      `hub LLM (${model}): HTTP ${resp.status} ${resp.statusText} ${t.slice(0, 300)}`.trim(),
    );
  }
  const data = await resp.json();
  if (data && data.error) {
    const m = data.error.message || JSON.stringify(data.error);
    throw new Error(`hub LLM (${model}): ${m}`);
  }
  const msg =
    data && data.choices && data.choices[0] && data.choices[0].message;
  // Some providers (doubao reasoning models) put the answer in `content`;
  // fall back to `reasoning_content` only if content is empty.
  const text = (msg && (msg.content || msg.reasoning_content)) || "";
  return {
    text,
    model: (data && data.model) || model,
    usage: normUsage(data && data.usage),
  };
}

/**
 * Anthropic native /v1/messages — system extracted from the messages array,
 * which Anthropic takes as a top-level `system` field.
 */
export async function anthropicChat({
  base,
  key,
  model,
  messages,
  opts = {},
  fetchImpl = fetch,
}) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

  const body = {
    model,
    messages: turns,
    max_tokens: Number.isFinite(opts.maxTokens ?? opts.max_tokens)
      ? (opts.maxTokens ?? opts.max_tokens)
      : 2048,
  };
  if (system) body.system = system;
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;

  const resp = await fetchImpl(`${trimBase(base)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(
      `hub LLM (${model}): HTTP ${resp.status} ${resp.statusText} ${t.slice(0, 300)}`.trim(),
    );
  }
  const data = await resp.json();
  if (data && data.error) {
    const m = data.error.message || JSON.stringify(data.error);
    throw new Error(`hub LLM (${model}): ${m}`);
  }
  const text = ((data && data.content) || [])
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("");
  const u = data && data.usage;
  return {
    text,
    model: (data && data.model) || model,
    usage: u
      ? {
          promptTokens: u.input_tokens,
          completionTokens: u.output_tokens,
          totalTokens: (u.input_tokens || 0) + (u.output_tokens || 0),
        }
      : undefined,
  };
}
