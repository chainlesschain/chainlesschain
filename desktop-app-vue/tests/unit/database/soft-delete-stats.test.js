/**
 * getSoftDeletedStats 回归测试
 *
 * 历史 bug ①：函数用 sql.js 风格的 stmt.step()/stmt.getAsObject()，但 SQLCipher
 * 包装器把 step() 桩成恒返 false、getAsObject() 桩成恒返 null → null.count 抛
 * TypeError 被 per-table catch 吞 → 每张表恒计 0，软删除统计永远为 {total:0}。
 * 修复：改用包装器支持的 better-sqlite3 风格 .get()。
 *
 * 历史 bug ②：syncTables 列出 knowledge_items/project_collaborators/project_comments
 * （都是带 deleted 列的真实表），但它们不在 SqlSecurity 白名单里 → validateTableName
 * 抛错被吞 → 这三张表的软删除统计恒 0、且 cleanupSoftDeleted 永远清不掉它们。
 * 修复：把三张真实表加入白名单。
 */

let Database;
let hasSqlite = true;
try {
  Database = require("better-sqlite3");
  const t = new Database(":memory:");
  t.close();
} catch {
  hasSqlite = false;
}

const {
  SQLCipherWrapper,
} = require("../../../src/main/database/sqlcipher-wrapper");
const {
  getSoftDeletedStats,
} = require("../../../src/main/database/database-soft-delete");

const describeIf = hasSqlite ? describe : describe.skip;

const noopLogger = { info() {}, warn() {}, error() {} };

const SYNC_TABLES = [
  "projects",
  "project_files",
  "knowledge_items",
  "project_collaborators",
  "project_comments",
  "project_tasks",
];

describeIf("getSoftDeletedStats (via SQLCipher wrapper)", () => {
  let wrapper, dbManager;

  beforeEach(() => {
    wrapper = new SQLCipherWrapper(":memory:", {}, Database);
    wrapper.open();
    // 建 6 张同步表（最小列：id + deleted）
    for (const t of SYNC_TABLES) {
      wrapper.db.exec(
        `CREATE TABLE ${t} (id TEXT PRIMARY KEY, deleted INTEGER DEFAULT 0)`,
      );
    }
    dbManager = { db: wrapper };
  });

  afterEach(() => {
    try {
      wrapper.db.close();
    } catch {
      /* ignore */
    }
  });

  function seed(table, deletedCount, liveCount) {
    const ins = wrapper.db.prepare(
      `INSERT INTO ${table} (id, deleted) VALUES (?, ?)`,
    );
    let n = 0;
    for (let i = 0; i < deletedCount; i++) {
      ins.run(`${table}-d-${n++}`, 1);
    }
    for (let i = 0; i < liveCount; i++) {
      ins.run(`${table}-l-${n++}`, 0);
    }
  }

  it("counts soft-deleted rows per table (not silently zero)", () => {
    seed("projects", 3, 2);
    seed("project_files", 1, 5);
    seed("project_tasks", 4, 0);

    const stats = getSoftDeletedStats(dbManager, noopLogger);

    expect(stats.byTable.projects).toBe(3);
    expect(stats.byTable.project_files).toBe(1);
    expect(stats.byTable.project_tasks).toBe(4);
    expect(stats.total).toBe(8);
  });

  it("counts the previously non-allowlisted tables (knowledge_items / collaborators / comments)", () => {
    seed("knowledge_items", 2, 1);
    seed("project_collaborators", 5, 0);
    seed("project_comments", 1, 9);

    const stats = getSoftDeletedStats(dbManager, noopLogger);

    expect(stats.byTable.knowledge_items).toBe(2);
    expect(stats.byTable.project_collaborators).toBe(5);
    expect(stats.byTable.project_comments).toBe(1);
    expect(stats.total).toBe(8);
  });

  it("returns zeros (not a throw) when there are no soft-deleted rows", () => {
    seed("projects", 0, 3);

    const stats = getSoftDeletedStats(dbManager, noopLogger);

    expect(stats.total).toBe(0);
    for (const t of SYNC_TABLES) {
      expect(stats.byTable[t]).toBe(0);
    }
  });

  it("aggregates across all six sync tables", () => {
    seed("projects", 1, 0);
    seed("project_files", 1, 0);
    seed("knowledge_items", 1, 0);
    seed("project_collaborators", 1, 0);
    seed("project_comments", 1, 0);
    seed("project_tasks", 1, 0);

    const stats = getSoftDeletedStats(dbManager, noopLogger);
    expect(stats.total).toBe(6);
  });
});
