/**
 * StatisticsCollector 聚合去重测试
 *
 * 回归覆盖历史 bug：aggregate() 的 upsert 用 ON CONFLICT(id)（id 为
 * AUTOINCREMENT 永不冲突）→ 每次 tick 都新插重复行（getTrend 的 SUM 翻倍 +
 * 表无限增长）。修复后 upsert 以分组键唯一索引去重，并在 init 时迁移历史重复行 +
 * 归一 NULL 分组列。
 */

// Vitest globals available via globals:true
let Database;
let hasSqlite = true;
try {
  Database = require("better-sqlite3");
  const t = new Database(":memory:");
  t.close();
} catch {
  hasSqlite = false;
}

const STATS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS remote_command_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_type TEXT NOT NULL,
    period_start INTEGER NOT NULL,
    period_end INTEGER NOT NULL,
    device_did TEXT,
    command_namespace TEXT,
    command_action TEXT,
    total_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    total_duration INTEGER NOT NULL DEFAULT 0,
    avg_duration REAL NOT NULL DEFAULT 0,
    min_duration INTEGER,
    max_duration INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`;

const {
  StatisticsCollector,
} = require("../../src/main/remote/logging/statistics-collector");

const describeIf = hasSqlite ? describe : describe.skip;

function createLogsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS remote_command_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_did TEXT,
      command_namespace TEXT,
      command_action TEXT,
      status TEXT,
      duration INTEGER,
      timestamp INTEGER NOT NULL
    )`);
}

function insertLog(
  db,
  {
    device_did = null,
    ns = "fs",
    action = "list",
    status = "success",
    duration = 10,
    ts,
  },
) {
  db.prepare(
    `INSERT INTO remote_command_logs (device_did, command_namespace, command_action, status, duration, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(device_did, ns, action, status, duration, ts);
}

function newCollector(db) {
  const c = new StatisticsCollector(db, { statsAggregationInterval: 60_000 });
  c.stopAggregation(); // 不让定时器在测试中触发
  return c;
}

describeIf("StatisticsCollector aggregate dedup", () => {
  let db;

  beforeEach(() => {
    db = new Database(":memory:");
    createLogsTable(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  it("repeated aggregate() upserts instead of inserting duplicate rows", async () => {
    const now = Date.now();
    insertLog(db, { device_did: "dev-1", status: "success", ts: now });
    insertLog(db, { device_did: "dev-1", status: "success", ts: now });
    insertLog(db, { device_did: "dev-1", status: "failure", ts: now });

    const c = newCollector(db);

    await c.aggregate();
    const rowsAfter1 = db
      .prepare("SELECT COUNT(*) AS n FROM remote_command_stats")
      .get().n;

    await c.aggregate();
    const rowsAfter2 = db
      .prepare("SELECT COUNT(*) AS n FROM remote_command_stats")
      .get().n;

    // 一组 (dev-1, fs, list) × 两个 period_type (hour, day) = 2 行，重复聚合不应翻倍
    expect(rowsAfter1).toBe(2);
    expect(rowsAfter2).toBe(2);

    // 每行 total_count 应等于真实日志数（3），而不是累加/翻倍
    const counts = db
      .prepare(
        "SELECT total_count, failure_count FROM remote_command_stats WHERE period_type = 'day'",
      )
      .all();
    expect(counts).toHaveLength(1);
    expect(counts[0].total_count).toBe(3);
    expect(counts[0].failure_count).toBe(1);
  });

  it("rows with NULL device_did are stored as '' and deduped across runs", async () => {
    const now = Date.now();
    insertLog(db, { device_did: null, status: "success", ts: now });
    insertLog(db, { device_did: null, status: "success", ts: now });

    const c = newCollector(db);
    await c.aggregate();
    await c.aggregate();

    const dayRows = db
      .prepare(
        "SELECT device_did, total_count FROM remote_command_stats WHERE period_type = 'day'",
      )
      .all();
    expect(dayRows).toHaveLength(1);
    expect(dayRows[0].device_did).toBe("");
    expect(dayRows[0].total_count).toBe(2);
  });

  it("getTrend does not double-count after repeated aggregate", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      insertLog(db, { device_did: "dev-1", status: "success", ts: now });
    }

    const c = newCollector(db);
    await c.aggregate();
    await c.aggregate();
    await c.aggregate();

    const trend = c.getTrend("day", 7);
    const total = trend.reduce((s, r) => s + r.total_count, 0);
    expect(total).toBe(5); // 真实 5 条，不因 3 次聚合翻倍
  });

  it("init migration collapses pre-existing duplicate rows and creates the unique index", () => {
    // 模拟旧版本遗留的重复行（同分组键、AUTOINCREMENT 不同 id）+ 一行 NULL device_did
    db.exec(STATS_TABLE_DDL);
    const ins = db.prepare(`
      INSERT INTO remote_command_stats
        (period_type, period_start, period_end, device_did, command_namespace, command_action,
         total_count, success_count, failure_count, warning_count, total_duration, avg_duration,
         min_duration, max_duration, created_at, updated_at)
      VALUES ('day', 1000, 2000, ?, 'fs', 'list', ?, ?, 0, 0, 0, 0, NULL, NULL, 1, 1)`);
    ins.run("dev-1", 3, 3);
    ins.run("dev-1", 7, 7); // 重复组，应只保留 MAX(id)
    ins.run(null, 4, 4); // NULL device_did，应归一为 ''

    // 构造 collector → 触发 initializeDatabase 的迁移
    const c = newCollector(db);

    const dev1 = db
      .prepare("SELECT * FROM remote_command_stats WHERE device_did = 'dev-1'")
      .all();
    expect(dev1).toHaveLength(1); // 重复组被去重
    expect(dev1[0].total_count).toBe(7); // 保留的是 MAX(id) 那一行

    const nullRows = db
      .prepare(
        "SELECT COUNT(*) AS n FROM remote_command_stats WHERE device_did IS NULL",
      )
      .get().n;
    expect(nullRows).toBe(0); // NULL 已归一

    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_stats_unique'",
      )
      .get();
    expect(idx).toBeTruthy();

    c.stopAggregation();
  });
});
