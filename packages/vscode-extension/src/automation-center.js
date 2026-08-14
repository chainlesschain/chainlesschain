/** Pure fail-closed parser/projector for `cc automation center-projection --json`. */

const SCHEMA = "chainlesschain.automation-center/v3";
const SCHEMA_VERSION = 3;
const LEGACY_SCHEMA = "chainlesschain.automation-center/v2";
const LEGACY_SCHEMA_VERSION = 2;
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
const INCIDENT_CATEGORIES = new Set([
  "permission",
  "connector",
  "budget",
  "write_scope",
]);
const INCIDENT_STATUSES = new Set(["open", "resolved", "cancelled"]);
const INCIDENT_ACTIONS = Object.freeze(["retry", "cancel"]);
const INCIDENT_ID = /^[0-9a-f]{64}$/u;
const INCIDENT_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const INCIDENT_TRIGGER = /^[a-z][a-z0-9_-]{0,31}$/u;
const INCIDENT_CONTROL = /[\u0000-\u001f\u007f]/u;
const MAX_INCIDENTS = 100;
const RUNTIME_SCHEMA = "chainlesschain.automation-center-runtime/v1";
const RUNTIME_SCHEMA_VERSION = 1;
const RUNTIME_ACTIONS = Object.freeze(["pause", "resume"]);
const RUNTIME_JOB_KINDS = new Set([
  "agenda",
  "automation",
  "automation-event",
  "cowork-cron",
  "loop-iteration",
  "routine",
]);
const RUNTIME_STATUSES = new Set(["running", "pause_requested", "paused"]);
const RUNTIME_OCCURRENCE_STATUSES = new Set(["running", "retry_wait"]);
const RUNTIME_SAFE_POINTS = new Set(["before_execute", "adapter_checkpoint"]);
const MAX_RUNTIME_ITEMS = 200;

function text(value, maximum = 500) {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function disconnected(error, { stale = false, revision = null } = {}) {
  return {
    connected: false,
    schema: null,
    schemaVersion: null,
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
      runtimeRunning: 0,
      runtimePauseRequested: 0,
      runtimePaused: 0,
    },
    mutations: { createRoutine: null },
    items: [],
    flows: [],
    runtime: {
      schema: RUNTIME_SCHEMA,
      schemaVersion: RUNTIME_SCHEMA_VERSION,
      items: [],
    },
    runtimeItems: [],
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

function safeInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum ? value : null;
}

function strictText(value, maximum) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    INCIDENT_CONTROL.test(value)
  ) {
    return null;
  }
  return text(value, maximum);
}

function exactObject(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === allowedKeys.length &&
    keys.every((key) => allowedKeys.includes(key))
  );
}

function parseStrictPreview(value, expected) {
  if (
    !exactObject(value, ["executor", "argv", "mutates"]) ||
    value.executor !== "cli" ||
    value.mutates !== true ||
    !Array.isArray(value.argv) ||
    value.argv.length !== expected.length ||
    value.argv.some((entry, index) => entry !== expected[index])
  ) {
    return null;
  }
  return { executor: "cli", argv: [...expected], mutates: true };
}

function parseIncidentActions(rawActions, incident) {
  if (
    !Array.isArray(rawActions) ||
    rawActions.length !== INCIDENT_ACTIONS.length
  ) {
    throw new Error("malformed incident actions");
  }
  const actions = {};
  const schedulerBacked =
    Boolean(incident.occurrenceId) &&
    ["schedule", "event"].includes(incident.triggerType);
  for (const raw of rawActions) {
    if (
      !exactObject(raw, ["id", "available", "reason", "preview"]) ||
      !INCIDENT_ACTIONS.includes(raw.id) ||
      actions[raw.id] ||
      (raw.available !== true && raw.available !== false)
    ) {
      throw new Error("malformed incident action");
    }
    const expectedAvailable =
      incident.status === "open" && (raw.id === "cancel" || schedulerBacked);
    if (raw.available !== expectedAvailable) {
      throw new Error("inconsistent incident action");
    }
    const expectedArgv = [
      "automation",
      "center-incident-action",
      incident.incidentId,
      raw.id,
      "--expected-revision",
      String(incident.revision),
      "--json",
    ];
    const preview = raw.available
      ? parseStrictPreview(raw.preview, expectedArgv)
      : null;
    const reason = raw.available ? null : strictText(raw.reason, 240);
    if (
      (raw.available && (raw.reason !== null || !preview)) ||
      (!raw.available && (raw.preview !== null || !reason))
    ) {
      throw new Error("malformed incident action preview");
    }
    actions[raw.id] = {
      available: raw.available,
      reason,
      preview,
    };
  }
  if (Object.keys(actions).length !== INCIDENT_ACTIONS.length) {
    throw new Error("incomplete incident actions");
  }
  return actions;
}

function parseIncidents(value, globalIds = new Set()) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_INCIDENTS) {
    throw new Error("malformed incidents");
  }
  return value.map((raw) => {
    if (
      !exactObject(raw, [
        "incidentId",
        "runId",
        "occurrenceId",
        "triggerType",
        "category",
        "code",
        "status",
        "revision",
        "createdAtMs",
        "updatedAtMs",
        "actions",
      ])
    ) {
      throw new Error("incident crossed display boundary");
    }
    const incidentId = strictText(raw.incidentId, 64);
    const runId = strictText(raw.runId, 256);
    const occurrenceId =
      raw.occurrenceId == null ? null : strictText(raw.occurrenceId, 256);
    const triggerType = strictText(raw.triggerType, 32);
    const category = strictText(raw.category, 32);
    const code = strictText(raw.code, 128);
    const status = strictText(raw.status, 16);
    const revision = safeInteger(raw.revision, 1);
    const createdAtMs = safeInteger(raw.createdAtMs);
    const updatedAtMs = safeInteger(raw.updatedAtMs);
    if (
      !INCIDENT_ID.test(incidentId) ||
      globalIds.has(incidentId) ||
      !runId ||
      (raw.occurrenceId != null && !occurrenceId) ||
      !INCIDENT_TRIGGER.test(triggerType) ||
      !INCIDENT_CATEGORIES.has(category) ||
      !INCIDENT_CODE.test(code) ||
      !INCIDENT_STATUSES.has(status) ||
      revision == null ||
      createdAtMs == null ||
      updatedAtMs == null ||
      updatedAtMs < createdAtMs
    ) {
      throw new Error("malformed incident");
    }
    globalIds.add(incidentId);
    const incident = {
      incidentId,
      runId,
      occurrenceId,
      triggerType,
      category,
      code,
      status,
      revision,
      createdAtMs,
      updatedAtMs,
    };
    return {
      ...incident,
      actions: parseIncidentActions(raw.actions, incident),
    };
  });
}

function parseRuntimeControl(value) {
  if (value === null) return null;
  if (
    !exactObject(value, ["pauseResume", "safePoints"]) ||
    value.pauseResume !== "checkpoint_v1" ||
    !Array.isArray(value.safePoints) ||
    value.safePoints.length === 0 ||
    value.safePoints.length > RUNTIME_SAFE_POINTS.size
  ) {
    throw new Error("malformed runtime capability");
  }
  const safePoints = value.safePoints.map((point) => strictText(point, 32));
  if (
    safePoints.some((point) => !RUNTIME_SAFE_POINTS.has(point)) ||
    new Set(safePoints).size !== safePoints.length
  ) {
    throw new Error("malformed runtime safe points");
  }
  return { pauseResume: "checkpoint_v1", safePoints };
}

function parseRuntimeActions(rawActions, item) {
  if (
    !Array.isArray(rawActions) ||
    rawActions.length !== RUNTIME_ACTIONS.length
  ) {
    throw new Error("malformed runtime actions");
  }
  const actions = {};
  for (const raw of rawActions) {
    if (
      !exactObject(raw, ["id", "available", "reason", "preview"]) ||
      !RUNTIME_ACTIONS.includes(raw.id) ||
      actions[raw.id] ||
      (raw.available !== true && raw.available !== false)
    ) {
      throw new Error("malformed runtime action");
    }
    const expectedAvailable =
      item.runtimeControl !== null &&
      ((raw.id === "pause" && item.status === "running") ||
        (raw.id === "resume" && item.status === "paused"));
    if (raw.available !== expectedAvailable) {
      throw new Error("inconsistent runtime action");
    }
    const expectedArgv = [
      "automation",
      "center-runtime-action",
      item.id,
      raw.id,
      "--expected-fence",
      String(item.fence),
      "--expected-control-revision",
      String(item.controlRevision),
      "--json",
    ];
    const preview = raw.available
      ? parseStrictPreview(raw.preview, expectedArgv)
      : null;
    const reason = raw.available ? null : strictText(raw.reason, 240);
    if (
      (raw.available && (raw.reason !== null || !preview)) ||
      (!raw.available && (raw.preview !== null || !reason))
    ) {
      throw new Error("malformed runtime action preview");
    }
    actions[raw.id] = {
      available: raw.available,
      reason,
      preview,
    };
  }
  if (Object.keys(actions).length !== RUNTIME_ACTIONS.length) {
    throw new Error("incomplete runtime actions");
  }
  return actions;
}

function parseRuntime(value) {
  if (
    !exactObject(value, ["schema", "schemaVersion", "items"]) ||
    value.schema !== RUNTIME_SCHEMA ||
    value.schemaVersion !== RUNTIME_SCHEMA_VERSION ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_RUNTIME_ITEMS
  ) {
    throw new Error("malformed runtime projection");
  }
  const ids = new Set();
  const items = value.items.map((raw) => {
    if (
      !exactObject(raw, [
        "id",
        "jobId",
        "jobKind",
        "status",
        "occurrenceStatus",
        "scheduledFor",
        "attempt",
        "maxAttempts",
        "fence",
        "controlRevision",
        "createdAt",
        "updatedAt",
        "runtimeControl",
        "actions",
      ])
    ) {
      throw new Error("runtime item crossed display boundary");
    }
    const id = strictText(raw.id, 256);
    const jobId = strictText(raw.jobId, 256);
    const jobKind = strictText(raw.jobKind, 32);
    const status = strictText(raw.status, 32);
    const occurrenceStatus = strictText(raw.occurrenceStatus, 32);
    const scheduledFor = safeInteger(raw.scheduledFor);
    const attempt = safeInteger(raw.attempt, 1);
    const maxAttempts = safeInteger(raw.maxAttempts, 1);
    const fence = safeInteger(raw.fence, 1);
    const controlRevision = safeInteger(raw.controlRevision);
    const createdAt = safeInteger(raw.createdAt);
    const updatedAt = safeInteger(raw.updatedAt);
    if (
      !id ||
      ids.has(id) ||
      !jobId ||
      !RUNTIME_JOB_KINDS.has(jobKind) ||
      !RUNTIME_STATUSES.has(status) ||
      !RUNTIME_OCCURRENCE_STATUSES.has(occurrenceStatus) ||
      (status === "paused"
        ? occurrenceStatus !== "retry_wait"
        : occurrenceStatus !== "running") ||
      scheduledFor == null ||
      attempt == null ||
      maxAttempts == null ||
      attempt > maxAttempts ||
      fence == null ||
      controlRevision == null ||
      createdAt == null ||
      updatedAt == null ||
      updatedAt < createdAt
    ) {
      throw new Error("malformed runtime item");
    }
    ids.add(id);
    const runtimeControl = parseRuntimeControl(raw.runtimeControl);
    const item = {
      id,
      jobId,
      jobKind,
      status,
      occurrenceStatus,
      scheduledFor,
      attempt,
      maxAttempts,
      fence,
      controlRevision,
      createdAt,
      updatedAt,
      runtimeControl,
    };
    return { ...item, actions: parseRuntimeActions(raw.actions, item) };
  });
  return {
    schema: RUNTIME_SCHEMA,
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    items,
  };
}

function parseAutomationCenter(input, { expectedRevision = null } = {}) {
  let root;
  try {
    root = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    return disconnected("invalid Automation Center JSON");
  }
  const revision = text(root?.revision, 96) || null;
  const v3 = root?.schema === SCHEMA && root?.schemaVersion === SCHEMA_VERSION;
  const v2 =
    root?.schema === LEGACY_SCHEMA &&
    root?.schemaVersion === LEGACY_SCHEMA_VERSION;
  if (!root || (!v3 && !v2) || root.authority !== "cli") {
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
    if (v2 && root.runtime != null) {
      throw new Error("legacy projection cannot carry runtime controls");
    }
    const runtime = v3
      ? parseRuntime(root.runtime)
      : {
          schema: RUNTIME_SCHEMA,
          schemaVersion: RUNTIME_SCHEMA_VERSION,
          items: [],
        };
    const keys = new Set();
    const incidentIds = new Set();
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
      if (v3 && kind === "flow" && !Array.isArray(item.incidents)) {
        throw new Error("missing flow incidents");
      }
      if (
        v2 &&
        item.incidents != null &&
        (!Array.isArray(item.incidents) || item.incidents.length !== 0)
      ) {
        throw new Error("legacy item cannot carry incident controls");
      }
      const incidents = v3 ? parseIncidents(item.incidents, incidentIds) : [];
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
        incidents,
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
      runtimeRunning: v3 ? safeInteger(root.summary?.runtimeRunning) : 0,
      runtimePauseRequested: v3
        ? safeInteger(root.summary?.runtimePauseRequested)
        : 0,
      runtimePaused: v3 ? safeInteger(root.summary?.runtimePaused) : 0,
    };
    if (
      summary.total !== items.length ||
      summary.flows !== items.filter((item) => item.kind === "flow").length ||
      summary.routines !==
        items.filter((item) => item.kind === "routine").length ||
      summary.runtimeRunning !==
        runtime.items.filter((item) => item.status === "running").length ||
      summary.runtimePauseRequested !==
        runtime.items.filter((item) => item.status === "pause_requested")
          .length ||
      summary.runtimePaused !==
        runtime.items.filter((item) => item.status === "paused").length
    ) {
      throw new Error("summary mismatch");
    }
    return {
      connected: true,
      schema: root.schema,
      schemaVersion: root.schemaVersion,
      stale: false,
      revision,
      routineCatalogRevision,
      summary,
      mutations: { createRoutine },
      items,
      flows: items,
      runtime,
      runtimeItems: runtime.items,
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

function samePreview(left, right) {
  return (
    left?.executor === "cli" &&
    right?.executor === "cli" &&
    left.mutates === true &&
    right.mutates === true &&
    Array.isArray(left.argv) &&
    Array.isArray(right.argv) &&
    left.argv.length === right.argv.length &&
    left.argv.every((entry, index) => entry === right.argv[index])
  );
}

function findRuntimeItem(snapshot, occurrenceId) {
  return snapshot?.runtimeItems?.find((item) => item.id === occurrenceId);
}

function previewAutomationRuntimeAction(snapshot, request) {
  if (
    !snapshot?.connected ||
    !request ||
    snapshot.revision !== request.revision ||
    !RUNTIME_ACTIONS.includes(request.action)
  ) {
    return null;
  }
  const item = findRuntimeItem(snapshot, request.id);
  if (
    !item ||
    item.fence !== request.fence ||
    item.controlRevision !== request.controlRevision
  ) {
    return null;
  }
  return item.actions[request.action]?.preview || null;
}

function recheckAutomationRuntimeAction(rendered, current, request) {
  const renderedPreview = previewAutomationRuntimeAction(rendered, request);
  if (!renderedPreview || !current?.connected) return null;
  const item = findRuntimeItem(current, request.id);
  if (
    !item ||
    item.fence !== request.fence ||
    item.controlRevision !== request.controlRevision
  ) {
    return null;
  }
  const currentPreview = item.actions[request.action]?.preview || null;
  return samePreview(renderedPreview, currentPreview) ? currentPreview : null;
}

function findIncident(snapshot, incidentId) {
  for (const item of snapshot?.items || []) {
    const incident = item.incidents.find(
      (candidate) => candidate.incidentId === incidentId,
    );
    if (incident) return incident;
  }
  return null;
}

function previewAutomationIncidentAction(snapshot, request) {
  if (
    !snapshot?.connected ||
    !request ||
    snapshot.revision !== request.revision ||
    !INCIDENT_ACTIONS.includes(request.action)
  ) {
    return null;
  }
  const incident = findIncident(snapshot, request.id);
  if (!incident || incident.revision !== request.incidentRevision) return null;
  return incident.actions[request.action]?.preview || null;
}

function recheckAutomationIncidentAction(rendered, current, request) {
  const renderedPreview = previewAutomationIncidentAction(rendered, request);
  if (!renderedPreview || !current?.connected) return null;
  const incident = findIncident(current, request.id);
  if (!incident || incident.revision !== request.incidentRevision) return null;
  const currentPreview = incident.actions[request.action]?.preview || null;
  return samePreview(renderedPreview, currentPreview) ? currentPreview : null;
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
      ...(item.incidents || []).flatMap((incident) => [
        incident.runId,
        incident.occurrenceId,
        incident.triggerType,
        incident.category,
        incident.code,
        incident.status,
      ]),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle)),
  );
}

function filterAutomationRuntimeItems(items, query) {
  const needle = String(query || "")
    .trim()
    .toLowerCase();
  if (!needle) return [...(items || [])];
  return (items || []).filter((item) =>
    [
      item.id,
      item.jobId,
      item.jobKind,
      item.status,
      item.occurrenceStatus,
      ...(item.runtimeControl?.safePoints || []),
    ].some((value) => String(value).toLowerCase().includes(needle)),
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

function renderAutomationRows(items, runtimeItems = []) {
  if (!items?.length && !runtimeItems?.length) {
    return '<div class="empty">No automation items or live occurrences.</div>';
  }
  const automationRows = (items || [])
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
      const incidents = item.incidents
        .slice(0, 5)
        .map((incident) => {
          const incidentButtons = INCIDENT_ACTIONS.map((id) => {
            const action = incident.actions[id];
            return `<button data-control="incident" data-id="${escapeHtml(incident.incidentId)}" data-incident-revision="${incident.revision}" data-action="${id}"${action.available ? "" : " disabled"} title="${escapeHtml(action.reason || "")}">${escapeHtml(id)}</button>`;
          }).join("");
          return `<li><b class="incident-status ${escapeHtml(incident.status)}">${escapeHtml(incident.status)}</b> · ${escapeHtml(incident.category)} · ${escapeHtml(incident.code)}<br><span class="meta">Run ${escapeHtml(incident.runId)}${incident.occurrenceId ? ` · occurrence ${escapeHtml(incident.occurrenceId)}` : ""}</span><div class="actions">${incidentButtons}</div></li>`;
        })
        .join("");
      const actionIds =
        item.kind === "routine" ? ROUTINE_ACTIONS : FLOW_ACTIONS;
      const buttons = actionIds
        .map((id) => {
          const action = item.actions[id];
          return `<button data-control="item" data-kind="${item.kind}" data-id="${escapeHtml(item.id)}" data-revision="${escapeHtml(item.revision)}" data-action="${id}"${action.available ? "" : " disabled"} title="${escapeHtml(action.reason || "")}">${escapeHtml(id.replace("_", " "))}</button>`;
        })
        .join("");
      return `<section class="flow"><header><b>${escapeHtml(item.name)}</b><span><span class="kind">${escapeHtml(item.kind)}</span> · <span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></span></header><div class="meta">${escapeHtml(item.id)}${item.schedule ? ` · ${escapeHtml(item.schedule)}` : ""}</div><div class="security">Preflight: ${escapeHtml(security)}</div><div class="triggers">Triggers: ${escapeHtml(triggers || "none")}</div><div class="actions">${buttons}</div><details><summary>Incidents (${item.incidents.length})</summary><ul>${incidents || "<li>No incidents</li>"}</ul></details><details><summary>Run history (${item.history.length})</summary><ul>${history || "<li>No runs</li>"}</ul></details></section>`;
    })
    .join("");
  const runtimeRows = (runtimeItems || [])
    .map((item) => {
      const buttons = RUNTIME_ACTIONS.map((id) => {
        const action = item.actions[id];
        return `<button data-control="runtime" data-id="${escapeHtml(item.id)}" data-fence="${item.fence}" data-control-revision="${item.controlRevision}" data-action="${id}"${action.available ? "" : " disabled"} title="${escapeHtml(action.reason || "")}">${escapeHtml(id)}</button>`;
      }).join("");
      const safePoints =
        item.runtimeControl?.safePoints.join(", ") || "unsupported";
      return `<section class="flow runtime"><header><b>Live occurrence</b><span><span class="kind">${escapeHtml(item.jobKind)}</span> · <span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></span></header><div class="meta">${escapeHtml(item.id)} · job ${escapeHtml(item.jobId)}</div><div class="security">Fence ${item.fence} · control revision ${item.controlRevision} · attempt ${item.attempt}/${item.maxAttempts}</div><div class="triggers">Safe points: ${escapeHtml(safePoints)}</div><div class="actions">${buttons}</div></section>`;
    })
    .join("");
  return `${runtimeRows}${automationRows}`;
}

module.exports = {
  SCHEMA,
  SCHEMA_VERSION,
  LEGACY_SCHEMA,
  LEGACY_SCHEMA_VERSION,
  ACTIONS,
  FLOW_ACTIONS,
  ROUTINE_ACTIONS,
  INCIDENT_ACTIONS,
  RUNTIME_ACTIONS,
  RUNTIME_SCHEMA,
  RUNTIME_SCHEMA_VERSION,
  parseAutomationCenter,
  previewAutomationAction,
  recheckAutomationAction,
  previewAutomationRuntimeAction,
  recheckAutomationRuntimeAction,
  previewAutomationIncidentAction,
  recheckAutomationIncidentAction,
  recheckCreateRoutine,
  filterAutomationItems,
  filterAutomationFlows: filterAutomationItems,
  filterAutomationRuntimeItems,
  renderAutomationRows,
};
