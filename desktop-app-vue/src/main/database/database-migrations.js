/**
 * Database migrations & schema rebuilds — extracted from database.js
 * as part of H3 split (v0.45.32).
 *
 * Each function takes the DatabaseManager instance and a logger; behavior
 * is byte-identical to the original DatabaseManager methods. The class
 * itself keeps thin delegate methods so the public API is unchanged.
 *
 * Extracted on 2026-04-07.
 */

const fs = require("fs");
const path = require("path");

function ensureTaskBoardOwnerSchema(dbManager, logger) {
  try {
    const tableInfo = dbManager.db
      .prepare("PRAGMA table_info(task_boards)")
      .all();
    const hasBoardType = tableInfo.some((col) => col.name === "board_type");
    const hasOwnerDid = tableInfo.some((col) => col.name === "owner_did");
    const hasIsArchived = tableInfo.some((col) => col.name === "is_archived");
    const hasOrgId = tableInfo.some((col) => col.name === "org_id");

    if (!hasBoardType) {
      logger.info("[Database] 添加 task_boards.board_type 列");
      dbManager.db.run(
        "ALTER TABLE task_boards ADD COLUMN board_type TEXT DEFAULT 'kanban'",
      );
      dbManager.saveToFile();
    }

    if (!hasOwnerDid) {
      logger.info("[Database] 添加 task_boards.owner_did 列");
      dbManager.db.run("ALTER TABLE task_boards ADD COLUMN owner_did TEXT");
      dbManager.saveToFile();
    }

    if (!hasIsArchived) {
      logger.info("[Database] 添加 task_boards.is_archived 列");
      dbManager.db.run(
        "ALTER TABLE task_boards ADD COLUMN is_archived INTEGER DEFAULT 0",
      );
      dbManager.saveToFile();
    }

    if (hasOrgId) {
      dbManager.db.run(
        "CREATE INDEX IF NOT EXISTS idx_task_boards_org ON task_boards(org_id)",
      );
    } else {
      logger.warn("[Database] task_boards.org_id 列缺失，跳过索引创建");
    }

    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_task_boards_owner ON task_boards(owner_did)",
    );
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_task_boards_archived ON task_boards(is_archived)",
    );

    dbManager.saveToFile();
  } catch (error) {
    logger.warn(
      "[Database] task_boards.owner_did 迁移失败（可忽略）:",
      error.message,
    );
  }
}

function migrateDatabase(dbManager, logger) {
  logger.info("[Database] 开始数据库迁移...");

  try {
    // ==================== 原有迁移 ====================
    // 检查 conversations 表是否有 project_id 列
    const conversationsInfo = dbManager.db
      .prepare("PRAGMA table_info(conversations)")
      .all();
    const hasProjectId = conversationsInfo.some(
      (col) => col.name === "project_id",
    );
    const hasContextType = conversationsInfo.some(
      (col) => col.name === "context_type",
    );
    const hasContextData = conversationsInfo.some(
      (col) => col.name === "context_data",
    );

    if (!hasProjectId) {
      logger.info("[Database] 添加 conversations.project_id 列");
      dbManager.db.run("ALTER TABLE conversations ADD COLUMN project_id TEXT");
    }
    if (!hasContextType) {
      logger.info("[Database] 添加 conversations.context_type 列");
      dbManager.db.run(
        "ALTER TABLE conversations ADD COLUMN context_type TEXT DEFAULT 'global'",
      );
    }
    if (!hasContextData) {
      logger.info("[Database] 添加 conversations.context_data 列");
      dbManager.db.run(
        "ALTER TABLE conversations ADD COLUMN context_data TEXT",
      );
    }

    const hasIsStarred = conversationsInfo.some(
      (col) => col.name === "is_starred",
    );
    if (!hasIsStarred) {
      logger.info("[Database] 添加 conversations.is_starred 列");
      dbManager.db.run(
        "ALTER TABLE conversations ADD COLUMN is_starred INTEGER DEFAULT 0",
      );
    }

    // 检查 project_files 表是否有 fs_path 列
    const projectFilesInfo = dbManager.db
      .prepare("PRAGMA table_info(project_files)")
      .all();
    const hasFsPath = projectFilesInfo.some((col) => col.name === "fs_path");

    if (!hasFsPath) {
      logger.info("[Database] 添加 project_files.fs_path 列");
      dbManager.db.run("ALTER TABLE project_files ADD COLUMN fs_path TEXT");
    }

    // 检查 p2p_chat_messages 表是否有 transfer_id 列（用于P2P文件传输）
    const chatMessagesInfo = dbManager.db
      .prepare("PRAGMA table_info(p2p_chat_messages)")
      .all();
    const hasTransferId = chatMessagesInfo.some(
      (col) => col.name === "transfer_id",
    );

    if (!hasTransferId) {
      logger.info("[Database] 添加 p2p_chat_messages.transfer_id 列");
      dbManager.db.run(
        "ALTER TABLE p2p_chat_messages ADD COLUMN transfer_id TEXT",
      );
    }

    // ==================== 同步字段迁移（V2） ====================
    logger.info("[Database] 执行同步字段迁移 (V2)...");

    // 为 projects 表添加设备ID和同步字段
    const projectsInfo = dbManager.db
      .prepare("PRAGMA table_info(projects)")
      .all();
    if (!projectsInfo.some((col) => col.name === "device_id")) {
      logger.info("[Database] 添加 projects.device_id 列");
      dbManager.db.run("ALTER TABLE projects ADD COLUMN device_id TEXT");
    }
    if (!projectsInfo.some((col) => col.name === "synced_at")) {
      logger.info("[Database] 添加 projects.synced_at 列");
      dbManager.db.run("ALTER TABLE projects ADD COLUMN synced_at INTEGER");
    }
    if (!projectsInfo.some((col) => col.name === "deleted")) {
      logger.info("[Database] 添加 projects.deleted 列");
      dbManager.db.run(
        "ALTER TABLE projects ADD COLUMN deleted INTEGER DEFAULT 0",
      );
    }

    // 为 conversations 表添加同步字段
    const convSyncInfo = dbManager.db
      .prepare("PRAGMA table_info(conversations)")
      .all();
    if (!convSyncInfo.some((col) => col.name === "sync_status")) {
      logger.info("[Database] 添加 conversations.sync_status 列");
      dbManager.db.run(
        "ALTER TABLE conversations ADD COLUMN sync_status TEXT DEFAULT 'pending'",
      );
    }
    if (!convSyncInfo.some((col) => col.name === "synced_at")) {
      logger.info("[Database] 添加 conversations.synced_at 列");
      dbManager.db.run(
        "ALTER TABLE conversations ADD COLUMN synced_at INTEGER",
      );
    }

    // 为 messages 表添加同步字段
    const messagesInfo = dbManager.db
      .prepare("PRAGMA table_info(messages)")
      .all();
    if (!messagesInfo.some((col) => col.name === "sync_status")) {
      logger.info("[Database] 添加 messages.sync_status 列");
      dbManager.db.run(
        "ALTER TABLE messages ADD COLUMN sync_status TEXT DEFAULT 'pending'",
      );
    }
    if (!messagesInfo.some((col) => col.name === "synced_at")) {
      logger.info("[Database] 添加 messages.synced_at 列");
      dbManager.db.run("ALTER TABLE messages ADD COLUMN synced_at INTEGER");
    }

    // 为 project_files 表添加设备ID和同步字段
    const filesSyncInfo = dbManager.db
      .prepare("PRAGMA table_info(project_files)")
      .all();
    if (!filesSyncInfo.some((col) => col.name === "device_id")) {
      logger.info("[Database] 添加 project_files.device_id 列");
      dbManager.db.run("ALTER TABLE project_files ADD COLUMN device_id TEXT");
    }
    if (!filesSyncInfo.some((col) => col.name === "sync_status")) {
      logger.info("[Database] 添加 project_files.sync_status 列");
      dbManager.db.run(
        "ALTER TABLE project_files ADD COLUMN sync_status TEXT DEFAULT 'pending'",
      );
    }
    if (!filesSyncInfo.some((col) => col.name === "synced_at")) {
      logger.info("[Database] 添加 project_files.synced_at 列");
      dbManager.db.run(
        "ALTER TABLE project_files ADD COLUMN synced_at INTEGER",
      );
    }
    if (!filesSyncInfo.some((col) => col.name === "deleted")) {
      logger.info("[Database] 添加 project_files.deleted 列");
      dbManager.db.run(
        "ALTER TABLE project_files ADD COLUMN deleted INTEGER DEFAULT 0",
      );
    }
    if (!filesSyncInfo.some((col) => col.name === "is_folder")) {
      logger.info("[Database] 添加 project_files.is_folder 列");
      dbManager.db.run(
        "ALTER TABLE project_files ADD COLUMN is_folder INTEGER DEFAULT 0",
      );
    }

    // 为 knowledge_items 表添加设备ID和同步字段
    const knowledgeInfo = dbManager.db
      .prepare("PRAGMA table_info(knowledge_items)")
      .all();
    if (!knowledgeInfo.some((col) => col.name === "device_id")) {
      logger.info("[Database] 添加 knowledge_items.device_id 列");
      dbManager.db.run("ALTER TABLE knowledge_items ADD COLUMN device_id TEXT");
    }
    if (!knowledgeInfo.some((col) => col.name === "sync_status")) {
      logger.info("[Database] 添加 knowledge_items.sync_status 列");
      dbManager.db.run(
        "ALTER TABLE knowledge_items ADD COLUMN sync_status TEXT DEFAULT 'pending'",
      );
    }
    if (!knowledgeInfo.some((col) => col.name === "synced_at")) {
      logger.info("[Database] 添加 knowledge_items.synced_at 列");
      dbManager.db.run(
        "ALTER TABLE knowledge_items ADD COLUMN synced_at INTEGER",
      );
    }
    if (!knowledgeInfo.some((col) => col.name === "deleted")) {
      logger.info("[Database] 添加 knowledge_items.deleted 列");
      dbManager.db.run(
        "ALTER TABLE knowledge_items ADD COLUMN deleted INTEGER DEFAULT 0",
      );
    }

    // ==================== 企业版字段迁移 ====================
    logger.info("[Database] 执行企业版字段迁移...");

    // 为 knowledge_items 表添加组织相关字段
    if (!knowledgeInfo.some((col) => col.name === "org_id")) {
      logger.info("[Database] 添加 knowledge_items.org_id 列");
      dbManager.db.run("ALTER TABLE knowledge_items ADD COLUMN org_id TEXT");
    }
    if (!knowledgeInfo.some((col) => col.name === "created_by")) {
      logger.info("[Database] 添加 knowledge_items.created_by 列");
      dbManager.db.run(
        "ALTER TABLE knowledge_items ADD COLUMN created_by TEXT",
      );
    }
    if (!knowledgeInfo.some((col) => col.name === "updated_by")) {
      logger.info("[Database] 添加 knowledge_items.updated_by 列");
      dbManager.db.run(
        "ALTER TABLE knowledge_items ADD COLUMN updated_by TEXT",
      );
    }
    if (!knowledgeInfo.some((col) => col.name === "share_scope")) {
      logger.info("[Database] 添加 knowledge_items.share_scope 列");
      dbManager.db.run(
        "ALTER TABLE knowledge_items ADD COLUMN share_scope TEXT DEFAULT 'private'",
      );
    }
    if (!knowledgeInfo.some((col) => col.name === "permissions")) {
      logger.info("[Database] 添加 knowledge_items.permissions 列");
      dbManager.db.run(
        "ALTER TABLE knowledge_items ADD COLUMN permissions TEXT",
      );
    }
    if (!knowledgeInfo.some((col) => col.name === "version")) {
      logger.info("[Database] 添加 knowledge_items.version 列");
      dbManager.db.run(
        "ALTER TABLE knowledge_items ADD COLUMN version INTEGER DEFAULT 1",
      );
    }
    if (!knowledgeInfo.some((col) => col.name === "parent_version_id")) {
      logger.info("[Database] 添加 knowledge_items.parent_version_id 列");
      dbManager.db.run(
        "ALTER TABLE knowledge_items ADD COLUMN parent_version_id TEXT",
      );
    }
    if (!knowledgeInfo.some((col) => col.name === "cid")) {
      logger.info("[Database] 添加 knowledge_items.cid 列");
      dbManager.db.run("ALTER TABLE knowledge_items ADD COLUMN cid TEXT");
    }

    // 为 project_collaborators 表添加基础和同步字段
    const collabInfo = dbManager.db
      .prepare("PRAGMA table_info(project_collaborators)")
      .all();
    if (!collabInfo.some((col) => col.name === "created_at")) {
      logger.info("[Database] 添加 project_collaborators.created_at 列");
      dbManager.db.run(
        "ALTER TABLE project_collaborators ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!collabInfo.some((col) => col.name === "updated_at")) {
      logger.info("[Database] 添加 project_collaborators.updated_at 列");
      dbManager.db.run(
        "ALTER TABLE project_collaborators ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!collabInfo.some((col) => col.name === "device_id")) {
      logger.info("[Database] 添加 project_collaborators.device_id 列");
      dbManager.db.run(
        "ALTER TABLE project_collaborators ADD COLUMN device_id TEXT",
      );
    }
    if (!collabInfo.some((col) => col.name === "sync_status")) {
      logger.info("[Database] 添加 project_collaborators.sync_status 列");
      dbManager.db.run(
        "ALTER TABLE project_collaborators ADD COLUMN sync_status TEXT DEFAULT 'pending'",
      );
    }
    if (!collabInfo.some((col) => col.name === "synced_at")) {
      logger.info("[Database] 添加 project_collaborators.synced_at 列");
      dbManager.db.run(
        "ALTER TABLE project_collaborators ADD COLUMN synced_at INTEGER",
      );
    }
    if (!collabInfo.some((col) => col.name === "deleted")) {
      logger.info("[Database] 添加 project_collaborators.deleted 列");
      dbManager.db.run(
        "ALTER TABLE project_collaborators ADD COLUMN deleted INTEGER DEFAULT 0",
      );
    }

    // 为 project_comments 表添加设备ID和同步字段
    const commentsInfo = dbManager.db
      .prepare("PRAGMA table_info(project_comments)")
      .all();
    if (!commentsInfo.some((col) => col.name === "device_id")) {
      logger.info("[Database] 添加 project_comments.device_id 列");
      dbManager.db.run(
        "ALTER TABLE project_comments ADD COLUMN device_id TEXT",
      );
    }
    if (!commentsInfo.some((col) => col.name === "sync_status")) {
      logger.info("[Database] 添加 project_comments.sync_status 列");
      dbManager.db.run(
        "ALTER TABLE project_comments ADD COLUMN sync_status TEXT DEFAULT 'pending'",
      );
    }
    if (!commentsInfo.some((col) => col.name === "synced_at")) {
      logger.info("[Database] 添加 project_comments.synced_at 列");
      dbManager.db.run(
        "ALTER TABLE project_comments ADD COLUMN synced_at INTEGER",
      );
    }
    if (!commentsInfo.some((col) => col.name === "deleted")) {
      logger.info("[Database] 添加 project_comments.deleted 列");
      dbManager.db.run(
        "ALTER TABLE project_comments ADD COLUMN deleted INTEGER DEFAULT 0",
      );
    }

    // 为 project_tasks 表添加设备ID和同步字段
    const tasksInfo = dbManager.db
      .prepare("PRAGMA table_info(project_tasks)")
      .all();
    if (!tasksInfo.some((col) => col.name === "device_id")) {
      logger.info("[Database] 添加 project_tasks.device_id 列");
      dbManager.db.run("ALTER TABLE project_tasks ADD COLUMN device_id TEXT");
    }
    if (!tasksInfo.some((col) => col.name === "sync_status")) {
      logger.info("[Database] 添加 project_tasks.sync_status 列");
      dbManager.db.run(
        "ALTER TABLE project_tasks ADD COLUMN sync_status TEXT DEFAULT 'pending'",
      );
    }
    if (!tasksInfo.some((col) => col.name === "synced_at")) {
      logger.info("[Database] 添加 project_tasks.synced_at 列");
      dbManager.db.run(
        "ALTER TABLE project_tasks ADD COLUMN synced_at INTEGER",
      );
    }
    if (!tasksInfo.some((col) => col.name === "deleted")) {
      logger.info("[Database] 添加 project_tasks.deleted 列");
      dbManager.db.run(
        "ALTER TABLE project_tasks ADD COLUMN deleted INTEGER DEFAULT 0",
      );
    }

    // 为 project_conversations 表添加同步字段
    const projConvInfo = dbManager.db
      .prepare("PRAGMA table_info(project_conversations)")
      .all();
    if (!projConvInfo.some((col) => col.name === "sync_status")) {
      logger.info("[Database] 添加 project_conversations.sync_status 列");
      dbManager.db.run(
        "ALTER TABLE project_conversations ADD COLUMN sync_status TEXT DEFAULT 'pending'",
      );
    }
    if (!projConvInfo.some((col) => col.name === "synced_at")) {
      logger.info("[Database] 添加 project_conversations.synced_at 列");
      dbManager.db.run(
        "ALTER TABLE project_conversations ADD COLUMN synced_at INTEGER",
      );
    }
    if (!projConvInfo.some((col) => col.name === "deleted")) {
      logger.info("[Database] 添加 project_conversations.deleted 列");
      dbManager.db.run(
        "ALTER TABLE project_conversations ADD COLUMN deleted INTEGER DEFAULT 0",
      );
    }

    // 为 project_templates 表添加 deleted 字段
    const templatesInfo = dbManager.db
      .prepare("PRAGMA table_info(project_templates)")
      .all();
    if (!templatesInfo.some((col) => col.name === "deleted")) {
      logger.info("[Database] 添加 project_templates.deleted 列");
      dbManager.db.run(
        "ALTER TABLE project_templates ADD COLUMN deleted INTEGER DEFAULT 0",
      );
    }

    // ==================== 项目分类迁移 (V3) ====================
    logger.info("[Database] 执行项目分类迁移 (V3)...");

    // 为 projects 表添加 category_id 字段
    const projectsInfoV3 = dbManager.db
      .prepare("PRAGMA table_info(projects)")
      .all();
    if (!projectsInfoV3.some((col) => col.name === "category_id")) {
      logger.info("[Database] 添加 projects.category_id 列");
      dbManager.db.run("ALTER TABLE projects ADD COLUMN category_id TEXT");
      // 添加外键约束（注：SQLite的ALTER TABLE不支持直接添加外键，需要在查询时处理）
    }

    // ==================== CHECK约束更新迁移 (V4) ====================
    logger.info("[Database] 执行CHECK约束更新迁移 (V4)...");

    // 检查是否需要重建projects表（通过尝试插入测试数据来判断）
    const needsProjectsRebuild = dbManager.checkIfTableNeedsRebuild(
      "projects",
      "presentation",
    );
    if (needsProjectsRebuild) {
      logger.info("[Database] 检测到projects表需要更新CHECK约束，开始重建...");
      dbManager.rebuildProjectsTable();
    }

    // 检查是否需要重建project_templates表 (检查是否支持business分类)
    const needsTemplatesRebuild = dbManager.checkIfTableNeedsRebuild(
      "project_templates",
      "business",
    );
    if (needsTemplatesRebuild) {
      logger.info(
        "[Database] 检测到project_templates表需要更新CHECK约束（添加business/hr/project分类），开始重建...",
      );
      dbManager.rebuildProjectTemplatesTable();
    }

    // ==================== 任务规划消息支持迁移 (V5) ====================
    logger.info("[Database] 执行任务规划消息支持迁移 (V5)...");

    // 为 messages 表添加 message_type 和 metadata 字段
    const messagesInfoV5 = dbManager.db
      .prepare("PRAGMA table_info(messages)")
      .all();
    if (!messagesInfoV5.some((col) => col.name === "message_type")) {
      logger.info("[Database] 添加 messages.message_type 列");
      // 默认为 'ASSISTANT'，与原有的 role='assistant' 消息兼容
      dbManager.db.run(
        "ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'ASSISTANT'",
      );

      // 迁移现有数据：根据role设置message_type
      logger.info("[Database] 迁移现有消息的 message_type...");
      dbManager.db.run(`
        UPDATE messages
        SET message_type = CASE
          WHEN role = 'user' THEN 'USER'
          WHEN role = 'assistant' THEN 'ASSISTANT'
          WHEN role = 'system' THEN 'SYSTEM'
          ELSE 'ASSISTANT'
        END
        WHERE message_type = 'ASSISTANT'
      `);
    }

    if (!messagesInfoV5.some((col) => col.name === "metadata")) {
      logger.info("[Database] 添加 messages.metadata 列");
      dbManager.db.run("ALTER TABLE messages ADD COLUMN metadata TEXT");
    }

    // ==================== 项目交付时间迁移 (V6) ====================
    logger.info("[Database] 执行项目交付时间迁移 (V6)...");

    // 为 projects 表添加 delivered_at 字段
    const projectsInfoV6 = dbManager.db
      .prepare("PRAGMA table_info(projects)")
      .all();
    if (!projectsInfoV6.some((col) => col.name === "delivered_at")) {
      logger.info("[Database] 添加 projects.delivered_at 列");
      dbManager.db.run("ALTER TABLE projects ADD COLUMN delivered_at TEXT");
    }

    // ==================== Phase 6: Enterprise Edition Migrations ====================
    // Add team_type column to org_teams for department support (Feature 1)
    const orgTeamsInfo = dbManager.db
      .prepare("PRAGMA table_info(org_teams)")
      .all();
    if (!orgTeamsInfo.some((col) => col.name === "team_type")) {
      logger.info("[Database] 添加 org_teams.team_type 列");
      dbManager.db.run(
        "ALTER TABLE org_teams ADD COLUMN team_type TEXT DEFAULT 'team'",
      );
    }

    logger.info("[Database] 数据库迁移完成");
  } catch (error) {
    logger.error("[Database] 数据库迁移失败:", error);
  }
}

function runMigrationsOptimized(dbManager, logger) {
  try {
    // 创建迁移版本表（如果不存在）
    dbManager.db.exec(`
      CREATE TABLE IF NOT EXISTS migration_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        last_updated INTEGER NOT NULL
      )
    `);

    // 获取当前迁移版本
    const currentVersion = dbManager.db
      .prepare("SELECT version FROM migration_version WHERE id = 1")
      .get();

    // 定义最新迁移版本号
    const LATEST_VERSION = 6; // 增加版本号当有新迁移时（v6: browser_workflows 表 Phase 4-5）

    // BUGFIX: 总是检查关键列是否存在，即使版本号正确
    // 这确保了即使迁移版本号被更新但列没有添加的情况也能被修复
    try {
      const filesSyncInfo = dbManager.db
        .prepare("PRAGMA table_info(project_files)")
        .all();
      if (!filesSyncInfo.some((col) => col.name === "is_folder")) {
        logger.warn(
          "[Database] 检测到 project_files 缺少 is_folder 列，强制运行迁移",
        );
        dbManager.runMigrations();
        // 更新版本号
        if (currentVersion) {
          dbManager.db
            .prepare(
              "UPDATE migration_version SET version = ?, last_updated = ? WHERE id = 1",
            )
            .run(LATEST_VERSION, Date.now());
        } else {
          dbManager.db
            .prepare(
              "INSERT INTO migration_version (id, version, last_updated) VALUES (1, ?, ?)",
            )
            .run(LATEST_VERSION, Date.now());
        }
        logger.info("[Database] 迁移版本已更新到 v" + LATEST_VERSION);
        return;
      }
    } catch (checkError) {
      logger.error("[Database] 检查列失败:", checkError);
    }

    // 如果版本已是最新，跳过迁移
    if (currentVersion && currentVersion.version >= LATEST_VERSION) {
      logger.info(`[Database] 迁移已是最新版本 v${LATEST_VERSION}，跳过迁移`);
      return;
    }

    logger.info("[Database] 运行数据库迁移...");

    // 运行实际的迁移逻辑
    dbManager.runMigrations();

    // 更新迁移版本
    if (currentVersion) {
      dbManager.db
        .prepare(
          "UPDATE migration_version SET version = ?, last_updated = ? WHERE id = 1",
        )
        .run(LATEST_VERSION, Date.now());
    } else {
      dbManager.db
        .prepare(
          "INSERT INTO migration_version (id, version, last_updated) VALUES (1, ?, ?)",
        )
        .run(LATEST_VERSION, Date.now());
    }

    logger.info(`[Database] 迁移版本已更新到 v${LATEST_VERSION}`);
  } catch (error) {
    logger.error("[Database] 优化迁移失败:", error);
    // 降级到普通迁移
    dbManager.runMigrations();
  }
}

function runMigrations(dbManager, logger) {
  try {
    logger.info("[Database] 开始运行数据库迁移...");

    // 迁移1: 修复 project_stats 表的列名
    const statsInfo = dbManager.db
      .prepare("PRAGMA table_info(project_stats)")
      .all();
    const hasTotalSize = statsInfo.some((col) => col.name === "total_size");
    const hasTotalSizeKb = statsInfo.some(
      (col) => col.name === "total_size_kb",
    );
    const hasLastUpdatedAt = statsInfo.some(
      (col) => col.name === "last_updated_at",
    );

    if (hasTotalSize && !hasTotalSizeKb) {
      logger.info(
        "[Database] 迁移 project_stats 表: total_size -> total_size_kb",
      );
      // SQLite不支持重命名列，需要重建表
      dbManager.db.exec(`
        -- 创建临时表
        CREATE TABLE project_stats_new (
          project_id TEXT PRIMARY KEY,
          file_count INTEGER DEFAULT 0,
          total_size_kb REAL DEFAULT 0,
          code_lines INTEGER DEFAULT 0,
          comment_lines INTEGER DEFAULT 0,
          blank_lines INTEGER DEFAULT 0,
          commit_count INTEGER DEFAULT 0,
          contributor_count INTEGER DEFAULT 0,
          last_commit_at INTEGER,
          last_updated_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        -- 复制数据，将 total_size (bytes) 转换为 total_size_kb
        INSERT INTO project_stats_new (
          project_id, file_count, total_size_kb, code_lines, comment_lines,
          blank_lines, commit_count, contributor_count, last_commit_at,
          last_updated_at, created_at, updated_at
        )
        SELECT
          project_id, file_count, CAST(total_size AS REAL) / 1024.0, code_lines, comment_lines,
          blank_lines, commit_count, contributor_count, last_commit_at,
          last_commit_at, created_at, updated_at
        FROM project_stats;

        -- 删除旧表
        DROP TABLE project_stats;

        -- 重命名新表
        ALTER TABLE project_stats_new RENAME TO project_stats;
      `);
      dbManager.saveToFile();
      logger.info("[Database] project_stats 表迁移完成");
    } else if (!hasTotalSizeKb) {
      // 如果两个列都不存在，添加 total_size_kb 列
      logger.info("[Database] 添加 project_stats.total_size_kb 列");
      dbManager.db.run(
        "ALTER TABLE project_stats ADD COLUMN total_size_kb REAL DEFAULT 0",
      );
      dbManager.saveToFile();

      // 同时检查并添加 last_updated_at 列
      if (!hasLastUpdatedAt) {
        logger.info("[Database] 添加 project_stats.last_updated_at 列");
        dbManager.db.run(
          "ALTER TABLE project_stats ADD COLUMN last_updated_at INTEGER",
        );
        dbManager.saveToFile();
      }
    } else if (!hasLastUpdatedAt) {
      // 如果 total_size_kb 已存在，但 last_updated_at 不存在
      logger.info("[Database] 添加 project_stats.last_updated_at 列");
      dbManager.db.run(
        "ALTER TABLE project_stats ADD COLUMN last_updated_at INTEGER",
      );
      dbManager.saveToFile();
    }

    // 迁移2: 插件系统
    const pluginTableExists = dbManager.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='plugins'",
      )
      .get();

    if (!pluginTableExists) {
      logger.info("[Database] 创建插件系统表...");
      try {
        const migrationPath = path.join(
          __dirname,
          "database",
          "migrations",
          "001_plugin_system.sql",
        );
        if (fs.existsSync(migrationPath)) {
          const migrationSQL = fs.readFileSync(migrationPath, "utf-8");
          dbManager.db.exec(migrationSQL);
          dbManager.saveToFile();
          logger.info("[Database] 插件系统表创建完成");
        } else {
          logger.warn("[Database] 插件系统迁移文件不存在:", migrationPath);
        }
      } catch (pluginError) {
        logger.error("[Database] 创建插件系统表失败:", pluginError);
      }
    }

    // 迁移3: 音频系统 (语音识别)
    const audioTableExists = dbManager.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='audio_files'",
      )
      .get();

    if (!audioTableExists) {
      logger.info("[Database] 创建音频系统表...");
      try {
        const migrationPath = path.join(
          __dirname,
          "database",
          "migrations",
          "002_audio_system.sql",
        );
        if (fs.existsSync(migrationPath)) {
          const migrationSQL = fs.readFileSync(migrationPath, "utf-8");
          dbManager.db.exec(migrationSQL);
          dbManager.saveToFile();
          logger.info("[Database] 音频系统表创建完成");
        } else {
          logger.warn("[Database] 音频系统迁移文件不存在:", migrationPath);
        }
      } catch (audioError) {
        logger.error("[Database] 创建音频系统表失败:", audioError);
      }
    }

    // 迁移4: 技能和工具管理系统
    const skillTableExists = dbManager.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='skills'",
      )
      .get();

    if (!skillTableExists) {
      logger.info("[Database] 创建技能和工具管理系统表...");
      try {
        const migrationPath = path.join(
          __dirname,
          "database",
          "migrations",
          "003_skill_tool_system.sql",
        );
        if (fs.existsSync(migrationPath)) {
          const migrationSQL = fs.readFileSync(migrationPath, "utf-8");
          dbManager.db.exec(migrationSQL);
          dbManager.saveToFile();
          logger.info("[Database] 技能和工具管理系统表创建完成");
        } else {
          logger.warn("[Database] 技能工具系统迁移文件不存在:", migrationPath);
        }
      } catch (skillToolError) {
        logger.error("[Database] 创建技能工具系统表失败:", skillToolError);
      }
    }

    // 迁移5: 初始化内置技能和工具数据
    const skillsCount = dbManager.db
      .prepare("SELECT COUNT(*) as count FROM skills WHERE is_builtin = 1")
      .get();

    if (skillTableExists && skillsCount.count === 0) {
      logger.info("[Database] 初始化内置技能和工具数据...");
      try {
        const dataInitPath = path.join(
          __dirname,
          "database",
          "migrations",
          "004_video_skills_tools.sql",
        );
        if (fs.existsSync(dataInitPath)) {
          const dataInitSQL = fs.readFileSync(dataInitPath, "utf-8");
          dbManager.db.exec(dataInitSQL);
          dbManager.saveToFile();

          // 验证数据是否成功插入
          const newSkillsCount = dbManager.db
            .prepare(
              "SELECT COUNT(*) as count FROM skills WHERE is_builtin = 1",
            )
            .get();
          const newToolsCount = dbManager.db
            .prepare("SELECT COUNT(*) as count FROM tools WHERE is_builtin = 1")
            .get();
          logger.info(
            `[Database] 内置数据初始化完成 - 技能: ${newSkillsCount.count}, 工具: ${newToolsCount.count}`,
          );
        } else {
          logger.warn("[Database] 内置数据初始化文件不存在:", dataInitPath);
        }
      } catch (dataInitError) {
        logger.error("[Database] 初始化内置数据失败:", dataInitError);
      }
    }

    // 迁移6: Phase 1 - 工作区与任务管理系统 (v0.17.0)
    const workspaceTableExists = dbManager.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='organization_workspaces'",
      )
      .get();

    if (!workspaceTableExists) {
      logger.info("[Database] Phase 1 迁移 - 创建工作区与任务管理系统表...");
      try {
        const migrationPath = path.join(
          __dirname,
          "database",
          "migrations",
          "005_workspace_task_system.sql",
        );
        if (fs.existsSync(migrationPath)) {
          const migrationSQL = fs.readFileSync(migrationPath, "utf-8");
          dbManager.db.exec(migrationSQL);
          dbManager.saveToFile();
          logger.info("[Database] 工作区与任务管理系统表创建完成");
        } else {
          logger.warn(
            "[Database] 工作区任务系统迁移文件不存在:",
            migrationPath,
          );
        }
      } catch (workspaceError) {
        logger.error("[Database] 创建工作区任务系统表失败:", workspaceError);
      }
    }

    // 迁移7: 为现有 project_tasks 表添加企业协作字段
    const tasksInfo = dbManager.db
      .prepare("PRAGMA table_info(project_tasks)")
      .all();
    const tasksColumnsToAdd = [
      { name: "org_id", type: "TEXT", default: null },
      { name: "workspace_id", type: "TEXT", default: null },
      { name: "assigned_to", type: "TEXT", default: null },
      { name: "collaborators", type: "TEXT", default: null },
      { name: "labels", type: "TEXT", default: null },
      { name: "due_date", type: "INTEGER", default: null },
      { name: "reminder_at", type: "INTEGER", default: null },
      { name: "blocked_by", type: "TEXT", default: null },
      { name: "estimate_hours", type: "REAL", default: null },
      { name: "actual_hours", type: "REAL", default: null },
    ];

    let tasksColumnsAdded = false;
    for (const column of tasksColumnsToAdd) {
      if (!tasksInfo.some((col) => col.name === column.name)) {
        logger.info(`[Database] 添加 project_tasks.${column.name} 列`);
        const defaultClause =
          column.default !== null ? ` DEFAULT ${column.default}` : "";
        dbManager.db.run(
          `ALTER TABLE project_tasks ADD COLUMN ${column.name} ${column.type}${defaultClause}`,
        );
        tasksColumnsAdded = true;
      }
    }

    if (tasksColumnsAdded) {
      dbManager.saveToFile();
      logger.info("[Database] project_tasks 表字段扩展完成");
    }

    // 迁移8: Phase 2 - 文件共享与版本控制系统 (v0.18.0)
    const fileVersionsTableExists = dbManager.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='file_versions'",
      )
      .get();

    if (!fileVersionsTableExists) {
      logger.info("[Database] Phase 2 迁移 - 创建文件共享与版本控制系统表...");
      try {
        const migrationPath = path.join(
          __dirname,
          "database",
          "migrations",
          "006_file_sharing_system.sql",
        );
        if (fs.existsSync(migrationPath)) {
          const migrationSQL = fs.readFileSync(migrationPath, "utf-8");
          dbManager.db.exec(migrationSQL);
          dbManager.saveToFile();
          logger.info("[Database] 文件共享与版本控制系统表创建完成");
        } else {
          logger.warn("[Database] 文件共享系统迁移文件不存在:", migrationPath);
        }
      } catch (fileError) {
        logger.error("[Database] 创建文件共享系统表失败:", fileError);
      }
    }

    // 迁移9: 为现有 project_files 表添加共享和锁定字段
    const filesInfo = dbManager.db
      .prepare("PRAGMA table_info(project_files)")
      .all();
    const filesColumnsToAdd = [
      { name: "org_id", type: "TEXT", default: null },
      { name: "workspace_id", type: "TEXT", default: null },
      { name: "shared_with", type: "TEXT", default: null },
      { name: "lock_status", type: "TEXT", default: "'unlocked'" },
      { name: "locked_by", type: "TEXT", default: null },
      { name: "locked_at", type: "INTEGER", default: null },
      { name: "version_number", type: "INTEGER", default: 1 },
      { name: "checksum", type: "TEXT", default: null },
    ];

    let filesColumnsAdded = false;
    for (const column of filesColumnsToAdd) {
      if (!filesInfo.some((col) => col.name === column.name)) {
        logger.info(`[Database] 添加 project_files.${column.name} 列`);
        const defaultClause =
          column.default !== null ? ` DEFAULT ${column.default}` : "";
        dbManager.db.run(
          `ALTER TABLE project_files ADD COLUMN ${column.name} ${column.type}${defaultClause}`,
        );
        filesColumnsAdded = true;
      }
    }

    if (filesColumnsAdded) {
      dbManager.saveToFile();
      logger.info("[Database] project_files 表字段扩展完成");
    }

    // 迁移10: LLM 会话管理和 Token 追踪系统 (v0.20.0)
    const llmSessionsTableExists = dbManager.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='llm_sessions'",
      )
      .get();

    if (!llmSessionsTableExists) {
      logger.info("[Database] 创建 LLM 会话管理和 Token 追踪系统表...");
      try {
        const migrationPath = path.join(
          __dirname,
          "database",
          "migrations",
          "005_llm_sessions.sql",
        );
        if (fs.existsSync(migrationPath)) {
          const migrationSQL = fs.readFileSync(migrationPath, "utf-8");
          dbManager.db.exec(migrationSQL);
          dbManager.saveToFile();
          logger.info("[Database] LLM 会话管理和 Token 追踪系统表创建完成");
        } else {
          logger.warn(
            "[Database] LLM 会话管理系统迁移文件不存在:",
            migrationPath,
          );
        }
      } catch (llmError) {
        logger.error("[Database] 创建 LLM 会话管理系统表失败:", llmError);
      }
    }

    // 迁移11: 为 conversations 表添加 Token 统计字段
    const conversationsInfo = dbManager.db
      .prepare("PRAGMA table_info(conversations)")
      .all();
    const conversationsColumnsToAdd = [
      { name: "total_input_tokens", type: "INTEGER", default: 0 },
      { name: "total_output_tokens", type: "INTEGER", default: 0 },
      { name: "total_cost_usd", type: "REAL", default: 0 },
      { name: "total_cost_cny", type: "REAL", default: 0 },
    ];

    let conversationsColumnsAdded = false;
    for (const column of conversationsColumnsToAdd) {
      if (!conversationsInfo.some((col) => col.name === column.name)) {
        logger.info(`[Database] 添加 conversations.${column.name} 列`);
        const defaultClause =
          column.default !== null ? ` DEFAULT ${column.default}` : "";
        dbManager.db.run(
          `ALTER TABLE conversations ADD COLUMN ${column.name} ${column.type}${defaultClause}`,
        );
        conversationsColumnsAdded = true;
      }
    }

    if (conversationsColumnsAdded) {
      dbManager.saveToFile();
      logger.info("[Database] conversations 表字段扩展完成");
    }

    // 迁移12: Token 追踪和成本优化完整系统 (v0.21.0)
    const tokenTrackingTableExists = dbManager.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='llm_usage_log'",
      )
      .get();

    if (!tokenTrackingTableExists) {
      logger.info("[Database] 创建 Token 追踪和成本优化系统表...");
      try {
        const tokenTrackingMigration = require("./migrations/add-token-tracking");
        // 同步调用迁移（虽然函数是 async，但内部操作都是同步的）
        tokenTrackingMigration.migrate(dbManager.db);
        dbManager.saveToFile();
        logger.info("[Database] ✓ Token 追踪和成本优化系统表创建完成");
      } catch (tokenError) {
        logger.error("[Database] 创建 Token 追踪系统表失败:", tokenError);
      }
    }

    // 迁移13: ErrorMonitor AI 诊断系统 (v0.22.0)
    const errorAnalysisTableExists = dbManager.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='error_analysis'",
      )
      .get();

    if (!errorAnalysisTableExists) {
      logger.info("[Database] 创建 ErrorMonitor AI 诊断系统表...");
      try {
        const migrationSQL = fs.readFileSync(
          path.join(
            __dirname,
            "database",
            "migrations",
            "006_error_analysis.sql",
          ),
          "utf-8",
        );
        dbManager.db.exec(migrationSQL);
        dbManager.saveToFile();
        logger.info("[Database] ✓ ErrorMonitor AI 诊断系统表创建完成");
      } catch (errorAnalysisError) {
        logger.error(
          "[Database] 创建 ErrorMonitor AI 诊断系统表失败:",
          errorAnalysisError,
        );
      }
    }

    // 迁移14: Email 草稿系统 (v0.29.0)
    const emailDraftsTableExists = dbManager.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='email_drafts'",
      )
      .get();

    if (!emailDraftsTableExists) {
      logger.info("[Database] 创建 Email 草稿系统表...");
      try {
        const migrationSQL = fs.readFileSync(
          path.join(
            __dirname,
            "database",
            "migrations",
            "017_email_drafts.sql",
          ),
          "utf-8",
        );
        dbManager.db.exec(migrationSQL);
        dbManager.saveToFile();
        logger.info("[Database] ✓ Email 草稿系统表创建完成");
      } catch (emailDraftsError) {
        logger.error("[Database] 创建 Email 草稿系统表失败:", emailDraftsError);
      }
    }

    // 迁移18: 浏览器自动化 Phase 4-5 (v0.30.0)
    const browserWorkflowsTableExists = dbManager.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='browser_workflows'",
      )
      .get();

    if (!browserWorkflowsTableExists) {
      logger.info("[Database] 创建浏览器自动化系统表 (Phase 4-5)...");
      try {
        const migrationSQL = fs.readFileSync(
          path.join(
            __dirname,
            "database",
            "migrations",
            "018_browser_workflows.sql",
          ),
          "utf-8",
        );
        dbManager.db.exec(migrationSQL);
        dbManager.saveToFile();
        logger.info("[Database] ✓ 浏览器自动化系统表创建完成");
      } catch (browserWorkflowsError) {
        logger.error(
          "[Database] 创建浏览器自动化系统表失败:",
          browserWorkflowsError,
        );
      }
    }

    logger.info("[Database] 数据库迁移任务完成");
  } catch (error) {
    logger.error("[Database] 运行数据库迁移失败:", error);
    // 不抛出错误，避免影响应用启动
  }
}

function checkIfTableNeedsRebuild(
  dbManager,
  logger,
  tableName,
  testCategoryValue,
) {
  try {
    // 获取表的SQL定义
    const stmt = dbManager.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
    );
    const result = stmt.get([tableName]);
    stmt.free();

    if (!result || !result.sql) {
      return false;
    }

    // 检查SQL定义中是否包含新的值
    const sql = result.sql;

    if (tableName === "projects") {
      // 检查是否包含 'presentation' 和 'spreadsheet'
      return !sql.includes("'presentation'") || !sql.includes("'spreadsheet'");
    } else if (tableName === "project_templates") {
      // 检查category是否包含测试值
      return !sql.includes(`'${testCategoryValue}'`);
    }

    return false;
  } catch (error) {
    logger.error(`[Database] 检查${tableName}表失败:`, error);
    return false;
  }
}

function rebuildProjectsTable(dbManager, logger) {
  try {
    logger.info("[Database] 开始重建projects表...");

    // 1. 重命名旧表
    dbManager.db.run("ALTER TABLE projects RENAME TO projects_old");

    // 2. 创建新表（带更新的CHECK约束）
    dbManager.db.run(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        project_type TEXT NOT NULL CHECK(project_type IN ('web', 'document', 'data', 'app', 'presentation', 'spreadsheet', 'design', 'code')),
        status TEXT DEFAULT 'active' CHECK(status IN ('draft', 'active', 'completed', 'archived')),
        root_path TEXT,
        file_count INTEGER DEFAULT 0,
        total_size INTEGER DEFAULT 0,
        template_id TEXT,
        cover_image_url TEXT,
        tags TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error')),
        synced_at INTEGER,
        device_id TEXT,
        deleted INTEGER DEFAULT 0,
        category_id TEXT
      )
    `);

    // 3. 复制数据
    dbManager.db.run(`
      INSERT INTO projects
      SELECT id, user_id, name, description, project_type, status, root_path,
             file_count, total_size, template_id, cover_image_url, tags, metadata,
             created_at, updated_at, sync_status, synced_at, device_id, deleted,
             ${dbManager.checkColumnExists("projects_old", "category_id") ? "category_id" : "NULL"}
      FROM projects_old
    `);

    // 4. 删除旧表
    dbManager.db.run("DROP TABLE projects_old");

    // 5. 重新创建索引
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)",
    );
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC)",
    );
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC)",
    );
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)",
    );
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(project_type)",
    );
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_projects_sync_status ON projects(sync_status)",
    );
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_projects_category_id ON projects(category_id)",
    );

    dbManager.saveToFile();
    logger.info("[Database] projects表重建成功");
  } catch (error) {
    logger.error("[Database] 重建projects表失败:", error);
    throw error;
  }
}

function rebuildProjectTemplatesTable(dbManager, logger) {
  try {
    logger.info("[Database] 开始重建project_templates表...");

    // 1. 重命名旧表
    dbManager.db.run(
      "ALTER TABLE project_templates RENAME TO project_templates_old",
    );

    // 2. 创建新表（带更新的CHECK约束）
    dbManager.db.run(`
      CREATE TABLE project_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        cover_image TEXT,

        -- 分类信息
        category TEXT NOT NULL CHECK(category IN (
          -- 职业专用分类 (v0.20.0)
          'medical',      -- 医疗
          'legal',        -- 法律
          'education',    -- 教育
          'research',     -- 研究
          -- 通用分类
          'writing',      -- 写作
          'ppt',          -- PPT演示
          'excel',        -- Excel数据
          'web',          -- 网页开发
          'design',       -- 设计
          'podcast',      -- 播客
          'resume',       -- 简历
          'marketing',    -- 营销
          'lifestyle',    -- 生活
          'travel',       -- 旅游
          -- 新增分类 (v0.19.0)
          'video',            -- 视频内容
          'social-media',     -- 社交媒体
          'creative-writing', -- 创意写作
          'code-project',     -- 代码项目
          'data-science',     -- 数据科学
          'tech-docs',        -- 技术文档
          'ecommerce',        -- 电商运营
          'marketing-pro',    -- 营销推广
          'learning',         -- 学习成长
          'health',           -- 健康生活
          'time-management',  -- 时间管理
          'productivity',     -- 效率工具
          'finance',          -- 财务管理
          'photography',      -- 摄影
          'music',            -- 音乐创作
          'gaming',           -- 游戏设计
          'cooking',          -- 烹饪美食
          'career',           -- 职业发展
          'business',         -- 商业
          'hr',               -- 人力资源
          'project'           -- 项目管理
        )),
        subcategory TEXT,
        tags TEXT,

        -- 模板配置
        project_type TEXT NOT NULL CHECK(project_type IN ('web', 'document', 'data', 'app', 'presentation', 'spreadsheet', 'design', 'code')),
        prompt_template TEXT,
        variables_schema TEXT,
        file_structure TEXT,
        default_files TEXT,

        -- 元数据
        is_builtin INTEGER DEFAULT 0,
        author TEXT,
        version TEXT DEFAULT '1.0.0',
        usage_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,

        -- 时间戳
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,

        -- 同步
        sync_status TEXT DEFAULT 'synced' CHECK(sync_status IN ('synced', 'pending', 'conflict')),
        deleted INTEGER DEFAULT 0
      )
    `);

    // 3. 复制数据
    dbManager.db.run(`
      INSERT INTO project_templates
      SELECT id, name, display_name, description, icon, cover_image,
             category, subcategory, tags,
             project_type, prompt_template, variables_schema, file_structure, default_files,
             is_builtin, author, version, usage_count, rating, rating_count,
             created_at, updated_at, sync_status,
             ${dbManager.checkColumnExists("project_templates_old", "deleted") ? "deleted" : "0"}
      FROM project_templates_old
    `);

    // 4. 删除旧表
    dbManager.db.run("DROP TABLE project_templates_old");

    // 5. 重新创建索引
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_templates_category ON project_templates(category)",
    );
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_templates_subcategory ON project_templates(subcategory)",
    );
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_templates_type ON project_templates(project_type)",
    );
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_templates_usage ON project_templates(usage_count DESC)",
    );
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_templates_rating ON project_templates(rating DESC)",
    );
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_templates_builtin ON project_templates(is_builtin)",
    );
    dbManager.db.run(
      "CREATE INDEX IF NOT EXISTS idx_templates_deleted ON project_templates(deleted)",
    );

    dbManager.saveToFile();
    logger.info("[Database] project_templates表重建成功");
  } catch (error) {
    logger.error("[Database] 重建project_templates表失败:", error);
    throw error;
  }
}

function checkColumnExists(dbManager, logger, tableName, columnName) {
  try {
    const stmt = dbManager.db.prepare(`PRAGMA table_info(${tableName})`);
    const columns = stmt.all();
    stmt.free();
    return columns.some((col) => col.name === columnName);
  } catch {
    return false;
  }
}

module.exports = {
  ensureTaskBoardOwnerSchema,
  migrateDatabase,
  runMigrationsOptimized,
  runMigrations,
  checkIfTableNeedsRebuild,
  rebuildProjectsTable,
  rebuildProjectTemplatesTable,
  checkColumnExists,
};
