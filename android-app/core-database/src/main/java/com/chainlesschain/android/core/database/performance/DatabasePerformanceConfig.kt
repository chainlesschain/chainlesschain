package com.chainlesschain.android.core.database.performance

import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import timber.log.Timber

/**
 * Room数据库性能优化配置
 *
 * 优化策略:
 * 1. 启用WAL模式 - 提升并发读写性能
 * 2. 优化查询计划 - ANALYZE命令
 * 3. 索引优化建议
 * 4. 查询性能监控
 */
object DatabasePerformanceConfig {

    /**
     * 数据库打开回调 - 应用性能优化配置
     */
    val callback = object : RoomDatabase.Callback() {
        override fun onOpen(db: SupportSQLiteDatabase) {
            super.onOpen(db)

            // 启用WAL模式 (Write-Ahead Logging)
            // 优点: 提升并发性能,读写不阻塞
            db.execSQL("PRAGMA journal_mode=WAL")

            // 设置同步模式为NORMAL (平衡性能和安全性)
            db.execSQL("PRAGMA synchronous=NORMAL")

            // 设置缓存大小 (单位: 页, 1页=4KB, 10000页=40MB)
            db.execSQL("PRAGMA cache_size=10000")

            // 设置临时存储在内存中
            db.execSQL("PRAGMA temp_store=MEMORY")

            // 优化查询计划
            db.execSQL("ANALYZE")

            Timber.d("Database performance optimizations applied")
        }
    }

    /**
     * 推荐的索引配置
     * 在Entity类中使用 @Index 注解
     */
    object IndexRecommendations {
        const val KNOWLEDGE_ITEM_TITLE = "index_knowledge_item_title"
        const val KNOWLEDGE_ITEM_CREATED_AT = "index_knowledge_item_created_at"
        const val KNOWLEDGE_ITEM_UPDATED_AT = "index_knowledge_item_updated_at"
        const val KNOWLEDGE_ITEM_TYPE = "index_knowledge_item_type"

        const val CONVERSATION_CREATED_AT = "index_conversation_created_at"
        const val CONVERSATION_UPDATED_AT = "index_conversation_updated_at"

        const val MESSAGE_CONVERSATION_ID = "index_message_conversation_id"
        const val MESSAGE_CREATED_AT = "index_message_created_at"
    }

    /**
     * 查询性能监控
     * 记录慢查询 (超过100ms)
     */
    fun logSlowQuery(query: String, durationMs: Long) {
        if (durationMs > 100) {
            Timber.w("Slow query detected (${durationMs}ms): $query")
        }
    }
}
