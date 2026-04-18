/**
 * Automation Engine commands — Phase 96 工作流自动化引擎 CLI.
 * `cc automation ...` (alias `cc auto`).
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureAutomationTables,
  listConnectors,
  getConnector,
  listFlowTemplates,
  getFlowTemplate,
  createFlow,
  getFlow,
  listFlows,
  updateFlowStatus,
  deleteFlow,
  scheduleFlow,
  shareFlow,
  importTemplate,
  addTrigger,
  listTriggers,
  getTrigger,
  setTriggerEnabled,
  executeFlow,
  fireTrigger,
  getExecution,
  listExecutions,
  getStats,
  getConfig,
  FLOW_STATUS,
  EXECUTION_STATUS,
  TRIGGER_TYPE,
  AUTOMATION_MATURITY_V2,
  EXECUTION_LIFECYCLE_V2,
  getMaxActiveAutomationsPerOwnerV2,
  setMaxActiveAutomationsPerOwnerV2,
  getMaxRunningExecutionsPerAutomationV2,
  setMaxRunningExecutionsPerAutomationV2,
  getAutomationIdleMsV2,
  setAutomationIdleMsV2,
  getExecutionStuckMsV2,
  setExecutionStuckMsV2,
  registerAutomationV2,
  getAutomationV2,
  listAutomationsV2,
  setAutomationStatusV2,
  activateAutomationV2,
  pauseAutomationV2,
  retireAutomationV2,
  touchAutomationV2,
  getActiveAutomationCountV2,
  createExecutionV2,
  getExecutionV2 as getExecutionV2Surface,
  listExecutionsV2,
  setExecutionStatusV2,
  startExecutionV2,
  succeedExecutionV2,
  failExecutionV2,
  cancelExecutionV2,
  getRunningExecutionCountV2,
  autoPauseIdleAutomationsV2,
  autoFailStuckExecutionsV2,
  getAutomationEngineStatsV2,
} from "../lib/automation-engine.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

async function _prepare(cmd) {
  const verbose = cmd?.parent?.parent?.opts?.()?.verbose;
  const ctx = await bootstrap({ verbose });
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureAutomationTables(db);
  return db;
}

function _parseJsonArg(value, label) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch (_e) {
    throw new Error(`Invalid JSON for ${label}`);
  }
}

export function registerAutomationCommand(program) {
  const make = (name) => {
    const cmd = program
      .command(name)
      .description(
        "Workflow automation engine — 12 SaaS connectors + triggers (Phase 96)",
      )
      .hook("preAction", async (thisCommand, actionCommand) => {
        if (actionCommand && actionCommand.name().endsWith("-v2")) return;
        const db = await _prepare(thisCommand);
        thisCommand._db = db;
      });
    return cmd;
  };

  const automation = make("automation");
  const auto = make("auto");

  for (const root of [automation, auto]) {
    _wire(root);
  }
}

function _wire(root) {
  // ─── Catalog ──────────────────────────────────────────────

  root
    .command("connectors")
    .description("List 12 built-in SaaS connectors")
    .option("--json", "Output as JSON")
    .action((options) => {
      const list = listConnectors();
      if (options.json) {
        console.log(JSON.stringify(list, null, 2));
        return;
      }
      logger.info(`${list.length} connectors`);
      for (const c of list) {
        logger.log(
          `  ${chalk.cyan(c.id.padEnd(12))} ${chalk.dim(c.category.padEnd(10))} ${c.actions.join(", ")}`,
        );
      }
    });

  root
    .command("trigger-types")
    .description("List trigger types")
    .option("--json", "Output as JSON")
    .action((options) => {
      const types = Object.values(TRIGGER_TYPE);
      if (options.json) {
        console.log(JSON.stringify(types, null, 2));
        return;
      }
      for (const t of types) logger.log(`  ${chalk.cyan(t)}`);
    });

  root
    .command("statuses")
    .description("List flow and execution statuses")
    .action(() => {
      logger.log(chalk.bold("Flow statuses:"));
      for (const s of Object.values(FLOW_STATUS)) logger.log(`  ${s}`);
      logger.log(chalk.bold("Execution statuses:"));
      for (const s of Object.values(EXECUTION_STATUS)) logger.log(`  ${s}`);
    });

  root
    .command("config")
    .description("Show automation engine config")
    .option("--json", "Output as JSON")
    .action((options) => {
      const cfg = getConfig();
      if (options.json) {
        console.log(JSON.stringify(cfg, null, 2));
        return;
      }
      logger.info(`${cfg.connectors} connectors, ${cfg.templates} templates`);
      logger.log(`  flow-statuses: ${cfg.flowStatuses.join(", ")}`);
      logger.log(`  exec-statuses: ${cfg.executionStatuses.join(", ")}`);
      logger.log(`  trigger-types: ${cfg.triggerTypes.join(", ")}`);
      logger.log(`  node-types:    ${cfg.nodeTypes.join(", ")}`);
    });

  // ─── Flow CRUD ────────────────────────────────────────────

  root
    .command("create")
    .description("Create a flow")
    .requiredOption("-n, --name <name>", "Flow name")
    .option("-d, --description <text>", "Flow description")
    .option(
      "-N, --nodes <json>",
      'Nodes array as JSON (e.g. \'[{"id":"n1","type":"action","connector":"slack","action":"postMessage"}]\')',
    )
    .option("-E, --edges <json>", "Edges array as JSON")
    .option("-u, --created-by <userId>", "Creator user ID")
    .option("-s, --schedule <cron>", "Cron expression")
    .action(async (opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const flow = createFlow(db, {
          name: opts.name,
          description: opts.description,
          nodes: _parseJsonArg(opts.nodes, "--nodes") || [],
          edges: _parseJsonArg(opts.edges, "--edges") || [],
          createdBy: opts.createdBy,
          schedule: opts.schedule,
        });
        logger.success(`Flow created: ${chalk.cyan(flow.id)}`);
        logger.log(`  name:   ${flow.name}`);
        logger.log(`  status: ${flow.status}`);
        logger.log(`  nodes:  ${flow.nodes.length}`);
        logger.log(`  edges:  ${flow.edges.length}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("flows")
    .description("List flows")
    .option("-s, --status <status>", "Filter by status")
    .option("-l, --limit <n>", "Limit", "50")
    .option("--json", "Output as JSON")
    .action(async (opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const rows = listFlows(db, {
          status: opts.status,
          limit: parseInt(opts.limit, 10),
        });
        if (opts.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        if (rows.length === 0) {
          logger.info("No flows");
          return;
        }
        logger.info(`${rows.length} flows`);
        for (const f of rows) {
          logger.log(
            `  ${chalk.cyan(f.id)} ${chalk.dim(f.status.padEnd(8))} ${f.name} (${f.nodes.length}n/${f.edges.length}e)`,
          );
        }
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("show <flowId>")
    .description("Show flow detail")
    .option("--json", "Output as JSON")
    .action(async (flowId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const flow = getFlow(db, flowId);
        if (!flow) {
          logger.error(`Flow not found: ${flowId}`);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(flow, null, 2));
          return;
        }
        logger.log(`${chalk.bold("ID:")}       ${flow.id}`);
        logger.log(`${chalk.bold("Name:")}     ${flow.name}`);
        logger.log(`${chalk.bold("Status:")}   ${flow.status}`);
        logger.log(`${chalk.bold("Schedule:")} ${flow.schedule || "—"}`);
        logger.log(`${chalk.bold("Nodes:")}    ${flow.nodes.length}`);
        for (const n of flow.nodes) {
          logger.log(
            `  - ${chalk.cyan(n.id)} ${n.type || "action"} ${n.connector || ""}${n.action ? "." + n.action : ""}`,
          );
        }
        logger.log(`${chalk.bold("Edges:")}    ${flow.edges.length}`);
        for (const e of flow.edges) {
          logger.log(`  - ${e.from} → ${e.to}`);
        }
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("activate <flowId>")
    .description("Set flow status = active")
    .action(async (flowId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const flow = updateFlowStatus(db, flowId, FLOW_STATUS.ACTIVE);
        logger.success(`Flow ${flow.id} → active`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("pause <flowId>")
    .description("Set flow status = paused")
    .action(async (flowId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const flow = updateFlowStatus(db, flowId, FLOW_STATUS.PAUSED);
        logger.success(`Flow ${flow.id} → paused`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("archive <flowId>")
    .description("Set flow status = archived")
    .action(async (flowId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const flow = updateFlowStatus(db, flowId, FLOW_STATUS.ARCHIVED);
        logger.success(`Flow ${flow.id} → archived`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("delete <flowId>")
    .description("Delete a flow (cascades triggers + executions)")
    .action(async (flowId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        deleteFlow(db, flowId);
        logger.success(`Flow deleted: ${flowId}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("schedule <flowId>")
    .description("Set flow cron schedule")
    .requiredOption("-c, --cron <expr>", "Cron expression")
    .action(async (flowId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const flow = scheduleFlow(db, flowId, opts.cron);
        logger.success(`Flow ${flow.id} scheduled: ${flow.schedule}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("share <flowId>")
    .description("Record flow share to another org")
    .requiredOption("-o, --org <targetOrg>", "Target org ID")
    .action(async (flowId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const flow = shareFlow(db, flowId, opts.org);
        logger.success(
          `Shared ${flow.id} with [${flow.sharedWith.join(", ")}]`,
        );
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  // ─── Templates ────────────────────────────────────────────

  root
    .command("templates")
    .description("List built-in flow templates")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const list = listFlowTemplates();
      if (opts.json) {
        console.log(JSON.stringify(list, null, 2));
        return;
      }
      for (const t of list) {
        logger.log(`  ${chalk.cyan(t.id.padEnd(26))} ${chalk.dim(t.name)}`);
        logger.log(`     ${t.description}`);
      }
    });

  root
    .command("import-template <templateId>")
    .description("Import a built-in template as a flow")
    .option("-n, --name <name>", "Override flow name")
    .option("-u, --created-by <userId>", "Creator user ID")
    .action(async (templateId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const flow = importTemplate(db, templateId, {
          name: opts.name,
          createdBy: opts.createdBy,
        });
        logger.success(
          `Imported ${templateId} → ${chalk.cyan(flow.id)} (${flow.name})`,
        );
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  // ─── Triggers ─────────────────────────────────────────────

  root
    .command("add-trigger <flowId>")
    .description("Add a trigger to a flow")
    .requiredOption(
      "-t, --type <type>",
      "Trigger type (webhook|schedule|event|condition|manual)",
    )
    .requiredOption("-c, --config <json>", "Trigger config as JSON")
    .action(async (flowId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const trig = addTrigger(db, flowId, {
          type: opts.type,
          config: _parseJsonArg(opts.config, "--config") || {},
        });
        logger.success(`Trigger added: ${chalk.cyan(trig.id)}`);
        logger.log(`  flow: ${trig.flowId}`);
        logger.log(`  type: ${trig.type}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("triggers [flowId]")
    .description("List triggers (optionally scoped to a flow)")
    .option("--json", "Output as JSON")
    .action(async (flowId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const rows = listTriggers(db, flowId);
        if (opts.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        if (rows.length === 0) {
          logger.info("No triggers");
          return;
        }
        for (const t of rows) {
          logger.log(
            `  ${chalk.cyan(t.id)} ${chalk.dim(t.type.padEnd(10))} flow=${t.flowId} fires=${t.triggerCount} ${t.enabled ? "" : chalk.red("(disabled)")}`,
          );
        }
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("enable-trigger <triggerId>")
    .description("Enable a trigger")
    .action(async (triggerId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const trig = setTriggerEnabled(db, triggerId, true);
        logger.success(`Trigger ${trig.id} enabled`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("disable-trigger <triggerId>")
    .description("Disable a trigger")
    .action(async (triggerId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const trig = setTriggerEnabled(db, triggerId, false);
        logger.success(`Trigger ${trig.id} disabled`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("fire-trigger <triggerId>")
    .description("Simulate trigger firing (executes flow)")
    .option("-i, --input <json>", "Input data as JSON")
    .action(async (triggerId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const input = _parseJsonArg(opts.input, "--input") || {};
        const exec = fireTrigger(db, triggerId, input);
        logger.success(`Fired trigger → exec ${chalk.cyan(exec.id)}`);
        logger.log(`  status:   ${exec.status}`);
        logger.log(`  duration: ${exec.durationMs}ms`);
        logger.log(`  steps:    ${exec.stepsLog.length}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  // ─── Execution ────────────────────────────────────────────

  root
    .command("execute <flowId>")
    .description("Manually execute a flow (simulated)")
    .option("-i, --input <json>", "Input data as JSON")
    .option("--test", "Test mode (marks execution as test)")
    .action(async (flowId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const input = _parseJsonArg(opts.input, "--input") || {};
        const exec = executeFlow(db, flowId, {
          inputData: input,
          testMode: Boolean(opts.test),
        });
        logger.success(`Execution ${chalk.cyan(exec.id)} → ${exec.status}`);
        logger.log(`  duration: ${exec.durationMs}ms`);
        logger.log(`  steps:    ${exec.stepsLog.length}`);
        if (exec.error) logger.log(chalk.red(`  error: ${exec.error}`));
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("exec-show <execId>")
    .description("Show execution detail")
    .option("--json", "Output as JSON")
    .action(async (execId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const exec = getExecution(db, execId);
        if (!exec) {
          logger.error(`Execution not found: ${execId}`);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(exec, null, 2));
          return;
        }
        logger.log(`${chalk.bold("ID:")}       ${exec.id}`);
        logger.log(`${chalk.bold("Flow:")}     ${exec.flowId}`);
        logger.log(`${chalk.bold("Trigger:")}  ${exec.triggerType}`);
        logger.log(`${chalk.bold("Status:")}   ${exec.status}`);
        logger.log(`${chalk.bold("Duration:")} ${exec.durationMs}ms`);
        logger.log(`${chalk.bold("Test:")}     ${exec.testMode}`);
        logger.log(chalk.bold("Steps:"));
        for (const s of exec.stepsLog) {
          logger.log(
            `  ${chalk.cyan(s.nodeId)} ${s.nodeType} ${s.connector || ""}${s.action ? "." + s.action : ""} → ${s.status} ${s.durationMs}ms`,
          );
        }
        if (exec.error) logger.log(chalk.red(`Error: ${exec.error}`));
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  root
    .command("logs")
    .description("List executions")
    .option("-f, --flow <flowId>", "Filter by flow ID")
    .option("-s, --status <status>", "Filter by status")
    .option("-l, --limit <n>", "Limit", "50")
    .option("--json", "Output as JSON")
    .action(async (opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const rows = listExecutions(db, {
          flowId: opts.flow,
          status: opts.status,
          limit: parseInt(opts.limit, 10),
        });
        if (opts.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        if (rows.length === 0) {
          logger.info("No executions");
          return;
        }
        for (const e of rows) {
          logger.log(
            `  ${chalk.cyan(e.id)} ${chalk.dim(e.status.padEnd(9))} flow=${e.flowId} ${e.durationMs}ms via ${e.triggerType}`,
          );
        }
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  // ─── Stats ────────────────────────────────────────────────

  root
    .command("stats")
    .description("Show automation engine stats")
    .option("--json", "Output as JSON")
    .action(async (opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const s = getStats(db);
        if (opts.json) {
          console.log(JSON.stringify(s, null, 2));
          return;
        }
        logger.log(chalk.bold("Flows"));
        logger.log(`  total: ${s.flows.total}`);
        for (const [k, v] of Object.entries(s.flows.byStatus)) {
          logger.log(`    ${k.padEnd(10)} ${v}`);
        }
        logger.log(chalk.bold("Executions"));
        logger.log(`  total: ${s.executions.total}`);
        logger.log(
          `  success rate: ${(s.executions.successRate * 100).toFixed(1)}%`,
        );
        logger.log(
          `  avg duration: ${s.executions.avgDurationMs.toFixed(1)}ms`,
        );
        for (const [k, v] of Object.entries(s.executions.byStatus)) {
          logger.log(`    ${k.padEnd(10)} ${v}`);
        }
        logger.log(chalk.bold("Triggers"));
        logger.log(`  total: ${s.triggers.total}`);
        for (const [k, v] of Object.entries(s.triggers.byType)) {
          logger.log(`    ${k.padEnd(10)} ${v}`);
        }
        logger.log(
          chalk.dim(`Connectors: ${s.connectors}  Templates: ${s.templates}`),
        );
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  // ── V2 Surface ──

  const outV2 = (obj) => console.log(JSON.stringify(obj, null, 2));
  const tryRunV2 = (fn) => {
    try {
      fn();
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  };

  root
    .command("automation-maturities-v2")
    .description("List V2 automation maturity states")
    .action(() => outV2(Object.values(AUTOMATION_MATURITY_V2)));

  root
    .command("execution-lifecycles-v2")
    .description("List V2 execution lifecycle states")
    .action(() => outV2(Object.values(EXECUTION_LIFECYCLE_V2)));

  root
    .command("stats-v2")
    .description("V2 automation engine stats")
    .action(() => outV2(getAutomationEngineStatsV2()));

  root
    .command("get-max-active-automations-v2")
    .description("Get max active automations per owner (V2)")
    .action(() =>
      outV2({
        maxActiveAutomationsPerOwner: getMaxActiveAutomationsPerOwnerV2(),
      }),
    );

  root
    .command("set-max-active-automations-v2 <n>")
    .description("Set max active automations per owner (V2)")
    .action((n) =>
      tryRunV2(() => {
        setMaxActiveAutomationsPerOwnerV2(Number(n));
        outV2({
          maxActiveAutomationsPerOwner: getMaxActiveAutomationsPerOwnerV2(),
        });
      }),
    );

  root
    .command("get-max-running-executions-v2")
    .description("Get max running executions per automation (V2)")
    .action(() =>
      outV2({
        maxRunningExecutionsPerAutomation:
          getMaxRunningExecutionsPerAutomationV2(),
      }),
    );

  root
    .command("set-max-running-executions-v2 <n>")
    .description("Set max running executions per automation (V2)")
    .action((n) =>
      tryRunV2(() => {
        setMaxRunningExecutionsPerAutomationV2(Number(n));
        outV2({
          maxRunningExecutionsPerAutomation:
            getMaxRunningExecutionsPerAutomationV2(),
        });
      }),
    );

  root
    .command("get-automation-idle-ms-v2")
    .description("Get automation idle threshold (V2)")
    .action(() => outV2({ automationIdleMs: getAutomationIdleMsV2() }));

  root
    .command("set-automation-idle-ms-v2 <ms>")
    .description("Set automation idle threshold (V2)")
    .action((ms) =>
      tryRunV2(() => {
        setAutomationIdleMsV2(Number(ms));
        outV2({ automationIdleMs: getAutomationIdleMsV2() });
      }),
    );

  root
    .command("get-execution-stuck-ms-v2")
    .description("Get execution stuck threshold (V2)")
    .action(() => outV2({ executionStuckMs: getExecutionStuckMsV2() }));

  root
    .command("set-execution-stuck-ms-v2 <ms>")
    .description("Set execution stuck threshold (V2)")
    .action((ms) =>
      tryRunV2(() => {
        setExecutionStuckMsV2(Number(ms));
        outV2({ executionStuckMs: getExecutionStuckMsV2() });
      }),
    );

  root
    .command("active-automation-count-v2 <ownerId>")
    .description("Active automation count for owner (V2)")
    .action((ownerId) =>
      outV2({ ownerId, count: getActiveAutomationCountV2(ownerId) }),
    );

  root
    .command("running-execution-count-v2 <automationId>")
    .description("Running execution count for automation (V2)")
    .action((automationId) =>
      outV2({
        automationId,
        count: getRunningExecutionCountV2(automationId),
      }),
    );

  root
    .command("register-automation-v2 <id>")
    .description("Register a V2 automation")
    .requiredOption("-o, --owner <id>", "owner id")
    .requiredOption("-n, --name <name>", "automation name")
    .action((id, opts) =>
      tryRunV2(() =>
        outV2(
          registerAutomationV2(id, { ownerId: opts.owner, name: opts.name }),
        ),
      ),
    );

  root
    .command("get-automation-v2 <id>")
    .description("Get a V2 automation")
    .action((id) => outV2(getAutomationV2(id)));

  root
    .command("list-automations-v2")
    .description("List V2 automations")
    .option("-o, --owner <id>", "filter by owner")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      outV2(listAutomationsV2({ ownerId: opts.owner, status: opts.status })),
    );

  root
    .command("set-automation-status-v2 <id> <next>")
    .description("Set V2 automation status")
    .action((id, next) =>
      tryRunV2(() => outV2(setAutomationStatusV2(id, next))),
    );

  root
    .command("activate-automation-v2 <id>")
    .description("Activate a V2 automation")
    .action((id) => tryRunV2(() => outV2(activateAutomationV2(id))));

  root
    .command("pause-automation-v2 <id>")
    .description("Pause a V2 automation")
    .action((id) => tryRunV2(() => outV2(pauseAutomationV2(id))));

  root
    .command("retire-automation-v2 <id>")
    .description("Retire a V2 automation")
    .action((id) => tryRunV2(() => outV2(retireAutomationV2(id))));

  root
    .command("touch-automation-v2 <id>")
    .description("Touch a V2 automation")
    .action((id) => tryRunV2(() => outV2(touchAutomationV2(id))));

  root
    .command("create-execution-v2 <id>")
    .description("Create a V2 execution")
    .requiredOption("-a, --automation <id>", "automation id")
    .action((id, opts) =>
      tryRunV2(() =>
        outV2(createExecutionV2(id, { automationId: opts.automation })),
      ),
    );

  root
    .command("get-execution-v2 <id>")
    .description("Get a V2 execution")
    .action((id) => outV2(getExecutionV2Surface(id)));

  root
    .command("list-executions-v2")
    .description("List V2 executions")
    .option("-a, --automation <id>", "filter by automation")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      outV2(
        listExecutionsV2({
          automationId: opts.automation,
          status: opts.status,
        }),
      ),
    );

  root
    .command("set-execution-status-v2 <id> <next>")
    .description("Set V2 execution status")
    .action((id, next) =>
      tryRunV2(() => outV2(setExecutionStatusV2(id, next))),
    );

  root
    .command("start-execution-v2 <id>")
    .description("Start a V2 execution")
    .action((id) => tryRunV2(() => outV2(startExecutionV2(id))));

  root
    .command("succeed-execution-v2 <id>")
    .description("Succeed a V2 execution")
    .action((id) => tryRunV2(() => outV2(succeedExecutionV2(id))));

  root
    .command("fail-execution-v2 <id>")
    .description("Fail a V2 execution")
    .action((id) => tryRunV2(() => outV2(failExecutionV2(id))));

  root
    .command("cancel-execution-v2 <id>")
    .description("Cancel a V2 execution")
    .action((id) => tryRunV2(() => outV2(cancelExecutionV2(id))));

  root
    .command("auto-pause-idle-automations-v2")
    .description("Auto-pause idle V2 automations")
    .action(() => outV2(autoPauseIdleAutomationsV2()));

  root
    .command("auto-fail-stuck-executions-v2")
    .description("Auto-fail stuck V2 executions")
    .action(() => outV2(autoFailStuckExecutionsV2()));
}
