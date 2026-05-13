/**
 * ProjectManagementHandler 单元测试 (#21 P1)
 *
 * 验证桌面侧 mobile-REMOTE 桥接的 6 个 actions:
 *   list / get / init / delete / listFiles / getFile
 */

import { vi } from "vitest";
const ProjectManagementHandler = require("../../../src/main/remote/handlers/project-management-handler");

describe("ProjectManagementHandler", () => {
  let handler;
  let mockDatabase;
  const context = { userId: "did:cc:test", did: "did:cc:test" };

  beforeEach(() => {
    mockDatabase = {
      run: vi.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
      get: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue([]),
    };
    handler = new ProjectManagementHandler(mockDatabase);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("handle dispatcher", () => {
    it("dispatches list/get/init/delete/listFiles/getFile", async () => {
      const spyList = vi
        .spyOn(handler, "list")
        .mockResolvedValue({ projects: [], count: 0 });
      await handler.handle("list", {}, context);
      expect(spyList).toHaveBeenCalled();
    });

    it("throws on unknown action", async () => {
      await expect(handler.handle("nope", {}, context)).rejects.toThrow(
        /Unknown/,
      );
    });
  });

  describe("list", () => {
    it("returns projects for given user filtered by deleted=0", async () => {
      mockDatabase.all.mockResolvedValue([
        { id: "p1", name: "Test", project_type: "document", status: "active" },
      ]);
      const r = await handler.list({ userId: "u-1" }, context);
      expect(r.projects).toHaveLength(1);
      expect(r.count).toBe(1);
      const [sql, args] = mockDatabase.all.mock.calls[0];
      expect(sql).toContain("WHERE user_id = ? AND deleted = 0");
      expect(args).toEqual(["u-1", 50, 0]);
    });

    it("applies status filter when given", async () => {
      mockDatabase.all.mockResolvedValue([]);
      await handler.list({ userId: "u-1", status: "archived" }, context);
      const [sql, args] = mockDatabase.all.mock.calls[0];
      expect(sql).toContain("AND status = ?");
      expect(args).toEqual(["u-1", "archived", 50, 0]);
    });

    it("falls back to context.userId when userId param missing", async () => {
      mockDatabase.all.mockResolvedValue([]);
      await handler.list({}, { userId: "ctx-user" });
      const [, args] = mockDatabase.all.mock.calls[0];
      expect(args[0]).toBe("ctx-user");
    });
  });

  describe("get", () => {
    it("returns project row when found", async () => {
      mockDatabase.get.mockResolvedValue({ id: "p1", name: "X" });
      const r = await handler.get({ id: "p1" }, context);
      expect(r.id).toBe("p1");
    });

    it("throws PROJECT_NOT_FOUND when missing", async () => {
      mockDatabase.get.mockResolvedValue(null);
      try {
        await handler.get({ id: "nope" }, context);
        throw new Error("expected throw");
      } catch (e) {
        expect(e.code).toBe("PROJECT_NOT_FOUND");
      }
    });

    it("throws when id missing", async () => {
      await expect(handler.get({}, context)).rejects.toThrow(/id required/);
    });
  });

  describe("init", () => {
    it("creates project with all defaults", async () => {
      const r = await handler.init({ name: "My Project" }, context);
      expect(r.id).toBeDefined();
      expect(r.name).toBe("My Project");
      expect(r.project_type).toBe("document");
      expect(r.status).toBe("active");

      const [sql, args] = mockDatabase.run.mock.calls[0];
      expect(sql).toContain("INSERT INTO projects");
      // args: [id, userId, name, description=null, type, rootPath=null, now, now]
      expect(args[2]).toBe("My Project");
      expect(args[3]).toBeNull();
      expect(args[4]).toBe("document");
      expect(args[5]).toBeNull();
    });

    it("validates project_type", async () => {
      await expect(
        handler.init({ name: "x", type: "invalid-type" }, context),
      ).rejects.toThrow(/Invalid type/);
    });

    it("rejects missing name", async () => {
      await expect(handler.init({}, context)).rejects.toThrow(/name required/);
    });

    it("passes through description and rootPath", async () => {
      await handler.init(
        {
          name: "Detailed Project",
          description: "Some desc",
          type: "code",
          rootPath: "/Users/test/proj",
        },
        context,
      );
      const [, args] = mockDatabase.run.mock.calls[0];
      expect(args[3]).toBe("Some desc");
      expect(args[4]).toBe("code");
      expect(args[5]).toBe("/Users/test/proj");
    });
  });

  describe("delete", () => {
    it("soft-deletes by default (UPDATE deleted=1)", async () => {
      mockDatabase.get.mockResolvedValue({ id: "p1" });
      const r = await handler.delete({ id: "p1" }, context);
      expect(r).toMatchObject({ ok: true, id: "p1", hard: false });
      const [sql, args] = mockDatabase.run.mock.calls[0];
      expect(sql).toContain("UPDATE projects SET deleted = 1");
      expect(args[1]).toBe("p1");
    });

    it("hard-deletes when --hard", async () => {
      mockDatabase.get.mockResolvedValue({ id: "p1" });
      const r = await handler.delete({ id: "p1", hard: true }, context);
      expect(r.hard).toBe(true);
      const [sql] = mockDatabase.run.mock.calls[0];
      expect(sql).toContain("DELETE FROM projects WHERE id = ?");
    });

    it("throws PROJECT_NOT_FOUND when project missing", async () => {
      mockDatabase.get.mockResolvedValue(null);
      try {
        await handler.delete({ id: "x" }, context);
        throw new Error("expected throw");
      } catch (e) {
        expect(e.code).toBe("PROJECT_NOT_FOUND");
      }
    });

    it("rejects missing id", async () => {
      await expect(handler.delete({}, context)).rejects.toThrow(/id required/);
    });
  });

  describe("listFiles", () => {
    it("queries project_files filtered by project + deleted=0", async () => {
      mockDatabase.all.mockResolvedValue([{ id: "f1", file_name: "x.md" }]);
      const r = await handler.listFiles({ projectId: "p1" }, context);
      expect(r.files).toHaveLength(1);
      expect(r.count).toBe(1);
      const [sql, args] = mockDatabase.all.mock.calls[0];
      expect(sql).toContain("FROM project_files");
      expect(sql).toContain("AND deleted = 0");
      expect(args[0]).toBe("p1");
    });

    it("rejects missing projectId", async () => {
      await expect(handler.listFiles({}, context)).rejects.toThrow(
        /projectId required/,
      );
    });
  });

  describe("getFile", () => {
    it("returns file row when found", async () => {
      mockDatabase.get.mockResolvedValue({
        id: "f1",
        file_name: "x.md",
        content: "hi",
      });
      const r = await handler.getFile({ fileId: "f1" }, context);
      expect(r.id).toBe("f1");
      expect(r.content).toBe("hi");
    });

    it("throws FILE_NOT_FOUND when missing", async () => {
      mockDatabase.get.mockResolvedValue(null);
      try {
        await handler.getFile({ fileId: "nope" }, context);
        throw new Error("expected throw");
      } catch (e) {
        expect(e.code).toBe("FILE_NOT_FOUND");
      }
    });

    it("rejects missing fileId", async () => {
      await expect(handler.getFile({}, context)).rejects.toThrow(
        /fileId required/,
      );
    });
  });
});
