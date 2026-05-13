/**
 * Unit tests for `project.*` WS handlers (#21 P3 web-shell wrapper around
 * P1 ProjectManagementHandler).
 *
 * The handler itself has dedicated tests in
 * tests/unit/remote/project-management-handler.test.js; this file only
 * verifies:
 *   - factory dispatch shape (6 topics)
 *   - context.userId fallback wired
 *   - pre-bootstrap (database=null) path returns DB_UNAVAILABLE error
 */

import { vi } from "vitest";
const { createProjectHandlers } = require("../handlers/project-handlers.js");

describe("createProjectHandlers", () => {
  function makeDb() {
    return {
      run: vi.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
      get: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue([]),
    };
  }

  it("exposes 6 project.* topics when database is provided", () => {
    const handlers = createProjectHandlers({ database: makeDb() });
    const keys = Object.keys(handlers).sort();
    expect(keys).toEqual(
      [
        "project.delete",
        "project.getFile",
        "project.init",
        "project.list",
        "project.listFiles",
        "project.show",
      ].sort(),
    );
  });

  it("pre-bootstrap (database=null): all topics reject with DB_UNAVAILABLE", async () => {
    const handlers = createProjectHandlers({ database: null });
    for (const topic of Object.keys(handlers)) {
      try {
        await handlers[topic]({});
        throw new Error(`expected ${topic} to throw`);
      } catch (e) {
        expect(e.code).toBe("DB_UNAVAILABLE");
      }
    }
  });

  it("project.list calls database.all under the hood", async () => {
    const db = makeDb();
    db.all.mockResolvedValue([{ id: "p1", name: "Test" }]);
    const handlers = createProjectHandlers({ database: db });
    const r = await handlers["project.list"]({ userId: "u-1" });
    expect(r.projects).toHaveLength(1);
    expect(r.count).toBe(1);
    expect(db.all).toHaveBeenCalled();
  });

  it("project.init falls back to defaultUserId when params.userId missing", async () => {
    const db = makeDb();
    const handlers = createProjectHandlers({
      database: db,
      defaultUserId: "my-default-user",
    });
    await handlers["project.init"]({ name: "X" });
    const [, args] = db.run.mock.calls[0];
    // args[1] is userId in the INSERT
    expect(args[1]).toBe("my-default-user");
  });

  it("project.init forwards params.userId verbatim when provided", async () => {
    const db = makeDb();
    const handlers = createProjectHandlers({
      database: db,
      defaultUserId: "default",
    });
    await handlers["project.init"]({ name: "X", userId: "explicit-user" });
    const [, args] = db.run.mock.calls[0];
    expect(args[1]).toBe("explicit-user");
  });

  it("project.delete propagates PROJECT_NOT_FOUND from handler", async () => {
    const db = makeDb();
    db.get.mockResolvedValue(null); // project doesn't exist
    const handlers = createProjectHandlers({ database: db });
    try {
      await handlers["project.delete"]({ id: "nope" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e.code).toBe("PROJECT_NOT_FOUND");
    }
  });

  it("project.listFiles requires projectId param", async () => {
    const db = makeDb();
    const handlers = createProjectHandlers({ database: db });
    await expect(handlers["project.listFiles"]({})).rejects.toThrow(
      /projectId required/,
    );
  });
});
