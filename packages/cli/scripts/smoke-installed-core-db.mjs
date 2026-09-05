#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const [installRoot, ...extra] = process.argv.slice(2);
if (!installRoot || extra.length)
  throw new Error("usage: smoke-installed-core-db.mjs <clean-install-root>");
const require = createRequire(path.resolve(installRoot, "package.json"));
const coreDbEntry = require.resolve("@chainlesschain/core-db/database-manager");
const coreRequire = createRequire(coreDbEntry);
const { createSqlJsCompat } = require(coreDbEntry);
const SQL = await coreRequire("sql.js")();
const db = createSqlJsCompat(
  new SQL.Database(),
  path.resolve(installRoot, "child-bind-smoke.sqlite"),
);
try {
  db.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  db.prepare("INSERT INTO smoke (id, value) VALUES (@id, @value)").run({
    id: 7,
    value: "public-child-binding",
  });
  assert.deepEqual(
    db.prepare("SELECT id, value FROM smoke WHERE id = @id").get({ id: 7 }),
    { id: 7, value: "public-child-binding" },
  );
  process.stdout.write(
    "Installed Core DB SQL.js unprefixed named parameter binding passed\n",
  );
} finally {
  db.close();
}
