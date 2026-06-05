/**
 * degraded-registry 单元测试 —— 降级登记表的记录/查询/累加/订阅语义。
 */

const registry = require("../degraded-registry");

describe("degraded-registry", () => {
  beforeEach(() => {
    registry.clear();
  });

  test("note 记录子系统并可 list/count/isDegraded 查询", () => {
    expect(registry.count()).toBe(0);
    registry.note("ai-llm", "LLM manager not initialized");

    expect(registry.count()).toBe(1);
    expect(registry.isDegraded("ai-llm")).toBe(true);
    expect(registry.isDegraded("nope")).toBe(false);

    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      subsystem: "ai-llm",
      reason: "LLM manager not initialized",
      count: 1,
    });
    expect(typeof list[0].firstAt).toBe("number");
  });

  test("同名子系统重复 note 累加 count 并更新 reason/detail，不新增条目", () => {
    registry.note("database-core", "DB null", { missing: "db" });
    registry.note("database-core", "DB still null", { phase: 5 });

    expect(registry.count()).toBe(1);
    const [entry] = registry.list();
    expect(entry.count).toBe(2);
    expect(entry.reason).toBe("DB still null");
    expect(entry.detail).toEqual({ missing: "db", phase: 5 });
    expect(entry.lastAt).toBeGreaterThanOrEqual(entry.firstAt);
  });

  test("不同子系统各占一条", () => {
    registry.note("sync", "syncManager 未初始化");
    registry.note("ukey", "U-Key manager not initialized");
    expect(registry.count()).toBe(2);
    expect(
      registry
        .list()
        .map((e) => e.subsystem)
        .sort(),
    ).toEqual(["sync", "ukey"]);
  });

  test("list 返回拷贝，外部改动不污染内部状态", () => {
    registry.note("sync", "x");
    const list = registry.list();
    list[0].subsystem = "MUTATED";
    expect(registry.list()[0].subsystem).toBe("sync");
  });

  test("clear 清空所有条目", () => {
    registry.note("a", "x");
    registry.note("b", "y");
    expect(registry.count()).toBe(2);
    registry.clear();
    expect(registry.count()).toBe(0);
    expect(registry.list()).toEqual([]);
  });

  test("onChange 在 note/clear 时收到最新快照并可取消订阅", () => {
    const seen = [];
    const off = registry.onChange((entries) => seen.push(entries.length));

    registry.note("a", "x"); // → 1
    registry.note("b", "y"); // → 2
    registry.clear(); // → 0
    off();
    registry.note("c", "z"); // 取消后不应再收到

    expect(seen).toEqual([1, 2, 0]);
  });
});
