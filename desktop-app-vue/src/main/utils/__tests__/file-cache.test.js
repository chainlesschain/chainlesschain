/**
 * LRUCache 单元测试。
 *
 * 回归点：has() 早先实现为 `this.cache.has(key) && this.get(key) !== null`，
 * 而 get() 会把命中项移到队尾（标记为最近使用）。于是一次纯粹的「存在性检查」
 * 就会污染 LRU 驱逐顺序——本应被驱逐的旧项因为被 has() 探测过而苟活，真正
 * 较新的项反被驱逐。修复后 has() 是纯查询，不改动 recency。
 */

const { LRUCache } = require("../file-cache.js");

// 把某个 key 的时间戳改到过去，确定性地模拟过期（不依赖定时器 mock）。
const expire = (cache, key) => {
  const item = cache.cache.get(key);
  item.timestamp = Date.now() - cache.ttl - 1000;
};

describe("LRUCache", () => {
  test("set/get 基本往返", () => {
    const cache = new LRUCache();
    cache.set("a", "valueA");
    expect(cache.get("a")).toBe("valueA");
  });

  test("get 未命中返回 null", () => {
    const cache = new LRUCache();
    expect(cache.get("missing")).toBeNull();
  });

  test("has() 是纯查询，不会把条目提升为最近使用", () => {
    const cache = new LRUCache({ maxSize: 2 });
    cache.set("a", 1); // 最旧
    cache.set("b", 2); // 最新

    // 探测最旧项。修复前这会把 "a" 提升到队尾。
    expect(cache.has("a")).toBe(true);

    // 写入第三项触发按数量驱逐。has() 既然不改 recency，被驱逐的应是最旧的 "a"。
    cache.set("c", 3);

    // 直接查底层 Map，避免再次触发任何副作用。
    expect(cache.cache.has("a")).toBe(false); // 旧项如期被驱逐
    expect(cache.cache.has("b")).toBe(true);
    expect(cache.cache.has("c")).toBe(true);
  });

  test("get() 仍会提升 recency（与 has 对照）", () => {
    const cache = new LRUCache({ maxSize: 2 });
    cache.set("a", 1);
    cache.set("b", 2);

    // get 命中应把 "a" 提升为最近使用。
    expect(cache.get("a")).toBe(1);

    cache.set("c", 3); // 触发驱逐：此时最旧的是 "b"
    expect(cache.cache.has("a")).toBe(true);
    expect(cache.cache.has("b")).toBe(false);
    expect(cache.cache.has("c")).toBe(true);
  });

  test("过期项：get 返回 null 并清理；has 返回 false", () => {
    const cache = new LRUCache({ ttl: 1000 });
    cache.set("a", "v", 10);
    expire(cache, "a");

    expect(cache.has("a")).toBe(false);
    // has 不改动状态：过期项仍在底层 Map 中（留待 get/驱逐清理）。
    expect(cache.cache.has("a")).toBe(true);

    expect(cache.get("a")).toBeNull();
    // get 命中过期项会删除它。
    expect(cache.cache.has("a")).toBe(false);
  });

  test("按条目数量驱逐最旧项", () => {
    const cache = new LRUCache({ maxSize: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.cache.size).toBe(2);
    expect(cache.cache.has("a")).toBe(false);
    expect(cache.cache.has("b")).toBe(true);
    expect(cache.cache.has("c")).toBe(true);
  });

  test("按字节上限驱逐并维护 currentBytes 计账", () => {
    const cache = new LRUCache({ maxSize: 100, maxBytes: 100 });
    cache.set("a", "x", 60);
    cache.set("b", "y", 60); // 60+60>100 → 驱逐 "a"

    expect(cache.cache.has("a")).toBe(false);
    expect(cache.cache.has("b")).toBe(true);
    expect(cache.currentBytes).toBe(60);
  });

  test("delete 更新 currentBytes 并返回是否删除", () => {
    const cache = new LRUCache();
    cache.set("a", "v", 25);
    expect(cache.currentBytes).toBe(25);

    expect(cache.delete("a")).toBe(true);
    expect(cache.currentBytes).toBe(0);
    expect(cache.delete("a")).toBe(false); // 再删不存在的项
  });

  test("set 覆盖已存在 key 不重复累计字节", () => {
    const cache = new LRUCache();
    cache.set("a", "v1", 30);
    cache.set("a", "v2", 40); // 先删旧的(30)，再加新的(40)

    expect(cache.get("a")).toBe("v2");
    expect(cache.currentBytes).toBe(40);
    expect(cache.cache.size).toBe(1);
  });

  test("getStats 反映条目数与字节数", () => {
    const cache = new LRUCache({ maxSize: 10, maxBytes: 1000 });
    cache.set("a", "v", 100);
    cache.set("b", "v", 200);

    const stats = cache.getStats();
    expect(stats.entries).toBe(2);
    expect(stats.bytes).toBe(300);
    expect(stats.maxEntries).toBe(10);
  });
});
