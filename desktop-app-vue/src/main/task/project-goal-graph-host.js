"use strict";
const { randomUUID } = require("node:crypto");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
const defaultLoader = () =>
  import(
    pathToFileURL(
      resolve(
        __dirname,
        "../../../../packages/cli/src/host/project-goal-graph.js",
      ),
    ).href
  );

/** The project DB remembers activation and the identity of its dedicated Graph
 * database. Turning the flag off cannot hide or recreate an existing journal. */
async function prepareProjectGoalGraphFactory({
  db,
  file,
  mode,
  clock,
  protectFile,
  assertCurrent,
  loadHost = defaultLoader,
}) {
  if (!["legacy", "shadow", "canonical"].includes(mode))
    fail("GOAL_MONITOR_GRAPH_MODE_INVALID");
  const table = "cc_project_goal_graph_store";
  const hasTable = !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  if (mode === "legacy" && !hasTable) return null;
  if (db.inTransaction) fail("GOAL_TRANSACTION_BUSY");
  const binding = db
    .transaction(() => {
      db.exec(
        `CREATE TABLE IF NOT EXISTS ${table}(singleton INTEGER PRIMARY KEY CHECK(singleton=1),graph_id TEXT NOT NULL,phase TEXT NOT NULL)`,
      );
      let row = db
        .prepare(`SELECT graph_id,phase FROM ${table} WHERE singleton=1`)
        .get();
      if (!row) {
        if (mode === "legacy") return null;
        row = { graph_id: `goal-graph-${randomUUID()}`, phase: "initializing" };
        db.prepare(`INSERT INTO ${table} VALUES(1,?,?)`).run(
          row.graph_id,
          row.phase,
        );
      }
      if (
        !/^goal-graph-[a-f0-9-]{36}$/u.test(row.graph_id) ||
        !["initializing", "ready"].includes(row.phase)
      )
        fail("GOAL_MONITOR_GRAPH_STORE_CORRUPT");
      if (row.phase === "ready" && !existsSync(file))
        fail("GOAL_MONITOR_GRAPH_STORAGE_MISSING");
      return row;
    })
    .immediate();
  if (!binding) return null;
  const host = await loadHost();
  assertCurrent();
  if (
    host.PROJECT_GOAL_GRAPH_HOST_VERSION !== 1 ||
    typeof host.createProjectGoalGraphAuthority !== "function"
  )
    fail("GOAL_MONITOR_GRAPH_HOST_INCOMPATIBLE");
  const protect = () => {
    for (const candidate of [file, `${file}-wal`, `${file}-shm`])
      if (existsSync(candidate) && protectFile(candidate) !== candidate)
        fail("GOAL_MONITOR_STORAGE_PROTECTION_FAILED");
  };
  return ({ readCommittedResult }) => {
    assertCurrent();
    protect();
    const current = db
      .prepare(`SELECT graph_id,phase FROM ${table} WHERE singleton=1`)
      .get();
    if (!current || current.graph_id !== binding.graph_id)
      fail("GOAL_MONITOR_GRAPH_STORE_CORRUPT");
    if (current.phase === "ready" && !existsSync(file))
      fail("GOAL_MONITOR_GRAPH_STORAGE_MISSING");
    let graphDb, authority;
    try {
      graphDb = new db.constructor(file);
      protect();
      const identityTable = !!graphDb
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cc_project_goal_graph_identity'",
        )
        .get();
      if (!identityTable && current.phase === "ready")
        fail("GOAL_MONITOR_GRAPH_STORE_CORRUPT");
      graphDb.exec(
        "CREATE TABLE IF NOT EXISTS cc_project_goal_graph_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),graph_id TEXT NOT NULL)",
      );
      if (current.phase === "initializing")
        graphDb
          .prepare(
            "INSERT OR IGNORE INTO cc_project_goal_graph_identity VALUES(1,?)",
          )
          .run(binding.graph_id);
      if (
        graphDb
          .prepare(
            "SELECT graph_id FROM cc_project_goal_graph_identity WHERE singleton=1",
          )
          .get()?.graph_id !== binding.graph_id
      )
        fail("GOAL_MONITOR_GRAPH_STORE_CORRUPT");
      authority = host.createProjectGoalGraphAuthority({
        database: graphDb,
        mode,
        clock,
        readCommittedResult,
      });
      protect();
      assertCurrent();
      db.transaction(() => {
        if (
          db
            .prepare(
              `UPDATE ${table} SET phase='ready' WHERE singleton=1 AND graph_id=?`,
            )
            .run(binding.graph_id).changes !== 1
        )
          fail("GOAL_MONITOR_GRAPH_STORE_CORRUPT");
      }).immediate();
      return authority;
    } catch (error) {
      if (authority) authority.close?.();
      else if (graphDb?.open) graphDb.close();
      throw error;
    }
  };
}
module.exports = { prepareProjectGoalGraphFactory };
