/**
 * Permission / policy viewer core (gap #10) — pure logic for the
 * `chainlesschain.policy.show` panel. Joins the CLI policy/effect surfaces:
 *
 *  - permission rules   `cc permissions list --json`
 *                       → { rules:{allow,ask,deny}, sources{"kind:rule"→file},
 *                           files, managed, managedFile }
 *  - recent denials     `cc permissions recent --json -n 20`
 *                       → { file, count, denials:[{at,tool,summary,via,rule,…}] }
 *  - actual effects     `cc permissions activity --session <id> --json`
 *                       → resources, decisions, call chain, rollback coverage
 *  - auto-mode          `cc auto-mode config --json` (effective decisions map
 *                       + fine-grained rules) and `cc auto-mode defaults`
 *                       (always JSON — carries the precedence chain, which the
 *                       config output does not)
 *  - MCP servers        `cc mcp servers --json` (optional section — this call
 *                       bootstraps the CLI DB and may legitimately fail; a
 *                       failure becomes a warning row, never a blank panel)
 *
 * Scoped mutations are emitted only as validated CLI argv; the IDE never
 * edits policy state directly. Pure Node (no `vscode`) → unit-testable; the
 * webview glue lives in ui/policy-view.js. Everything that reaches HTML goes
 * through escapeHtml — rules/paths/denial summaries are user-controlled.
 */

const {
  escapeHtml,
  formatRelativeTime,
  toEpoch,
} = require("./sessions-workbench.js");

const RULE_KINDS = ["deny", "ask", "allow"];
const RISK_LEVELS = ["low", "medium", "high"];
const SCOPED_RULE_ID = /^spr_[0-9a-f]{32}$/;
const SCOPED_DURATION = /^\d+(s|m|h|d)$/;
const SIDE_EFFECT_SCHEMA = "cc-permission-side-effect-center/v1";

/** The `cc …` argv arrays the panel spawns (all read-only). */
function buildPolicyArgs({
  denialLimit = 20,
  activityLimit = 50,
  sessionId = "default",
} = {}) {
  return {
    permissionsList: ["permissions", "list", "--json"],
    recentDenials: [
      "permissions",
      "recent",
      "--json",
      "-n",
      String(denialLimit),
    ],
    permissionActivity: [
      "permissions",
      "activity",
      "--session",
      String(sessionId || "default"),
      "--limit",
      String(activityLimit),
      "--json",
    ],
    autoModeConfig: ["auto-mode", "config", "--json"],
    autoModeDefaults: ["auto-mode", "defaults"],
    mcpServers: ["mcp", "servers", "--json"],
  };
}

function buildScopedPermissionCreateArgs({
  decision,
  rule,
  expiresIn,
  reason = "",
  expectedGeneration = null,
} = {}) {
  const kind = String(decision || "")
    .trim()
    .toLowerCase();
  const normalizedRule = String(rule || "").trim();
  const duration = String(expiresIn || "")
    .trim()
    .toLowerCase();
  if (!RULE_KINDS.includes(kind)) throw new Error("invalid decision");
  if (!normalizedRule || /[\r\n\0]/.test(normalizedRule)) {
    throw new Error("a single-line permission rule is required");
  }
  if (!SCOPED_DURATION.test(duration)) throw new Error("invalid TTL");
  const args = [
    "permissions",
    "scoped",
    kind,
    normalizedRule,
    "--expires-in",
    duration,
  ];
  const normalizedReason = String(reason || "").trim();
  if (normalizedReason) {
    if (normalizedReason.length > 500 || /[\r\n\0]/.test(normalizedReason)) {
      throw new Error("reason must be one line and at most 500 characters");
    }
    args.push("--reason", normalizedReason);
  }
  if (expectedGeneration !== null && expectedGeneration !== undefined) {
    const generation = Number(expectedGeneration);
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new Error("invalid expected generation");
    }
    args.push("--expected-generation", String(generation));
  }
  args.push("--json");
  return args;
}

function buildScopedPermissionRevokeArgs({ id, revision } = {}) {
  const normalizedId = String(id || "").trim();
  const normalizedRevision = Number(revision);
  if (!SCOPED_RULE_ID.test(normalizedId)) throw new Error("invalid rule id");
  if (!Number.isSafeInteger(normalizedRevision) || normalizedRevision < 1) {
    throw new Error("invalid rule revision");
  }
  return [
    "permissions",
    "revoke",
    normalizedId,
    "--revision",
    String(normalizedRevision),
    "--json",
  ];
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
  const scopedPayload =
    payload?.scoped && typeof payload.scoped === "object"
      ? payload.scoped
      : null;
  const scopedRules = (
    Array.isArray(scopedPayload?.rules) ? scopedPayload.rules : []
  )
    .filter(
      (record) =>
        record &&
        SCOPED_RULE_ID.test(record.id || "") &&
        RULE_KINDS.includes(record.decision) &&
        typeof record.rule === "string" &&
        record.rule,
    )
    .map((record) => ({
      id: record.id,
      revision:
        Number.isSafeInteger(record.revision) && record.revision > 0
          ? record.revision
          : 0,
      decision: record.decision,
      rule: record.rule,
      status:
        typeof record.effectiveStatus === "string"
          ? record.effectiveStatus
          : typeof record.status === "string"
            ? record.status
            : "unknown",
      expiresAt: Number.isFinite(record.expiresAt) ? record.expiresAt : 0,
      reason: typeof record.reason === "string" ? record.reason : "",
      source:
        typeof record.source === "string"
          ? record.source
          : "cli-security-store",
      scope: typeof record.scope === "string" ? record.scope : "workspace",
    }));
  return {
    groups,
    files: Array.isArray(payload?.files) ? payload.files.filter(Boolean) : [],
    managedFile,
    managedFlags,
    scopedRules,
    scopedGeneration:
      Number.isSafeInteger(scopedPayload?.generation) &&
      scopedPayload.generation >= 0
        ? scopedPayload.generation
        : null,
    scopedFile:
      typeof scopedPayload?.file === "string" ? scopedPayload.file : null,
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

function stringList(value, limit = 32) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => typeof item === "string" && item)
    .slice(0, limit)
    .map((item) => item.slice(0, 512));
}

/** `cc permissions activity --json` → bounded actual side-effect rows. */
function shapeSideEffectActivity(payload) {
  if (
    !payload ||
    payload.schema !== SIDE_EFFECT_SCHEMA ||
    payload.authority !== "cli"
  ) {
    return null;
  }
  return {
    sessionId:
      typeof payload.sessionId === "string"
        ? payload.sessionId.slice(0, 320)
        : "",
    entries: (Array.isArray(payload.entries) ? payload.entries : [])
      .filter((entry) => entry && typeof entry === "object")
      .slice(0, 100)
      .map((entry) => ({
        opId: typeof entry.opId === "string" ? entry.opId.slice(0, 320) : "",
        tool: typeof entry.tool === "string" ? entry.tool.slice(0, 128) : "?",
        kind: typeof entry.kind === "string" ? entry.kind.slice(0, 80) : "?",
        state: typeof entry.state === "string" ? entry.state.slice(0, 32) : "?",
        irreversible: entry.irreversible === true,
        resources: {
          files: stringList(entry.resources?.files),
          network: stringList(entry.resources?.network),
          processes: stringList(entry.resources?.processes),
          credentials: stringList(entry.resources?.credentials),
        },
        unresolvedResources: stringList(entry.unresolvedResources),
        decision: {
          decision:
            typeof entry.decision?.decision === "string"
              ? entry.decision.decision.slice(0, 32)
              : "unknown",
          via:
            typeof entry.decision?.via === "string"
              ? entry.decision.via.slice(0, 120)
              : "policy",
          rule:
            typeof entry.decision?.rule === "string"
              ? entry.decision.rule.slice(0, 256)
              : null,
          source:
            typeof entry.decision?.source === "string"
              ? entry.decision.source.slice(0, 512)
              : null,
          reason:
            typeof entry.decision?.reason === "string"
              ? entry.decision.reason.slice(0, 500)
              : "",
        },
        callChain: {
          sessionId:
            typeof entry.callChain?.sessionId === "string"
              ? entry.callChain.sessionId.slice(0, 320)
              : "",
          turnId:
            typeof entry.callChain?.turnId === "string"
              ? entry.callChain.turnId.slice(0, 320)
              : null,
          toolUseId:
            typeof entry.callChain?.toolUseId === "string"
              ? entry.callChain.toolUseId.slice(0, 320)
              : null,
        },
        recovery: {
          coverage: ["full", "partial", "none", "unknown"].includes(
            entry.recovery?.coverage,
          )
            ? entry.recovery.coverage
            : "unknown",
          action: ["redo", "inspect", "skip"].includes(entry.recovery?.action)
            ? entry.recovery.action
            : "inspect",
          reason:
            typeof entry.recovery?.reason === "string"
              ? entry.recovery.reason.slice(0, 500)
              : "",
          checkpointId:
            typeof entry.recovery?.checkpointId === "string"
              ? entry.recovery.checkpointId.slice(0, 320)
              : null,
          uncoveredResources: stringList(entry.recovery?.uncoveredResources),
        },
      })),
  };
}

/** Human label for a fine-grained auto-mode rule's match object. */
function describeRuleMatch(match) {
  if (!match || typeof match !== "object") return "";
  return ["tool", "commandPattern", "riskLevel"]
    .filter((k) => typeof match[k] === "string" && match[k])
    .map(
      (k) =>
        `${k === "commandPattern" ? "command" : k === "riskLevel" ? "risk" : k}=${match[k]}`,
    )
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
  const fineRules = (
    Array.isArray(configPayload?.rules) ? configPayload.rules : []
  )
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
  activity = null,
  autoMode = null,
  mcpServers = null,
  errors = [],
} = {}) {
  return {
    permissions: permissions || {
      groups: { deny: [], ask: [], allow: [] },
      files: [],
      managedFile: null,
      managedFlags: [],
      scopedRules: [],
      scopedGeneration: null,
      scopedFile: null,
    },
    denials: Array.isArray(denials) ? denials : [],
    activity:
      activity && Array.isArray(activity.entries)
        ? activity
        : { sessionId: "", entries: [] },
    autoMode: autoMode || {
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
  if (model?.activity?.entries?.length) {
    parts.push(
      `${model.activity.entries.length} actual effects / ${model.activity.entries.filter((entry) => entry.recovery.action === "inspect").length} inspect`,
    );
  }
  const scoped = Array.isArray(model?.permissions?.scopedRules)
    ? model.permissions.scopedRules
    : [];
  if (scoped.length) {
    parts.push(
      `${scoped.filter((record) => record.status === "active").length}/${scoped.length} scoped active`,
    );
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

function scopedRuleRow(record) {
  let expiry = "?";
  try {
    if (record.expiresAt) expiry = new Date(record.expiresAt).toISOString();
  } catch {
    expiry = "?";
  }
  const revoke =
    record.status === "active" && record.revision > 0
      ? `<button class="revoke-scoped" data-rule-id="${escapeHtml(record.id)}" data-revision="${record.revision}">Revoke</button>`
      : "";
  return (
    `<tr><td><span class="st ${escapeHtml(record.decision)}">${escapeHtml(record.decision)}</span></td>` +
    `<td><code>${escapeHtml(record.rule)}</code>` +
    (record.reason
      ? `<div class="muted">${escapeHtml(record.reason)}</div>`
      : "") +
    `</td><td><code>${escapeHtml(record.status)}</code><div class="muted">expires ${escapeHtml(expiry)}</div></td>` +
    `<td><code>${escapeHtml(record.id)}</code> r${record.revision}<div class="muted">${escapeHtml(record.scope)} · ${escapeHtml(record.source)}</div></td>` +
    `<td>${revoke}</td></tr>`
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
  parts.push("<h2>Workspace-scoped authority</h2>");
  if (!m.permissions.scopedRules?.length) {
    parts.push('<p class="muted">No scoped rules.</p>');
  } else {
    parts.push(
      "<table><thead><tr><th>decision</th><th>rule</th><th>status / expiry</th><th>authority</th><th></th></tr></thead><tbody>" +
        m.permissions.scopedRules.map(scopedRuleRow).join("") +
        "</tbody></table>",
    );
  }
  if (m.permissions.scopedFile) {
    parts.push(
      `<div class="muted">CLI authority: ${escapeHtml(m.permissions.scopedFile)} · generation ${escapeHtml(m.permissions.scopedGeneration)}</div>`,
    );
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

  // (c) actual resources, decisions, side effects, and recovery coverage
  parts.push("<h2>Actual resources &amp; side effects</h2>");
  if (!m.activity.entries.length) {
    parts.push(
      `<p class="muted">No side-effect evidence for session ${escapeHtml(m.activity.sessionId || "default")}.</p>`,
    );
  } else {
    const rows = m.activity.entries
      .map((entry) => {
        const resources = Object.entries(entry.resources)
          .flatMap(([kind, values]) =>
            values.map(
              (value) =>
                `<div><span class="muted">${escapeHtml(kind)}</span> <code>${escapeHtml(value)}</code></div>`,
            ),
          )
          .join("");
        const unresolved = entry.unresolvedResources
          .map(
            (value) =>
              `<div class="warn">unresolved: ${escapeHtml(value)}</div>`,
          )
          .join("");
        const decision = [
          entry.decision.via,
          entry.decision.rule,
          entry.decision.source,
        ]
          .filter(Boolean)
          .join(" · ");
        const chain = [
          entry.callChain.sessionId
            ? `session ${entry.callChain.sessionId}`
            : "",
          entry.callChain.turnId ? `turn ${entry.callChain.turnId}` : "",
          entry.callChain.toolUseId ? `call ${entry.callChain.toolUseId}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        const uncovered = entry.recovery.uncoveredResources.length
          ? `<div class="warn">not restored: ${escapeHtml(entry.recovery.uncoveredResources.join(", "))}</div>`
          : "";
        return (
          `<tr><td><code>${escapeHtml(entry.tool)}</code><div class="muted">${escapeHtml(entry.kind)} · ${escapeHtml(entry.state)}</div>` +
          (entry.irreversible
            ? '<span class="st deny">irreversible</span>'
            : "") +
          `</td><td>${resources || '<span class="muted">none recorded</span>'}${unresolved}</td>` +
          `<td><span class="st ${escapeHtml(entry.decision.decision)}">${escapeHtml(entry.decision.decision)}</span>` +
          (decision ? `<div class="muted">${escapeHtml(decision)}</div>` : "") +
          (entry.decision.reason
            ? `<div class="muted">${escapeHtml(entry.decision.reason)}</div>`
            : "") +
          `</td><td><code>${escapeHtml(entry.recovery.coverage)}</code> / <code>${escapeHtml(entry.recovery.action)}</code>` +
          (entry.recovery.checkpointId
            ? `<div class="muted">checkpoint ${escapeHtml(entry.recovery.checkpointId)}</div>`
            : "") +
          (entry.recovery.reason
            ? `<div class="muted">${escapeHtml(entry.recovery.reason)}</div>`
            : "") +
          `${uncovered}</td><td class="muted">${escapeHtml(chain)}</td></tr>`
        );
      })
      .join("");
    parts.push(
      "<table><thead><tr><th>effect</th><th>actual resources</th><th>decision</th><th>recovery</th><th>call chain</th></tr></thead><tbody>" +
        rows +
        "</tbody></table>",
    );
  }

  // (d) auto-mode
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

  // (e) MCP servers (optional — only when the source loaded)
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
  buildScopedPermissionCreateArgs,
  buildScopedPermissionRevokeArgs,
  shapePermissionRules,
  shapeDenials,
  shapeSideEffectActivity,
  shapeAutoMode,
  shapeMcpServers,
  buildPolicyModel,
  summarizePolicy,
  describeRuleMatch,
  escapeHtml,
  renderPolicyHtml,
};
