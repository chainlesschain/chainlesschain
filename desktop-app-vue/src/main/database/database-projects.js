/**
 * database-projects — extracted from database.js as part of H3 split (v0.45.33).
 *
 * Each function takes the DatabaseManager instance and a logger; behavior
 * is byte-identical to the original DatabaseManager methods. The class
 * itself keeps thin delegate methods so the public API is unchanged.
 *
 * Extracted on 2026-04-07.
 */

const SqlSecurity = require("./sql-security");
const { v4: uuidv4 } = require("uuid");

function getProjects(dbManager, logger, userId, options = {}) {
  if (!dbManager.db) {
    logger.error("[DatabaseManager] 数据库未初始化");
    return [];
  }

  const {
    offset = 0,
    limit = 0,
    sortBy = "updated_at",
    sortOrder = "DESC",
  } = options;

  // ✅ 安全验证：防止SQL注入
  const safeSortBy = SqlSecurity.validateColumnName(sortBy, [
    "id",
    "name",
    "created_at",
    "updated_at",
    "project_type",
    "status",
  ]);
  const safeSortOrder = SqlSecurity.validateOrder(sortOrder);

  let query = `
    SELECT
      id, user_id, name, description, project_type, status,
      root_path, file_count, total_size, template_id, cover_image_url,
      tags, metadata, created_at, updated_at, synced_at, sync_status
    FROM projects
    WHERE user_id = ? AND deleted = 0
    ORDER BY ${safeSortBy} ${safeSortOrder}
  `;

  const params = [userId];

  // 添加分页
  if (limit > 0) {
    const safeLimit = SqlSecurity.validateLimit(limit);
    const safeOffset = SqlSecurity.validateOffset(offset);
    query += " LIMIT ? OFFSET ?";
    params.push(safeLimit, safeOffset);
  }

  const stmt = dbManager.db.prepare(query);

  let projects = [];
  try {
    projects = stmt.all(...params);
  } catch (err) {
    logger.error("[Database] getProjects 查询失败:", err);
    // 返回空数组
    return [];
  }

  // 清理每个项目中的 undefined 和 null 值
  return projects.map((project) => {
    const cleaned = {};
    for (const key in project) {
      if (Object.prototype.hasOwnProperty.call(project, key)) {
        const value = project[key];
        // 跳过 undefined 和 null
        if (value !== undefined && value !== null) {
          cleaned[key] = value;
        }
      }
    }
    return cleaned;
  });
}

function getProjectsCount(dbManager, logger, userId) {
  if (!dbManager.db) {
    logger.error("[DatabaseManager] 数据库未初始化");
    return 0;
  }

  const stmt = dbManager.db.prepare(`
    SELECT COUNT(*) as count
    FROM projects
    WHERE user_id = ? AND deleted = 0
  `);

  try {
    const result = stmt.get(userId);
    return result?.count || 0;
  } catch (err) {
    logger.error("[Database] getProjectsCount 查询失败:", err);
    return 0;
  }
}

function getDatabaseStats(dbManager, logger) {
  if (!dbManager.db) {
    return { error: "数据库未初始化" };
  }

  try {
    const stats = {};

    // 获取projects表统计
    const projectsCount = dbManager.db
      .prepare("SELECT COUNT(*) as count FROM projects")
      .get();
    const projectsDeleted = dbManager.db
      .prepare("SELECT COUNT(*) as count FROM projects WHERE deleted = 1")
      .get();
    const projectsActive = dbManager.db
      .prepare("SELECT COUNT(*) as count FROM projects WHERE deleted = 0")
      .get();

    // 获取project_files表统计
    const filesCount = dbManager.db
      .prepare("SELECT COUNT(*) as count FROM project_files")
      .get();
    const filesDeleted = dbManager.db
      .prepare("SELECT COUNT(*) as count FROM project_files WHERE deleted = 1")
      .get();
    const filesActive = dbManager.db
      .prepare("SELECT COUNT(*) as count FROM project_files WHERE deleted = 0")
      .get();

    // 获取所有用户ID
    const users = dbManager.db
      .prepare("SELECT DISTINCT user_id FROM projects")
      .all();

    stats.projects = {
      total: projectsCount.count,
      active: projectsActive.count,
      deleted: projectsDeleted.count,
    };

    stats.files = {
      total: filesCount.count,
      active: filesActive.count,
      deleted: filesDeleted.count,
    };

    stats.users = users.map((u) => u.user_id);

    // 获取数据库路径和大小
    stats.dbPath = dbManager.dbPath;
    if (fs.existsSync(dbManager.dbPath)) {
      const fileStats = fs.statSync(dbManager.dbPath);
      stats.dbSize = fileStats.size;
      stats.dbSizeMB = (fileStats.size / 1024 / 1024).toFixed(2) + " MB";
      stats.dbModified = new Date(fileStats.mtime).toISOString();
    }

    // 是否使用加密
    stats.encrypted = !!dbManager.adapter;

    return stats;
  } catch (error) {
    logger.error("[Database] getDatabaseStats 失败:", error);
    return { error: error.message };
  }
}

function getProjectById(dbManager, logger, projectId) {
  logger.info(
    "[Database] getProjectById 输入参数:",
    projectId,
    "type:",
    typeof projectId,
  );

  const stmt = dbManager.db.prepare("SELECT * FROM projects WHERE id = ?");

  logger.info("[Database] 准备执行 stmt.get...");
  let project;
  try {
    project = stmt.get(projectId);
    logger.info("[Database] stmt.get 执行成功，结果:", project ? "OK" : "NULL");
  } catch (getError) {
    logger.error("[Database] stmt.get 失败!");
    logger.error("[Database] 查询参数 projectId:", projectId);
    logger.error("[Database] 错误对象:", getError);
    throw getError;
  }

  // 清理 undefined 值，SQLite 可能返回 undefined
  if (!project) {
    logger.info("[Database] 未找到项目，返回 null");
    return null;
  }

  logger.info("[Database] 开始清理 undefined 值...");
  const cleaned = {};
  for (const key in project) {
    if (
      Object.prototype.hasOwnProperty.call(project, key) &&
      project[key] !== undefined
    ) {
      cleaned[key] = project[key];
    }
  }

  logger.info("[Database] 清理完成，返回键:", Object.keys(cleaned));
  return cleaned;
}

function saveProject(dbManager, logger, project) {
  // Check if database is initialized
  if (!dbManager.db) {
    const errorMsg =
      "数据库未初始化，无法保存项目。请检查数据库配置和加密设置。";
    logger.error("[Database]", errorMsg);
    throw new Error(errorMsg);
  }

  const safeProject = project || {};
  const projectType =
    safeProject.project_type ?? safeProject.projectType ?? "web";
  const userId = safeProject.user_id ?? safeProject.userId ?? "local-user";
  const rootPath = safeProject.root_path ?? safeProject.rootPath ?? null;
  const templateId = safeProject.template_id ?? safeProject.templateId ?? null;
  const coverImageUrl =
    safeProject.cover_image_url ?? safeProject.coverImageUrl ?? null;
  const fileCount = safeProject.file_count ?? safeProject.fileCount ?? 0;
  const totalSize = safeProject.total_size ?? safeProject.totalSize ?? 0;
  const tagsValue =
    typeof safeProject.tags === "string"
      ? safeProject.tags
      : JSON.stringify(safeProject.tags || []);
  const metadataValue =
    typeof safeProject.metadata === "string"
      ? safeProject.metadata
      : JSON.stringify(safeProject.metadata || {});
  // 确保时间戳是数字（毫秒），如果是字符串则转换
  let createdAt = safeProject.created_at ?? safeProject.createdAt ?? Date.now();
  logger.info(
    "[Database] createdAt 原始值:",
    createdAt,
    "type:",
    typeof createdAt,
  );
  if (typeof createdAt === "string") {
    createdAt = new Date(createdAt).getTime();
    logger.info(
      "[Database] createdAt 转换后:",
      createdAt,
      "type:",
      typeof createdAt,
    );
  }

  let updatedAt = safeProject.updated_at ?? safeProject.updatedAt ?? Date.now();
  logger.info(
    "[Database] updatedAt 原始值:",
    updatedAt,
    "type:",
    typeof updatedAt,
  );
  if (typeof updatedAt === "string") {
    updatedAt = new Date(updatedAt).getTime();
    logger.info(
      "[Database] updatedAt 转换后:",
      updatedAt,
      "type:",
      typeof updatedAt,
    );
  }

  let syncedAt = safeProject.synced_at ?? safeProject.syncedAt ?? null;
  logger.info(
    "[Database] syncedAt 原始值:",
    syncedAt,
    "type:",
    typeof syncedAt,
  );
  if (typeof syncedAt === "string") {
    syncedAt = new Date(syncedAt).getTime();
    logger.info(
      "[Database] syncedAt 转换后:",
      syncedAt,
      "type:",
      typeof syncedAt,
    );
  }

  const syncStatus =
    safeProject.sync_status ?? safeProject.syncStatus ?? "pending";
  const deviceId = safeProject.device_id ?? safeProject.deviceId ?? null;
  const deleted = safeProject.deleted ?? 0;
  const categoryId = safeProject.category_id ?? safeProject.categoryId ?? null;

  const stmt = dbManager.db.prepare(`
    INSERT OR REPLACE INTO projects (
      id, user_id, name, description, project_type, status,
      root_path, file_count, total_size, template_id, cover_image_url,
      tags, metadata, created_at, updated_at, sync_status, synced_at,
      device_id, deleted, category_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const params = [
    safeProject.id,
    userId,
    safeProject.name,
    safeProject.description,
    projectType,
    safeProject.status || "active",
    rootPath,
    fileCount,
    totalSize,
    templateId,
    coverImageUrl,
    tagsValue,
    metadataValue,
    createdAt,
    updatedAt,
    syncStatus,
    syncedAt,
    deviceId,
    deleted,
    categoryId,
  ].map((value) => (value === undefined ? null : value));

  logger.info("[Database] 最终params准备绑定:");
  params.forEach((param, index) => {
    logger.info(
      `  [${index}] ${typeof param} = ${param === undefined ? "UNDEFINED!" : param === null ? "NULL" : JSON.stringify(param).substring(0, 50)}`,
    );
  });

  logger.info("[Database] 开始执行 stmt.run...");
  try {
    stmt.run(...params);
    logger.info("[Database] stmt.run 执行成功");
  } catch (runError) {
    logger.error("[Database] stmt.run 失败!");
    logger.error("[Database] 错误对象:", runError);
    logger.error("[Database] 错误类型:", typeof runError);
    logger.error("[Database] 错误消息:", runError?.message);
    logger.error("[Database] 错误堆栈:", runError?.stack);
    logger.error("[Database] 错误代码:", runError?.code);
    throw runError;
  }

  // 不查询数据库，直接返回刚保存的数据（避免查询返回 undefined 字段）
  logger.info("[Database] 直接返回 safeProject（不查询）");
  const savedProject = {
    id: safeProject.id,
    user_id: userId,
    name: safeProject.name,
    description: safeProject.description,
    project_type: projectType,
    status: safeProject.status || "active",
    root_path: rootPath,
    file_count: fileCount,
    total_size: totalSize,
    template_id: templateId,
    cover_image_url: coverImageUrl,
    tags: tagsValue,
    metadata: metadataValue,
    created_at: createdAt,
    updated_at: updatedAt,
    sync_status: syncStatus,
    synced_at: syncedAt,
    device_id: deviceId,
    deleted: deleted,
    category_id: categoryId,
  };

  logger.info("[Database] saveProject 完成，返回结果");
  return savedProject;
}

function updateProject(dbManager, logger, projectId, updates) {
  const fields = [];
  const values = [];

  // 动态构建更新字段
  const allowedFields = [
    "name",
    "description",
    "status",
    "tags",
    "cover_image_url",
    "file_count",
    "total_size",
    "sync_status",
    "synced_at",
    "root_path",
    "folder_path",
    "project_type",
    "delivered_at",
  ];

  allowedFields.forEach((field) => {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      if (field === "tags" || field === "metadata") {
        values.push(
          typeof updates[field] === "string"
            ? updates[field]
            : JSON.stringify(updates[field]),
        );
      } else {
        values.push(updates[field]);
      }
    }
  });

  // 总是更新 updated_at
  fields.push("updated_at = ?");
  values.push(updates.updated_at || Date.now());

  values.push(projectId);

  if (fields.length === 1) {
    return dbManager.getProjectById(projectId);
  }

  dbManager.db.run(
    `
    UPDATE projects SET ${fields.join(", ")} WHERE id = ?
  `,
    values,
  );

  dbManager.saveToFile();
  return dbManager.getProjectById(projectId);
}

function deleteProject(dbManager, logger, projectId) {
  // 删除项目文件
  dbManager.db.run("DELETE FROM project_files WHERE project_id = ?", [
    projectId,
  ]);

  // 删除项目
  dbManager.db.run("DELETE FROM projects WHERE id = ?", [projectId]);

  dbManager.saveToFile();
  return true;
}

function getProjectFiles(dbManager, logger, projectId) {
  const stmt = dbManager.db.prepare(`
    SELECT * FROM project_files
    WHERE project_id = ? AND deleted = 0
    ORDER BY file_path
  `);
  return stmt.all(projectId);
}

function saveProjectFiles(dbManager, logger, projectId, files) {
  // Check if database is initialized
  if (!dbManager.db) {
    const errorMsg =
      "数据库未初始化，无法保存项目文件。请检查数据库配置和加密设置。";
    logger.error("[Database]", errorMsg);
    throw new Error(errorMsg);
  }

  const safeFiles = Array.isArray(files) ? files : [];
  dbManager.transaction(() => {
    const stmt = dbManager.db.prepare(`
      INSERT OR REPLACE INTO project_files (
        id, project_id, file_path, file_name, file_type,
        file_size, content, content_hash, version, fs_path, is_folder,
        created_at, updated_at, sync_status, synced_at, device_id, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    safeFiles.forEach((file) => {
      // 支持多种字段名格式：后端可能返回 path/type，前端可能使用 file_path/filePath
      const rawPath = file.file_path ?? file.filePath ?? file.path ?? null;
      const derivedName =
        file.file_name ??
        file.fileName ??
        (rawPath ? rawPath.split(/[\\/]/).pop() : null);
      const filePath = rawPath || derivedName || "";
      const fileName = derivedName || filePath || "untitled";
      const fileType = file.file_type ?? file.fileType ?? file.type ?? null;
      const fileSize = file.file_size ?? file.fileSize ?? null;
      const content = file.content ?? null;
      const contentHash = file.content_hash ?? file.contentHash ?? null;
      const version = file.version ?? 1;
      const fsPath = file.fs_path ?? file.fsPath ?? null;
      const syncStatus = file.sync_status ?? file.syncStatus ?? "pending";
      const syncedAt = file.synced_at ?? file.syncedAt ?? null;
      const deviceId = file.device_id ?? file.deviceId ?? null;
      const deleted = file.deleted ?? 0;
      const isFolder = file.is_folder ?? file.isFolder ?? 0;

      // 如果没有file_size但有content，自动计算大小
      let actualFileSize = fileSize;
      if (!actualFileSize && content) {
        if (typeof content === "string") {
          // base64编码的内容
          if (file.content_encoding === "base64") {
            actualFileSize = Math.floor(content.length * 0.75); // base64解码后约为3/4
          } else {
            actualFileSize = Buffer.byteLength(content, "utf-8");
          }
        } else if (Buffer.isBuffer(content)) {
          actualFileSize = content.length;
        }
      }
      actualFileSize = actualFileSize || 0;

      // 确保时间戳是数字（毫秒），如果是字符串则转换
      let createdAt = file.created_at ?? file.createdAt ?? Date.now();
      if (typeof createdAt === "string") {
        createdAt = new Date(createdAt).getTime();
      }

      let updatedAt = file.updated_at ?? file.updatedAt ?? Date.now();
      if (typeof updatedAt === "string") {
        updatedAt = new Date(updatedAt).getTime();
      }

      const fileId = file.id || uuidv4();

      const params = [
        fileId,
        projectId,
        filePath,
        fileName,
        fileType,
        actualFileSize,
        content,
        contentHash,
        version,
        fsPath,
        isFolder,
        createdAt,
        updatedAt,
        syncStatus,
        syncedAt,
        deviceId,
        deleted,
      ].map((value) => (value === undefined ? null : value));

      stmt.run(...params);
    });
  });
}

function updateProjectFile(dbManager, logger, fileUpdate) {
  const stmt = dbManager.db.prepare(`
    UPDATE project_files
    SET content = ?, updated_at = ?, version = ?
    WHERE id = ?
  `);

  stmt.run(
    fileUpdate.content,
    fileUpdate.updated_at || Date.now(),
    fileUpdate.version,
    fileUpdate.id,
  );

  dbManager.saveToFile();
}

module.exports = {
  getProjects,
  getProjectsCount,
  getDatabaseStats,
  getProjectById,
  saveProject,
  updateProject,
  deleteProject,
  getProjectFiles,
  saveProjectFiles,
  updateProjectFile,
};
