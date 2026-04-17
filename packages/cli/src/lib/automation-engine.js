/**
 * Automation Engine — CLI port of Phase 96 工作流自动化引擎.
 *
 * 12 built-in SaaS connectors (Gmail/Slack/GitHub/Jira/Notion/Trello/Discord/
 * Teams/Airtable/Figma/Linear/Confluence) + 5 trigger types
 * (webhook/schedule/event/condition/manual) + simulated flow execution.
 *
 * CLI is record-keeping + simulator only: no real API calls, no credential
 * storage, no outbound HTTP. Each node execution produces a mock output
 * shape derived from connector metadata so downstream nodes can chain.
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

export const FLOW_STATUS = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});

export const EXECUTION_STATUS = Object.freeze({
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const TRIGGER_TYPE = Object.freeze({
  WEBHOOK: "webhook",
  SCHEDULE: "schedule",
  EVENT: "event",
  CONDITION: "condition",
  MANUAL: "manual",
});

export const NODE_TYPE = Object.freeze({
  ACTION: "action",
  CONDITION: "condition",
  PARALLEL: "parallel",
  LOOP: "loop",
});

/* ── Built-in connector catalog ────────────────────────────── */

export const CONNECTOR_CATALOG = Object.freeze([
  {
    id: "gmail",
    displayName: "Gmail",
    category: "email",
    actions: ["send", "search", "markRead", "archive"],
  },
  {
    id: "slack",
    displayName: "Slack",
    category: "messaging",
    actions: ["postMessage", "createChannel", "listEvents"],
  },
  {
    id: "github",
    displayName: "GitHub",
    category: "dev",
    actions: ["createIssue", "createPR", "addWebhook", "createRelease"],
  },
  {
    id: "jira",
    displayName: "Jira",
    category: "project",
    actions: ["createIssue", "updateStatus", "jql"],
  },
  {
    id: "notion",
    displayName: "Notion",
    category: "knowledge",
    actions: ["createPage", "updateDatabase", "query"],
  },
  {
    id: "trello",
    displayName: "Trello",
    category: "kanban",
    actions: ["createCard", "moveCard", "addComment"],
  },
  {
    id: "discord",
    displayName: "Discord",
    category: "community",
    actions: ["postMessage", "manageChannel", "botReply"],
  },
  {
    id: "teams",
    displayName: "Teams",
    category: "collab",
    actions: ["postMessage", "createMeeting", "shareFile"],
  },
  {
    id: "airtable",
    displayName: "Airtable",
    category: "data",
    actions: ["listRecords", "createRecord", "updateRecord", "deleteRecord"],
  },
  {
    id: "figma",
    displayName: "Figma",
    category: "design",
    actions: ["exportAsset", "listenChange", "addComment"],
  },
  {
    id: "linear",
    displayName: "Linear",
    category: "project",
    actions: ["createIssue", "updateStatus", "query"],
  },
  {
    id: "confluence",
    displayName: "Confluence",
    category: "docs",
    actions: ["createPage", "update", "search"],
  },
]);

const CONNECTOR_INDEX = new Map(CONNECTOR_CATALOG.map((c) => [c.id, c]));

export function listConnectors() {
  return CONNECTOR_CATALOG.map((c) => ({ ...c, actions: [...c.actions] }));
}

export function getConnector(id) {
  const c = CONNECTOR_INDEX.get(id);
  return c ? { ...c, actions: [...c.actions] } : null;
}

/* ── Built-in flow templates ───────────────────────────────── */

export const FLOW_TEMPLATES = Object.freeze([
  {
    id: "github-issue-to-slack",
    name: "GitHub Issue → Slack notify",
    description: "Post to #dev when a GitHub issue is opened",
    nodes: [
      {
        id: "n1",
        type: "action",
        connector: "github",
        action: "addWebhook",
        params: { events: ["issues"] },
      },
      {
        id: "n2",
        type: "action",
        connector: "slack",
        action: "postMessage",
        params: { channel: "#dev" },
      },
    ],
    edges: [{ from: "n1", to: "n2" }],
  },
  {
    id: "daily-standup-digest",
    name: "Daily standup digest",
    description: "9:00 AM daily — pull Jira tickets and email team",
    nodes: [
      {
        id: "n1",
        type: "action",
        connector: "jira",
        action: "jql",
        params: { jql: "assignee = currentUser()" },
      },
      {
        id: "n2",
        type: "action",
        connector: "gmail",
        action: "send",
        params: { subject: "Daily standup" },
      },
    ],
    edges: [{ from: "n1", to: "n2" }],
  },
  {
    id: "figma-to-notion",
    name: "Figma export → Notion page",
    description:
      "When a Figma file changes, export the latest asset to a Notion page",
    nodes: [
      {
        id: "n1",
        type: "action",
        connector: "figma",
        action: "listenChange",
        params: {},
      },
      {
        id: "n2",
        type: "action",
        connector: "figma",
        action: "exportAsset",
        params: { format: "png" },
      },
      {
        id: "n3",
        type: "action",
        connector: "notion",
        action: "createPage",
        params: { database: "design-assets" },
      },
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
    ],
  },
  {
    id: "error-rate-alert",
    name: "Error-rate alert",
    description: "When error rate > 5% fire Slack + Teams alert",
    nodes: [
      {
        id: "n1",
        type: "condition",
        expression: "ctx.errorRate > 0.05",
      },
      {
        id: "n2",
        type: "action",
        connector: "slack",
        action: "postMessage",
        params: { channel: "#ops" },
      },
      {
        id: "n3",
        type: "action",
        connector: "teams",
        action: "postMessage",
        params: { channel: "ops" },
      },
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n1", to: "n3" },
    ],
  },
]);

const TEMPLATE_INDEX = new Map(FLOW_TEMPLATES.map((t) => [t.id, t]));

export function listFlowTemplates() {
  return FLOW_TEMPLATES.map((t) => ({
    ...t,
    nodes: t.nodes.map((n) => ({ ...n })),
    edges: t.edges.map((e) => ({ ...e })),
  }));
}

export function getFlowTemplate(id) {
  const t = TEMPLATE_INDEX.get(id);
  if (!t) return null;
  return {
    ...t,
    nodes: t.nodes.map((n) => ({ ...n })),
    edges: t.edges.map((e) => ({ ...e })),
  };
}

/* ── Schema ────────────────────────────────────────────────── */

export function ensureAutomationTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      nodes TEXT,
      edges TEXT,
      status TEXT DEFAULT 'draft',
      schedule TEXT,
      created_by TEXT,
      shared_with TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_executions (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      trigger_type TEXT,
      input_data TEXT,
      output_data TEXT,
      status TEXT DEFAULT 'running',
      steps_log TEXT DEFAULT '[]',
      duration_ms INTEGER DEFAULT 0,
      error TEXT,
      test_mode INTEGER DEFAULT 0,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_triggers (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT,
      enabled INTEGER DEFAULT 1,
      last_triggered_at TEXT,
      trigger_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Helpers ───────────────────────────────────────────────── */

function _genId(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString("hex")}`;
}

function _now() {
  return new Date().toISOString();
}

function _parseJSON(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_e) {
    return fallback;
  }
}

function _rowToFlow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    nodes: _parseJSON(row.nodes, []),
    edges: _parseJSON(row.edges, []),
    status: row.status,
    schedule: row.schedule || null,
    createdBy: row.created_by || null,
    sharedWith: _parseJSON(row.shared_with, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function _rowToExecution(row) {
  if (!row) return null;
  return {
    id: row.id,
    flowId: row.flow_id,
    triggerType: row.trigger_type,
    inputData: _parseJSON(row.input_data, null),
    outputData: _parseJSON(row.output_data, null),
    status: row.status,
    stepsLog: _parseJSON(row.steps_log, []),
    durationMs: row.duration_ms || 0,
    error: row.error || null,
    testMode: row.test_mode === 1,
    startedAt: row.started_at,
    completedAt: row.completed_at || null,
  };
}

function _rowToTrigger(row) {
  if (!row) return null;
  return {
    id: row.id,
    flowId: row.flow_id,
    type: row.type,
    config: _parseJSON(row.config, {}),
    enabled: row.enabled === 1,
    lastTriggeredAt: row.last_triggered_at || null,
    triggerCount: row.trigger_count || 0,
    createdAt: row.created_at,
  };
}

function _requireFlow(db, flowId) {
  const row = db.prepare(`SELECT * FROM auto_flows WHERE id = ?`).get(flowId);
  if (!row) throw new Error(`Flow not found: ${flowId}`);
  return row;
}

function _validateNodes(nodes) {
  if (!Array.isArray(nodes)) throw new Error("nodes must be an array");
  for (const n of nodes) {
    if (!n || typeof n !== "object") throw new Error("node must be an object");
    if (!n.id) throw new Error("node.id required");
    const type = n.type || "action";
    if (!Object.values(NODE_TYPE).includes(type)) {
      throw new Error(`Unknown node type: ${type}`);
    }
    if (type === "action") {
      if (!n.connector) throw new Error(`node ${n.id}: connector required`);
      if (!CONNECTOR_INDEX.has(n.connector)) {
        throw new Error(`Unknown connector: ${n.connector}`);
      }
      const conn = CONNECTOR_INDEX.get(n.connector);
      if (!n.action) throw new Error(`node ${n.id}: action required`);
      if (!conn.actions.includes(n.action)) {
        throw new Error(`Unknown action for ${n.connector}: ${n.action}`);
      }
    }
    if (type === "condition" && !n.expression) {
      throw new Error(`node ${n.id}: expression required for condition`);
    }
  }
}

function _validateEdges(edges, nodes) {
  if (!Array.isArray(edges)) throw new Error("edges must be an array");
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!e || !e.from || !e.to) throw new Error("edge needs from/to");
    if (!ids.has(e.from)) throw new Error(`edge.from unknown node: ${e.from}`);
    if (!ids.has(e.to)) throw new Error(`edge.to unknown node: ${e.to}`);
  }
}

/* ── Flow CRUD ─────────────────────────────────────────────── */

export function createFlow(db, options = {}) {
  const {
    name,
    description,
    nodes = [],
    edges = [],
    createdBy,
    schedule,
  } = options;
  if (!name) throw new Error("name is required");
  _validateNodes(nodes);
  _validateEdges(edges, nodes);

  const id = _genId("flow");
  const now = _now();
  db.prepare(
    `INSERT INTO auto_flows
     (id, name, description, nodes, edges, status, schedule, created_by, shared_with, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    description || "",
    JSON.stringify(nodes),
    JSON.stringify(edges),
    FLOW_STATUS.DRAFT,
    schedule || null,
    createdBy || null,
    JSON.stringify([]),
    now,
    now,
  );

  return _rowToFlow(
    db.prepare(`SELECT * FROM auto_flows WHERE id = ?`).get(id),
  );
}

export function getFlow(db, flowId) {
  return _rowToFlow(
    db.prepare(`SELECT * FROM auto_flows WHERE id = ?`).get(flowId),
  );
}

export function listFlows(db, filters = {}) {
  const { status, limit = 50 } = filters;
  const all = db.data?.get("auto_flows") || [];
  let rows;
  if (status) {
    rows = db
      .prepare(
        `SELECT * FROM auto_flows WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(status, limit);
  } else {
    rows = db
      .prepare(`SELECT * FROM auto_flows ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
  }
  // Defensive: if db helper returns nothing for some reason, fall back to raw data
  if ((!rows || rows.length === 0) && all.length > 0) {
    let fallback = [...all];
    if (status) fallback = fallback.filter((r) => r.status === status);
    fallback.sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
    rows = fallback.slice(0, limit);
  }
  return rows.map(_rowToFlow);
}

export function updateFlowStatus(db, flowId, status) {
  const validStatuses = Object.values(FLOW_STATUS);
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid flow status: ${status}`);
  }
  _requireFlow(db, flowId);
  db.prepare(
    `UPDATE auto_flows SET status = ?, updated_at = ? WHERE id = ?`,
  ).run(status, _now(), flowId);
  return _rowToFlow(
    db.prepare(`SELECT * FROM auto_flows WHERE id = ?`).get(flowId),
  );
}

export function deleteFlow(db, flowId) {
  _requireFlow(db, flowId);
  db.prepare(`DELETE FROM auto_triggers WHERE flow_id = ?`).run(flowId);
  db.prepare(`DELETE FROM auto_executions WHERE flow_id = ?`).run(flowId);
  db.prepare(`DELETE FROM auto_flows WHERE id = ?`).run(flowId);
  return true;
}

export function scheduleFlow(db, flowId, cron) {
  if (!cron || typeof cron !== "string") {
    throw new Error("cron expression required");
  }
  _requireFlow(db, flowId);
  db.prepare(
    `UPDATE auto_flows SET schedule = ?, updated_at = ? WHERE id = ?`,
  ).run(cron, _now(), flowId);
  return getFlow(db, flowId);
}

export function shareFlow(db, flowId, targetOrg) {
  if (!targetOrg) throw new Error("targetOrg required");
  const row = _requireFlow(db, flowId);
  const flow = _rowToFlow(row);
  const set = new Set(flow.sharedWith);
  set.add(targetOrg);
  const shared = [...set];
  db.prepare(
    `UPDATE auto_flows SET shared_with = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(shared), _now(), flowId);
  return getFlow(db, flowId);
}

export function importTemplate(db, templateId, options = {}) {
  const template = getFlowTemplate(templateId);
  if (!template) throw new Error(`Template not found: ${templateId}`);
  const name = options.name || template.name;
  return createFlow(db, {
    name,
    description: options.description || template.description,
    nodes: template.nodes,
    edges: template.edges,
    createdBy: options.createdBy || null,
  });
}

/* ── Triggers ──────────────────────────────────────────────── */

export function addTrigger(db, flowId, options = {}) {
  const { type, config = {} } = options;
  if (!type) throw new Error("trigger type required");
  if (!Object.values(TRIGGER_TYPE).includes(type)) {
    throw new Error(`Unknown trigger type: ${type}`);
  }
  _requireFlow(db, flowId);

  if (type === TRIGGER_TYPE.SCHEDULE && !config.cron) {
    throw new Error("schedule trigger requires config.cron");
  }
  if (type === TRIGGER_TYPE.WEBHOOK && !config.url) {
    throw new Error("webhook trigger requires config.url");
  }
  if (type === TRIGGER_TYPE.EVENT && !config.event) {
    throw new Error("event trigger requires config.event");
  }
  if (type === TRIGGER_TYPE.CONDITION && !config.expression) {
    throw new Error("condition trigger requires config.expression");
  }

  const id = _genId("trig");
  const now = _now();
  db.prepare(
    `INSERT INTO auto_triggers
     (id, flow_id, type, config, enabled, last_triggered_at, trigger_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, flowId, type, JSON.stringify(config), 1, null, 0, now);

  return _rowToTrigger(
    db.prepare(`SELECT * FROM auto_triggers WHERE id = ?`).get(id),
  );
}

export function listTriggers(db, flowId) {
  const rows = flowId
    ? db
        .prepare(
          `SELECT * FROM auto_triggers WHERE flow_id = ? ORDER BY created_at DESC`,
        )
        .all(flowId)
    : db.prepare(`SELECT * FROM auto_triggers ORDER BY created_at DESC`).all();
  return rows.map(_rowToTrigger);
}

export function getTrigger(db, triggerId) {
  return _rowToTrigger(
    db.prepare(`SELECT * FROM auto_triggers WHERE id = ?`).get(triggerId),
  );
}

export function setTriggerEnabled(db, triggerId, enabled) {
  const trig = getTrigger(db, triggerId);
  if (!trig) throw new Error(`Trigger not found: ${triggerId}`);
  db.prepare(`UPDATE auto_triggers SET enabled = ? WHERE id = ?`).run(
    enabled ? 1 : 0,
    triggerId,
  );
  return getTrigger(db, triggerId);
}

/* ── Flow execution (simulation) ───────────────────────────── */

function _simulateNodeOutput(node, input) {
  if (node.type === "condition") {
    const result = _evalCondition(node.expression, input);
    return { branch: result ? "true" : "false", expression: node.expression };
  }
  if (node.type === "parallel") {
    return { parallel: true, branches: node.branches || [] };
  }
  if (node.type === "loop") {
    return { loop: true, iterations: node.iterations || 1 };
  }
  const conn = CONNECTOR_INDEX.get(node.connector);
  const action = node.action || "noop";
  return {
    simulated: true,
    connector: conn?.displayName || node.connector,
    action,
    input,
    output: {
      status: "ok",
      resourceId: _genId(action),
      timestamp: _now(),
    },
  };
}

function _evalCondition(expression, ctx) {
  // Safe-ish numeric comparison evaluator.
  // Supports: <, <=, >, >=, ==, != between ctx.<path> and a numeric literal,
  // or between two ctx.<path> refs. Anything else returns false.
  if (!expression || typeof expression !== "string") return false;
  const opMatch = expression.match(
    /^\s*ctx\.([\w.]+)\s*(<=|>=|==|!=|<|>)\s*([\w.]+|-?\d+(?:\.\d+)?)\s*$/,
  );
  if (!opMatch) return false;
  const [, lhsPath, op, rhsRaw] = opMatch;
  const lhs = _getByPath(ctx, lhsPath);
  let rhs;
  if (/^-?\d+(\.\d+)?$/.test(rhsRaw)) {
    rhs = parseFloat(rhsRaw);
  } else if (rhsRaw.startsWith("ctx.")) {
    rhs = _getByPath(ctx, rhsRaw.slice(4));
  } else {
    rhs = rhsRaw;
  }
  switch (op) {
    case "<":
      return lhs < rhs;
    case "<=":
      return lhs <= rhs;
    case ">":
      return lhs > rhs;
    case ">=":
      return lhs >= rhs;
    case "==":
      return lhs == rhs; // eslint-disable-line eqeqeq
    case "!=":
      return lhs != rhs; // eslint-disable-line eqeqeq
    default:
      return false;
  }
}

function _getByPath(obj, path) {
  if (!obj || !path) return undefined;
  let cur = obj;
  for (const part of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function _topoOrder(nodes, edges) {
  const idSet = new Set(nodes.map((n) => n.id));
  const incoming = new Map();
  const outgoing = new Map();
  for (const n of nodes) {
    incoming.set(n.id, new Set());
    outgoing.set(n.id, new Set());
  }
  for (const e of edges) {
    if (idSet.has(e.from) && idSet.has(e.to)) {
      incoming.get(e.to).add(e.from);
      outgoing.get(e.from).add(e.to);
    }
  }
  const result = [];
  const queue = [];
  for (const n of nodes) {
    if ((incoming.get(n.id)?.size || 0) === 0) queue.push(n.id);
  }
  while (queue.length > 0) {
    const id = queue.shift();
    result.push(id);
    for (const nextId of outgoing.get(id) || []) {
      incoming.get(nextId).delete(id);
      if (incoming.get(nextId).size === 0) queue.push(nextId);
    }
  }
  if (result.length !== nodes.length) {
    throw new Error("Flow has cycles — cannot execute");
  }
  const indexById = new Map(nodes.map((n) => [n.id, n]));
  return result.map((id) => indexById.get(id));
}

export function executeFlow(db, flowId, options = {}) {
  const flow = getFlow(db, flowId);
  if (!flow) throw new Error(`Flow not found: ${flowId}`);

  const {
    inputData = {},
    triggerType = TRIGGER_TYPE.MANUAL,
    testMode = false,
  } = options;
  const execId = _genId("exec");
  const startedAt = _now();
  const startMs = Date.now();

  db.prepare(
    `INSERT INTO auto_executions
     (id, flow_id, trigger_type, input_data, output_data, status, steps_log, duration_ms, error, test_mode, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    execId,
    flowId,
    triggerType,
    JSON.stringify(inputData),
    null,
    EXECUTION_STATUS.RUNNING,
    JSON.stringify([]),
    0,
    null,
    testMode ? 1 : 0,
    startedAt,
    null,
  );

  const stepsLog = [];
  let finalStatus = EXECUTION_STATUS.SUCCESS;
  let finalError = null;
  let outputData = null;

  try {
    const ordered = _topoOrder(flow.nodes, flow.edges);
    const stepInputs = new Map();
    stepInputs.set("__initial__", inputData);

    for (const node of ordered) {
      const stepStart = Date.now();
      const parentEdges = flow.edges.filter((e) => e.to === node.id);
      let merged;
      if (parentEdges.length === 0) {
        merged = inputData;
      } else if (parentEdges.length === 1) {
        merged = stepInputs.get(parentEdges[0].from) || {};
      } else {
        merged = {};
        for (const pe of parentEdges) {
          Object.assign(merged, stepInputs.get(pe.from) || {});
        }
      }
      const output = _simulateNodeOutput(node, merged);
      stepInputs.set(node.id, output.output || output);
      stepsLog.push({
        nodeId: node.id,
        nodeType: node.type || "action",
        connector: node.connector || null,
        action: node.action || null,
        status: "success",
        durationMs: Date.now() - stepStart,
        output,
      });
      outputData = output;
    }
  } catch (err) {
    finalStatus = EXECUTION_STATUS.FAILED;
    finalError = err.message;
  }

  const durationMs = Date.now() - startMs;
  const completedAt = _now();
  db.prepare(
    `UPDATE auto_executions SET output_data = ?, status = ?, steps_log = ?, duration_ms = ?, error = ?, completed_at = ? WHERE id = ?`,
  ).run(
    JSON.stringify(outputData),
    finalStatus,
    JSON.stringify(stepsLog),
    durationMs,
    finalError,
    completedAt,
    execId,
  );

  return _rowToExecution(
    db.prepare(`SELECT * FROM auto_executions WHERE id = ?`).get(execId),
  );
}

export function fireTrigger(db, triggerId, inputData = {}) {
  const trig = getTrigger(db, triggerId);
  if (!trig) throw new Error(`Trigger not found: ${triggerId}`);
  if (!trig.enabled) throw new Error(`Trigger disabled: ${triggerId}`);

  const flow = getFlow(db, trig.flowId);
  if (!flow) throw new Error(`Flow not found: ${trig.flowId}`);
  if (flow.status === FLOW_STATUS.ARCHIVED) {
    throw new Error(`Flow archived: ${trig.flowId}`);
  }
  if (flow.status === FLOW_STATUS.PAUSED) {
    throw new Error(`Flow paused: ${trig.flowId}`);
  }

  const now = _now();
  // trigger_count increment read-modify-write (MockDatabase can't parse `col = col + 1`)
  const currentTrig = db
    .prepare(`SELECT * FROM auto_triggers WHERE id = ?`)
    .get(triggerId);
  const newCount = (currentTrig?.trigger_count || 0) + 1;
  db.prepare(
    `UPDATE auto_triggers SET last_triggered_at = ?, trigger_count = ? WHERE id = ?`,
  ).run(now, newCount, triggerId);

  return executeFlow(db, trig.flowId, {
    inputData,
    triggerType: trig.type,
  });
}

export function getExecution(db, execId) {
  return _rowToExecution(
    db.prepare(`SELECT * FROM auto_executions WHERE id = ?`).get(execId),
  );
}

export function listExecutions(db, filters = {}) {
  const { flowId, status, limit = 50 } = filters;
  let rows;
  if (flowId && status) {
    rows = db
      .prepare(
        `SELECT * FROM auto_executions WHERE flow_id = ? AND status = ? ORDER BY started_at DESC LIMIT ?`,
      )
      .all(flowId, status, limit);
  } else if (flowId) {
    rows = db
      .prepare(
        `SELECT * FROM auto_executions WHERE flow_id = ? ORDER BY started_at DESC LIMIT ?`,
      )
      .all(flowId, limit);
  } else if (status) {
    rows = db
      .prepare(
        `SELECT * FROM auto_executions WHERE status = ? ORDER BY started_at DESC LIMIT ?`,
      )
      .all(status, limit);
  } else {
    rows = db
      .prepare(`SELECT * FROM auto_executions ORDER BY started_at DESC LIMIT ?`)
      .all(limit);
  }
  return rows.map(_rowToExecution);
}

/* ── Stats ─────────────────────────────────────────────────── */

export function getStats(db) {
  const flowsByStatus = {};
  for (const status of Object.values(FLOW_STATUS)) flowsByStatus[status] = 0;
  for (const row of db.data?.get("auto_flows") || []) {
    flowsByStatus[row.status] = (flowsByStatus[row.status] || 0) + 1;
  }

  const execByStatus = {};
  for (const status of Object.values(EXECUTION_STATUS))
    execByStatus[status] = 0;
  let totalDuration = 0;
  let execCount = 0;
  for (const row of db.data?.get("auto_executions") || []) {
    execByStatus[row.status] = (execByStatus[row.status] || 0) + 1;
    totalDuration += row.duration_ms || 0;
    execCount++;
  }

  const triggersByType = {};
  for (const type of Object.values(TRIGGER_TYPE)) triggersByType[type] = 0;
  for (const row of db.data?.get("auto_triggers") || []) {
    triggersByType[row.type] = (triggersByType[row.type] || 0) + 1;
  }

  const successRate =
    execCount > 0
      ? (execByStatus[EXECUTION_STATUS.SUCCESS] || 0) / execCount
      : 0;
  const avgDurationMs = execCount > 0 ? totalDuration / execCount : 0;

  return {
    flows: {
      total: Object.values(flowsByStatus).reduce((a, b) => a + b, 0),
      byStatus: flowsByStatus,
    },
    executions: {
      total: execCount,
      byStatus: execByStatus,
      successRate,
      avgDurationMs,
    },
    triggers: {
      total: Object.values(triggersByType).reduce((a, b) => a + b, 0),
      byType: triggersByType,
    },
    connectors: CONNECTOR_CATALOG.length,
    templates: FLOW_TEMPLATES.length,
  };
}

/* ── Config ────────────────────────────────────────────────── */

export function getConfig() {
  return {
    connectors: CONNECTOR_CATALOG.length,
    templates: FLOW_TEMPLATES.length,
    flowStatuses: Object.values(FLOW_STATUS),
    executionStatuses: Object.values(EXECUTION_STATUS),
    triggerTypes: Object.values(TRIGGER_TYPE),
    nodeTypes: Object.values(NODE_TYPE),
  };
}
