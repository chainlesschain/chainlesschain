/**
 * `cc federation` — CLI surface for Phase 58 Federation Hardening.
 */

import { Command } from "commander";

import {
  CIRCUIT_STATE,
  HEALTH_STATUS,
  HEALTH_METRIC,
  POOL_DEFAULTS,
  ensureFederationHardeningTables,
  registerNode,
  getCircuitBreaker,
  listCircuitBreakers,
  recordFailure,
  recordSuccess,
  tryHalfOpen,
  resetCircuitBreaker,
  removeNode,
  recordHealthCheck,
  getHealthCheck,
  listHealthChecks,
  getNodeHealth,
  initPool,
  acquireConnection,
  releaseConnection,
  getPoolStats,
  listPools,
  destroyPool,
  getFederationHardeningStats,
} from "../lib/federation-hardening.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

export function registerFederationCommand(program) {
  const fed = new Command("federation")
    .description("Federation hardening system (Phase 58)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureFederationHardeningTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  fed
    .command("circuit-states")
    .description("List circuit breaker states")
    .option("--json", "JSON output")
    .action((opts) => {
      const states = Object.values(CIRCUIT_STATE);
      if (opts.json) return console.log(JSON.stringify(states, null, 2));
      for (const s of states) console.log(`  ${s}`);
    });

  fed
    .command("health-statuses")
    .description("List health statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const statuses = Object.values(HEALTH_STATUS);
      if (opts.json) return console.log(JSON.stringify(statuses, null, 2));
      for (const s of statuses) console.log(`  ${s}`);
    });

  fed
    .command("health-metrics")
    .description("List health check metric types")
    .option("--json", "JSON output")
    .action((opts) => {
      const metrics = Object.values(HEALTH_METRIC);
      if (opts.json) return console.log(JSON.stringify(metrics, null, 2));
      for (const m of metrics) console.log(`  ${m}`);
    });

  /* ── Node Registration ──────────────────────────── */

  fed
    .command("register <node-id>")
    .description("Register a federation node with circuit breaker")
    .option(
      "-f, --failure-threshold <n>",
      "Failure threshold before tripping",
      parseInt,
    )
    .option("-s, --success-threshold <n>", "Success probes to close", parseInt)
    .option("-t, --open-timeout <ms>", "Open timeout in ms", parseInt)
    .option("-m, --metadata <json>", "Metadata JSON")
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const db = _dbFromCtx(fed);
      const result = registerNode(db, nodeId, {
        failureThreshold: opts.failureThreshold,
        successThreshold: opts.successThreshold,
        openTimeout: opts.openTimeout,
        metadata: opts.metadata,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.registered) console.log(`Node registered: ${result.nodeId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  fed
    .command("remove <node-id>")
    .description("Remove a federation node")
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const db = _dbFromCtx(fed);
      const result = removeNode(db, nodeId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.removed ? "Node removed." : `Failed: ${result.reason}`,
      );
    });

  /* ── Circuit Breaker ────────────────────────────── */

  fed
    .command("breaker-show <node-id>")
    .description("Show circuit breaker state for a node")
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const db = _dbFromCtx(fed);
      const b = getCircuitBreaker(db, nodeId);
      if (!b) return console.log("Node not found.");
      if (opts.json) return console.log(JSON.stringify(b, null, 2));
      console.log(`Node:      ${b.node_id}`);
      console.log(`State:     ${b.state}`);
      console.log(
        `Failures:  ${b.failure_count} (threshold: ${b.failure_threshold})`,
      );
      console.log(
        `Successes: ${b.success_count} (threshold: ${b.success_threshold})`,
      );
      console.log(`Timeout:   ${b.open_timeout}ms`);
    });

  fed
    .command("breakers")
    .description("List circuit breakers")
    .option("-s, --state <state>", "Filter by state (closed/open/half_open)")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(fed);
      const breakers = listCircuitBreakers(db, {
        state: opts.state,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(breakers, null, 2));
      if (breakers.length === 0) return console.log("No circuit breakers.");
      for (const b of breakers) {
        console.log(
          `  ${b.state.padEnd(10)} fail:${String(b.failure_count).padEnd(4)} succ:${String(b.success_count).padEnd(4)} ${b.node_id}`,
        );
      }
    });

  fed
    .command("failure <node-id>")
    .description("Record a failure for a node (may trip breaker)")
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const db = _dbFromCtx(fed);
      const result = recordFailure(db, nodeId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.updated) {
        const tripped =
          result.previousState !== result.state ? ` → ${result.state}` : "";
        console.log(
          `Failure recorded (count: ${result.failureCount})${tripped}`,
        );
      } else console.log(`Failed: ${result.reason}`);
    });

  fed
    .command("success <node-id>")
    .description("Record a success for a node (may close breaker)")
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const db = _dbFromCtx(fed);
      const result = recordSuccess(db, nodeId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.updated) {
        const closed =
          result.previousState !== result.state ? ` → ${result.state}` : "";
        console.log(
          `Success recorded (count: ${result.successCount})${closed}`,
        );
      } else console.log(`Failed: ${result.reason}`);
    });

  fed
    .command("half-open <node-id>")
    .description("Try transitioning an open breaker to half-open")
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const db = _dbFromCtx(fed);
      const result = tryHalfOpen(db, nodeId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.updated) console.log(`Breaker transitioned to half_open`);
      else
        console.log(
          `Failed: ${result.reason}${result.remainingMs ? ` (${result.remainingMs}ms remaining)` : ""}`,
        );
    });

  fed
    .command("reset <node-id>")
    .description("Reset circuit breaker to closed state")
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const db = _dbFromCtx(fed);
      const result = resetCircuitBreaker(db, nodeId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.reset ? "Breaker reset to closed." : `Failed: ${result.reason}`,
      );
    });

  /* ── Health Checks ──────────────────────────────── */

  fed
    .command("check <node-id>")
    .description("Record a health check result")
    .requiredOption(
      "-t, --type <type>",
      "Check type (heartbeat/latency/success_rate/cpu_usage/memory_usage)",
    )
    .requiredOption(
      "-s, --status <status>",
      "Health status (healthy/degraded/unhealthy/unknown)",
    )
    .option("-m, --metrics <json>", "Metrics JSON")
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const db = _dbFromCtx(fed);
      const result = recordHealthCheck(db, {
        nodeId,
        checkType: opts.type,
        status: opts.status,
        metrics: opts.metrics,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.recorded)
        console.log(`Health check recorded: ${result.checkId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  fed
    .command("check-show <check-id>")
    .description("Show health check details")
    .option("--json", "JSON output")
    .action((checkId, opts) => {
      const db = _dbFromCtx(fed);
      const c = getHealthCheck(db, checkId);
      if (!c) return console.log("Check not found.");
      if (opts.json) return console.log(JSON.stringify(c, null, 2));
      console.log(`ID:     ${c.check_id}`);
      console.log(`Node:   ${c.node_id}`);
      console.log(`Type:   ${c.check_type}`);
      console.log(`Status: ${c.status}`);
      if (c.metrics) console.log(`Metrics: ${c.metrics}`);
    });

  fed
    .command("checks")
    .description("List health checks")
    .option("-n, --node <id>", "Filter by node ID")
    .option("-t, --type <type>", "Filter by check type")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(fed);
      const checks = listHealthChecks(db, {
        nodeId: opts.node,
        checkType: opts.type,
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(checks, null, 2));
      if (checks.length === 0) return console.log("No health checks.");
      for (const c of checks) {
        console.log(
          `  ${c.status.padEnd(12)} ${c.check_type.padEnd(14)} ${c.node_id.padEnd(20)} ${c.check_id.slice(0, 8)}`,
        );
      }
    });

  fed
    .command("node-health <node-id>")
    .description("Get aggregated health status for a node")
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const db = _dbFromCtx(fed);
      const health = getNodeHealth(db, nodeId);
      if (opts.json) return console.log(JSON.stringify(health, null, 2));
      console.log(`Node:   ${health.nodeId}`);
      console.log(`Status: ${health.status}`);
      console.log(`Checks: ${health.checks}`);
      if (health.latestChecks) {
        for (const c of health.latestChecks) {
          console.log(`  ${c.checkType.padEnd(14)} ${c.status}`);
        }
      }
    });

  /* ── Connection Pool ────────────────────────────── */

  fed
    .command("pool-init <node-id>")
    .description("Initialize a connection pool for a node")
    .option("--min <n>", "Min connections", parseInt)
    .option("--max <n>", "Max connections", parseInt)
    .option("--idle-timeout <ms>", "Idle timeout in ms", parseInt)
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const result = initPool(nodeId, {
        minConnections: opts.min,
        maxConnections: opts.max,
        idleTimeout: opts.idleTimeout,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.initialized) console.log(`Pool initialized for ${nodeId}`);
      else console.log(`Failed: ${result.reason}`);
    });

  fed
    .command("pool-acquire <node-id>")
    .description("Acquire a connection from pool")
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const result = acquireConnection(nodeId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.acquired)
        console.log(
          `Connection acquired (active: ${result.active}, idle: ${result.idle})`,
        );
      else console.log(`Failed: ${result.reason}`);
    });

  fed
    .command("pool-release <node-id>")
    .description("Release a connection back to pool")
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const result = releaseConnection(nodeId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.released)
        console.log(
          `Connection released (active: ${result.active}, idle: ${result.idle})`,
        );
      else console.log(`Failed: ${result.reason}`);
    });

  fed
    .command("pool-stats <node-id>")
    .description("Show connection pool stats")
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const pool = getPoolStats(nodeId);
      if (!pool) return console.log("Pool not found.");
      if (opts.json) return console.log(JSON.stringify(pool, null, 2));
      console.log(`Node:    ${pool.nodeId}`);
      console.log(`Active:  ${pool.activeConnections}`);
      console.log(`Idle:    ${pool.idleConnections}`);
      console.log(`Max:     ${pool.maxConnections}`);
      console.log(`Created: ${pool.totalCreated}`);
      console.log(`Waiting: ${pool.waitingRequests}`);
    });

  fed
    .command("pools")
    .description("List all connection pools")
    .option("--json", "JSON output")
    .action((opts) => {
      const pools = listPools();
      if (opts.json) return console.log(JSON.stringify(pools, null, 2));
      if (pools.length === 0) return console.log("No pools.");
      for (const p of pools) {
        console.log(
          `  ${p.nodeId.padEnd(20)} active:${String(p.activeConnections).padEnd(4)} idle:${String(p.idleConnections).padEnd(4)} max:${p.maxConnections}`,
        );
      }
    });

  fed
    .command("pool-destroy <node-id>")
    .description("Destroy a connection pool")
    .option("--json", "JSON output")
    .action((nodeId, opts) => {
      const result = destroyPool(nodeId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.destroyed ? "Pool destroyed." : `Failed: ${result.reason}`,
      );
    });

  /* ── Stats ──────────────────────────────────────── */

  fed
    .command("stats")
    .description("Federation hardening statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(fed);
      const s = getFederationHardeningStats(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`Circuit breakers: ${s.circuitBreakers.total}`);
      for (const [state, count] of Object.entries(s.circuitBreakers.byState)) {
        if (count > 0) console.log(`  ${state.padEnd(10)} ${count}`);
      }
      console.log(`Health checks: ${s.healthChecks.total}`);
      for (const [status, count] of Object.entries(s.healthChecks.byStatus)) {
        if (count > 0) console.log(`  ${status.padEnd(12)} ${count}`);
      }
      console.log(
        `Connection pools: ${s.connectionPools.total} (active: ${s.connectionPools.totalActive}, idle: ${s.connectionPools.totalIdle})`,
      );
    });

  program.addCommand(fed);
}
