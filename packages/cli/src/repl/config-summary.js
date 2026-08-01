/** Secret-safe rendering and parsing for the interactive `/config` command. */
import {
  isSecretConfigKey,
  redactConfigValue,
} from "../lib/config-redaction.js";

export { isSecretConfigKey } from "../lib/config-redaction.js";

/** Report only presence; never retain a suffix from a credential. */
export function maskSecret(value) {
  return value == null || value === "" ? "not set" : "set (hidden)";
}

export function parseConfigCommand(argStr) {
  const input = (argStr || "").trim();
  if (input === "") return { action: "show" };
  if (/^(--help|-h|help|\?)$/i.test(input)) return { action: "help" };

  const equals = input.indexOf("=");
  if (equals !== -1) {
    const key = input.slice(0, equals).trim();
    const value = input.slice(equals + 1).trim();
    if (!key) return { action: "error", message: "missing key before '='" };
    return { action: "set", key, value };
  }

  const spaced = input.match(/^(\S+)\s+([\s\S]+)$/);
  if (spaced) {
    return { action: "set", key: spaced[1], value: spaced[2].trim() };
  }
  return { action: "get", key: input };
}

export const COMMON_CONFIG_KEYS = Object.freeze([
  ["llm.provider", "LLM provider id"],
  ["llm.model", "default text model id"],
  ["llm.visionModel", "model used for image turns"],
  ["llm.baseUrl", "provider API base URL"],
  ["llm.apiKey", "provider API key (use cc config set-secret)"],
  ["webSearch.provider", "web-search backend"],
  ["webSearch.apiKey", "web-search API key (use cc config set-secret)"],
  ["cli.theme", "REPL color theme (auto | dark | light | mono)"],
]);

export function renderConfigHelp() {
  const lines = [
    "/config — show or edit non-secret configuration:",
    "  /config                 show effective config (secret-safe)",
    "  /config <key>           read a value",
    "  /config <key>=<value>   set a non-secret value",
    "  /config <key> <value>   set a non-secret value",
    "  /config --help          this list",
    "",
    "Common keys:",
  ];
  const width = Math.max(...COMMON_CONFIG_KEYS.map(([key]) => key.length));
  for (const [key, description] of COMMON_CONFIG_KEYS) {
    lines.push(`  ${key.padEnd(width)}  ${description}`);
  }
  lines.push("");
  lines.push(
    "  Unknown keys are rejected; use `cc config set --allow-unknown` only for extension development.",
  );
  lines.push(
    "  Secrets cannot be set here; use the hidden `cc config set-secret <key>` input.",
  );
  return lines.join("\n");
}

export function renderConfigGet(key, value) {
  if (value === undefined) return `${key} = (unset)`;
  if (isSecretConfigKey(key)) return `${key} = ${maskSecret(value)}`;
  const safe = redactConfigValue(key, value);
  const shown =
    safe !== null && typeof safe === "object"
      ? JSON.stringify(safe)
      : String(safe);
  return `${key} = ${shown}`;
}

export function renderConfigSet(key, storedValue) {
  if (isSecretConfigKey(key)) return `set ${key} = ${maskSecret(storedValue)}`;
  const safe = redactConfigValue(key, storedValue);
  const shown =
    safe !== null && typeof safe === "object"
      ? JSON.stringify(safe)
      : String(safe);
  return `set ${key} = ${shown}`;
}

export function renderConfigSummary(config, opts = {}) {
  const cfg = config || {};
  const llm = cfg.llm || {};
  const lines = ["Effective configuration:"];
  if (opts.path) lines.push(`  config file: ${opts.path}`);

  lines.push("  llm:");
  lines.push(`    provider: ${llm.provider || "(unset; defaults to ollama)"}`);
  lines.push(`    model:    ${llm.model || "(unset)"}`);
  if (llm.visionModel) lines.push(`    vision:   ${llm.visionModel}`);
  if (llm.baseUrl)
    lines.push(
      `    baseUrl:  ${redactConfigValue("llm.baseUrl", llm.baseUrl)}`,
    );
  lines.push(`    apiKey:   ${maskSecret(llm.apiKey)}`);

  const webSearch = cfg.webSearch || {};
  if (webSearch.provider || webSearch.apiKey) {
    lines.push("  webSearch:");
    lines.push(`    provider: ${webSearch.provider || "(unset; auto)"}`);
    lines.push(`    apiKey:   ${maskSecret(webSearch.apiKey)}`);
  }

  if (opts.activeProvider || opts.activeModel) {
    const provider = opts.activeProvider || "?";
    const model = opts.activeModel || "?";
    const differs =
      Boolean(llm.provider) &&
      (provider !== llm.provider || model !== llm.model);
    lines.push(
      `  active this session: ${provider} · ${model}${differs ? "  (overrides config)" : ""}`,
    );
  }

  lines.push(
    "  note: secret values are hidden; environment variables can override config at runtime.",
  );
  return lines.join("\n");
}
