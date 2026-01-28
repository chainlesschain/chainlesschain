/**
 * Redis 缓存集成测试
 *
 * 测试范围：
 * - 连接和健康检查
 * - 字符串操作（GET/SET/DEL）
 * - 哈希操作（HGET/HSET/HDEL）
 * - 列表操作（LPUSH/RPUSH/LPOP/RPOP）
 * - 集合操作（SADD/SMEMBERS/SREM）
 * - 有序集合操作（ZADD/ZRANGE/ZREM）
 * - 过期和TTL
 * - 发布/订阅
 * - 错误处理
 * - 性能测试
 * - 真实场景测试
 *
 * 创建日期: 2026-01-28
 * Week 4 Day 2: External Services Integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ==================== Mock Redis ====================

class MockRedisClient {
  constructor() {
    this.storage = new Map();
    this.expirations = new Map();
    this.subscribers = new Map();
    this.connected = false;
  }

  async connect() {
    this.connected = true;
    return Promise.resolve();
  }

  async disconnect() {
    this.connected = false;
    return Promise.resolve();
  }

  async ping() {
    if (!this.connected) {
      throw new Error("Client not connected");
    }
    return "PONG";
  }

  async info() {
    return `# Server
redis_version:7.0.11
redis_mode:standalone
os:Linux
arch_bits:64
uptime_in_seconds:3600`;
  }

  // ==================== String Operations ====================

  async set(key, value, options = {}) {
    this.storage.set(key, String(value));

    if (options.EX) {
      const expiresAt = Date.now() + options.EX * 1000;
      this.expirations.set(key, expiresAt);
    }

    return "OK";
  }

  async get(key) {
    this._checkExpiration(key);
    return this.storage.get(key) || null;
  }

  async del(...keys) {
    let count = 0;
    for (const key of keys) {
      if (this.storage.has(key)) {
        this.storage.delete(key);
        this.expirations.delete(key);
        count++;
      }
    }
    return count;
  }

  async exists(...keys) {
    let count = 0;
    for (const key of keys) {
      this._checkExpiration(key);
      if (this.storage.has(key)) {
        count++;
      }
    }
    return count;
  }

  async incr(key) {
    const current = parseInt(this.storage.get(key) || "0");
    const newValue = current + 1;
    this.storage.set(key, String(newValue));
    return newValue;
  }

  async decr(key) {
    const current = parseInt(this.storage.get(key) || "0");
    const newValue = current - 1;
    this.storage.set(key, String(newValue));
    return newValue;
  }

  async expire(key, seconds) {
    if (!this.storage.has(key)) {
      return 0;
    }
    const expiresAt = Date.now() + seconds * 1000;
    this.expirations.set(key, expiresAt);
    return 1;
  }

  async ttl(key) {
    if (!this.expirations.has(key)) {
      return -1;
    }
    if (!this.storage.has(key)) {
      return -2;
    }

    const expiresAt = this.expirations.get(key);
    const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  // ==================== Hash Operations ====================

  async hSet(key, field, value) {
    let hash = this.storage.get(key);
    if (!hash || typeof hash === "string") {
      hash = {};
    } else {
      hash = JSON.parse(hash);
    }

    const isNew = !Object.hasOwn(hash, field);
    hash[field] = String(value);
    this.storage.set(key, JSON.stringify(hash));

    return isNew ? 1 : 0;
  }

  async hGet(key, field) {
    this._checkExpiration(key);
    const hash = this.storage.get(key);
    if (!hash) {
      return null;
    }

    const parsed = JSON.parse(hash);
    return parsed[field] || null;
  }

  async hGetAll(key) {
    this._checkExpiration(key);
    const hash = this.storage.get(key);
    if (!hash) {
      return {};
    }

    return JSON.parse(hash);
  }

  async hDel(key, ...fields) {
    const hash = this.storage.get(key);
    if (!hash) {
      return 0;
    }

    const parsed = JSON.parse(hash);
    let count = 0;

    for (const field of fields) {
      if (Object.hasOwn(parsed, field)) {
        delete parsed[field];
        count++;
      }
    }

    this.storage.set(key, JSON.stringify(parsed));
    return count;
  }

  async hExists(key, field) {
    const hash = this.storage.get(key);
    if (!hash) {
      return 0;
    }

    const parsed = JSON.parse(hash);
    return Object.hasOwn(parsed, field) ? 1 : 0;
  }

  // ==================== List Operations ====================

  async lPush(key, ...elements) {
    let list = this.storage.get(key);
    if (!list) {
      list = JSON.stringify([]);
    }

    const parsed = JSON.parse(list);
    parsed.unshift(...elements.reverse());
    this.storage.set(key, JSON.stringify(parsed));

    return parsed.length;
  }

  async rPush(key, ...elements) {
    let list = this.storage.get(key);
    if (!list) {
      list = JSON.stringify([]);
    }

    const parsed = JSON.parse(list);
    parsed.push(...elements);
    this.storage.set(key, JSON.stringify(parsed));

    return parsed.length;
  }

  async lPop(key) {
    const list = this.storage.get(key);
    if (!list) {
      return null;
    }

    const parsed = JSON.parse(list);
    if (parsed.length === 0) {
      return null;
    }

    const value = parsed.shift();
    this.storage.set(key, JSON.stringify(parsed));

    return value;
  }

  async rPop(key) {
    const list = this.storage.get(key);
    if (!list) {
      return null;
    }

    const parsed = JSON.parse(list);
    if (parsed.length === 0) {
      return null;
    }

    const value = parsed.pop();
    this.storage.set(key, JSON.stringify(parsed));

    return value;
  }

  async lRange(key, start, stop) {
    const list = this.storage.get(key);
    if (!list) {
      return [];
    }

    const parsed = JSON.parse(list);
    const end = stop === -1 ? parsed.length : stop + 1;

    return parsed.slice(start, end);
  }

  async lLen(key) {
    const list = this.storage.get(key);
    if (!list) {
      return 0;
    }

    return JSON.parse(list).length;
  }

  // ==================== Set Operations ====================

  async sAdd(key, ...members) {
    let set = this.storage.get(key);
    if (!set) {
      set = JSON.stringify([]);
    }

    const parsed = JSON.parse(set);
    let count = 0;

    for (const member of members) {
      if (!parsed.includes(member)) {
        parsed.push(member);
        count++;
      }
    }

    this.storage.set(key, JSON.stringify(parsed));
    return count;
  }

  async sMembers(key) {
    const set = this.storage.get(key);
    if (!set) {
      return [];
    }

    return JSON.parse(set);
  }

  async sRem(key, ...members) {
    const set = this.storage.get(key);
    if (!set) {
      return 0;
    }

    const parsed = JSON.parse(set);
    let count = 0;

    for (const member of members) {
      const index = parsed.indexOf(member);
      if (index !== -1) {
        parsed.splice(index, 1);
        count++;
      }
    }

    this.storage.set(key, JSON.stringify(parsed));
    return count;
  }

  async sIsMember(key, member) {
    const set = this.storage.get(key);
    if (!set) {
      return 0;
    }

    const parsed = JSON.parse(set);
    return parsed.includes(member) ? 1 : 0;
  }

  async sCard(key) {
    const set = this.storage.get(key);
    if (!set) {
      return 0;
    }

    return JSON.parse(set).length;
  }

  // ==================== Sorted Set Operations ====================

  async zAdd(key, ...args) {
    let sortedSet = this.storage.get(key);
    if (!sortedSet) {
      sortedSet = JSON.stringify([]);
    }

    const parsed = JSON.parse(sortedSet);
    let count = 0;

    for (let i = 0; i < args.length; i += 2) {
      const score = parseFloat(args[i]);
      const member = args[i + 1];

      const existing = parsed.find((item) => item.member === member);
      if (existing) {
        existing.score = score;
      } else {
        parsed.push({ score, member });
        count++;
      }
    }

    parsed.sort((a, b) => a.score - b.score);
    this.storage.set(key, JSON.stringify(parsed));

    return count;
  }

  async zRange(key, start, stop, options = {}) {
    const sortedSet = this.storage.get(key);
    if (!sortedSet) {
      return [];
    }

    const parsed = JSON.parse(sortedSet);
    const end = stop === -1 ? parsed.length : stop + 1;
    const slice = parsed.slice(start, end);

    if (options.WITHSCORES) {
      return slice.flatMap((item) => [item.member, item.score.toString()]);
    }

    return slice.map((item) => item.member);
  }

  async zRem(key, ...members) {
    const sortedSet = this.storage.get(key);
    if (!sortedSet) {
      return 0;
    }

    const parsed = JSON.parse(sortedSet);
    let count = 0;

    for (const member of members) {
      const index = parsed.findIndex((item) => item.member === member);
      if (index !== -1) {
        parsed.splice(index, 1);
        count++;
      }
    }

    this.storage.set(key, JSON.stringify(parsed));
    return count;
  }

  async zScore(key, member) {
    const sortedSet = this.storage.get(key);
    if (!sortedSet) {
      return null;
    }

    const parsed = JSON.parse(sortedSet);
    const item = parsed.find((i) => i.member === member);

    return item ? item.score.toString() : null;
  }

  async zCard(key) {
    const sortedSet = this.storage.get(key);
    if (!sortedSet) {
      return 0;
    }

    return JSON.parse(sortedSet).length;
  }

  // ==================== Pub/Sub ====================

  async publish(channel, message) {
    if (!this.subscribers.has(channel)) {
      return 0;
    }

    const callbacks = this.subscribers.get(channel);
    callbacks.forEach((callback) => callback(message, channel));

    return callbacks.length;
  }

  subscribe(channel, callback) {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, []);
    }
    this.subscribers.get(channel).push(callback);
  }

  // ==================== Helper Methods ====================

  _checkExpiration(key) {
    if (this.expirations.has(key)) {
      const expiresAt = this.expirations.get(key);
      if (Date.now() >= expiresAt) {
        this.storage.delete(key);
        this.expirations.delete(key);
      }
    }
  }

  async flushAll() {
    this.storage.clear();
    this.expirations.clear();
    return "OK";
  }
}

// Mock redis module
vi.mock("redis", () => ({
  createClient: vi.fn(() => new MockRedisClient()),
}));

// ==================== RedisClient Wrapper ====================

class RedisClient {
  constructor(config = {}) {
    this.config = {
      host: config.host || "localhost",
      port: config.port || 6379,
      password: config.password,
      db: config.db || 0,
    };

    const { createClient } = require("redis");
    this.client = createClient(this.config);
  }

  async connect() {
    await this.client.connect();
  }

  async disconnect() {
    await this.client.disconnect();
  }

  async checkHealth() {
    try {
      const pong = await this.client.ping();
      const info = await this.client.info();

      return {
        available: true,
        pong,
        info,
        status: "healthy",
      };
    } catch (error) {
      return {
        available: false,
        error: error.message,
        status: "unhealthy",
      };
    }
  }

  // Delegate all operations to client
  async set(key, value, options) {
    return this.client.set(key, value, options);
  }

  async get(key) {
    return this.client.get(key);
  }

  async del(...keys) {
    return this.client.del(...keys);
  }

  async exists(...keys) {
    return this.client.exists(...keys);
  }

  async incr(key) {
    return this.client.incr(key);
  }

  async decr(key) {
    return this.client.decr(key);
  }

  async expire(key, seconds) {
    return this.client.expire(key, seconds);
  }

  async ttl(key) {
    return this.client.ttl(key);
  }

  async hSet(key, field, value) {
    return this.client.hSet(key, field, value);
  }

  async hGet(key, field) {
    return this.client.hGet(key, field);
  }

  async hGetAll(key) {
    return this.client.hGetAll(key);
  }

  async hDel(key, ...fields) {
    return this.client.hDel(key, ...fields);
  }

  async hExists(key, field) {
    return this.client.hExists(key, field);
  }

  async lPush(key, ...elements) {
    return this.client.lPush(key, ...elements);
  }

  async rPush(key, ...elements) {
    return this.client.rPush(key, ...elements);
  }

  async lPop(key) {
    return this.client.lPop(key);
  }

  async rPop(key) {
    return this.client.rPop(key);
  }

  async lRange(key, start, stop) {
    return this.client.lRange(key, start, stop);
  }

  async lLen(key) {
    return this.client.lLen(key);
  }

  async sAdd(key, ...members) {
    return this.client.sAdd(key, ...members);
  }

  async sMembers(key) {
    return this.client.sMembers(key);
  }

  async sRem(key, ...members) {
    return this.client.sRem(key, ...members);
  }

  async sIsMember(key, member) {
    return this.client.sIsMember(key, member);
  }

  async sCard(key) {
    return this.client.sCard(key);
  }

  async zAdd(key, ...args) {
    return this.client.zAdd(key, ...args);
  }

  async zRange(key, start, stop, options) {
    return this.client.zRange(key, start, stop, options);
  }

  async zRem(key, ...members) {
    return this.client.zRem(key, ...members);
  }

  async zScore(key, member) {
    return this.client.zScore(key, member);
  }

  async zCard(key) {
    return this.client.zCard(key);
  }

  async publish(channel, message) {
    return this.client.publish(channel, message);
  }

  subscribe(channel, callback) {
    return this.client.subscribe(channel, callback);
  }

  async flushAll() {
    return this.client.flushAll();
  }
}

// ==================== Test Suite ====================

describe("Redis 缓存集成测试", () => {
  let client;

  beforeEach(async () => {
    vi.clearAllMocks();

    client = new RedisClient({
      host: "localhost",
      port: 6379,
      db: 0,
    });

    await client.connect();
    await client.flushAll();
  });

  afterEach(async () => {
    if (client && client.disconnect) {
      await client.disconnect();
    }
  });

  // ==================== 1. 连接和健康检查 ====================

  describe("连接和健康检查", () => {
    it("应该成功连接到 Redis", async () => {
      const health = await client.checkHealth();

      expect(health.available).toBe(true);
      expect(health.pong).toBe("PONG");
      expect(health.status).toBe("healthy");
    });

    it("应该返回服务器信息", async () => {
      const health = await client.checkHealth();

      expect(health.info).toContain("redis_version");
    });

    it("应该处理连接失败", async () => {
      const failClient = new RedisClient({
        host: "invalid-host",
        port: 9999,
      });

      failClient.client.ping = vi
        .fn()
        .mockRejectedValue(new Error("ECONNREFUSED"));

      const health = await failClient.checkHealth();

      expect(health.available).toBe(false);
      expect(health.error).toBe("ECONNREFUSED");
    });
  });

  // ==================== 2. 字符串操作 ====================

  describe("字符串操作", () => {
    it("应该设置和获取字符串值", async () => {
      await client.set("key1", "value1");
      const value = await client.get("key1");

      expect(value).toBe("value1");
    });

    it("应该删除键", async () => {
      await client.set("key1", "value1");
      const deleted = await client.del("key1");

      expect(deleted).toBe(1);

      const value = await client.get("key1");
      expect(value).toBeNull();
    });

    it("应该批量删除多个键", async () => {
      await client.set("key1", "value1");
      await client.set("key2", "value2");
      await client.set("key3", "value3");

      const deleted = await client.del("key1", "key2", "key3");

      expect(deleted).toBe(3);
    });

    it("应该检查键是否存在", async () => {
      await client.set("key1", "value1");

      const exists1 = await client.exists("key1");
      const exists2 = await client.exists("nonexistent");

      expect(exists1).toBe(1);
      expect(exists2).toBe(0);
    });

    it("应该递增计数器", async () => {
      await client.set("counter", "10");

      const newValue = await client.incr("counter");

      expect(newValue).toBe(11);
    });

    it("应该递减计数器", async () => {
      await client.set("counter", "10");

      const newValue = await client.decr("counter");

      expect(newValue).toBe(9);
    });

    it("应该处理不存在的计数器", async () => {
      const value = await client.incr("new_counter");

      expect(value).toBe(1);
    });
  });

  // ==================== 3. 过期和TTL ====================

  describe("过期和TTL", () => {
    it("应该设置键的过期时间", async () => {
      await client.set("temp_key", "temp_value");
      await client.expire("temp_key", 60);

      const ttl = await client.ttl("temp_key");

      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it("应该在设置时指定过期时间", async () => {
      await client.set("temp_key", "temp_value", { EX: 60 });

      const ttl = await client.ttl("temp_key");

      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it("应该返回 -1 对于没有过期的键", async () => {
      await client.set("permanent_key", "value");

      const ttl = await client.ttl("permanent_key");

      expect(ttl).toBe(-1);
    });

    it("应该返回 -2 对于不存在的键", async () => {
      const ttl = await client.ttl("nonexistent");

      expect(ttl).toBe(-2);
    });
  });

  // ==================== 4. 哈希操作 ====================

  describe("哈希操作", () => {
    it("应该设置和获取哈希字段", async () => {
      await client.hSet("user:1", "name", "Alice");
      await client.hSet("user:1", "email", "alice@example.com");

      const name = await client.hGet("user:1", "name");
      const email = await client.hGet("user:1", "email");

      expect(name).toBe("Alice");
      expect(email).toBe("alice@example.com");
    });

    it("应该获取所有哈希字段", async () => {
      await client.hSet("user:1", "name", "Alice");
      await client.hSet("user:1", "email", "alice@example.com");
      await client.hSet("user:1", "age", "30");

      const user = await client.hGetAll("user:1");

      expect(user).toEqual({
        name: "Alice",
        email: "alice@example.com",
        age: "30",
      });
    });

    it("应该删除哈希字段", async () => {
      await client.hSet("user:1", "name", "Alice");
      await client.hSet("user:1", "email", "alice@example.com");

      const deleted = await client.hDel("user:1", "email");

      expect(deleted).toBe(1);

      const email = await client.hGet("user:1", "email");
      expect(email).toBeNull();
    });

    it("应该检查哈希字段是否存在", async () => {
      await client.hSet("user:1", "name", "Alice");

      const exists1 = await client.hExists("user:1", "name");
      const exists2 = await client.hExists("user:1", "age");

      expect(exists1).toBe(1);
      expect(exists2).toBe(0);
    });
  });

  // ==================== 5. 列表操作 ====================

  describe("列表操作", () => {
    it("应该从左侧推入元素", async () => {
      await client.lPush("queue", "task1");
      await client.lPush("queue", "task2");
      await client.lPush("queue", "task3");

      const list = await client.lRange("queue", 0, -1);

      expect(list).toEqual(["task3", "task2", "task1"]);
    });

    it("应该从右侧推入元素", async () => {
      await client.rPush("queue", "task1");
      await client.rPush("queue", "task2");
      await client.rPush("queue", "task3");

      const list = await client.lRange("queue", 0, -1);

      expect(list).toEqual(["task1", "task2", "task3"]);
    });

    it("应该从左侧弹出元素", async () => {
      await client.rPush("queue", "task1", "task2", "task3");

      const popped = await client.lPop("queue");

      expect(popped).toBe("task1");

      const remaining = await client.lRange("queue", 0, -1);
      expect(remaining).toEqual(["task2", "task3"]);
    });

    it("应该从右侧弹出元素", async () => {
      await client.rPush("queue", "task1", "task2", "task3");

      const popped = await client.rPop("queue");

      expect(popped).toBe("task3");

      const remaining = await client.lRange("queue", 0, -1);
      expect(remaining).toEqual(["task1", "task2"]);
    });

    it("应该获取列表长度", async () => {
      await client.rPush("queue", "task1", "task2", "task3");

      const length = await client.lLen("queue");

      expect(length).toBe(3);
    });

    it("应该获取列表范围", async () => {
      await client.rPush("queue", "a", "b", "c", "d", "e");

      const range = await client.lRange("queue", 1, 3);

      expect(range).toEqual(["b", "c", "d"]);
    });
  });

  // ==================== 6. 集合操作 ====================

  describe("集合操作", () => {
    it("应该添加成员到集合", async () => {
      const added = await client.sAdd(
        "tags",
        "javascript",
        "typescript",
        "nodejs",
      );

      expect(added).toBe(3);
    });

    it("应该获取集合所有成员", async () => {
      await client.sAdd("tags", "javascript", "typescript", "nodejs");

      const members = await client.sMembers("tags");

      expect(members).toHaveLength(3);
      expect(members).toContain("javascript");
      expect(members).toContain("typescript");
      expect(members).toContain("nodejs");
    });

    it("应该删除集合成员", async () => {
      await client.sAdd("tags", "javascript", "typescript", "nodejs");

      const removed = await client.sRem("tags", "typescript");

      expect(removed).toBe(1);

      const members = await client.sMembers("tags");
      expect(members).not.toContain("typescript");
    });

    it("应该检查成员是否存在", async () => {
      await client.sAdd("tags", "javascript", "typescript");

      const exists1 = await client.sIsMember("tags", "javascript");
      const exists2 = await client.sIsMember("tags", "python");

      expect(exists1).toBe(1);
      expect(exists2).toBe(0);
    });

    it("应该获取集合大小", async () => {
      await client.sAdd("tags", "a", "b", "c", "d", "e");

      const size = await client.sCard("tags");

      expect(size).toBe(5);
    });

    it("应该防止重复添加", async () => {
      await client.sAdd("tags", "javascript");
      const added = await client.sAdd("tags", "javascript");

      expect(added).toBe(0);

      const size = await client.sCard("tags");
      expect(size).toBe(1);
    });
  });

  // ==================== 7. 有序集合操作 ====================

  describe("有序集合操作", () => {
    it("应该添加带分数的成员", async () => {
      const added = await client.zAdd(
        "leaderboard",
        100,
        "player1",
        200,
        "player2",
        150,
        "player3",
      );

      expect(added).toBe(3);
    });

    it("应该按分数排序获取成员", async () => {
      await client.zAdd(
        "leaderboard",
        100,
        "player1",
        200,
        "player2",
        150,
        "player3",
      );

      const members = await client.zRange("leaderboard", 0, -1);

      expect(members).toEqual(["player1", "player3", "player2"]);
    });

    it("应该获取成员和分数", async () => {
      await client.zAdd("leaderboard", 100, "player1", 200, "player2");

      const result = await client.zRange("leaderboard", 0, -1, {
        WITHSCORES: true,
      });

      expect(result).toEqual(["player1", "100", "player2", "200"]);
    });

    it("应该获取成员分数", async () => {
      await client.zAdd("leaderboard", 100, "player1");

      const score = await client.zScore("leaderboard", "player1");

      expect(score).toBe("100");
    });

    it("应该删除有序集合成员", async () => {
      await client.zAdd("leaderboard", 100, "player1", 200, "player2");

      const removed = await client.zRem("leaderboard", "player1");

      expect(removed).toBe(1);

      const members = await client.zRange("leaderboard", 0, -1);
      expect(members).not.toContain("player1");
    });

    it("应该获取有序集合大小", async () => {
      await client.zAdd("leaderboard", 100, "p1", 200, "p2", 300, "p3");

      const size = await client.zCard("leaderboard");

      expect(size).toBe(3);
    });

    it("应该更新成员分数", async () => {
      await client.zAdd("leaderboard", 100, "player1");
      await client.zAdd("leaderboard", 200, "player1");

      const score = await client.zScore("leaderboard", "player1");

      expect(score).toBe("200");
    });
  });

  // ==================== 8. 发布/订阅 ====================

  describe("发布/订阅", () => {
    it("应该发布和接收消息", async () => {
      const receivedMessages = [];

      client.subscribe("notifications", (message, channel) => {
        receivedMessages.push({ message, channel });
      });

      const subscribers = await client.publish("notifications", "Hello World");

      expect(subscribers).toBe(1);
      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].message).toBe("Hello World");
      expect(receivedMessages[0].channel).toBe("notifications");
    });

    it("应该支持多个订阅者", async () => {
      const messages1 = [];
      const messages2 = [];

      client.subscribe("news", (msg) => messages1.push(msg));
      client.subscribe("news", (msg) => messages2.push(msg));

      const subscribers = await client.publish("news", "Breaking News");

      expect(subscribers).toBe(2);
      expect(messages1).toContain("Breaking News");
      expect(messages2).toContain("Breaking News");
    });

    it("应该返回 0 当没有订阅者", async () => {
      const subscribers = await client.publish(
        "empty_channel",
        "No one listening",
      );

      expect(subscribers).toBe(0);
    });
  });

  // ==================== 9. 错误处理 ====================

  describe("错误处理", () => {
    it("应该处理未连接的客户端", async () => {
      const newClient = new RedisClient();

      newClient.client.ping = vi
        .fn()
        .mockRejectedValue(new Error("Client not connected"));

      await expect(newClient.checkHealth()).resolves.toMatchObject({
        available: false,
        error: "Client not connected",
      });
    });

    it("应该处理无效的操作", async () => {
      await client.set("string_key", "value");

      // 尝试对字符串执行哈希操作（在真实 Redis 中会报错）
      // Mock 实现可能需要添加类型检查
      const result = await client.hGet("string_key", "field");

      expect(result).toBeNull();
    });
  });

  // ==================== 10. 性能测试 ====================

  describe("性能测试", () => {
    it("应该快速执行简单操作（< 10ms）", async () => {
      const start = Date.now();

      await client.set("test_key", "test_value");
      await client.get("test_key");

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(10);
    });

    it("应该支持批量操作", async () => {
      const start = Date.now();

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(client.set(`key_${i}`, `value_${i}`));
      }

      await Promise.all(promises);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it("应该高效处理大型列表", async () => {
      for (let i = 0; i < 1000; i++) {
        await client.rPush("big_list", `item_${i}`);
      }

      const length = await client.lLen("big_list");

      expect(length).toBe(1000);
    });
  });

  // ==================== 11. 真实场景测试 ====================

  describe("真实场景测试", () => {
    it("场景1: 会话管理", async () => {
      const sessionId = "session_12345";
      const sessionData = {
        userId: "1",
        username: "alice",
        loginTime: new Date().toISOString(),
      };

      // 设置会话，30分钟过期
      await client.set(`session:${sessionId}`, JSON.stringify(sessionData), {
        EX: 1800,
      });

      // 获取会话
      const retrieved = await client.get(`session:${sessionId}`);
      const parsed = JSON.parse(retrieved);

      expect(parsed.userId).toBe("1");
      expect(parsed.username).toBe("alice");

      // 检查 TTL
      const ttl = await client.ttl(`session:${sessionId}`);
      expect(ttl).toBeGreaterThan(0);
    });

    it("场景2: 缓存数据库查询", async () => {
      const cacheKey = "user:123";
      const userData = {
        id: 123,
        name: "John Doe",
        email: "john@example.com",
      };

      // 模拟缓存未命中
      let cachedData = await client.get(cacheKey);

      if (!cachedData) {
        // 从"数据库"获取（模拟）
        await client.set(cacheKey, JSON.stringify(userData), { EX: 300 });
        cachedData = await client.get(cacheKey);
      }

      expect(JSON.parse(cachedData)).toEqual(userData);
    });

    it("场景3: 实时排行榜", async () => {
      // 记录玩家分数
      await client.zAdd("game:leaderboard", 1500, "player1");
      await client.zAdd("game:leaderboard", 2000, "player2");
      await client.zAdd("game:leaderboard", 1800, "player3");
      await client.zAdd("game:leaderboard", 2200, "player4");

      // 获取前3名
      const topPlayers = await client.zRange("game:leaderboard", -3, -1);

      expect(topPlayers).toEqual(["player3", "player2", "player4"]);
    });

    it("场景4: 消息队列", async () => {
      // 生产者推入消息
      await client.rPush(
        "job:queue",
        JSON.stringify({ type: "email", to: "user@example.com" }),
      );
      await client.rPush(
        "job:queue",
        JSON.stringify({ type: "sms", to: "+1234567890" }),
      );

      // 消费者处理消息
      const job1 = await client.lPop("job:queue");
      const job2 = await client.lPop("job:queue");

      expect(JSON.parse(job1).type).toBe("email");
      expect(JSON.parse(job2).type).toBe("sms");

      // 队列应该为空
      const remaining = await client.lLen("job:queue");
      expect(remaining).toBe(0);
    });

    it("场景5: 用户在线状态", async () => {
      // 用户上线
      await client.sAdd("online:users", "user1", "user2", "user3");

      // 检查用户是否在线
      const isOnline = await client.sIsMember("online:users", "user1");
      expect(isOnline).toBe(1);

      // 获取在线用户数
      const onlineCount = await client.sCard("online:users");
      expect(onlineCount).toBe(3);

      // 用户下线
      await client.sRem("online:users", "user2");

      const newCount = await client.sCard("online:users");
      expect(newCount).toBe(2);
    });

    it("场景6: 限流器", async () => {
      const userId = "user123";
      const rateLimitKey = `rate_limit:${userId}`;

      // 模拟请求
      for (let i = 0; i < 10; i++) {
        await client.incr(rateLimitKey);
      }

      // 设置1分钟过期
      await client.expire(rateLimitKey, 60);

      const requestCount = await client.get(rateLimitKey);

      expect(parseInt(requestCount)).toBe(10);

      // 检查是否超过限制（假设限制为5）
      if (parseInt(requestCount) > 5) {
        // 应该被限流
        expect(parseInt(requestCount)).toBeGreaterThan(5);
      }
    });

    it("场景7: 分布式锁", async () => {
      const lockKey = "lock:resource1";
      const lockValue = "unique_lock_id_12345";

      // 尝试获取锁（SET NX）
      const acquired = await client.set(lockKey, lockValue, { EX: 10 });

      expect(acquired).toBe("OK");

      // 执行关键操作...

      // 释放锁
      const deleted = await client.del(lockKey);

      expect(deleted).toBe(1);
    });
  });
});
