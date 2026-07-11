/**
 * Plugin / LSP quality board (gap #11) — pure logic for the "Quality" section
 * of the Plugins & MCP manager panel. Combines three CLI surfaces:
 *
 *   cc plugin installed --json        → [{name, version, scope, dir, ok}]
 *   cc plugin validate <dir> --json   → {ok, errors, warnings, components,
 *                                        componentCounts:{skills,agents,hooks,
 *                                        mcp,lsp,monitors,bin,settings}, …}
 *   cc code-intel status --json       → {servers:[{languageId,id,available,
 *                                        command}], extensions:[…]}
 *
 * into per-plugin quality rows: contributed component counts by type + flags:
 *   broken          validate reported errors / invalid manifest
 *   lsp             'none' | 'ok' | 'unavailable' | 'unknown' — derived from
 *                   the live `code-intel status` probe; when the probe result
 *                   can't be matched to the plugin's declared server (plugin
 *                   untrusted → not registered, or status unreadable) we say
 *                   "unknown" instead of fabricating a verdict.
 *   unused          contributes NOTHING (every component count is zero). A
 *                   plugin that only ships an LSP server is NOT unused.
 *
 * There is deliberately NO `slow` flag: the CLI plugin runtime records no
 * load/exec timing today, and we don't fake metrics we don't have.
 *
 * Pure Node (no `vscode`) → unit-testable; the webview glue lives in
 * ui/plugin-manager-view.js. All strings that reach HTML go through
 * escapeHtml — names/errors come from user-authored manifests.
 */

/** Component types `plugin validate --json` counts (manifest.js summarizeComponents). */
const COMPONENT_TYPES = [
  "skills",
  "agents",
  "hooks",
  "mcp",
  "lsp",
  "monitors",
  "bin",
  "settings",
];

function buildPluginValidateArgs(dir) {
  return ["plugin", "validate", String(dir), "--json"];
}

function buildCodeIntelStatusArgs() {
  return ["code-intel", "status", "--json"];
}

function parseObject(text) {
  try {
    const parsed = JSON.parse(String(text || "").trim());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * `plugin validate <dir> --json` → {ok, errors, warnings, counts, lsp};
 * null = unreadable. The command prints the JSON even for an INVALID manifest
 * (it only sets the exit code), so null really means "no usable output".
 */
function parsePluginValidate(text) {
  const parsed = parseObject(text);
  if (!parsed) return null;
  const rawCounts =
    parsed.componentCounts && typeof parsed.componentCounts === "object"
      ? parsed.componentCounts
      : {};
  const counts = {};
  for (const t of COMPONENT_TYPES) {
    const n = Number(rawCounts[t]);
    counts[t] = Number.isFinite(n) && n > 0 ? n : 0;
  }
  const strList = (v) =>
    Array.isArray(v) ? v.map((e) => String(e)).filter(Boolean) : [];
  const lspRaw = parsed.components && parsed.components.lsp;
  const lsp = (Array.isArray(lspRaw) ? lspRaw : [])
    .filter((s) => s && typeof s.languageId === "string")
    .map((s) => ({
      languageId: s.languageId,
      id: String(s.id || s.command || ""),
    }));
  return {
    ok: parsed.ok === true,
    errors: strList(parsed.errors),
    warnings: strList(parsed.warnings),
    counts,
    lsp,
  };
}

/** `code-intel status --json` → [{languageId, id, available}]; null = unreadable. */
function parseCodeIntelStatus(text) {
  const parsed = parseObject(text);
  if (!parsed || !Array.isArray(parsed.servers)) return null;
  return parsed.servers
    .filter((s) => s && typeof s.languageId === "string")
    .map((s) => ({
      languageId: s.languageId,
      id: String(s.id || ""),
      available: s.available === true,
    }));
}

/**
 * Derive a plugin's LSP availability from the live `code-intel status` probe.
 *
 *  'none'        the plugin declares no LSP servers
 *  'unknown'     no live status data, OR the status row for that languageId
 *                belongs to a DIFFERENT server (the plugin is untrusted/not
 *                registered, so its own binary was never probed) — we do not
 *                fabricate a verdict from someone else's probe
 *  'unavailable' the plugin's own registered server did not resolve a binary
 *  'ok'          every declared server resolved
 */
function deriveLspAvailability(lspEntries, statusServers) {
  const entries = Array.isArray(lspEntries) ? lspEntries : [];
  if (!entries.length) return "none";
  if (!Array.isArray(statusServers)) return "unknown";
  let sawUnknown = false;
  for (const e of entries) {
    const row = statusServers.find((s) => s.languageId === e.languageId);
    if (!row || (e.id && row.id !== e.id)) {
      sawUnknown = true;
      continue;
    }
    if (!row.available) return "unavailable";
  }
  return sawUnknown ? "unknown" : "ok";
}

/**
 * Build quality rows from the three sources.
 *
 * @param {{
 *   plugins: Array<{name,version,scope,dir,ok}>|null,  // parsePluginInstalled
 *   validations?: Object<string, {failed?:boolean,message?:string}|
 *                                ReturnType<parsePluginValidate>>, // by name
 *   lspStatus?: Array|null,                            // parseCodeIntelStatus
 * }} sources
 * @returns {Array|null} rows; null when the plugin list itself was unreadable.
 *
 * Row: {name, version, scope, counts|null, broken:true|false|null,
 *       brokenReasons:string[], lsp:'none'|'ok'|'unavailable'|'unknown',
 *       unused:true|false|null, validateFailed, validateMessage}
 * `null` flag values mean "validate output unavailable — unknown", never a
 * fabricated verdict.
 */
function buildQualityRows({ plugins, validations = {}, lspStatus = null } = {}) {
  if (!Array.isArray(plugins)) return null;
  return plugins.map((p) => {
    const v = validations ? validations[p.name] : null;
    const failed = !v || v.failed === true || !v.counts;
    if (failed) {
      return {
        name: p.name,
        version: p.version || "",
        scope: p.scope || "user",
        counts: null,
        broken: p.ok === false ? true : null,
        brokenReasons: [],
        lsp: "unknown",
        unused: null,
        validateFailed: true,
        validateMessage:
          (v && v.message) || "plugin validate produced no output",
      };
    }
    const broken = v.ok === false || v.errors.length > 0 || p.ok === false;
    return {
      name: p.name,
      version: p.version || "",
      scope: p.scope || "user",
      counts: v.counts,
      broken,
      brokenReasons: v.errors.slice(0, 5),
      lsp: deriveLspAvailability(v.lsp, lspStatus),
      unused: COMPONENT_TYPES.every((t) => !v.counts[t]),
      validateFailed: false,
      validateMessage: "",
    };
  });
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

/** "skills 2 · lsp 1" — only the non-zero component types. */
function formatCounts(counts) {
  if (!counts) return "";
  return COMPONENT_TYPES.filter((t) => counts[t] > 0)
    .map((t) => `${t} ${counts[t]}`)
    .join(" · ");
}

/**
 * Quality-section HTML fragment (server-rendered, fully escaped) for the
 * plugin manager webview. Reuses the panel's existing CSS classes
 * (ok/bad/muted/pill/err/warnflag).
 */
function renderQualityHtml(rows, { lspStatusAvailable = true } = {}) {
  const parts = [];
  if (!lspStatusAvailable) {
    parts.push(
      '<p class="warnflag">⚠ `cc code-intel status` unavailable — LSP availability shown as unknown.</p>',
    );
  }
  if (rows === null) {
    parts.push(
      '<p class="err">could not read plugins (is cc installed?)</p>',
    );
    return parts.join("");
  }
  if (!rows.length) {
    parts.push('<p class="muted">No runtime plugins installed.</p>');
    return parts.join("");
  }
  const lspBadge = {
    ok: '<span class="pill ok">lsp ok</span>',
    unavailable: '<span class="pill bad">lsp unavailable</span>',
    unknown: '<span class="pill muted">lsp unknown</span>',
    none: "",
  };
  const body = rows
    .map((r) => {
      const flags = [];
      if (r.broken === true) {
        flags.push(
          `<span class="pill bad" title="${escapeHtml(r.brokenReasons.join("; "))}">✖ broken</span>`,
        );
      } else if (r.broken === null) {
        flags.push('<span class="pill muted">validity unknown</span>');
      }
      flags.push(lspBadge[r.lsp] || "");
      if (r.unused === true) {
        flags.push(
          '<span class="pill warnflag" title="contributes no skills/agents/hooks/mcp/monitors/bin/settings and no lsp">unused</span>',
        );
      }
      const components = r.validateFailed
        ? `<span class="muted">validate failed: ${escapeHtml(r.validateMessage)}</span>`
        : escapeHtml(formatCounts(r.counts)) ||
          '<span class="muted">(none)</span>';
      return (
        `<tr><td>${escapeHtml(r.name)} <span class="muted">v${escapeHtml(r.version)}</span></td>` +
        `<td><span class="pill">${escapeHtml(r.scope)}</span></td>` +
        `<td>${components}</td>` +
        `<td>${flags.filter(Boolean).join(" ")}</td></tr>`
      );
    })
    .join("");
  parts.push(
    '<table><thead><tr><th>plugin</th><th>scope</th><th>components</th><th style="width:260px">flags</th></tr></thead><tbody>' +
      body +
      "</tbody></table>",
  );
  return parts.join("");
}

module.exports = {
  COMPONENT_TYPES,
  buildPluginValidateArgs,
  buildCodeIntelStatusArgs,
  parsePluginValidate,
  parseCodeIntelStatus,
  deriveLspAvailability,
  buildQualityRows,
  formatCounts,
  escapeHtml,
  renderQualityHtml,
};
