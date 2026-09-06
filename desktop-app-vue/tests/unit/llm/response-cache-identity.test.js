import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const {
  ResponseCache,
  calculateCacheKey,
} = require("../../../src/main/llm/response-cache.js");
const messages = [{ role: "user", content: "Find the project" }];

describe("response cache exact request identity", () => {
  it("isolates options in real SQLite and ignores legacy unbound rows", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE llm_cache (
      id TEXT PRIMARY KEY, cache_key TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL, model TEXT NOT NULL, request_messages TEXT NOT NULL,
      response_content TEXT NOT NULL, response_tokens INTEGER DEFAULT 0,
      hit_count INTEGER DEFAULT 0, tokens_saved INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL
    )`);
    const cache = new ResponseCache(db, { enableAutoCleanup: false });
    const response = { text: "Bound answer", tokens: 5 };
    const options = {
      model: "chosen",
      userId: "alice",
      tenantId: "one",
      temperature: 0.2,
      tools: [{ type: "function", function: { name: "lookup" } }],
    };
    try {
      expect(
        await cache.set("openai", "default", messages, response, options),
      ).toBe(true);
      expect(
        await cache.get("openai", "default", messages, options),
      ).toMatchObject({ hit: true, response });
      for (const change of [
        { model: "other" },
        { userId: "bob" },
        { tenantId: "two" },
        { temperature: 0.7 },
        { tools: [] },
        { max_tokens: 10 },
        { response_format: { type: "json_object" } },
      ]) {
        expect(
          await cache.get("openai", "default", messages, {
            ...options,
            ...change,
          }),
        ).toEqual({ hit: false });
      }
      const legacy = createHash("sha256")
        .update(
          JSON.stringify({ provider: "openai", model: "default", messages }),
        )
        .digest("hex");
      db.prepare("UPDATE llm_cache SET cache_key = ?").run(legacy);
      expect(await cache.get("openai", "default", messages, options)).toEqual({
        hit: false,
      });
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM llm_cache").get().count,
      ).toBe(1);
    } finally {
      cache.destroy();
      db.close();
    }
  });

  it("canonicalizes data keys without reordering messages or tools", () => {
    const key = (options) =>
      calculateCacheKey("openai", "model", messages, options);
    expect(key({ temperature: 0.2, userId: "alice" })).toBe(
      key({ userId: "alice", temperature: 0.2 }),
    );
    expect(key({ tools: ["one", "two"] })).not.toBe(
      key({ tools: ["two", "one"] }),
    );
    expect(key({ temperature: 0 })).not.toBe(key({}));
  });

  it("rejects ambiguous options without executing getters or serialization hooks", () => {
    let accessed = false;
    const accessor = Object.defineProperty({}, "model", {
      enumerable: true,
      get() {
        accessed = true;
        return "model";
      },
    });
    const cyclic = {};
    cyclic.self = cyclic;
    for (const options of [
      accessor,
      cyclic,
      { signal: new AbortController().signal },
      { value: undefined },
      { value: NaN },
      { value: Infinity },
      { value: () => "x" },
      {
        toJSON() {
          accessed = true;
          return {};
        },
      },
      { tools: Array(2) },
      new Proxy({}, {}),
    ]) {
      expect(() =>
        calculateCacheKey("openai", "model", messages, options),
      ).toThrow();
    }
    expect(accessed).toBe(false);
  });
});
