package com.chainlesschain.android.feature.familyguard.data

import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.room.migration.Migration
import timber.log.Timber

/**
 * Migration chain for [FamilyGuardDatabase].
 *
 * v1: 初版, 无迁移 (Room 由 entity 自动建表)。后续每加列 / 改列 / 删表
 * 都必走 schema bump + Migration(N, N+1) + 单测 (参考
 * [[pdh_partial_index_if_not_exists_drift]] trap #25)。
 *
 * 风格抄 :core-database/migration/DatabaseMigrations.kt:
 *   - Migration 类 / 函数定义在此 object 中
 *   - [MigrationCallback.onOpen] 应用 PRAGMA (foreign_keys / WAL)
 *   - 单测放 androidTest, 用 Room MigrationTestHelper 真跑 SQLite (因 SQLCipher
 *     不能 in-memory; 等 FAMILY-09 fixture 框架 land 后补)。
 */
object FamilyGuardMigrations {

    /**
     * 完整 migration 链入口。v1 是首版, 暂空。
     */
    fun all(): Array<Migration> = ALL_MIGRATIONS

    @Suppress("VariableNaming") // 名字按 :core-database 风格保持 UPPER_SNAKE
    val ALL_MIGRATIONS: Array<Migration> = emptyArray()

    /**
     * 数据库 PRAGMA 应用 + open 后自检。
     *
     * SQLCipher 在 [SupportSQLiteDatabase.execSQL] 中可正常解析这些 PRAGMA;
     * foreign_keys 必须 onOpen 时设, 因 Room 每次 open 都重置 connection state。
     */
    class FamilyGuardMigrationCallback : RoomDatabase.Callback() {
        override fun onOpen(db: SupportSQLiteDatabase) {
            super.onOpen(db)
            db.execSQL("PRAGMA foreign_keys = ON")
            // WAL 由 SQLCipher 默认开, 这里仅作显式确认; 失败不报错。
            runCatching { db.execSQL("PRAGMA journal_mode = WAL") }
                .onFailure { Timber.w(it, "family_guard.db PRAGMA journal_mode WAL ignored") }
        }
    }
}
