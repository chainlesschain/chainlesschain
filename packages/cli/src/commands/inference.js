/**
 * `cc inference` — CLI surface for Phase 67 Decentralized Inference Network.
 */

import { Command } from "commander";

import {
  NODE_STATUS,
  TASK_STATUS,
  PRIVACY_MODE,
  DEFAULT_CONFIG,
  ensureInferenceTables,
  registerNode,
  unregisterNode,
  heartbeat,
  updateNodeStatus,
  getNode,
  listNodes,
  submitTask,
  completeTask,
  failTask,
  getTask,
  listTasks,
  getSchedulerStats,
} from "../lib/inference-network.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

export function registerInferenceCommand(program) {
  const inf = new Command("inference")
    .description("Decentralized inference network (Phase 67)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureInferenceTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  inf
    .command("node-statuses")
    .description("List node statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const statuses = Object.values(NODE_STATUS);
      if (opts.json) return console.log(JSON.stringify(statuses, null, 2));
      for (const s of statuses) console.log(`  ${s}`);
    });

  inf
    .command("task-statuses")
    .description("List task statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const statuses = Object.values(TASK_STATUS);
      if (opts.json) return console.log(JSON.stringify(statuses, null, 2));
      for (const s of statuses) console.log(`  ${s}`);
    });

  inf
    .command("privacy-modes")
    .description("List privacy modes")
    .option("--json", "JSON output")
    .action((opts) => {
      const modes = Object.values(PRIVACY_MODE);
      if (opts.json) return console.log(JSON.stringify(modes, null, 2));
      for (const m of modes) console.log(`  ${m}`);
    });

  /* ── Node Registry ───────────────────────────────── */

  inf
    .command("register <node-id>")
    .description("Register inference node")
    .option("-e, --endpoint <url>", "Node endpoint URL")
    .option("-c, --capabilities <list>", "Comma-separated capabilities")
    .option("-g, --gpu <mb>", "GPU memory in MB", parseInt)
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const db = _dbFromCtx(inf);
      const caps = opts.capabilities ? opts.capabilities.split(",") : [];
      const result = registerNode(db, nodeId, {
        endpoint: opts.endpoint,
        capabilities: caps,
        gpuMemory: opts.gpu,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.nodeId) console.log(`Node registered: ${result.nodeId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  inf
    .command("unregister <id>")
    .description("Unregister inference node")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(inf);
      const result = unregisterNode(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.removed ? "Node unregistered." : `Failed: ${result.reason}`,
      );
    });

  inf
    .command("heartbeat <id>")
    .description("Send node heartbeat")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(inf);
      const result = heartbeat(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.updated
          ? `Heartbeat OK (status=${result.status})`
          : `Failed: ${result.reason}`,
      );
    });

  inf
    .command("node-status <id> <status>")
    .description("Update node status")
    .option("--json", "JSON output")
    .action((id, status, opts) => {
      const db = _dbFromCtx(inf);
      const result = updateNodeStatus(db, id, status);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.updated ? "Node status updated." : `Failed: ${result.reason}`,
      );
    });

  inf
    .command("show-node <id>")
    .description("Show node details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(inf);
      const n = getNode(db, id);
      if (!n) return console.log("Node not found.");
      if (opts.json) return console.log(JSON.stringify(n, null, 2));
      console.log(`ID:           ${n.id}`);
      console.log(`Node ID:      ${n.node_id}`);
      console.log(`Status:       ${n.status}`);
      if (n.endpoint) console.log(`Endpoint:     ${n.endpoint}`);
      console.log(`GPU:          ${n.gpu_memory_mb} MB`);
      console.log(`Tasks:        ${n.task_count}`);
      console.log(
        `Capabilities: ${Array.isArray(n.capabilities) ? n.capabilities.join(", ") : "none"}`,
      );
    });

  inf
    .command("nodes")
    .description("List inference nodes")
    .option("-s, --status <status>", "Filter by status")
    .option("-c, --capability <cap>", "Filter by capability")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(inf);
      const nodes = listNodes(db, {
        status: opts.status,
        capability: opts.capability,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(nodes, null, 2));
      if (nodes.length === 0) return console.log("No nodes.");
      for (const n of nodes) {
        console.log(
          `  ${n.status.padEnd(10)} ${n.node_id.padEnd(20)} gpu=${n.gpu_memory_mb}MB  tasks=${n.task_count}  ${n.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Task Scheduler ──────────────────────────────── */

  inf
    .command("submit <model>")
    .description("Submit inference task")
    .option("-i, --input <text>", "Input data")
    .option("-p, --priority <n>", "Priority (1-10)", parseInt)
    .option("-m, --mode <mode>", "Privacy mode (standard/encrypted/federated)")
    .option("--json", "JSON output")
    .action((model, opts) => {
      const db = _dbFromCtx(inf);
      const result = submitTask(db, model, {
        input: opts.input,
        privacyMode: opts.mode,
        priority: opts.priority,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.taskId) {
        console.log(`Task submitted: ${result.taskId}`);
        console.log(`Status: ${result.status}`);
        if (result.assignedNode)
          console.log(`Assigned: ${result.assignedNode}`);
      } else console.log(`Failed: ${result.reason}`);
    });

  inf
    .command("complete <task-id>")
    .description("Mark task as complete")
    .option("-o, --output <text>", "Task output")
    .option("-d, --duration <ms>", "Duration in ms", parseInt)
    .option("--json", "JSON output")
    .action((taskId, opts) => {
      const db = _dbFromCtx(inf);
      const result = completeTask(db, taskId, {
        output: opts.output,
        durationMs: opts.duration,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.completed
          ? `Task completed (${result.durationMs}ms)`
          : `Failed: ${result.reason}`,
      );
    });

  inf
    .command("fail-task <task-id>")
    .description("Mark task as failed")
    .option("-e, --error <text>", "Error message")
    .option("--json", "JSON output")
    .action((taskId, opts) => {
      const db = _dbFromCtx(inf);
      const result = failTask(db, taskId, { error: opts.error });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.failed ? "Task marked as failed." : `Failed: ${result.reason}`,
      );
    });

  inf
    .command("show-task <task-id>")
    .description("Show task details")
    .option("--json", "JSON output")
    .action((taskId, opts) => {
      const db = _dbFromCtx(inf);
      const t = getTask(db, taskId);
      if (!t) return console.log("Task not found.");
      if (opts.json) return console.log(JSON.stringify(t, null, 2));
      console.log(`ID:       ${t.id}`);
      console.log(`Model:    ${t.model}`);
      console.log(`Status:   ${t.status}`);
      console.log(`Priority: ${t.priority}`);
      console.log(`Privacy:  ${t.privacy_mode}`);
      if (t.assigned_node) console.log(`Node:     ${t.assigned_node}`);
      if (t.input) console.log(`Input:    ${t.input}`);
      if (t.output) console.log(`Output:   ${t.output}`);
      if (t.duration_ms) console.log(`Duration: ${t.duration_ms}ms`);
    });

  inf
    .command("tasks")
    .description("List inference tasks")
    .option("-s, --status <status>", "Filter by status")
    .option("-m, --model <model>", "Filter by model")
    .option("-p, --privacy <mode>", "Filter by privacy mode")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(inf);
      const tasks = listTasks(db, {
        status: opts.status,
        model: opts.model,
        privacyMode: opts.privacy,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(tasks, null, 2));
      if (tasks.length === 0) return console.log("No tasks.");
      for (const t of tasks) {
        console.log(
          `  ${t.status.padEnd(12)} ${t.model.padEnd(16)} prio=${t.priority}  ${t.privacy_mode.padEnd(10)} ${t.id.slice(0, 8)}`,
        );
      }
    });

  /* ── Stats ───────────────────────────────────────── */

  inf
    .command("stats")
    .description("Inference network statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(inf);
      const stats = getSchedulerStats(db);
      if (opts.json) return console.log(JSON.stringify(stats, null, 2));
      const n = stats.nodes;
      console.log(
        `Nodes:  ${n.total} total  (${n.online} online, ${n.offline} offline, ${n.busy} busy)`,
      );
      const t = stats.tasks;
      console.log(
        `Tasks:  ${t.total} total  (${t.queued} queued, ${t.completed} completed, ${t.failed} failed)`,
      );
      if (t.avgDurationMs > 0) console.log(`Avg latency: ${t.avgDurationMs}ms`);
    });

  program.addCommand(inf);
}
