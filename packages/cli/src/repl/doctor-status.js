/**
 * `/doctor` REPL command (Claude-Code parity) — a consolidated session-health
 * readout. Where /config, /ide, /mcp, /permissions each show one subsystem,
 * /doctor rolls them into a single pass/warn view and flags the common reasons
 * a chat silently fails (no provider, provider set but no key, …).
 *
 * Pure and dependency-free: `buildDoctorChecks` turns already-resolved session
 * state into a check list, `renderDoctor` formats it. The REPL gathers inputs.
 */

/** Providers whose models run locally and need no API key. */
const FREE_PROVIDERS = ["ollama", "local", "llamacpp", "mediapipe"];

/**
 * @param {object} input
 *   { config, ideTools?: string[], mcpServers?: Array, permissionRules?, settingsHooks? }
 * @returns {Array<{level:'ok'|'warn'|'info'|'err', name:string, detail:string}>}
 */
export function buildDoctorChecks(input = {}) {
  const { config, ideTools, mcpServers, permissionRules, settingsHooks } =
    input;
  const llm = (config && config.llm) || {};
  const checks = [];

  // LLM provider / model
  if (!llm.provider) {
    checks.push({
      level: "warn",
      name: "LLM provider",
      detail:
        "unset → defaults to ollama (local); set llm.provider or --provider",
    });
  } else {
    checks.push({
      level: "ok",
      name: "LLM provider",
      detail: `${llm.provider}${llm.model ? " · " + llm.model : " (no model set)"}`,
    });
  }

  // API key for non-local providers
  if (
    llm.provider &&
    !FREE_PROVIDERS.includes(String(llm.provider).toLowerCase()) &&
    !llm.apiKey
  ) {
    checks.push({
      level: "warn",
      name: "API key",
      detail: `${llm.provider} has no apiKey set (config llm.apiKey or a *_API_KEY env var)`,
    });
  }

  // IDE bridge
  const ideCount = Array.isArray(ideTools) ? ideTools.length : 0;
  checks.push(
    ideCount > 0
      ? {
          level: "ok",
          name: "IDE bridge",
          detail: `${ideCount} tools connected`,
        }
      : { level: "info", name: "IDE bridge", detail: "not connected" },
  );

  // MCP servers
  const mcpCount = Array.isArray(mcpServers) ? mcpServers.length : 0;
  checks.push(
    mcpCount > 0
      ? { level: "ok", name: "MCP servers", detail: `${mcpCount} connected` }
      : { level: "info", name: "MCP servers", detail: "none" },
  );

  // Permission rules
  const ruleCount = permissionRules
    ? (permissionRules.allow?.length || 0) +
      (permissionRules.ask?.length || 0) +
      (permissionRules.deny?.length || 0)
    : 0;
  checks.push({
    level: "info",
    name: "Permission rules",
    detail: ruleCount > 0 ? `${ruleCount} rule(s)` : "none (default gate)",
  });

  // settings.json hooks
  checks.push({
    level: "info",
    name: "settings.json hooks",
    detail: settingsHooks ? "loaded" : "none",
  });

  return checks;
}

const ICON = { ok: "✓", warn: "⚠", err: "✗", info: "·" };

/** Render the check list as a readable health block. */
export function renderDoctor(checks) {
  const list = Array.isArray(checks) ? checks : [];
  const lines = ["Session health (/doctor):"];
  for (const c of list) {
    lines.push(`  ${ICON[c.level] || "·"} ${c.name}: ${c.detail}`);
  }
  const problems = list.filter(
    (c) => c.level === "warn" || c.level === "err",
  ).length;
  lines.push(
    problems === 0
      ? "  no problems detected"
      : `  ${problems} item(s) need attention`,
  );
  return lines.join("\n");
}
