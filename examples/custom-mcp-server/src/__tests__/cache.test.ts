/**
 * 缓存工具测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getCache, resetCache, WeatherCache } from "../utils/cache.js";

describe("Weather Cache", () => {
  beforeEach(() => {
    // 每个测试前重置缓存
    resetCache();
  });

  afterEach(() => {
    // 清理缓存实例
    resetCache();
  });

  describe("Singleton Pattern", () => {
    it("should return the same instance", () => {
      const cache1 = getCache();
      const cache2 = getCache();
      expect(cache1).toBe(cache2);
    });

    it("should create new instance after reset", () => {
      const cache1 = getCache();
      resetCache();
      const cache2 = getCache();
      expect(cache1).not.toBe(cache2);
    });
  });

  describe("Key Generation", () => {
    it("should generate consistent keys for same params", () => {
      const cache = getCache();
      const key1 = cache.generateKey("current", { city: "北京", units: "metric" });
      const key2 = cache.generateKey("current", { city: "北京", units: "metric" });
      expect(key1).toBe(key2);
    });

    it("should sort params for consistency", () => {
      const cache = getCache();
      const key1 = cache.generateKey("current", { units: "metric", city: "北京" });
      const key2 = cache.generateKey("current", { city: "北京", units: "metric" });
      expect(key1).toBe(key2);
    });

    it("should generate different keys for different params", () => {
      const cache = getCache();
      const key1 = cache.generateKey("current", { city: "北京" });
      const key2 = cache.generateKey("current", { city: "上海" });
      expect(key1).not.toBe(key2);
    });

    it("should include type in key", () => {
      const cache = getCache();
      const key1 = cache.generateKey("current", { city: "北京" });
      const key2 = cache.generateKey("forecast", { city: "北京" });
      expect(key1).not.toBe(key2);
      expect(key1).toContain("current:");
      expect(key2).toContain("forecast:");
    });
  });

  describe("Get and Set", () => {
    it("should return undefined for non-existent key", () => {
      const cache = getCache();
      const value = cache.get("non-existent");
      expect(value).toBeUndefined();
    });

    it("should set and get value", () => {
      const cache = getCache();
      const data = { city: "北京", temperature: 22 };
      cache.set("test-key", data);
      const retrieved = cache.get("test-key");
      expect(retrieved).toEqual(data);
    });

    it("should set value with type-specific TTL", () => {
      const cache = getCache();
      const data = { city: "北京" };
      cache.set("current:city=北京", data, "current");
      expect(cache.has("current:city=北京")).toBe(true);
    });

    it("should clone values by default", () => {
      const cache = getCache();
      const original = { city: "北京", temperature: 22 };
      cache.set("test-key", original);
      const retrieved = cache.get<typeof original>("test-key");

      // 修改原始对象
      original.temperature = 30;

      // 缓存的值应该不变
      expect(retrieved?.temperature).toBe(22);
    });
  });

  describe("Delete Operations", () => {
    it("should delete a key", () => {
      const cache = getCache();
      cache.set("test-key", "value");
      expect(cache.has("test-key")).toBe(true);

      const deleted = cache.del("test-key");
      expect(deleted).toBe(1);
      expect(cache.has("test-key")).toBe(false);
    });

    it("should delete by pattern", () => {
      const cache = getCache();
      cache.set("current:city=北京", { city: "北京" });
      cache.set("current:city=上海", { city: "上海" });
      cache.set("forecast:city=北京", { city: "北京" });

      const deleted = cache.delByPattern("current:*");
      expect(deleted).toBe(2);
      expect(cache.has("current:city=北京")).toBe(false);
      expect(cache.has("current:city=上海")).toBe(false);
      expect(cache.has("forecast:city=北京")).toBe(true);
    });

    it("should flush all cache", () => {
      const cache = getCache();
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      cache.flush();

      expect(cache.keys()).toHaveLength(0);
    });
  });

  describe("Statistics", () => {
    it("should track hits and misses", () => {
      const cache = getCache();
      cache.set("key1", "value1");

      // Miss
      cache.get("non-existent");

      // Hits
      cache.get("key1");
      cache.get("key1");

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
    });

    it("should reset statistics", () => {
      const cache = getCache();
      cache.set("key", "value");
      cache.get("key");
      cache.get("non-existent");

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it("should count keys correctly", () => {
      const cache = getCache();
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      const stats = cache.getStats();
      expect(stats.keys).toBe(3);
    });
  });

  describe("Key Operations", () => {
    it("should list all keys", () => {
      const cache = getCache();
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      const keys = cache.keys();
      expect(keys).toContain("key1");
      expect(keys).toContain("key2");
      expect(keys).toHaveLength(2);
    });

    it("should check if key exists", () => {
      const cache = getCache();
      cache.set("existing-key", "value");

      expect(cache.has("existing-key")).toBe(true);
      expect(cache.has("non-existent")).toBe(false);
    });
  });

  describe("TTL Configuration", () => {
    it("should set and get type TTL", () => {
      const cache = getCache();

      // 默认 TTL
      const defaultCurrentTTL = cache.getTypeTTL("current");
      expect(defaultCurrentTTL).toBe(300); // 5 分钟

      // 修改 TTL
      cache.setTypeTTL("current", 120);
      expect(cache.getTypeTTL("current")).toBe(120);
    });

    it("should return default TTL for unknown type", () => {
      const cache = getCache();
      const ttl = cache.getTypeTTL("unknown-type");
      expect(ttl).toBe(600); // 默认 10 分钟
    });
  });
});

describe("Cache Integration with Weather Tools", () => {
  beforeEach(() => {
    resetCache();
  });

  afterEach(() => {
    resetCache();
  });

  it("should cache weather data", () => {
    const cache = getCache();
    const weatherData = {
      city: "北京",
      temperature: 22,
      condition: "晴",
      timestamp: new Date().toISOString(),
    };

    const key = cache.generateKey("current", { city: "北京", units: "metric" });
    cache.set(key, weatherData, "current");

    const cached = cache.get(key);
    expect(cached).toEqual(weatherData);
  });

  it("should cache forecast data", () => {
    const cache = getCache();
    const forecastData = {
      city: "上海",
      forecast: [
        { date: "2026-01-18", tempHigh: 25, tempLow: 18 },
        { date: "2026-01-19", tempHigh: 23, tempLow: 16 },
      ],
    };

    const key = cache.generateKey("forecast", { city: "上海", days: 2 });
    cache.set(key, forecastData, "forecast");

    const cached = cache.get(key);
    expect(cached).toEqual(forecastData);
  });

  it("should cache air quality data", () => {
    const cache = getCache();
    const aqiData = {
      city: "广州",
      aqi: 85,
      level: "良",
      pm25: 60,
    };

    const key = cache.generateKey("airQuality", { city: "广州" });
    cache.set(key, aqiData, "airQuality");

    const cached = cache.get(key);
    expect(cached).toEqual(aqiData);
  });
});
