"use strict";

/** Resolve only the trusted desktop encryption wrapper. Never call getHandle:
 * it reopens a closed wrapper and would revive a revoked connection. */
function currentProjectGoalDatabase(database) {
  const current = database?.getDatabase ? database.getDatabase() : database;
  if (!current || typeof current !== "object") return current;
  // Raw SQLite handles stay unchanged, including their native transaction and
  // readonly state. Avoid loading optional encryption dependencies on that path.
  if (typeof current.transaction === "function") return current;
  const { SQLCipherWrapper } = require("../database/sqlcipher-wrapper.js");
  if (!(current instanceof SQLCipherWrapper)) return current;
  if (!current.db || current.db.open !== true)
    throw Object.assign(new Error("GOAL_NATIVE_DATABASE_REQUIRED"), {
      code: "GOAL_NATIVE_DATABASE_REQUIRED",
    });
  return current.db;
}

module.exports = { currentProjectGoalDatabase };
