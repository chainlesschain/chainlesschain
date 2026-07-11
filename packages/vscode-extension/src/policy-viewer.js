/**
 * Permission / policy viewer core (gap #10) — pure logic for the read-only
 * `chainlesschain.policy.show` panel. Joins four CLI surfaces:
 *
 *  - permission rules   `cc permissions list --json`
 *                       → { rules:{allow,ask,deny}, sources{"kind:rule"→file},
 *                           files, managed, managedFile }
 *  - recent denials     `cc permissions recent --json -n 20`
 *                       → { file, count, denials:[{at,tool,summary,via,rule,…}] }
 *  - auto-mode          `cc auto-mode config --json` (effective decisions map
 *                       + fine-grained rules) and `cc auto-mode defaults`
 *                       (always JSON — carries the precedence chain, which the
 *                       config output does not)
 *  - MCP servers        `cc mcp servers --json` (optional section — this call
 *                       bootstraps the CLI DB and may legitimately fail; a
 *                       failure becomes a warning row, never a blank panel)
 *
 * Read-only v1 — no editing. Pure Node (no `vscode`) → unit-testable; the
 * webview glue lives in ui/policy-view.js. Everything that reaches HTML goes
 * through escapeHtml — rules/paths/denial summaries are user-controlled.
 */

const { escapeHtml, formatRelativeTime, toEpoch } = require("./sessions-workbench.js");

const RULE_KINDS = ["deny", "ask", "allow"];
const RISK_LEVELS = ["low", "medium", "high"];

/** The `cc …` argv arrays the panel spawns (all read-only). */
function buildPolicyArgs({ denialLimit = 20 } = {}) {
  return {
    permissionsList: ["permissions", "list", "--json"],
    recentDenials: ["permissions", "recent", "--json", "-n", String(denialLimit)],
    autoModeConfig: ["auto-mode", "config", "--json"],
    autoModeDefaults: ["auto-mode", "defaults"],
    mcpServers: ["mcp", "servers", "--json"],
  };
}

/** `cc permissions list --json` → { groups, files, managedFile, managedFlags }. */
function shapePermissionRules(payload) {
  const rules = payload && typeof payload === "object" ? payload.rules : null;
  const sources =
    payload && typeof payload.sources === "object" && payload.sources
      ? payload.sources
      : {};
  const managedFile =
    typeof payload?.managedFile === "string" ? payload.managedFile : null;
  const groups = {};
  for (const kind of RULE_KINDS) {
    const arr = Array.isArray(rules?.[kind]) ? rules[kind] : [];
    groups[kind] = arr
      .filter((r) => typeof r === "string" && r)
      .map((rule) => {
        const source = sources[`${kind}:${rule}`] || null;
        return {
          rule,
          source,
          managed: Boolean(managedFile && source === managedFile),
        };
      });
  }
  const managed = payload?.managed;
  const managedFlags = [];
  if (managed && typeof managed === "object") {
    if (managed.allowManagedPermissionRulesOnly) {
      managedFlags.push("user/project permission rules disabled");
    }
    if (
      managed.disableBypassPermissionsMode === true ||
      managed.disableBypassPermissionsMode === "disable"
    ) {
      managedFlags.push("bypassPermissions disabled");
    }
    if (managed.allowManagedHooksOnly) {
      managedFlags.push("only managed hooks may run");
    }
    if (managed.allowManagedMcpServersOnly) {
      managedFlags.push("only managed-allowed MCP servers may connect");
    }
    if (managed.requireSignedPlugins) {
      managedFlags.push("signed plugin manifests required");
    }
  }
  return {
    groups,
    files: Array.isArray(payload?.files) ? payload.files.filter(Boolean) : [],
    managedFile,
    managedFlags,
  };
}

/** `cc permissions recent --json` → shaped denial rows, most recent first. */
function shapeDenials(payload) {
  const list = Array.isArray(payload?.denials)
    ? payload.denials
    : Array.isArray(payload)
      ? payload
      : [];
  return list
    .filter((d) => d && typeof d === "object")
    .map((d) => ({
      at: toEpoch(d.at),
      tool: typeof d.tool === "string" ? d.tool : "?",
      summary: typeof d.summary === "string" ? d.summary : "",
      reason: typeof d.reason === "string" ? d.reason : "",
      via: typeof d.via === "string" ? d.via : "policy",
      rule: typeof d.rule === "string" ? d.rule : null,
      count: Number.isFinite(d.count) && d.count > 1 ? d.count : 1,
      sessionId: typeof d.sessionId === "string" ? d.sessionId : null,
      permissionMode:
        typeof d.permissionMode === "string" ? d.permissionMode : null,
    }))
    .reverse(); // store appends → last entry is the most recent
}

/** Human label for a fine-grained auto-mode rule's match object. */
function describeRuleMatch(match) {
  if (!match || typeof match !== "object") return "";
  return ["tool", "commandPattern", "riskLevel"]
    .filter((k) => typeof match[k] === "string" && match[k])
    .map((k) => `${k === "commandPattern" ? "command" : k === "riskLevel" ? "risk" : k}=${match[k]}`)
    .join(" ");
}

/**
 * `cc auto-mode config --json` + `cc auto-mode defaults` → decision matrix,
 * fine-grained rules (declaration order), precedence chain (from defaults —
 * config output does not carry it), classifyAllShell + provenance.
 */
function shapeAutoMode(configPayload, defaultsPayload) {
  const decisionsMap =
    configPayload && typeof configPayload.decisions === "object"
      ? configPayload.decisions
      : {};
  const decisions = RISK_LEVELS.map((riskLevel) => {
    const d = decisionsMap?.[riskLevel];
    return {
      riskLevel,
      decision: typeof d?.decision === "string" ? d.decision : "?",
      reason: typeof d?.reason === "string" ? d.reason : "",
      source: typeof d?.source === "string" ? d.source : "default",
    };
  });
  const fineRules = (Array.isArray(configPayload?.rules) ? configPayload.rules : [])
    .filter((r) => r && typeof r === "object")
    .map((r) => ({
      match: describeRuleMatch(r.match),
      decision: typeof r.decision === "string" ? r.decision : "?",
      reason: typeof r.reason === "string" ? r.reason : "",
    }));
  const precedence = Array.isArray(defaultsPayload?.precedence)
    ? defaultsPayload.precedence.filter((p) => typeof p === "string")
    : [];
  return {
    decisions,
    fineRules,
    precedence,
    customized: Boolean(configPayload?.customized),
    classifyAllShell: Boolean(configPayload?.effective?.classifyAllShell),
    files: Array.isArray(configPayload?.files)
      ? configPayload.files.filter(Boolean)
      : [],
    managedFile:
      typeof configPayload?.managedFile === "string"
        ? configPayload.managedFile
        : null,
  };
}

/** `cc mcp servers --json` (array) → shaped rows. */
function shapeMcpServers(payload) {
  const list = Array.isArray(payload) ? payload : [];
  return list
    .filter((s) => s && typeof s === "object")
    .map((s) => ({
      name: typeof s.name === "string" ? s.name : "?",
      target:
        typeof s.url === "string" && s.url
          ? s.url
          : [s.command, ...(Array.isArray(s.args) ? s.args : [])]
              .filter(Boolean)
              .join(" "),
      transport: s.transport || s._transport || (s.url ? "http" : "stdio"),
      autoConnect: Boolean(s.autoConnect),
      allowed: s._allowed !== false,
      reason: typeof s._reason === "string" ? s._reason : "",
    }));
}

/**
 * Join the shaped sources into the panel model. Every source is optional —
 * pass null for a failed one and its section renders empty while
 * `errors` renders a warning row (per-source failure tolerance).
 */
function buildPolicyModel({
  permissions = null,
  denials = null,
  autoMode = null,
  mcpServers = null,
  errors = [],
} = {}) {
  return {
    permissions:
      permissions || { groups: { deny: [], ask: [], allow: [] }, files: [], managedFile: null, managedFlags: [] },
    denials: Array.isArray(denials) ? denials : [],
    autoMode:
      autoMode || {
        decisions: [],
        fineRules: [],
        precedence: [],
        customized: false,
        classifyAllShell: false,
        files: [],
        managedFile: null,
      },
    mcpServers: Array.isArray(mcpServers) ? mcpServers : null, // null = source unavailable
    errors: Array.isArray(errors) ? errors : [],
  };
}

/** One-liner (plain text, for the panel status line): rule/denial/server counts. */
function summarizePolicy(model) {
  const g = model?.permissions?.groups || {};
  const count = (k) => (Array.isArray(g[k]) ? g[k].length : 0);
  const parts = [
    `${count("allow")} allow / ${count("ask")} ask / ${count("deny")} deny`,
    `${(model?.denials || []).length} recent denials`,
    `auto-mode ${model?.autoMode?.customized ? "customized" : "defaults"}`,
  ];
  if (Array.isArray(model?.mcpServers)) {
    parts.push(`${model.mcpServers.length} MCP servers`);
  }
  return parts.join(" · ");
}

function ruleRow(kind, r) {
  const badge = r.managed ? ' <span class="badge">managed</span>' : "";
  return (
    `<tr><td><span class="st ${escapeHtml(kind)}">${escapeHtml(kind)}</span></td>` +
    `<td><code>${escapeHtml(r.rule)}</code>${badge}</td>` +
    `<td class="muted">${escapeHtml(r.source || "?")}</td></tr>`
  );
}

/**
 * Full panel HTML fragment (server-rendered, fully escaped): warnings,
 * (a) rules grouped deny/ask/allow with source + managed badge, (b) recent
 * denials, (c) auto-mode decision matrix + fine-grained rules + precedence
 * chain in order, (d) MCP servers when that source loaded.
 */
function renderPolicyHtml(model, { now = Date.now() } = {}) {
  const m = buildPolicyModel(model || {});
  const parts = [];
  for (const e of m.errors) {
    parts.push(
      `<div class="warn">⚠ ${escapeHtml(e.source || "source")} unavailable: ${escapeHtml(e.message || "unknown error")}</div>`,
    );
  }

  // (a) permission rules
  parts.push("<h2>Permission rules</h2>");
  const total = RULE_KINDS.reduce(
    (n, k) => n + (m.permissions.groups[k] || []).length,
    0,
  );
  if (total === 0) {
    parts.push(
      '<p class="muted">No permission rules (add with: cc permissions add).</p>',
    );
  } else {
    const rows = RULE_KINDS.flatMap((kind) =>
      (m.permissions.groups[kind] || []).map((r) => ruleRow(kind, r)),
    ).join("");
    parts.push(
      '<table><thead><tr><th style="width:70px">decision</th><th>rule</th><th>source</th></tr></thead><tbody>' +
        rows +
        "</tbody></table>",
    );
  }
  if (m.permissions.managedFile) {
    parts.push(
      `<div class="muted">managed policy: ${escapeHtml(m.permissions.managedFile)}</div>`,
    );
  }
  for (const flag of m.permissions.managedFlags) {
    parts.push(`<div class="warn">${escapeHtml(flag)}</div>`);
  }

  // (b) recent denials
  parts.push("<h2>Recent denials</h2>");
  if (!m.denials.length) {
    parts.push('<p class="muted">No recent policy denials.</p>');
  } else {
    const rows = m.denials
      .map((d) => {
        const what = d.summary ? `${d.tool} ${d.summary}` : d.tool;
        const times = d.count > 1 ? ` ×${d.count}` : "";
        const where = d.rule ? `${d.via}:${d.rule}` : d.via;
        const meta = [
          d.sessionId ? `session ${d.sessionId}` : "",
          d.permissionMode ? `mode ${d.permissionMode}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          `<tr><td>${escapeHtml(what)}${escapeHtml(times)}` +
          (d.reason ? `<div class="muted">${escapeHtml(d.reason)}</div>` : "") +
          `</td><td><code>${escapeHtml(where)}</code>` +
          (meta ? `<div class="muted">${escapeHtml(meta)}</div>` : "") +
          `</td><td>${escapeHtml(formatRelativeTime(d.at, now))}</td></tr>`
        );
      })
      .join("");
    parts.push(
      '<table><thead><tr><th>denied call</th><th>decided by</th><th style="width:90px">when</th></tr></thead><tbody>' +
        rows +
        "</tbody></table>",
    );
  }

  // (c) auto-mode
  parts.push("<h2>Auto-mode decisions</h2>");
  parts.push(
    `<div class="muted">classifier: ${m.autoMode.customized ? "autoMode.decisions (customized)" : "trusted policy (defaults)"} · classifyAllShell: ${m.autoMode.classifyAllShell}</div>`,
  );
  if (m.autoMode.fineRules.length) {
    const rows = m.autoMode.fineRules
      .map(
        (r) =>
          `<tr><td><code>${escapeHtml(r.match)}</code></td><td><span class="st ${escapeHtml(r.decision)}">${escapeHtml(r.decision)}</span></td><td class="muted">${escapeHtml(r.reason)}</td></tr>`,
      )
      .join("");
    parts.push(
      '<h3>Fine-grained rules (declaration order, tried first)</h3><table><thead><tr><th>match</th><th style="width:70px">decision</th><th>reason</th></tr></thead><tbody>' +
        rows +
        "</tbody></table>",
    );
  }
  if (m.autoMode.decisions.length) {
    const rows = m.autoMode.decisions
      .map(
        (d) =>
          `<tr><td>${escapeHtml(d.riskLevel)}</td><td><span class="st ${escapeHtml(d.decision)}">${escapeHtml(d.decision)}</span></td><td class="muted">${escapeHtml(d.source)}</td><td class="muted">${escapeHtml(d.reason)}</td></tr>`,
      )
      .join("");
    parts.push(
      '<table><thead><tr><th style="width:80px">risk</th><th style="width:70px">decision</th><th style="width:70px">source</th><th>reason</th></tr></thead><tbody>' +
        rows +
        "</tbody></table>",
    );
  } else {
    parts.push('<p class="muted">Auto-mode config unavailable.</p>');
  }
  if (m.autoMode.precedence.length) {
    parts.push(
      '<h3>Precedence chain</h3><ol class="chain">' +
        m.autoMode.precedence
          .map((p) => `<li><code>${escapeHtml(p)}</code></li>`)
          .join("") +
        "</ol>",
    );
  }

  // (d) MCP servers (optional — only when the source loaded)
  if (Array.isArray(m.mcpServers)) {
    parts.push("<h2>MCP servers</h2>");
    if (!m.mcpServers.length) {
      parts.push('<p class="muted">No MCP servers configured.</p>');
    } else {
      const rows = m.mcpServers
        .map(
          (s) =>
            `<tr><td>${escapeHtml(s.name)}${s.autoConnect ? ' <span class="badge alt">auto</span>' : ""}</td>` +
            `<td><code>${escapeHtml(s.target)}</code> <span class="muted">[${escapeHtml(s.transport)}]</span></td>` +
            `<td>${s.allowed ? '<span class="st allow">ok</span>' : `<span class="st deny">blocked</span> <span class="muted">${escapeHtml(s.reason)}</span>`}</td></tr>`,
        )
        .join("");
      parts.push(
        '<table><thead><tr><th style="width:160px">server</th><th>target</th><th style="width:180px">policy</th></tr></thead><tbody>' +
          rows +
          "</tbody></table>",
      );
    }
  }

  if (m.permissions.files.length) {
    parts.push(
      `<div class="muted">rule sources: ${m.permissions.files.map(escapeHtml).join(", ")}</div>`,
    );
  }
  return parts.join("");
}

module.exports = {
  RULE_KINDS,
  RISK_LEVELS,
  buildPolicyArgs,
  shapePermissionRules,
  shapeDenials,
  shapeAutoMode,
  shapeMcpServers,
  buildPolicyModel,
  summarizePolicy,
  describeRuleMatch,
  escapeHtml,
  renderPolicyHtml,
};
