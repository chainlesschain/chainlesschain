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
 * Privacy: OPT-IN ONLY. The backend is selected by env `CC_HUB_LLM` (ephemeral,
 * per-invocation) OR persistent config `hub.llm` (set once via
 * `cc config set hub.llm config`). When BOTH are unset this returns null and
 * the caller keeps the safe local-Ollama default (the §11.2 privacy promise:
 * personal data stays on-device unless the user explicitly opts in). The
 * client always reports `isLocal: false`, so the AnalysisEngine still refuses
 * to USE it unless the `ask` command authorizes egress — via --accept-non-local,
 * env `CC_HUB_ALLOW_NON_LOCAL`, or (for a PERSISTENT cloud backend) the standing
 * consent implied by `hub.llm` being set in config (see `isCloudHubConfigured`).
 * Two independent gates: this one chooses the backend, that one authorizes
 * sending data off-device.
 *
 *   value unset / ollama / local / off / 0  -> null (local Ollama default)
 *   value = config | auto | on | 1          -> config.llm.{provider,model,baseUrl,apiKey}
 *   value = <provider>                       -> that provider; reuse config
 *                                              creds when config.llm.provider
 *                                              matches, else provider default
 *                                              baseUrl + key from env/config
 * where `value` = env CC_HUB_LLM (wins) || config.hub.llm.
 *
 * Returns null (→ caller falls back to OllamaClient) when it can't build a
 * usable cloud client: backend resolves to ollama, or a cloud provider has no
 * API key. Never throws at build time — a bad value just keeps the local
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
 * Resolve the hub-LLM "spec" — what backend the user selected and how.
 * env `CC_HUB_LLM` (ephemeral) wins over persistent config `hub.llm`.
 *   - `hub.llm` as a STRING  → "config" | "<provider>" (creds reuse config.llm/env)
 *   - `hub.llm` as an OBJECT → { provider, model, baseUrl, apiKey, apiKeyEnv }
 *     (self-contained; lets the hub use a DIFFERENT key/account than cc-wide llm)
 * @returns {{kind:"string"|"object", value:any, source:"env"|"config"}|null}
 */
export function resolveHubSpec(config = {}, env = process.env) {
  const envVal = String((env && env.CC_HUB_LLM) || "").trim();
  if (envVal)
    return { kind: "string", value: envVal.toLowerCase(), source: "env" };
  const h = config && config.hub && config.hub.llm;
  if (h == null) return null;
  if (typeof h === "object") {
    return { kind: "object", value: h, source: "config" };
  }
  const s = String(h).trim();
  if (!s) return null;
  return { kind: "string", value: s.toLowerCase(), source: "config" };
}

/**
 * @param {{config?: object, env?: object}} [args]
 * @returns {{name:string,isLocal:boolean,chat:Function}|null}
 */
export function buildCliHubLLM({ config = {}, env = process.env } = {}) {
  const spec = resolveHubSpec(config, env);
  if (!spec) return null;

  const cfgLlm = (config && config.llm) || {};
  const sameAs = (p) => String(cfgLlm.provider || "").toLowerCase() === p;
  let provider, model, baseUrl, apiKey;

  if (spec.kind === "object") {
    // Self-contained hub creds — key can come from an explicit apiKey, a named
    // env var (apiKeyEnv → switch where the key is read from), or fall back to
    // the cc-wide config.llm creds when the provider matches.
    const o = spec.value || {};
    provider = String(o.provider || cfgLlm.provider || "").toLowerCase();
    apiKey =
      o.apiKey ||
      (o.apiKeyEnv ? env[o.apiKeyEnv] : null) ||
      (sameAs(provider) ? cfgLlm.apiKey : null);
    model = o.model || (sameAs(provider) ? cfgLlm.model : null);
    baseUrl = o.baseUrl || (sameAs(provider) ? cfgLlm.baseUrl : null);
  } else {
    const raw = spec.value;
    if (LOCAL_SENTINELS.has(raw)) return null;
    if (CONFIG_SENTINELS.has(raw)) {
      provider = String(cfgLlm.provider || "").toLowerCase();
      model = cfgLlm.model;
      baseUrl = cfgLlm.baseUrl;
      apiKey = cfgLlm.apiKey;
    } else {
      provider = raw;
      // Reuse the saved credentials only when they belong to the requested
      // provider; otherwise fall back to provider defaults + env key.
      model = sameAs(provider) ? cfgLlm.model : null;
      baseUrl = sameAs(provider) ? cfgLlm.baseUrl : null;
      apiKey = sameAs(provider) ? cfgLlm.apiKey : null;
    }
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

/**
 * True when a PERSISTENT config (`hub.llm`, NOT the ephemeral env var) selects
 * a usable non-local cloud backend. The `ask` command uses this as standing
 * consent to send data off-device — a deliberate `cc config set hub.llm …` is
 * the informed opt-in, so the user need not also pass --accept-non-local on
 * every call. The ephemeral env path (CC_HUB_LLM) is deliberately NOT covered:
 * a one-off backend override still requires an explicit egress flag.
 * @returns {boolean}
 */
export function isCloudHubConfigured(config = {}) {
  const h = config && config.hub && config.hub.llm;
  if (h == null) return false;
  // Resolve config-only (env stripped) and confirm it builds a non-local client.
  const llm = buildCliHubLLM({ config, env: {} });
  return !!(llm && llm.isLocal === false);
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
