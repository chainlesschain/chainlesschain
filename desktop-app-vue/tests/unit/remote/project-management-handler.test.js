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

    // Sub-phase 5-6 v2 (2026-05-18): Android pullProject 拿到文件清单后逐 id
    // 调 getFile 拿 content；下面验证多文件链路依赖的行为契约。
    it("returns content suitable for Android Room insert (full row passthrough)", async () => {
      mockDatabase.get.mockResolvedValue({
        id: "f1",
        project_id: "p1",
        file_path: "src/Main.kt",
        file_name: "Main.kt",
        file_type: "kt",
        file_size: 42,
        content: "fun main() {}",
        content_hash: "abc123",
        version: 3,
        is_folder: 0,
        created_at: 100,
        updated_at: 200,
      });
      const r = await handler.getFile({ fileId: "f1" }, context);
      expect(r.id).toBe("f1");
      expect(r.project_id).toBe("p1");
      expect(r.file_path).toBe("src/Main.kt");
      expect(r.content).toBe("fun main() {}");
      expect(r.content_hash).toBe("abc123");
      expect(r.version).toBe(3);
      expect(r.is_folder).toBe(0);
    });
  });

  // Sub-phase 7 文件 CRUD 双端 (commit 504bd6dde, 2026-05-17)
  describe("createFile", () => {
    it("inserts file + increments project file_count/total_size", async () => {
      mockDatabase.get
        .mockResolvedValueOnce({ id: "p1" }) // project exists
        .mockResolvedValueOnce(null); // no existing file at same path
      const r = await handler.createFile(
        { projectId: "p1", filePath: "src/Main.kt", content: "hi" },
        context,
      );
      expect(r.file_path).toBe("src/Main.kt");
      expect(r.file_name).toBe("Main.kt");
      expect(r.is_folder).toBe(0);
      // INSERT INTO project_files + UPDATE projects file_count
      expect(mockDatabase.run).toHaveBeenCalledTimes(2);
      const insertSql = mockDatabase.run.mock.calls[0][0];
      const updateSql = mockDatabase.run.mock.calls[1][0];
      expect(insertSql).toContain("INSERT INTO project_files");
      expect(updateSql).toContain("file_count = file_count + 1");
    });

    it("rejects when project not found", async () => {
      mockDatabase.get.mockResolvedValueOnce(null);
      try {
        await handler.createFile(
          { projectId: "nope", filePath: "x.md" },
          context,
        );
        throw new Error("expected throw");
      } catch (e) {
        expect(e.code).toBe("PROJECT_NOT_FOUND");
      }
    });

    it("rejects when file path already exists (UNIQUE)", async () => {
      mockDatabase.get
        .mockResolvedValueOnce({ id: "p1" })
        .mockResolvedValueOnce({ id: "existing-f" });
      try {
        await handler.createFile(
          { projectId: "p1", filePath: "dup.md" },
          context,
        );
        throw new Error("expected throw");
      } catch (e) {
        expect(e.code).toBe("FILE_EXISTS");
      }
    });

    it("rejects missing required params", async () => {
      await expect(handler.createFile({}, context)).rejects.toThrow(
        /projectId required/,
      );
      await expect(
        handler.createFile({ projectId: "p1" }, context),
      ).rejects.toThrow(/filePath required/);
    });
  });

  describe("createFolder", () => {
    it("inserts folder row with is_folder=1", async () => {
      mockDatabase.get
        .mockResolvedValueOnce({ id: "p1" })
        .mockResolvedValueOnce(null);
      const r = await handler.createFolder(
        { projectId: "p1", folderPath: "src/sub" },
        context,
      );
      expect(r.is_folder).toBe(1);
      const insertSql = mockDatabase.run.mock.calls[0][0];
      expect(insertSql).toContain("INSERT INTO project_files");
    });

    it("rejects missing required params", async () => {
      await expect(handler.createFolder({}, context)).rejects.toThrow(
        /projectId required/,
      );
    });
  });

  describe("writeFile", () => {
    it("updates content + bumps version + adjusts total_size", async () => {
      mockDatabase.get.mockResolvedValueOnce({
        id: "f1",
        project_id: "p1",
        file_size: 5,
        is_folder: 0,
      });
      const r = await handler.writeFile(
        { fileId: "f1", content: "new content" },
        context,
      );
      expect(r.id).toBe("f1");
      expect(r.file_size).toBe(Buffer.byteLength("new content", "utf8"));
      const updateSql = mockDatabase.run.mock.calls[0][0];
      expect(updateSql).toContain("UPDATE project_files");
      expect(updateSql).toContain("version = version + 1");
    });

    it("refuses to write content into a folder row", async () => {
      mockDatabase.get.mockResolvedValueOnce({
        id: "folder-1",
        is_folder: 1,
      });
      await expect(
        handler.writeFile({ fileId: "folder-1", content: "x" }, context),
      ).rejects.toThrow(/folder/i);
    });

    it("throws FILE_NOT_FOUND when fileId unknown", async () => {
      mockDatabase.get.mockResolvedValueOnce(null);
      try {
        await handler.writeFile({ fileId: "nope", content: "x" }, context);
        throw new Error("expected throw");
      } catch (e) {
        expect(e.code).toBe("FILE_NOT_FOUND");
      }
    });
  });

  describe("deleteFile (Sub-phase 7)", () => {
    it("soft-deletes and decrements project counters", async () => {
      mockDatabase.get.mockResolvedValueOnce({
        id: "f1",
        project_id: "p1",
        file_size: 100,
        is_folder: 0,
      });
      const r = await handler.deleteFile({ fileId: "f1" }, context);
      expect(r.deleted).toBe(true);
      const updateFile = mockDatabase.run.mock.calls[0][0];
      const updateProject = mockDatabase.run.mock.calls[1][0];
      expect(updateFile).toContain("UPDATE project_files SET deleted = 1");
      expect(updateProject).toContain("file_count = file_count - 1");
    });

    it("throws FILE_NOT_FOUND when fileId unknown", async () => {
      mockDatabase.get.mockResolvedValueOnce(null);
      try {
        await handler.deleteFile({ fileId: "nope" }, context);
        throw new Error("expected throw");
      } catch (e) {
        expect(e.code).toBe("FILE_NOT_FOUND");
      }
    });
  });
});
