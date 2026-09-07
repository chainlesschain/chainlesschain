import { BUILT_IN_PROVIDERS } from "./llm-providers.js";
import {
  setSecretConfigValue,
  updateConfigAtomically,
} from "./config-manager.js";

export function normalizeLlmConnection(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) =>
        ![
          "provider",
          "model",
          "baseUrl",
          "visionModel",
          "apiKey",
          "allowHttp",
        ].includes(k),
    )
  )
    throw new Error("Invalid LLM connection fields");
  const value = {};
  for (const key of ["provider", "model", "baseUrl", "visionModel", "apiKey"]) {
    if (input[key] != null && typeof input[key] !== "string")
      throw new Error(`Invalid ${key}`);
    value[key] = (input[key] || "").trim();
    if (value[key].length > (key === "apiKey" ? 8192 : 2048))
      throw new Error(`${key} is too long`);
  }
  if (!Object.hasOwn(BUILT_IN_PROVIDERS, value.provider))
    throw new Error("Choose a supported provider/protocol");
  if (!value.model || /[\r\n\0]/.test(value.model + value.visionModel))
    throw new Error("A valid model name is required");
  let url;
  try {
    url = new URL(value.baseUrl);
  } catch {
    throw new Error("Invalid LLM Base URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Base URL must be HTTP(S), without credentials, query or fragment",
    );
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    input.allowHttp !== true
  )
    throw new Error("Confirm unencrypted HTTP before using a remote endpoint");
  if (
    /\/(chat\/completions|messages|responses|api\/generate)\/?$/.test(
      url.pathname,
    )
  )
    throw new Error(
      "Use the API base path, not a completion/messages endpoint",
    );
  value.baseUrl = url.href.replace(/\/+$/, "");
  return value;
}

export function saveLlmConnection(input, { storage = "auto" } = {}) {
  if (!["auto", "keychain", "file"].includes(storage))
    throw new Error("Secret storage must be auto, keychain, or file");
  const value = normalizeLlmConnection(input);
  const mutate = (config) => {
    const current = config.llm || {};
    const sameEndpoint =
      current.provider === value.provider &&
      String(
        current.baseUrl || BUILT_IN_PROVIDERS[current.provider]?.baseUrl || "",
      ).replace(/\/+$/, "") === value.baseUrl;
    if (
      value.provider !== "ollama" &&
      !value.apiKey &&
      (!sameEndpoint || !current.apiKey)
    )
      throw new Error(
        "A new endpoint requires its own API key; the existing key was not reused",
      );
    config.llm = {
      ...current,
      provider: value.provider,
      model: value.model,
      baseUrl: value.baseUrl,
      visionModel: value.visionModel || null,
    };
  };
  // A single lock and atomic rename bind endpoint and credential together.
  // An interrupted save cannot route the old credential to the new endpoint.
  if (value.apiKey)
    setSecretConfigValue("llm.apiKey", value.apiKey, {
      storage,
      configMutator: mutate,
    });
  else updateConfigAtomically(mutate);
  return {
    provider: value.provider,
    model: value.model,
    baseUrl: value.baseUrl,
    visionModel: value.visionModel || null,
  };
}

export async function readLlmConnectionInput(stream = process.stdin) {
  if (stream.isTTY)
    throw new Error("Send the LLM configuration JSON through stdin");
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32768) throw new Error("LLM configuration input is too large");
    chunks.push(buffer);
  }
  const input = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(input);
  } catch {
    throw new Error("LLM configuration input must be valid JSON");
  }
}
