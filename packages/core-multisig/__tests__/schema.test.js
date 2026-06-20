import { describe, it, expect, beforeAll } from "vitest";

const { applySchema } = require("../lib/schema.js");
const { adaptSqlJsDb } = require("./helpers/sql-js-adapter.js");

let SQL;
beforeAll(async () => {
  const initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

function colNames(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

describe("schema.applySchema — require_pqc migration", () => {
  it("fresh DB: multisig_proposals has require_pqc column", () => {
    const db = adaptSqlJsDb(new SQL.Database());
    applySchema(db);
    expect(colNames(db, "multisig_proposals")).toContain("require_pqc");
  });

  it("is idempotent: applying twice does not throw (ALTER duplicate-column swallowed)", () => {
    const db = adaptSqlJsDb(new SQL.Database());
    applySchema(db);
    expect(() => applySchema(db)).not.toThrow();
    expect(colNames(db, "multisig_proposals")).toContain("require_pqc");
  });

  it("pre-existing DB without require_pqc: migration ADDs the column", () => {
    const db = adaptSqlJsDb(new SQL.Database());
    // Recreate the OLD multisig_proposals table (no require_pqc), as a DB
    // created before this column existed would have.
    db.exec(`
      CREATE TABLE multisig_proposals (
        id TEXT PRIMARY KEY, domain TEXT NOT NULL, payload_jcs TEXT NOT NULL,
        payload_hash BLOB NOT NULL, nonce TEXT NOT NULL, expires_at_ms INTEGER NOT NULL,
        threshold_m INTEGER NOT NULL, member_set TEXT NOT NULL,
        state TEXT NOT NULL, initiator_did TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
      );
    `);
    expect(colNames(db, "multisig_proposals")).not.toContain("require_pqc");
    applySchema(db);
    expect(colNames(db, "multisig_proposals")).toContain("require_pqc");
  });
});
