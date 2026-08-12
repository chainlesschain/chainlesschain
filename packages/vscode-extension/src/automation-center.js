/** Pure fail-closed parser/projector for `cc automation center-projection --json`. */

const SCHEMA = "chainlesschain.automation-center/v2";
const SCHEMA_VERSION = 2;
const FLOW_ACTIONS = Object.freeze([
  "run_now",
  "retry_failed",
  "pause",
  "resume",
  "disable",
  "delete",
]);
const ROUTINE_ACTIONS = Object.freeze([...FLOW_ACTIONS, "edit"]);
const ACTIONS = ROUTINE_ACTIONS;
const KINDS = new Set(["flow", "routine"]);
const STATUS = new Set(["draft", "active", "paused", "archived"]);
const SECURITY = new Set([
  "ready",
  "denied",
  "unconfigured",
  "invalid",
  "snapshot_bound",
]);

function text(value, maximum = 500) {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function disconnected(error, { stale = false, revision = null } = {}) {
  return {
    connected: false,
    stale,
    revision,
    routineCatalogRevision: null,
    summary: {
      total: 0,
      flows: 0,
      routines: 0,
      active: 0,
      paused: 0,
      needsAttention: 0,
    },
    mutations: { createRoutine: null },
    items: [],
    flows: [],
    error,
  };
}

function expectedActionArgv(kind, id, actionId, itemRevision) {
  if (kind === "flow") {
    return [
      "automation",
      "center-action",
      id,
      actionId,
      "--expected-revision",
      itemRevision,
      "--json",
    ];
  }
  if (actionId === "edit") {
    return [
      "automation",
      "center-routine-edit",
      id,
      "--expected-revision",
      itemRevision,
      "--json-stdin",
      "--json",
    ];
  }
  return [
    "automation",
    "center-routine-action",
    id,
    actionId,
    "--expected-revision",
    itemRevision,
    "--json",
  ];
}

function parsePreview(value, kind, id, actionId, itemRevision) {
  const expected = expectedActionArgv(kind, id, actionId, itemRevision);
  const requiresStdin = kind === "routine" && actionId === "edit";
  if (
    !value ||
    typeof value !== "object" ||
    value.executor !== "cli" ||
    value.mutates !== true ||
    (requiresStdin ? value.stdin !== "json" : value.stdin != null) ||
    !Array.isArray(value.argv) ||
    value.argv.length !== expected.length ||
    value.argv.some((entry, index) => entry !== expected[index])
  ) {
    return null;
  }
  return {
    executor: "cli",
    mutates: true,
    ...(requiresStdin ? { stdin: "json" } : {}),
    argv: [...expected],
  };
}

function parseCreateRoutine(value, catalogRevision) {
  const expected = [
    "automation",
    "center-routine-create",
    "--expected-revision",
    catalogRevision,
    "--json-stdin",
    "--json",
  ];
  if (
    !value ||
    value.available !== true ||
    value.reason != null ||
    !value.preview ||
    value.preview.executor !== "cli" ||
    value.preview.mutates !== true ||
    value.preview.stdin !== "json" ||
    !Array.isArray(value.preview.argv) ||
    value.preview.argv.length !== expected.length ||
    value.preview.argv.some((entry, index) => entry !== expected[index])
  ) {
    return null;
  }
  return {
    available: true,
    reason: null,
    preview: {
      executor: "cli",
      mutates: true,
      stdin: "json",
      argv: [...expected],
    },
  };
}

function parseDefinition(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = text(value.name, 512);
  const prompt = text(value.prompt, 64 * 1024);
  const trigger = value.trigger;
  if (
    !name ||
    !prompt ||
    !trigger ||
    typeof trigger !== "object" ||
    !["cron", "once", "webhook", "github"].includes(trigger.kind)
  ) {
    return null;
  }
  return { name, prompt, trigger: structuredClone(trigger) };
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
  if (root.connected !== true || !revision || !Array.isArray(root.items)) {
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
    const routineCatalogRevision = text(root.routineCatalogRevision, 96);
    const createRoutine = parseCreateRoutine(
      root.mutations?.createRoutine,
      routineCatalogRevision,
    );
    if (!routineCatalogRevision || !createRoutine) {
      throw new Error("malformed root mutation");
    }
    const keys = new Set();
    const items = root.items.map((item) => {
      const kind = text(item?.kind, 16);
      const id = text(item?.id, 256);
      const itemRevision = text(item?.revision, 96);
      const requiredActions =
        kind === "routine" ? ROUTINE_ACTIONS : FLOW_ACTIONS;
      if (
        !KINDS.has(kind) ||
        !id ||
        !itemRevision ||
        keys.has(`${kind}\0${id}`) ||
        !STATUS.has(item.status) ||
        !item.security ||
        !SECURITY.has(item.security.state) ||
        !Array.isArray(item.actions) ||
        !Array.isArray(item.triggers) ||
        !Array.isArray(item.history)
      ) {
        throw new Error("malformed item");
      }
      keys.add(`${kind}\0${id}`);
      const definition =
        kind === "routine" ? parseDefinition(item.definition) : null;
      if (kind === "routine" && !definition) {
        throw new Error("malformed routine definition");
      }
      const actionMap = {};
      for (const raw of item.actions) {
        if (!requiredActions.includes(raw?.id) || actionMap[raw.id]) continue;
        const available = raw.available === true;
        const preview = available
          ? parsePreview(raw.preview, kind, id, raw.id, itemRevision)
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
      if (Object.keys(actionMap).length !== requiredActions.length) {
        throw new Error("incomplete actions");
      }
      return {
        kind,
        id,
        revision: itemRevision,
        name: text(item.name, 200) || id,
        description: text(item.description, 500),
        status: item.status,
        schedule: text(item.schedule, 240) || null,
        updatedAt: text(item.updatedAt, 80) || null,
        definition,
        security: {
          state: item.security.state,
          ready: item.security.ready === true,
          principalId: text(item.security.principalId, 256) || null,
          connectors: Array.isArray(item.security.connectors)
            ? item.security.connectors
                .map((value) => text(value, 64))
                .filter(Boolean)
                .slice(0, 64)
            : [],
          permissions: Array.isArray(item.security.permissions)
            ? item.security.permissions
                .map((entry) => ({
                  permission: text(entry?.permission, 160),
                  allowed: entry?.allowed === true,
                }))
                .filter((entry) => entry.permission)
                .slice(0, 128)
            : [],
          budget:
            item.security.budget && typeof item.security.budget === "object"
              ? {
                  remainingRuns:
                    Number(item.security.budget.remainingRuns) || 0,
                  remainingActionSteps:
                    Number(item.security.budget.remainingActionSteps) || 0,
                  endsAtMs: Number(item.security.budget.endsAtMs) || 0,
                }
              : null,
          issue: item.security.issue
            ? {
                code: text(item.security.issue.code, 96),
                message: text(item.security.issue.message, 400),
              }
            : null,
        },
        triggers: item.triggers.slice(0, 100).map((trigger) => ({
          id: text(trigger?.id, 256),
          type: text(trigger?.type, 40),
          enabled: trigger?.enabled === true,
          scope:
            trigger?.scope && typeof trigger.scope === "object"
              ? structuredClone(trigger.scope)
              : {},
          triggerCount: Number(trigger?.triggerCount) || 0,
          lastTriggeredAt: text(trigger?.lastTriggeredAt, 80) || null,
        })),
        history: item.history.slice(0, 100).map((entry) => ({
          id: text(entry?.id, 256),
          status: text(entry?.status, 40),
          triggerType: text(entry?.triggerType, 80) || null,
          durationMs: Number(entry?.durationMs) || 0,
          startedAt: text(entry?.startedAt, 80) || null,
          completedAt: text(entry?.completedAt, 80) || null,
          error: text(entry?.error, 400) || null,
        })),
        actions: actionMap,
      };
    });
    const summary = {
      total: Number(root.summary?.total) || 0,
      flows: Number(root.summary?.flows) || 0,
      routines: Number(root.summary?.routines) || 0,
      active: Number(root.summary?.active) || 0,
      paused: Number(root.summary?.paused) || 0,
      needsAttention: Number(root.summary?.needsAttention) || 0,
    };
    if (
      summary.total !== items.length ||
      summary.flows !== items.filter((item) => item.kind === "flow").length ||
      summary.routines !==
        items.filter((item) => item.kind === "routine").length
    ) {
      throw new Error("summary mismatch");
    }
    return {
      connected: true,
      stale: false,
      revision,
      routineCatalogRevision,
      summary,
      mutations: { createRoutine },
      items,
      flows: items,
      error: null,
    };
  } catch {
    return disconnected("malformed Automation Center projection", { revision });
  }
}

function findItem(snapshot, request) {
  return snapshot.items.find(
    (item) => item.kind === request.kind && item.id === request.id,
  );
}

function previewAutomationAction(snapshot, request) {
  if (
    !snapshot?.connected ||
    !request ||
    snapshot.revision !== request.revision
  ) {
    return null;
  }
  const item = findItem(snapshot, request);
  if (!item || item.revision !== request.itemRevision) return null;
  return item.actions[request.action]?.preview || null;
}

function recheckAutomationAction(rendered, current, request) {
  if (!previewAutomationAction(rendered, request) || !current?.connected) {
    return null;
  }
  const item = findItem(current, request);
  if (!item || item.revision !== request.itemRevision) return null;
  return item.actions[request.action]?.preview || null;
}

function recheckCreateRoutine(rendered, current) {
  if (!rendered?.connected || !current?.connected) return null;
  if (rendered.routineCatalogRevision !== current.routineCatalogRevision) {
    return null;
  }
  return current.mutations.createRoutine?.preview || null;
}

function filterAutomationItems(items, query) {
  const needle = String(query || "")
    .trim()
    .toLowerCase();
  if (!needle) return [...(items || [])];
  return (items || []).filter((item) =>
    [
      item.kind,
      item.name,
      item.id,
      item.status,
      item.security.state,
      item.schedule,
    ]
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

function triggerScope(trigger) {
  if (trigger.scope?.origins?.length) return trigger.scope.origins.join(", ");
  if (trigger.scope?.endpointConfigured) return "endpoint configured";
  if (trigger.scope?.cron) return trigger.scope.cron;
  if (trigger.scope?.at) return trigger.scope.at;
  if (trigger.scope?.repo) {
    const events = Array.isArray(trigger.scope.events)
      ? trigger.scope.events.join(", ")
      : "";
    return `${trigger.scope.repo}${events ? ` (${events})` : ""}`;
  }
  if (trigger.scope?.entryPoint) return trigger.scope.entryPoint;
  return "";
}

function renderAutomationRows(items) {
  if (!items?.length) return '<div class="empty">No automation items.</div>';
  return items
    .map((item) => {
      const security = item.security.ready
        ? item.security.budget
          ? `ready · ${item.security.budget.remainingRuns} runs / ${item.security.budget.remainingActionSteps} steps left`
          : item.security.state.replace("_", " ")
        : `${item.security.state}${item.security.issue?.code ? ` · ${item.security.issue.code}` : ""}`;
      const triggers = item.triggers
        .map((trigger) => {
          const scope = triggerScope(trigger);
          return `${trigger.type}${trigger.enabled ? "" : " (disabled)"}${scope ? ` · ${scope}` : ""}`;
        })
        .join("; ");
      const history = item.history
        .slice(0, 5)
        .map(
          (entry) =>
            `<li><b>${escapeHtml(entry.status)}</b> · ${escapeHtml(entry.triggerType || "manual")} · ${escapeHtml(entry.startedAt || "")}${entry.error ? ` · ${escapeHtml(entry.error)}` : ""}</li>`,
        )
        .join("");
      const actionIds =
        item.kind === "routine" ? ROUTINE_ACTIONS : FLOW_ACTIONS;
      const buttons = actionIds
        .map((id) => {
          const action = item.actions[id];
          return `<button data-kind="${item.kind}" data-id="${escapeHtml(item.id)}" data-revision="${escapeHtml(item.revision)}" data-action="${id}"${action.available ? "" : " disabled"} title="${escapeHtml(action.reason || "")}">${escapeHtml(id.replace("_", " "))}</button>`;
        })
        .join("");
      return `<section class="flow"><header><b>${escapeHtml(item.name)}</b><span><span class="kind">${escapeHtml(item.kind)}</span> · <span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></span></header><div class="meta">${escapeHtml(item.id)}${item.schedule ? ` · ${escapeHtml(item.schedule)}` : ""}</div><div class="security">Preflight: ${escapeHtml(security)}</div><div class="triggers">Triggers: ${escapeHtml(triggers || "none")}</div><div class="actions">${buttons}</div><details><summary>Run history (${item.history.length})</summary><ul>${history || "<li>No runs</li>"}</ul></details></section>`;
    })
    .join("");
}

module.exports = {
  SCHEMA,
  SCHEMA_VERSION,
  ACTIONS,
  FLOW_ACTIONS,
  ROUTINE_ACTIONS,
  parseAutomationCenter,
  previewAutomationAction,
  recheckAutomationAction,
  recheckCreateRoutine,
  filterAutomationItems,
  filterAutomationFlows: filterAutomationItems,
  renderAutomationRows,
};
