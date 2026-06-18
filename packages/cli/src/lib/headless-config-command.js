/**
 * Headless `/config` directive (Claude-Code 2.1.181 parity — "/config key=value
 * in interactive AND -p modes"). The REPL already handles `/config` for the
 * interactive half; this is the `-p` / piped-stdin half: when the headless
 * prompt is a leading `/config …` slash command, treat it as a one-shot config
 * get / set / show instead of a task for the LLM — no model call, no session,
 * no bootstrap. (`cc config get|set` covers the same ground for pure scripting;
 * this gives the symmetric single-interface form Claude Code exposes.)
 *
 * Pure detection + execution; config-manager does the disk I/O (injected for
 * tests). Secrets stay masked on read and write — the same invariant the REPL
 * `/config` upholds.
 */
import {
  parseConfigCommand,
  renderConfigGet,
  renderConfigSet,
  renderConfigSummary,
} from "../repl/config-summary.js";

/** Does this headless prompt start with the `/config` slash command? */
export function isHeadlessConfigCommand(prompt) {
  return /^\/config(?:\s|$)/.test((prompt || "").trim());
}

/**
 * Execute a `/config …` directive. Returns `{ text, isError }`.
 *
 * @param {string} prompt  the full prompt (leading `/config …`)
 * @param {object} deps
 *   - configManager: { loadConfig, getConfigValue, setConfigValue } (required)
 *   - getConfigPath?: () => string|null  (shown in the `show` summary)
 */
export function runConfigDirective(prompt, deps = {}) {
  const cm = deps.configManager;
  if (!cm) return { text: "/config: no config manager", isError: true };
  const getConfigPath = deps.getConfigPath || (() => null);
  const argStr = (prompt || "").trim().replace(/^\/config\b/, "");
  const cmd = parseConfigCommand(argStr);

  if (cmd.action === "error") {
    return { text: `/config: ${cmd.message}`, isError: true };
  }
  if (cmd.action === "get") {
    return {
      text: renderConfigGet(cmd.key, cm.getConfigValue(cmd.key)),
      isError: false,
    };
  }
  if (cmd.action === "set") {
    cm.setConfigValue(cmd.key, cmd.value);
    return {
      text: renderConfigSet(cmd.key, cm.getConfigValue(cmd.key)),
      isError: false,
    };
  }
  // show
  return {
    text: renderConfigSummary(cm.loadConfig(), { path: getConfigPath() }),
    isError: false,
  };
}
