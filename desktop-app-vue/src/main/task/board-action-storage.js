"use strict";
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function databaseFile(db) {
  return db
    .prepare("PRAGMA database_list")
    .all()
    .find((row) => row.name === "main")?.file;
}
function assertStorage(database, db) {
  if (!databaseFile(db) || typeof db.transaction !== "function")
    fail("BOARD_ACTION_DURABLE_SQLITE_REQUIRED");
  if (db.inTransaction || db.isTransaction || database.inTransaction)
    fail("BOARD_ACTION_TRANSACTION_BUSY");
  if (
    !["wal", "delete", "truncate", "persist"].includes(
      db.prepare("PRAGMA journal_mode").get()?.journal_mode,
    ) ||
    !(db.prepare("PRAGMA synchronous").get()?.synchronous >= 1) ||
    db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1
  )
    fail("BOARD_ACTION_DURABLE_SQLITE_REQUIRED");
}
function transaction(database, db, operation) {
  assertStorage(database, db);
  return db.transaction(operation).immediate();
}
module.exports = { fail, databaseFile, assertStorage, transaction };
