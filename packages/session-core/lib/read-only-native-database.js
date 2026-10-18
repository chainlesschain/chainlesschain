"use strict";

// Internal native composition only. No raw handle, exec, run, pragma setter or
// schema/recovery initialization escapes this facade.
const views = new WeakSet();
function fail() {
  throw Object.assign(new Error("GOAL_EVIDENCE_READ_ONLY"), {
    code: "GOAL_EVIDENCE_READ_ONLY",
  });
}
function readOnlyNativeDatabase(db) {
  if (views.has(db)) return db;
  if (
    !db ||
    typeof db.prepare !== "function" ||
    typeof db.transaction !== "function" ||
    typeof db.inTransaction !== "boolean"
  )
    fail();
  const view = Object.freeze({
    get inTransaction() {
      return db.inTransaction;
    },
    exec: fail,
    prepare(sql) {
      if (
        typeof sql !== "string" ||
        !/^(?:SELECT\b|WITH\b|PRAGMA\s+table_info\([a-z_]+\)\s*$)/iu.test(
          sql.trim(),
        )
      )
        fail();
      const statement = db.prepare(sql);
      if (statement.readonly !== true || statement.reader !== true) fail();
      return Object.freeze({
        get: (...args) => statement.get(...args),
        all: (...args) => statement.all(...args),
      });
    },
    transaction(operation) {
      const tx = db.transaction(operation);
      const read = (...args) => tx.deferred(...args);
      return Object.assign(read, { immediate: read, deferred: read });
    },
  });
  views.add(view);
  return view;
}
function isReadOnlyNativeDatabase(db) {
  return views.has(db);
}
module.exports = { readOnlyNativeDatabase, isReadOnlyNativeDatabase };
