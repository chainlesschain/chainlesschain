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
     * - v5: FAMILY-63 加 audit_log (不可删审计日志, 主文档 §4.6; append-only)。
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

    /**
     * v4 → v5 (FAMILY-63).
     *
     * 加 audit_log 表 + 3 索引. append-only (不可删, 主文档 §4.6)。SQL 与 Room 自动
     * 5.json schema diff 必对齐; 改本 migration 前必跑 assembleDebug 让 Room 重新导出
     * 5.json 再 diff (trap [[pdh_partial_index_if_not_exists_drift]] family-guard 版)。
     */
    val MIGRATION_4_5: Migration = object : Migration(4, 5) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                    actor_did TEXT NOT NULL,
                    action TEXT NOT NULL,
                    target_did TEXT,
                    family_group_id TEXT,
                    detail TEXT NOT NULL DEFAULT '',
                    timestamp INTEGER NOT NULL,
                    created_at INTEGER NOT NULL
                )
                """.trimIndent(),
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_audit_log_group_time " +
                    "ON audit_log(family_group_id, timestamp)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)",
            )
        }
    }

    /**
     * v5 → v6 (M5).
     *
     * 加 family_task 表 (主文档 §3.5, 23 字段) + 3 索引。id 为 TEXT PK。SQL 与 Room 自动
     * 6.json schema diff 必对齐 (NOT NULL / nullable / 无 DEFAULT 列与 entity 完全一致);
     * 改本 migration 前必跑 assembleDebug 让 Room 重新导出 6.json 再 diff
     * (trap [[pdh_partial_index_if_not_exists_drift]] family-guard 版)。
     */
    val MIGRATION_5_6: Migration = object : Migration(5, 6) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS family_task (
                    id TEXT NOT NULL,
                    family_group_id TEXT NOT NULL,
                    assigner_did TEXT NOT NULL,
                    child_did TEXT NOT NULL,
                    source TEXT NOT NULL,
                    type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    subject TEXT,
                    grade_level TEXT,
                    attachments TEXT,
                    due_at INTEGER,
                    reminder_at INTEGER,
                    hard_constraint TEXT,
                    reward_points INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    submitted_at INTEGER,
                    submission TEXT,
                    ai_grade TEXT,
                    parent_review TEXT,
                    ai_call_log TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY(id)
                )
                """.trimIndent(),
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_family_task_child_status " +
                    "ON family_task(child_did, status)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_family_task_group ON family_task(family_group_id)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_family_task_due ON family_task(due_at)",
            )
        }
    }

    /**
     * v6 → v7 (M9).
     *
     * 加 points_event 积分流水表 (主文档 §3.9, append-only) + 3 索引。SQL 与 Room 自动
     * 7.json schema 必对齐 (同 [MIGRATION_5_6] 的 trap 注意事项): 改前必跑 assembleDebug
     * 重新导出 7.json 再 diff。
     */
    val MIGRATION_6_7: Migration = object : Migration(6, 7) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS points_event (
                    id TEXT NOT NULL,
                    child_did TEXT NOT NULL,
                    type TEXT NOT NULL,
                    amount INTEGER NOT NULL,
                    reason TEXT NOT NULL,
                    related_task_id TEXT,
                    related_reward_id TEXT,
                    granter_did TEXT,
                    timestamp INTEGER NOT NULL,
                    PRIMARY KEY(id)
                )
                """.trimIndent(),
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_points_event_child_type " +
                    "ON points_event(child_did, type)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_points_event_child_task " +
                    "ON points_event(child_did, related_task_id)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_points_event_ts ON points_event(timestamp)",
            )
        }
    }

    /**
     * v7 → v8 (M9→M4 临时白名单).
     *
     * enforce_rules 加 expires_at (NULL = 永久) + (active, expires_at) 复合索引
     * (索引名必须与 Room 默认 `index_enforce_rules_active_expires_at` 一致)。
     * 改前必跑 assembleDebug 重新导出 8.json 再 diff (同 [MIGRATION_5_6] trap)。
     */
    val MIGRATION_7_8: Migration = object : Migration(7, 8) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE enforce_rules ADD COLUMN expires_at INTEGER")
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS index_enforce_rules_active_expires_at " +
                    "ON enforce_rules(active, expires_at)",
            )
        }
    }

    /**
     * v8 → v9 (M9 家长 CRUD).
     *
     * 加 reward_catalog 兑换目录表 (主文档 §3.9) + 2 命名索引。SQL 与 Room 自动
     * 9.json schema 必对齐: 改前必跑 assembleDebug 重新导出 9.json 再 diff。
     */
    val MIGRATION_8_9: Migration = object : Migration(8, 9) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS reward_catalog (
                    id TEXT NOT NULL,
                    family_group_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL,
                    cost INTEGER NOT NULL,
                    deliverable_kind TEXT NOT NULL,
                    deliverable_value INTEGER NOT NULL,
                    target_apps TEXT NOT NULL,
                    max_per_day INTEGER NOT NULL,
                    active INTEGER NOT NULL,
                    created_by TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    PRIMARY KEY(id)
                )
                """.trimIndent(),
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_reward_catalog_group " +
                    "ON reward_catalog(family_group_id)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_reward_catalog_active ON reward_catalog(active)",
            )
        }
    }

    /**
     * v9 → v10 (M6 错题本).
     *
     * 加 mistake_book 表 (主文档 §3.6) + 2 命名索引。SQL 与 Room 自动 10.json
     * schema 必对齐: 改前必跑 assembleDebug 重新导出 10.json 再 diff。
     */
    val MIGRATION_9_10: Migration = object : Migration(9, 10) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS mistake_book (
                    id TEXT NOT NULL,
                    grade TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    knowledge_node TEXT NOT NULL,
                    question TEXT NOT NULL,
                    wrong_answer TEXT NOT NULL,
                    correct_answer TEXT NOT NULL,
                    note TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    review_count INTEGER NOT NULL,
                    last_reviewed_at INTEGER,
                    PRIMARY KEY(id)
                )
                """.trimIndent(),
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_mistake_book_grade_subject " +
                    "ON mistake_book(grade, subject)",
            )
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_mistake_book_node ON mistake_book(knowledge_node)",
            )
        }
    }

    @Suppress("VariableNaming")
    val ALL_MIGRATIONS: Array<Migration> = arrayOf(
        MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6,
        MIGRATION_6_7, MIGRATION_7_8, MIGRATION_8_9, MIGRATION_9_10,
    )

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
