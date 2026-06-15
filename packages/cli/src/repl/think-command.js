/**
 * Pure parser for the REPL `/think` · `/ultrathink` extended-thinking toggle.
 * Maps the slash-command string to the next `thinking` value the agent loop
 * reads (true | "ultra" | <level> | null) plus a human label. Returns null when
 * the input is not a think command, so the REPL falls through to its other
 * handlers. vscode/readline-free → unit-testable (mirrors the chat panel's
 * /think; extended thinking is Anthropic-only, ignored by other providers).
 *
 *   /think            → on (default budget)      /think off  → off
 *   /think ultra      → max budget               /think <level> → that level
 *   /think-off        → off (panel-style alias)
 *   /ultrathink       → max budget (alias)
 */
export function parseThinkCommand(trimmed) {
  const t = String(trimmed == null ? "" : trimmed).trim();
  const isThink =
    t === "/think" || t.startsWith("/think ") || t.startsWith("/think-");
  const isUltra = t === "/ultrathink" || t.startsWith("/ultrathink ");
  if (!isThink && !isUltra) return null;

  const arg = isUltra
    ? "ultra"
    : t.slice(6).replace(/^-+/, "").trim().toLowerCase();

  if (arg === "ultra") {
    return { thinking: "ultra", label: "ultra (max budget)", anthropic: true };
  }
  if (arg === "off" || arg === "false" || arg === "0" || arg === "none") {
    return { thinking: null, label: "off", anthropic: false };
  }
  if (!arg || arg === "on" || arg === "true") {
    return { thinking: true, label: "on", anthropic: true };
  }
  // An explicit effort level (low/medium/high/…) — passed through to the engine.
  return { thinking: arg, label: arg, anthropic: true };
}
