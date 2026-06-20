import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { PermissionEngine } = require("../permission-engine.js");

describe("PermissionEngine.checkPermission cache-hit shape", () => {
  let engine;
  const params = {
    userDid: "u",
    orgId: "o",
    resourceType: "doc",
    resourceId: "1",
    permission: "read",
  };
  const cacheKey = "u:o:doc:1:read";

  beforeEach(() => {
    engine = new PermissionEngine({}); // a cache hit returns before touching the db
  });

  it("returns { success, hasPermission } on a cache hit (regression: was a bare boolean)", async () => {
    engine.permissionCache.set(cacheKey, { value: true, timestamp: Date.now() });
    const result = await engine.checkPermission(params);
    expect(result).toEqual({ success: true, hasPermission: true });
  });

  it("preserves a cached false result in the same shape", async () => {
    engine.permissionCache.set(cacheKey, { value: false, timestamp: Date.now() });
    const result = await engine.checkPermission(params);
    expect(result).toEqual({ success: true, hasPermission: false });
  });
});
