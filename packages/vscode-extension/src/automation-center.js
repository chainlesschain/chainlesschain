/** Pure parser/projector for `cc automation center-projection --json`. */

const SCHEMA = "chainlesschain.automation-center/v1";
const SCHEMA_VERSION = 1;
const ACTIONS = Object.freeze(["run_now", "pause", "resume"]);
const STATUS = new Set(["draft", "active", "paused", "archived"]);
const SECURITY = new Set(["ready", "denied", "unconfigured", "invalid"]);

function text(value, maximum = 500) {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function disconnected(error, { stale = false, revision = null } = {}) {
  return {
    connected: false,
    stale,
    revision,
    summary: { total: 0, active: 0, paused: 0, needsAttention: 0 },
    flows: [],
    error,
  };
}

function parsePreview(value, flowId, actionId, itemRevision) {
  const expected = [
    "automation",
    "center-action",
    flowId,
    actionId,
    "--expected-revision",
    itemRevision,
    "--json",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    value.executor !== "cli" ||
    value.mutates !== true ||
    !Array.isArray(value.argv) ||
    value.argv.length !== expected.length ||
    value.argv.some((entry, index) => entry !== expected[index])
  ) {
    return null;
  }
  return { executor: "cli", mutates: true, argv: [...expected] };
}

function parseAutomationCenter(input, { expectedRevision = null } = {}) {
  let root;
  try {
    root = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    return disconnected("invalid Automation Center JSON");
  }
  const revision = text(root?.revision, 96) || null;
  if (
    !root ||
    root.schema !== SCHEMA ||
    root.schemaVersion !== SCHEMA_VERSION ||
    root.authority !== "cli"
  ) {
    return disconnected("unsupported or non-CLI Automation Center projection", {
      revision,
    });
  }
  if (root.connected !== true || !revision || !Array.isArray(root.flows)) {
    return disconnected(text(root.reason) || "Automation Center disconnected", {
      revision,
    });
  }
  if (expectedRevision && expectedRevision !== revision) {
    return disconnected("stale Automation Center projection", {
      stale: true,
      revision,
    });
  }

  try {
    const flows = root.flows.map((flow) => {
      const id = text(flow?.id, 256);
      const itemRevision = text(flow?.revision, 96);
      if (
        !id ||
        !itemRevision ||
        !STATUS.has(flow.status) ||
        !flow.security ||
        !SECURITY.has(flow.security.state) ||
        !Array.isArray(flow.actions) ||
        !Array.isArray(flow.triggers) ||
        !Array.isArray(flow.history)
      ) {
        throw new Error("malformed flow");
      }
      const actionMap = {};
      for (const raw of flow.actions) {
        if (!ACTIONS.includes(raw?.id) || actionMap[raw.id]) continue;
        const available = raw.available === true;
        const preview = available
          ? parsePreview(raw.preview, id, raw.id, itemRevision)
          : null;
        if ((available && !preview) || (!available && raw.preview != null)) {
          throw new Error("malformed action");
        }
        actionMap[raw.id] = {
          available,
          reason: available ? null : text(raw.reason, 240) || "unavailable",
          preview,
        };
      }
      if (Object.keys(actionMap).length !== ACTIONS.length) {
        throw new Error("incomplete actions");
      }
      return {
        id,
        revision: itemRevision,
        name: text(flow.name, 200) || id,
        description: text(flow.description, 500),
        status: flow.status,
        schedule: text(flow.schedule, 120) || null,
        updatedAt: text(flow.updatedAt, 80) || null,
        security: {
          state: flow.security.state,
          ready: flow.security.ready === true,
          principalId: text(flow.security.principalId, 256) || null,
          connectors: Array.isArray(flow.security.connectors)
            ? flow.security.connectors
                .map((value) => text(value, 64))
                .slice(0, 64)
            : [],
          permissions: Array.isArray(flow.security.permissions)
            ? flow.security.permissions
                .map((entry) => ({
                  permission: text(entry?.permission, 160),
                  allowed: entry?.allowed === true,
                }))
                .filter((entry) => entry.permission)
                .slice(0, 128)
            : [],
          budget:
            flow.security.budget && typeof flow.security.budget === "object"
              ? {
                  remainingRuns:
                    Number(flow.security.budget.remainingRuns) || 0,
                  remainingActionSteps:
                    Number(flow.security.budget.remainingActionSteps) || 0,
                  endsAtMs: Number(flow.security.budget.endsAtMs) || 0,
                }
              : null,
          issue: flow.security.issue
            ? {
                code: text(flow.security.issue.code, 96),
                message: text(flow.security.issue.message, 400),
              }
            : null,
        },
        triggers: flow.triggers.slice(0, 100).map((trigger) => ({
          id: text(trigger?.id, 256),
          type: text(trigger?.type, 40),
          enabled: trigger?.enabled === true,
          scope:
            trigger?.scope && typeof trigger.scope === "object"
              ? trigger.scope
              : {},
          triggerCount: Number(trigger?.triggerCount) || 0,
          lastTriggeredAt: text(trigger?.lastTriggeredAt, 80) || null,
        })),
        history: flow.history.slice(0, 100).map((entry) => ({
          id: text(entry?.id, 256),
          status: text(entry?.status, 40),
          triggerType: text(entry?.triggerType, 40) || null,
          durationMs: Number(entry?.durationMs) || 0,
          startedAt: text(entry?.startedAt, 80) || null,
          completedAt: text(entry?.completedAt, 80) || null,
          error: text(entry?.error, 400) || null,
        })),
        actions: actionMap,
      };
    });
    return {
      connected: true,
      stale: false,
      revision,
      summary: {
        total: Number(root.summary?.total) || 0,
        active: Number(root.summary?.active) || 0,
        paused: Number(root.summary?.paused) || 0,
        needsAttention: Number(root.summary?.needsAttention) || 0,
      },
      flows,
      error: null,
    };
  } catch {
    return disconnected("malformed Automation Center projection", { revision });
  }
}

function previewAutomationAction(snapshot, request) {
  if (
    !snapshot?.connected ||
    !request ||
    snapshot.revision !== request.revision
  ) {
    return null;
  }
  const flow = snapshot.flows.find((item) => item.id === request.id);
  if (!flow || flow.revision !== request.itemRevision) return null;
  return flow.actions[request.action]?.preview || null;
}

function recheckAutomationAction(rendered, current, request) {
  if (!previewAutomationAction(rendered, request) || !current?.connected) {
    return null;
  }
  const flow = current.flows.find((item) => item.id === request.id);
  if (!flow || flow.revision !== request.itemRevision) return null;
  return flow.actions[request.action]?.preview || null;
}

function filterAutomationFlows(flows, query) {
  const needle = String(query || "")
    .trim()
    .toLowerCase();
  if (!needle) return [...(flows || [])];
  return (flows || []).filter((flow) =>
    [flow.name, flow.id, flow.status, flow.security.state, flow.schedule]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)),
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAutomationRows(flows) {
  if (!flows?.length) return '<div class="empty">No automation flows.</div>';
  return flows
    .map((flow) => {
      const security = flow.security.ready
        ? `ready · ${flow.security.budget?.remainingRuns ?? 0} runs / ${flow.security.budget?.remainingActionSteps ?? 0} steps left`
        : `${flow.security.state}${flow.security.issue?.code ? ` · ${flow.security.issue.code}` : ""}`;
      const triggers = flow.triggers
        .map((trigger) => {
          const scope = trigger.scope?.origins?.length
            ? ` · ${trigger.scope.origins.join(", ")}`
            : trigger.scope?.endpointConfigured
              ? " · endpoint configured"
              : "";
          return `${trigger.type}${trigger.enabled ? "" : " (disabled)"}${scope}`;
        })
        .join("; ");
      const history = flow.history
        .slice(0, 5)
        .map(
          (entry) =>
            `<li><b>${escapeHtml(entry.status)}</b> · ${escapeHtml(entry.triggerType || "manual")} · ${escapeHtml(entry.startedAt || "")}${entry.error ? ` · ${escapeHtml(entry.error)}` : ""}</li>`,
        )
        .join("");
      const buttons = ACTIONS.map((id) => {
        const item = flow.actions[id];
        return `<button data-id="${escapeHtml(flow.id)}" data-revision="${escapeHtml(flow.revision)}" data-action="${id}"${item.available ? "" : " disabled"} title="${escapeHtml(item.reason || "")}">${escapeHtml(id.replace("_", " "))}</button>`;
      }).join("");
      return `<section class="flow"><header><b>${escapeHtml(flow.name)}</b><span class="status ${escapeHtml(flow.status)}">${escapeHtml(flow.status)}</span></header><div class="meta">${escapeHtml(flow.id)}${flow.schedule ? ` · ${escapeHtml(flow.schedule)}` : ""}</div><div class="security">Preflight: ${escapeHtml(security)}</div><div class="triggers">Triggers: ${escapeHtml(triggers || "none")}</div><div class="actions">${buttons}</div><details><summary>Run history (${flow.history.length})</summary><ul>${history || "<li>No runs</li>"}</ul></details></section>`;
    })
    .join("");
}

module.exports = {
  SCHEMA,
  SCHEMA_VERSION,
  ACTIONS,
  parseAutomationCenter,
  previewAutomationAction,
  recheckAutomationAction,
  filterAutomationFlows,
  renderAutomationRows,
};
