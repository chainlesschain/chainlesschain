/**
 * P2优化数据库迁移执行脚本
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      P2优化 - 数据库迁移脚本                            ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function runMigration() {
  try {
    const dbPath = path.join(__dirname, 'data/chainlesschain.db');
    const db = new Database(dbPath);
    console.log(`  ✅ 数据库已打开\n`);

    console.log('[1/2] 创建P2优化表...\n');

    db.exec(`
      CREATE TABLE IF NOT EXISTS intent_fusion_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        user_id TEXT,
        original_intents TEXT NOT NULL,
        fused_intents TEXT NOT NULL,
        fusion_strategy TEXT,
        original_count INTEGER NOT NULL,
        fused_count INTEGER NOT NULL,
        reduction_rate REAL,
        llm_calls_saved INTEGER,
        context TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS knowledge_distillation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        complexity_level TEXT NOT NULL,
        complexity_score REAL NOT NULL,
        planned_model TEXT NOT NULL,
        actual_model TEXT NOT NULL,
        used_fallback INTEGER DEFAULT 0,
        task_intents TEXT,
        context_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS streaming_response_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_intent_fusion_session ON intent_fusion_history(session_id);
      CREATE INDEX IF NOT EXISTS idx_intent_fusion_created ON intent_fusion_history(created_at);
      CREATE INDEX IF NOT EXISTS idx_kd_task ON knowledge_distillation_history(task_id);
      CREATE INDEX IF NOT EXISTS idx_kd_created ON knowledge_distillation_history(created_at);
      CREATE INDEX IF NOT EXISTS idx_streaming_task ON streaming_response_events(task_id);
      CREATE INDEX IF NOT EXISTS idx_streaming_timestamp ON streaming_response_events(timestamp);
    `);

    console.log('  ✅ 所有P2表创建成功\n');

    db.close();

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  ✅ P2优化迁移成功！                                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ 迁移失败:', error.message);
    process.exit(1);
  }
}

runMigration();
