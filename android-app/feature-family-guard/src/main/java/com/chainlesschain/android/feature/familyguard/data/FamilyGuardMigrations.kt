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
     * 完整 migration 链入口。
     * - v1: 首版 (FAMILY-02) — 7 表 baseline。
     * - v2: FAMILY-08 加 revival_code (6 位复活码, SHA256 hash + salt, 紧急解绑前置)。
     * - v3: FAMILY-20 加 child_event (Epic C M2 telemetry events; ForegroundAppTimer
     *   + 后续 PDH collectors 共享 schema, 主文档 §3.2)。
     * - v4: FAMILY-27 加 anomaly (AnomalyDetector v0 检出的异常事件; dedup_key UNIQUE,
     *   主文档 §3.2 异常事件触发)。
     */
    fun all(): Array<Migration> = ALL_MIGRATIONS

    /**
     * v1 → v2 (FAMILY-08).
     *
     * 加 revival_code 表 + 2 索引. SQL 与 Room 自动生成的 1.json → 2.json
     * schema diff 完全对齐 (字段名 / 类型 / 默认值)。改本 migration 前必先跑
     * `./gradlew :feature-family-guard:assembleDebug` 让 Room 重新导出 2.json,
     * 然后 diff schemas/2.json ↔ MIGRATION_1_2.migrate body 防漂移
     * (trap [[pdh_partial_index_if_not_exists_drift]] 的 family-guard 版本).
     */
    val MIGRATION_1_2: Migration = object : Migration(1, 2) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS revival_code (
                    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                    family_relationship_id INTEGER,
                    code_hash TEXT NOT NULL,
                    salt TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    failed_attempts INTEGER NOT NULL DEFAULT 0,
                    locked_until INTEGER,
                    consumed_at INTEGER
                )
                """.trimIndent(),
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS index_revival_code_family_relationship_id " +
                    "ON revival_code(family_relationship_id)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS index_revival_code_created_at " +
                    "ON revival_code(created_at)",
            )
        }
    }

    /**
     * v2 → v3 (FAMILY-20).
     *
     * 加 child_event 表 + 3 索引. SQL 与 Room 自动 3.json schema diff 必对齐;
     * 改本 migration 前必跑 assembleDebug 让 Room 重新导出 3.json 再 diff
     * (trap [[pdh_partial_index_if_not_exists_drift]] family-guard 版).
     */
    val MIGRATION_2_3: Migration = object : Migration(2, 3) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS child_event (
                    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                    child_did TEXT NOT NULL,
                    source TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    level TEXT NOT NULL DEFAULT 'L1'
                )
                """.trimIndent(),
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_child_event_did_time " +
                    "ON child_event(child_did, timestamp)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_child_event_source " +
                    "ON child_event(source)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_child_event_level " +
                    "ON child_event(level)",
            )
        }
    }

    /**
     * v3 → v4 (FAMILY-27).
     *
     * 加 anomaly 表 + 1 UNIQUE 索引 (dedup_key) + 1 普通索引 (child_did, detected_at)。
     * acknowledged 是 Room Boolean → INTEGER NOT NULL DEFAULT 0。SQL 与 Room 自动
     * 4.json schema diff 必对齐; 改本 migration 前必跑 assembleDebug 让 Room 重新导出
     * 4.json 再 diff (trap [[pdh_partial_index_if_not_exists_drift]] family-guard 版)。
     */
    val MIGRATION_3_4: Migration = object : Migration(3, 4) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS anomaly (
                    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                    child_did TEXT NOT NULL,
                    type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    dedup_key TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    detail TEXT NOT NULL,
                    detected_at INTEGER NOT NULL,
                    acknowledged INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                )
                """.trimIndent(),
            )
            db.execSQL(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_anomaly_dedup_key " +
                    "ON anomaly(dedup_key)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_anomaly_child_time " +
                    "ON anomaly(child_did, detected_at)",
            )
        }
    }

    @Suppress("VariableNaming")
    val ALL_MIGRATIONS: Array<Migration> = arrayOf(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)

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
