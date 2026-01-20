package com.chainlesschain.android.core.database.migration

import android.util.Log
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * 数据库迁移管理
 *
 * 包含所有版本间的迁移逻辑
 * 迁移规则：
 * - 每个迁移必须是幂等的（可重复执行）
 * - 迁移必须保持数据完整性
 * - 迁移不能删除用户数据（除非明确要求）
 */
object DatabaseMigrations {

    private const val TAG = "DatabaseMigrations"

    /**
     * 获取所有迁移
     */
    fun getAllMigrations(): Array<Migration> {
        return arrayOf(
            MIGRATION_1_2,
            MIGRATION_2_3,
            MIGRATION_3_4,
            MIGRATION_4_5,
            MIGRATION_5_6,
            MIGRATION_6_7,
            MIGRATION_7_8,
            MIGRATION_8_9
        )
    }

    /**
     * 迁移 1 -> 2
     *
     * 添加 P2P 消息表
     */
    val MIGRATION_1_2 = object : Migration(1, 2) {
        override fun migrate(db: SupportSQLiteDatabase) {
            Log.i(TAG, "Migrating database from version 1 to 2")

            // 创建 p2p_messages 表
            db.execSQL("""
                CREATE TABLE IF NOT EXISTS `p2p_messages` (
                    `id` TEXT NOT NULL PRIMARY KEY,
                    `peerId` TEXT NOT NULL,
                    `fromDeviceId` TEXT NOT NULL,
                    `toDeviceId` TEXT NOT NULL,
                    `type` TEXT NOT NULL,
                    `content` TEXT NOT NULL,
                    `encryptedPayload` TEXT,
                    `timestamp` INTEGER NOT NULL,
                    `isOutgoing` INTEGER NOT NULL,
                    `requiresAck` INTEGER NOT NULL DEFAULT 1,
                    `isAcknowledged` INTEGER NOT NULL DEFAULT 0,
                    `sendStatus` TEXT NOT NULL DEFAULT 'PENDING'
                )
            """.trimIndent())

            // 创建索引
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_p2p_messages_peerId` ON `p2p_messages` (`peerId`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_p2p_messages_timestamp` ON `p2p_messages` (`timestamp`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_p2p_messages_peerId_timestamp` ON `p2p_messages` (`peerId`, `timestamp`)")

            Log.i(TAG, "Migration 1 to 2 completed successfully")
        }
    }

    /**
     * 迁移 2 -> 3
     *
     * 预留：添加更多字段或表
     * 示例：添加消息撤回、消息编辑历史等功能
     */
    val MIGRATION_2_3 = object : Migration(2, 3) {
        override fun migrate(db: SupportSQLiteDatabase) {
            Log.i(TAG, "Migrating database from version 2 to 3")

            // 为 p2p_messages 添加撤回状态字段
            db.execSQL("""
                ALTER TABLE `p2p_messages`
                ADD COLUMN `isRecalled` INTEGER NOT NULL DEFAULT 0
            """.trimIndent())

            // 为 p2p_messages 添加编辑时间字段
            db.execSQL("""
                ALTER TABLE `p2p_messages`
                ADD COLUMN `editedAt` INTEGER
            """.trimIndent())

            // 为 knowledge_items 添加向量嵌入字段
            db.execSQL("""
                ALTER TABLE `knowledge_items`
                ADD COLUMN `embedding` TEXT
            """.trimIndent())

            Log.i(TAG, "Migration 2 to 3 completed successfully")
        }
    }

    /**
     * 迁移 3 -> 4
     *
     * 添加离线消息队列表
     */
    val MIGRATION_3_4 = object : Migration(3, 4) {
        override fun migrate(db: SupportSQLiteDatabase) {
            Log.i(TAG, "Migrating database from version 3 to 4")

            // 创建 offline_message_queue 表
            db.execSQL("""
                CREATE TABLE IF NOT EXISTS `offline_message_queue` (
                    `id` TEXT NOT NULL PRIMARY KEY,
                    `peerId` TEXT NOT NULL,
                    `messageType` TEXT NOT NULL,
                    `payload` TEXT NOT NULL,
                    `priority` TEXT NOT NULL DEFAULT 'NORMAL',
                    `requireAck` INTEGER NOT NULL DEFAULT 1,
                    `retryCount` INTEGER NOT NULL DEFAULT 0,
                    `maxRetries` INTEGER NOT NULL DEFAULT 5,
                    `lastRetryAt` INTEGER,
                    `expiresAt` INTEGER,
                    `status` TEXT NOT NULL DEFAULT 'PENDING',
                    `createdAt` INTEGER NOT NULL,
                    `updatedAt` INTEGER NOT NULL
                )
            """.trimIndent())

            // 创建索引
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_offline_message_queue_peerId_status` ON `offline_message_queue` (`peerId`, `status`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_offline_message_queue_status_createdAt` ON `offline_message_queue` (`status`, `createdAt`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_offline_message_queue_priority_createdAt` ON `offline_message_queue` (`priority`, `createdAt`)")

            Log.i(TAG, "Migration 3 to 4 completed successfully")
        }
    }

    /**
     * 迁移 4 -> 5
     *
     * 添加文件传输表
     */
    val MIGRATION_4_5 = object : Migration(4, 5) {
        override fun migrate(db: SupportSQLiteDatabase) {
            Log.i(TAG, "Migrating database from version 4 to 5")

            // 创建 file_transfers 表
            db.execSQL("""
                CREATE TABLE IF NOT EXISTS `file_transfers` (
                    `id` TEXT NOT NULL PRIMARY KEY,
                    `peerId` TEXT NOT NULL,
                    `fileName` TEXT NOT NULL,
                    `fileSize` INTEGER NOT NULL,
                    `mimeType` TEXT NOT NULL,
                    `fileChecksum` TEXT NOT NULL,
                    `thumbnailBase64` TEXT,
                    `localFilePath` TEXT,
                    `tempFilePath` TEXT,
                    `isOutgoing` INTEGER NOT NULL,
                    `status` TEXT NOT NULL DEFAULT 'PENDING',
                    `chunkSize` INTEGER NOT NULL,
                    `totalChunks` INTEGER NOT NULL,
                    `completedChunks` INTEGER NOT NULL DEFAULT 0,
                    `bytesTransferred` INTEGER NOT NULL DEFAULT 0,
                    `retryCount` INTEGER NOT NULL DEFAULT 0,
                    `errorMessage` TEXT,
                    `createdAt` INTEGER NOT NULL,
                    `updatedAt` INTEGER NOT NULL,
                    `completedAt` INTEGER
                )
            """.trimIndent())

            // 创建索引
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_file_transfers_peerId` ON `file_transfers` (`peerId`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_file_transfers_status` ON `file_transfers` (`status`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_file_transfers_createdAt` ON `file_transfers` (`createdAt`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_file_transfers_peerId_status` ON `file_transfers` (`peerId`, `status`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_file_transfers_peerId_createdAt` ON `file_transfers` (`peerId`, `createdAt`)")

            Log.i(TAG, "Migration 4 to 5 completed successfully")
        }
    }

    /**
     * 迁移 5 -> 6
     *
     * 添加项目管理表（projects, project_files, project_activities）
     */
    val MIGRATION_5_6 = object : Migration(5, 6) {
        override fun migrate(db: SupportSQLiteDatabase) {
            Log.i(TAG, "Migrating database from version 5 to 6")

            // 创建 projects 表
            db.execSQL("""
                CREATE TABLE IF NOT EXISTS `projects` (
                    `id` TEXT NOT NULL PRIMARY KEY,
                    `name` TEXT NOT NULL,
                    `description` TEXT,
                    `type` TEXT NOT NULL DEFAULT 'other',
                    `status` TEXT NOT NULL DEFAULT 'active',
                    `userId` TEXT NOT NULL,
                    `rootPath` TEXT,
                    `icon` TEXT,
                    `coverImage` TEXT,
                    `tags` TEXT,
                    `metadata` TEXT,
                    `isFavorite` INTEGER NOT NULL DEFAULT 0,
                    `isArchived` INTEGER NOT NULL DEFAULT 0,
                    `isSynced` INTEGER NOT NULL DEFAULT 0,
                    `remoteId` TEXT,
                    `lastSyncedAt` INTEGER,
                    `fileCount` INTEGER NOT NULL DEFAULT 0,
                    `totalSize` INTEGER NOT NULL DEFAULT 0,
                    `lastAccessedAt` INTEGER,
                    `accessCount` INTEGER NOT NULL DEFAULT 0,
                    `gitEnabled` INTEGER NOT NULL DEFAULT 0,
                    `gitRemoteUrl` TEXT,
                    `gitBranch` TEXT,
                    `lastCommitHash` TEXT,
                    `uncommittedChanges` INTEGER NOT NULL DEFAULT 0,
                    `createdAt` INTEGER NOT NULL,
                    `updatedAt` INTEGER NOT NULL,
                    `completedAt` INTEGER
                )
            """.trimIndent())

            // 创建 projects 索引
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_projects_userId` ON `projects` (`userId`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_projects_status` ON `projects` (`status`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_projects_type` ON `projects` (`type`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_projects_createdAt` ON `projects` (`createdAt`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_projects_updatedAt` ON `projects` (`updatedAt`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_projects_isFavorite` ON `projects` (`isFavorite`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_projects_isArchived` ON `projects` (`isArchived`)")

            // 创建 project_files 表
            db.execSQL("""
                CREATE TABLE IF NOT EXISTS `project_files` (
                    `id` TEXT NOT NULL PRIMARY KEY,
                    `projectId` TEXT NOT NULL,
                    `parentId` TEXT,
                    `name` TEXT NOT NULL,
                    `path` TEXT NOT NULL,
                    `type` TEXT NOT NULL DEFAULT 'file',
                    `mimeType` TEXT,
                    `size` INTEGER NOT NULL DEFAULT 0,
                    `extension` TEXT,
                    `content` TEXT,
                    `isEncrypted` INTEGER NOT NULL DEFAULT 0,
                    `hash` TEXT,
                    `isOpen` INTEGER NOT NULL DEFAULT 0,
                    `isDirty` INTEGER NOT NULL DEFAULT 0,
                    `createdAt` INTEGER NOT NULL,
                    `updatedAt` INTEGER NOT NULL,
                    `lastAccessedAt` INTEGER
                )
            """.trimIndent())

            // 创建 project_files 索引
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_project_files_projectId` ON `project_files` (`projectId`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_project_files_parentId` ON `project_files` (`parentId`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_project_files_type` ON `project_files` (`type`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_project_files_path` ON `project_files` (`path`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_project_files_updatedAt` ON `project_files` (`updatedAt`)")

            // 创建 project_activities 表
            db.execSQL("""
                CREATE TABLE IF NOT EXISTS `project_activities` (
                    `id` TEXT NOT NULL PRIMARY KEY,
                    `projectId` TEXT NOT NULL,
                    `type` TEXT NOT NULL,
                    `description` TEXT NOT NULL,
                    `fileId` TEXT,
                    `data` TEXT,
                    `createdAt` INTEGER NOT NULL
                )
            """.trimIndent())

            // 创建 project_activities 索引
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_project_activities_projectId` ON `project_activities` (`projectId`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_project_activities_createdAt` ON `project_activities` (`createdAt`)")

            Log.i(TAG, "Migration 5 to 6 completed successfully")
        }
    }

    /**
     * 迁移 6 -> 7
     *
     * 添加知识库全文搜索（FTS4）虚拟表
     */
    val MIGRATION_6_7 = object : Migration(6, 7) {
        override fun migrate(db: SupportSQLiteDatabase) {
            Log.i(TAG, "Migrating database from version 6 to 7")

            // 创建 FTS4 虚拟表用于知识库全文搜索
            // 使用 content= 指向 knowledge_items 表实现外部内容同步
            db.execSQL("""
                CREATE VIRTUAL TABLE IF NOT EXISTS `knowledge_items_fts` USING FTS4(
                    `title`,
                    `content`,
                    `tags`,
                    content=`knowledge_items`
                )
            """.trimIndent())

            // 创建触发器以保持 FTS 表与主表同步
            // INSERT 触发器
            db.execSQL("""
                CREATE TRIGGER IF NOT EXISTS knowledge_items_fts_ai AFTER INSERT ON knowledge_items BEGIN
                    INSERT INTO knowledge_items_fts(docid, title, content, tags)
                    VALUES (NEW.rowid, NEW.title, NEW.content, NEW.tags);
                END
            """.trimIndent())

            // DELETE 触发器
            db.execSQL("""
                CREATE TRIGGER IF NOT EXISTS knowledge_items_fts_ad AFTER DELETE ON knowledge_items BEGIN
                    INSERT INTO knowledge_items_fts(knowledge_items_fts, docid, title, content, tags)
                    VALUES ('delete', OLD.rowid, OLD.title, OLD.content, OLD.tags);
                END
            """.trimIndent())

            // UPDATE 触发器
            db.execSQL("""
                CREATE TRIGGER IF NOT EXISTS knowledge_items_fts_au AFTER UPDATE ON knowledge_items BEGIN
                    INSERT INTO knowledge_items_fts(knowledge_items_fts, docid, title, content, tags)
                    VALUES ('delete', OLD.rowid, OLD.title, OLD.content, OLD.tags);
                    INSERT INTO knowledge_items_fts(docid, title, content, tags)
                    VALUES (NEW.rowid, NEW.title, NEW.content, NEW.tags);
                END
            """.trimIndent())

            // 初始填充 FTS 表（重建索引）
            db.execSQL("INSERT INTO knowledge_items_fts(knowledge_items_fts) VALUES('rebuild')")

            Log.i(TAG, "Migration 6 to 7 completed successfully")
        }
    }

    /**
     * 迁移 7 -> 8
     *
     * 添加项目AI聊天消息表 (project_chat_messages)
     */
    val MIGRATION_7_8 = object : Migration(7, 8) {
        override fun migrate(db: SupportSQLiteDatabase) {
            Log.i(TAG, "Migrating database from version 7 to 8")

            // 创建 project_chat_messages 表
            db.execSQL("""
                CREATE TABLE IF NOT EXISTS `project_chat_messages` (
                    `id` TEXT NOT NULL PRIMARY KEY,
                    `projectId` TEXT NOT NULL,
                    `role` TEXT NOT NULL,
                    `content` TEXT NOT NULL,
                    `referencedFileIds` TEXT,
                    `model` TEXT,
                    `tokenCount` INTEGER,
                    `isQuickAction` INTEGER NOT NULL DEFAULT 0,
                    `quickActionType` TEXT,
                    `createdAt` INTEGER NOT NULL,
                    `isStreaming` INTEGER NOT NULL DEFAULT 0,
                    `error` TEXT,
                    FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE
                )
            """.trimIndent())

            // 创建索引
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_project_chat_messages_projectId` ON `project_chat_messages` (`projectId`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_project_chat_messages_createdAt` ON `project_chat_messages` (`createdAt`)")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_project_chat_messages_projectId_createdAt` ON `project_chat_messages` (`projectId`, `createdAt`)")

            Log.i(TAG, "Migration 7 to 8 completed successfully")
        }
    }

    /**
     * 迁移 8 -> 9
     *
     * 增强项目AI聊天消息表，添加上下文模式、消息类型、任务计划等字段
     */
    val MIGRATION_8_9 = object : Migration(8, 9) {
        override fun migrate(db: SupportSQLiteDatabase) {
            Log.i(TAG, "Migrating database from version 8 to 9")

            // 添加消息类型字段
            db.execSQL("""
                ALTER TABLE `project_chat_messages`
                ADD COLUMN `messageType` TEXT NOT NULL DEFAULT 'NORMAL'
            """.trimIndent())

            // 添加上下文模式字段
            db.execSQL("""
                ALTER TABLE `project_chat_messages`
                ADD COLUMN `contextMode` TEXT NOT NULL DEFAULT 'PROJECT'
            """.trimIndent())

            // 添加引用文件路径字段
            db.execSQL("""
                ALTER TABLE `project_chat_messages`
                ADD COLUMN `referencedFilePaths` TEXT
            """.trimIndent())

            // 添加任务计划数据字段
            db.execSQL("""
                ALTER TABLE `project_chat_messages`
                ADD COLUMN `taskPlanData` TEXT
            """.trimIndent())

            // 添加父消息ID字段（用于线程化回复）
            db.execSQL("""
                ALTER TABLE `project_chat_messages`
                ADD COLUMN `parentMessageId` TEXT
            """.trimIndent())

            // 添加元数据字段
            db.execSQL("""
                ALTER TABLE `project_chat_messages`
                ADD COLUMN `metadata` TEXT
            """.trimIndent())

            Log.i(TAG, "Migration 8 to 9 completed successfully")
        }
    }

    /**
     * 迁移回调（用于迁移后的数据验证和清理）
     */
    class MigrationCallback : androidx.room.RoomDatabase.Callback() {
        override fun onOpen(db: SupportSQLiteDatabase) {
            super.onOpen(db)
            Log.d(TAG, "Database opened, version: ${db.version}")

            // 启用 WAL 模式以提高性能
            db.execSQL("PRAGMA journal_mode=WAL")

            // 启用外键约束
            db.execSQL("PRAGMA foreign_keys=ON")
        }

        override fun onCreate(db: SupportSQLiteDatabase) {
            super.onCreate(db)
            Log.d(TAG, "Database created, version: ${db.version}")
        }

        override fun onDestructiveMigration(db: SupportSQLiteDatabase) {
            super.onDestructiveMigration(db)
            Log.w(TAG, "Destructive migration performed! Data may have been lost.")
        }
    }
}
