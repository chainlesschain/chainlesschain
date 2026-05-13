/**
 * 项目管理远程命令处理器 (#21 P1 — v1.2 GA 反馈 #4/#5/#7)
 *
 * 暴露给 Android REMOTE 端 (ProjectCommands.kt) 的项目操作:
 *   list                 列出所有项目
 *   get                  获取项目详情
 *   init                 创建新项目（手机端发起 → 桌面创建）
 *   delete               软删项目
 *   listFiles            列出项目下所有文件
 *   getFile              获取单个文件内容
 *
 * 高风险操作（runShell / writeFile 等）暂不暴露 —— 留 v1.3+ P3/P4
 * 阶段配合 ApprovalGate 做策略，目前先 read-mostly。
 *
 * 设计 (per #21 "目标在手机端做ai项目的交互要像在电脑端那样丝滑"):
 *   - 复用 desktop DatabaseManager (database/database-projects.js)
 *   - mobile-skill-whitelist.js 加 project.* namespace 白名单
 *   - Phase 3d sync 仍负责后台同步，但 REMOTE 提供 on-demand 实时操作
 */

const { logger } = require("../../utils/logger");
const { v4: uuidv4 } = require("uuid");

class ProjectManagementHandler {
  constructor(database) {
    this.database = database;
    logger.info("[ProjectManagementHandler] 项目管理处理器已初始化");
  }

  async handle(action, params, context) {
    logger.debug("[ProjectManagementHandler] 处理: " + action);

    switch (action) {
      case "list":
        return await this.list(params, context);
      case "get":
        return await this.get(params, context);
      case "init":
        return await this.init(params, context);
      case "delete":
        return await this.delete(params, context);
      case "listFiles":
        return await this.listFiles(params, context);
      case "getFile":
        return await this.getFile(params, context);
      default:
        throw new Error("Unknown project action: " + action);
    }
  }

  async list(params, context) {
    const {
      userId = context.userId || "default",
      status,
      limit = 50,
      offset = 0,
    } = params;

    let sql = `SELECT id, user_id, name, description, project_type, status,
      root_path, file_count, total_size, tags, created_at, updated_at, sync_status
      FROM projects WHERE user_id = ? AND deleted = 0`;
    const args = [userId];
    if (status) {
      sql += " AND status = ?";
      args.push(status);
    }
    sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
    args.push(limit, offset);

    const rows = await this.database.all(sql, args);
    return { projects: rows, count: rows.length };
  }

  async get(params, _context) {
    const { id } = params;
    if (!id) {
      throw new Error("Project id required");
    }
    const row = await this.database.get("SELECT * FROM projects WHERE id = ?", [
      id,
    ]);
    if (!row) {
      const e = new Error("Project not found: " + id);
      e.code = "PROJECT_NOT_FOUND";
      throw e;
    }
    return row;
  }

  async init(params, context) {
    const {
      name,
      description = null,
      type = "document",
      userId = context.userId || "default",
      rootPath = null,
    } = params;
    if (!name) {
      throw new Error("name required");
    }
    const validTypes = [
      "web",
      "document",
      "data",
      "app",
      "presentation",
      "spreadsheet",
      "design",
      "code",
      "workflow",
      "knowledge",
    ];
    if (!validTypes.includes(type)) {
      throw new Error(
        `Invalid type "${type}". Must be one of: ${validTypes.join(", ")}`,
      );
    }
    const id = uuidv4();
    const now = Date.now();
    await this.database.run(
      `INSERT INTO projects (
        id, user_id, name, description, project_type, status,
        root_path, created_at, updated_at, sync_status, deleted
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'pending', 0)`,
      [id, userId, name, description, type, rootPath, now, now],
    );
    logger.info(`[ProjectManagementHandler] init: ${name} (${id})`);
    return {
      id,
      name,
      project_type: type,
      status: "active",
      created_at: now,
      message: "Project created",
    };
  }

  async delete(params, _context) {
    const { id, hard = false } = params;
    if (!id) {
      throw new Error("Project id required");
    }
    const existing = await this.database.get(
      "SELECT id FROM projects WHERE id = ?",
      [id],
    );
    if (!existing) {
      const e = new Error("Project not found: " + id);
      e.code = "PROJECT_NOT_FOUND";
      throw e;
    }
    if (hard) {
      // CASCADE on FK removes project_files automatically per schema
      await this.database.run("DELETE FROM projects WHERE id = ?", [id]);
    } else {
      await this.database.run(
        "UPDATE projects SET deleted = 1, sync_status = 'pending', updated_at = ? WHERE id = ?",
        [Date.now(), id],
      );
    }
    logger.info(`[ProjectManagementHandler] delete: ${id} (hard=${hard})`);
    return { ok: true, id, hard };
  }

  async listFiles(params, _context) {
    const { projectId, limit = 100, offset = 0 } = params;
    if (!projectId) {
      throw new Error("projectId required");
    }
    const rows = await this.database.all(
      `SELECT id, project_id, file_path, file_name, file_type, file_size,
        content_hash, version, is_folder, created_at, updated_at, sync_status
        FROM project_files
        WHERE project_id = ? AND deleted = 0
        ORDER BY file_path ASC LIMIT ? OFFSET ?`,
      [projectId, limit, offset],
    );
    return { files: rows, count: rows.length };
  }

  async getFile(params, _context) {
    const { fileId } = params;
    if (!fileId) {
      throw new Error("fileId required");
    }
    const row = await this.database.get(
      "SELECT * FROM project_files WHERE id = ?",
      [fileId],
    );
    if (!row) {
      const e = new Error("File not found: " + fileId);
      e.code = "FILE_NOT_FOUND";
      throw e;
    }
    return row;
  }
}

module.exports = ProjectManagementHandler;
