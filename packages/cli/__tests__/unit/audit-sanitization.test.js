import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  _resetStateV2,
  logEvent,
  logEventV2,
  queryLogs,
  sanitizeDetails,
} from "../../src/lib/audit-logger.js";

describe("audit credential redaction", () => {
  beforeEach(() => _resetStateV2());

  it("redacts nested aliases and arrays without mutating input or hiding metrics", () => {
    const details = {
      users: [
        { Password: "password-secret", access_token: "access-secret" },
        { "PRIVATE-KEY": "private-secret", "x-api-key": "api-secret" },
      ],
      credentials: { username: "alice", password: "credentials-secret" },
      empty: { token: "", secret: false, password: 0 },
      tokenCount: 15,
      tokenizer: "bpe",
      spinning: true,
      publicKey: "public",
    };
    const original = structuredClone(details);
    const result = sanitizeDetails(details);
    expect(result.users).toEqual([
      { Password: "[REDACTED]", access_token: "[REDACTED]" },
      { "PRIVATE-KEY": "[REDACTED]", "x-api-key": "[REDACTED]" },
    ]);
    expect(result.empty).toEqual({
      token: "[REDACTED]",
      secret: "[REDACTED]",
      password: "[REDACTED]",
    });
    expect(result.credentials).toBe("[REDACTED]");
    expect(result).toMatchObject({
      tokenCount: 15,
      tokenizer: "bpe",
      spinning: true,
      publicKey: "public",
    });
    expect(details).toEqual(original);
  });

  it("supports native headers, header tuples and raw header arrays", () => {
    const result = sanitizeDetails({
      headers: new Headers({
        Authorization: "Bearer native-secret",
        Cookie: "session=cookie-secret",
        "x-request-id": "request-1",
      }),
      requestHeaders: [
        ["Authorization", "Basic tuple-secret"],
        ["content-type", "application/json"],
      ],
      rawHeaders: [
        "Proxy-Authorization",
        "proxy-secret",
        "X-Request-Id",
        "request-2",
      ],
      response: {
        headers: {
          "Set-Cookie": ["session=response-secret"],
          "Content-Length": "100",
        },
      },
      extraHeaders: [{ name: "Authorization", value: "named-secret" }],
    });
    expect(result.headers).toEqual({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      "x-request-id": "request-1",
    });
    expect(result.requestHeaders).toEqual([
      ["Authorization", "[REDACTED]"],
      ["content-type", "application/json"],
    ]);
    expect(result.rawHeaders).toEqual([
      "Proxy-Authorization",
      "[REDACTED]",
      "X-Request-Id",
      "request-2",
    ]);
    expect(result.response.headers["Set-Cookie"]).toBe("[REDACTED]");
    expect(result.extraHeaders).toEqual([
      { name: "Authorization", value: "[REDACTED]" },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("redacts URL userinfo and repeated/encoded query and fragment credentials", () => {
    const source =
      "https://alice:url-secret@example.test/items?access_token=first-secret&access_token=second-secret&api%5Fkey=third-secret&page=2#id_token=fragment-secret&state=ok";
    const result = sanitizeDetails({
      endpoint: source,
      url: new URL(source),
      query: new URLSearchParams("signature=query-secret&page=2"),
    });
    for (const key of ["endpoint", "url"]) {
      const url = new URL(result[key]);
      expect(decodeURIComponent(url.username)).toBe("[REDACTED]");
      expect(url.password).toBe("");
      expect(url.searchParams.getAll("access_token")).toEqual([
        "[REDACTED]",
        "[REDACTED]",
      ]);
      expect(url.searchParams.get("api_key")).toBe("[REDACTED]");
      expect(url.searchParams.get("page")).toBe("2");
      expect(new URLSearchParams(url.hash.slice(1)).get("id_token")).toBe(
        "[REDACTED]",
      );
      expect(url.host).toBe("example.test");
    }
    expect(result.query).toEqual({ signature: "[REDACTED]", page: "2" });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(source).toContain("url-secret");
  });

  it("preserves error diagnostics while redacting message, cause and own properties", () => {
    const error = new TypeError(
      "Request failed password=message-secret at https://user:stack-secret@example.test/api?token=query-secret",
    );
    Object.defineProperty(error, "stack", {
      value:
        "TypeError: password=stack-secret\n    at audit-sanitization.test.js:1:1",
      configurable: true,
    });
    error.code = "ECONNRESET";
    error.token = "own-secret";
    error.cause = new Error("Authorization: Bearer cause-secret");
    error.cause.context = {
      clientSecret: "cause-property-secret",
      retryable: true,
    };
    error.self = error;
    const result = sanitizeDetails({ error });
    expect(result.error).toMatchObject({
      name: "TypeError",
      code: "ECONNRESET",
      token: "[REDACTED]",
      self: "[Circular Reference]",
    });
    expect(result.error.message).toContain("Request failed");
    expect(result.error.stack).toContain("audit-sanitization.test.js");
    expect(result.error.cause.context).toEqual({
      clientSecret: "[REDACTED]",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("makes cycles, BigInts and binary objects JSON safe without executing user code", () => {
    const getter = vi.fn(() => {
      throw new Error("getter-secret");
    });
    const toJSON = vi.fn(() => ({ password: "tojson-secret" }));
    const shared = { count: 42n, when: new Date("2026-10-06T00:00:00Z") };
    const details = {
      first: shared,
      second: shared,
      toJSON,
      bytes: Buffer.from("buffer-secret"),
    };
    Object.defineProperty(details, "dangerous", {
      get: getter,
      enumerable: true,
    });
    details.self = details;
    const result = sanitizeDetails(details);
    expect(result.first).toEqual({
      count: "42",
      when: "2026-10-06T00:00:00.000Z",
    });
    expect(result.second).toEqual(result.first);
    expect(result.self).toBe("[Circular Reference]");
    expect(result.dangerous).toBe("[Accessor omitted]");
    expect(result.bytes).toBe("[Binary omitted]");
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("secret");
    const error = new Error("failure");
    Object.defineProperty(error, "stack", { get: getter });
    expect(sanitizeDetails(error).stack).toBe("[Accessor omitted]");
    expect(getter).not.toHaveBeenCalled();
  });

  it("handles hostile proxies and prototype-related keys safely", () => {
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("proxy-secret");
        },
      },
    );
    expect(sanitizeDetails(proxy)).toBe("[Unserializable]");
    const result = sanitizeDetails(
      JSON.parse(
        '{"__proto__":{"token":"prototype-secret"},"constructor":{"password":"constructor-secret"}}',
      ),
    );
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("bounds deeply nested, wide and oversized details", () => {
    let deep = { token: "deep-secret" };
    for (let i = 0; i < 1000; i += 1) deep = { child: deep };
    const wide = Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      message: "a".repeat(4000),
    }));
    const result = sanitizeDetails({
      deep,
      huge: "prefix " + "x".repeat(100000) + " token=long-secret",
      wide,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("[Truncated]");
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(65536);
    expect(serialized).not.toContain("secret");
    const inherited = Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [`inherited-${i}`, i]),
    );
    const withPrototype = Object.create(inherited);
    withPrototype.requestId = "request-1";
    expect(sanitizeDetails(withPrototype)).toEqual({
      requestId: "request-1",
      "[Truncated]": true,
    });
  });

  it("persists Error-valued errorMessage as redacted SQLite-compatible text", () => {
    const db = new Database(":memory:");
    try {
      const error = new Error("password=sqlite-secret");
      error.context = { access_token: "context-secret", status: 401 };
      const event = {
        eventType: "api",
        operation: "failed",
        errorMessage: error,
      };
      logEvent(db, event);
      const persisted = queryLogs(db)[0];
      const v2 = logEventV2(db, { ...event, logId: "sqlite-error-v2" });
      expect(typeof persisted.error_message).toBe("string");
      expect(persisted.error_message).toBe(v2.errorMessage);
      expect(JSON.parse(persisted.error_message)).toMatchObject({
        context: { access_token: "[REDACTED]", status: 401 },
      });
      expect(persisted.error_message).not.toContain("secret");
    } finally {
      db.close();
    }
  });

  it("redacts persisted v1 and in-memory v2 events including errorMessage", () => {
    const db = new MockDatabase();
    const details = {
      request: { headers: { AUTHORIZATION: "Bearer persisted-secret" } },
      count: 3n,
    };
    details.self = details;
    const event = {
      eventType: "api",
      operation: "request_failed",
      details,
      errorMessage:
        "https://alice:error-secret@example.test/api?token=error-query-secret",
      success: false,
    };
    logEvent(db, event);
    const persisted = queryLogs(db)[0];
    const v2 = logEventV2(db, { ...event, logId: "redaction-v2" });
    expect(persisted.details).toEqual(v2.details);
    expect(persisted.error_message).toBe(v2.errorMessage);
    expect(persisted.details.count).toBe(3);
    expect(JSON.stringify([persisted, v2])).not.toContain("secret");
    expect(event.details.request.headers.AUTHORIZATION).toBe(
      "Bearer persisted-secret",
    );
  });

  it("does not re-read getters during risk assessment and retains false/zero details", () => {
    const db = new MockDatabase();
    const getter = vi.fn(() => {
      throw new Error("getter-secret");
    });
    const details = {};
    Object.defineProperty(details, "bulkCount", {
      get: getter,
      enumerable: true,
    });
    expect(() =>
      logEvent(db, { eventType: "data", operation: "read", details }),
    ).not.toThrow();
    expect(() =>
      logEventV2(db, {
        logId: "getter-v2",
        eventType: "data",
        operation: "read",
        details,
      }),
    ).not.toThrow();
    expect(getter).not.toHaveBeenCalled();
    logEvent(db, { eventType: "data", operation: "false", details: false });
    logEvent(db, { eventType: "data", operation: "zero", details: 0 });
    expect(
      queryLogs(db).find((event) => event.operation === "false").details,
    ).toBe(false);
    expect(
      queryLogs(db).find((event) => event.operation === "zero").details,
    ).toBe(0);
  });
});
