/**
 * `/config` REPL command (Claude-Code parity) — show the effective
 * configuration in a readable, SECRET-SAFE form: the LLM provider/model/baseURL
 * actually in effect, whether an API key is set (never the key itself), the
 * web-search backend, and the config-file path. Also surfaces the session's
 * active provider/model, which can differ from the file (a --provider flag or
 * .claude/settings.json overrides it).
 *
 * Pure: takes the loaded config + context, returns plain text. The REPL does
 * the I/O. NEVER prints a secret — only "set (…1234)" / "not set".
 */

/** Mask a secret: presence + last 4 chars only, or "not set". */
export function maskSecret(v) {
  if (v == null || v === "") return "not set";
  const s = String(v);
  return s.length <= 4 ? "set (hidden)" : `set (…${s.slice(-4)})`;
}

/**
 * A config key whose value must never be echoed in plaintext in the
 * (shoulder-surfable) interactive REPL — apiKey / secret / token / password.
 * Matched on the last dotted segment (e.g. `llm.apiKey`, `webSearch.apiKey`).
 */
const SECRET_KEY_RE = /(api[_-]?key|secret|token|password|passwd)$/i;
export function isSecretConfigKey(key) {
  if (!key) return false;
  const last = String(key).split(".").pop();
  return SECRET_KEY_RE.test(last);
}

/**
 * Parse the argument string after `/config` into an action.
 * Mirrors Claude Code's `/config key=value` syntax, and also accepts the
 * `/config key value` form. Returns one of:
 *   { action: "show" }                       // `/config`
 *   { action: "get", key }                   // `/config llm.model`
 *   { action: "set", key, value }            // `/config llm.model=opus` | `/config llm.model opus`
 *   { action: "error", message }
 * `value` is the raw string; the caller coerces (true/false/null/number) via
 * config-manager's setConfigValue.
 *
 * @param {string} argStr  everything after the literal `/config`
 */
export function parseConfigCommand(argStr) {
  const s = (argStr || "").trim();
  if (s === "") return { action: "show" };

  const eq = s.indexOf("=");
  if (eq !== -1) {
    const key = s.slice(0, eq).trim();
    const value = s.slice(eq + 1).trim();
    if (!key) return { action: "error", message: "missing key before '='" };
    return { action: "set", key, value };
  }

  // `key value` — split on the first run of whitespace.
  const m = s.match(/^(\S+)\s+([\s\S]+)$/);
  if (m) return { action: "set", key: m[1], value: m[2].trim() };

  // Bare token → read that key.
  return { action: "get", key: s };
}

/** Render a single config value for `/config <key>`, masking secrets. */
export function renderConfigGet(key, value) {
  if (value === undefined) return `${key} = (unset)`;
  if (isSecretConfigKey(key)) return `${key} = ${maskSecret(value)}`;
  const shown =
    value !== null && typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return `${key} = ${shown}`;
}

/** Render the confirmation line after `/config <key>=<value>`. */
export function renderConfigSet(key, storedValue) {
  if (isSecretConfigKey(key)) return `set ${key} = ${maskSecret(storedValue)}`;
  const shown =
    storedValue !== null && typeof storedValue === "object"
      ? JSON.stringify(storedValue)
      : String(storedValue);
  return `set ${key} = ${shown}`;
}

/**
 * @param {object|null} config  loaded config.json
 * @param {object} [opts]  { path, activeProvider, activeModel }
 * @returns {string}
 */
export function renderConfigSummary(config, opts = {}) {
  const cfg = config || {};
  const llm = cfg.llm || {};
  const lines = ["Effective configuration:"];
  if (opts.path) lines.push(`  config file: ${opts.path}`);

  lines.push("  llm:");
  lines.push(`    provider: ${llm.provider || "(unset → defaults to ollama)"}`);
  lines.push(`    model:    ${llm.model || "(unset)"}`);
  if (llm.visionModel) lines.push(`    vision:   ${llm.visionModel}`);
  if (llm.baseUrl) lines.push(`    baseUrl:  ${llm.baseUrl}`);
  lines.push(`    apiKey:   ${maskSecret(llm.apiKey)}`);

  const ws = cfg.webSearch || {};
  if (ws.provider || ws.apiKey) {
    lines.push("  webSearch:");
    lines.push(`    provider: ${ws.provider || "(unset → auto)"}`);
    lines.push(`    apiKey:   ${maskSecret(ws.apiKey)}`);
  }

  if (opts.activeProvider || opts.activeModel) {
    const ap = opts.activeProvider || "?";
    const am = opts.activeModel || "?";
    const differs = !!llm.provider && (ap !== llm.provider || am !== llm.model);
    lines.push(
      `  active this session: ${ap} · ${am}` +
        (differs ? "  (overrides config)" : ""),
    );
  }

  lines.push(
    "  note: keys are hidden; env vars (e.g. *_API_KEY) can override config at runtime.",
  );
  return lines.join("\n");
}
