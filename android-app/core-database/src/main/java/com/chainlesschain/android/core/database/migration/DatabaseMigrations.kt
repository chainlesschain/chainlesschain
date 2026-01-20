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
            MIGRATION_2_3
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
