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
