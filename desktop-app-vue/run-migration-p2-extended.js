/**
 * P2扩展功能数据库迁移执行脚本
 * 创建任务分解、工具组合、历史记忆相关表
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      P2扩展功能 - 数据库迁移脚本                        ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function runMigration() {
  try {
    const dbPath = path.join(__dirname, 'data/chainlesschain.db');
    const db = new Database(dbPath);
    console.log(`  ✅ 数据库已打开: ${dbPath}\n`);

    console.log('[1/4] 创建任务分解历史表...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_decomposition_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        task_description TEXT,
        task_params TEXT,
        granularity TEXT NOT NULL,
        subtasks TEXT NOT NULL,
        subtask_count INTEGER NOT NULL,
        dependency_info TEXT,
        complexity_score REAL,
        decomposition_duration INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_task_decomp_session ON task_decomposition_history(session_id);
      CREATE INDEX IF NOT EXISTS idx_task_decomp_type ON task_decomposition_history(task_type);
      CREATE INDEX IF NOT EXISTS idx_task_decomp_created ON task_decomposition_history(created_at);
    `);
    console.log('  ✓ 任务分解历史表创建成功\n');

    console.log('[2/4] 创建工具组合历史表...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS tool_composition_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        goal TEXT NOT NULL,
        composition TEXT NOT NULL,
        tool_count INTEGER NOT NULL,
        composition_strategy TEXT,
        parallelizable_count INTEGER DEFAULT 0,
        estimated_cost REAL,
        actual_cost REAL,
        composition_duration INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_tool_comp_session ON tool_composition_history(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_comp_goal ON tool_composition_history(goal);
      CREATE INDEX IF NOT EXISTS idx_tool_comp_created ON tool_composition_history(created_at);
    `);
    console.log('  ✓ 工具组合历史表创建成功\n');

    console.log('[3/4] 创建任务执行历史表...');

    // 检查并删除依赖的视图
    const oldView = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='view' AND name='v_p2_daily_performance'
    `).get();

    if (oldView) {
      console.log('  ⚠️  删除旧视图 v_p2_daily_performance...');
      db.exec(`DROP VIEW IF EXISTS v_p2_daily_performance`);
      console.log('  ✓ 旧视图已删除');
    }

    // 检查旧表是否存在，如果存在则重命名为备份
    const oldTable = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='task_execution_history'
    `).get();

    if (oldTable) {
      console.log('  ⚠️  检测到旧版task_execution_history表，重命名为备份...');
      db.exec(`ALTER TABLE task_execution_history RENAME TO task_execution_history_p1_backup`);
      console.log('  ✓ 旧表已备份为 task_execution_history_p1_backup');
    }

    db.exec(`
      CREATE TABLE task_execution_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_task_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        task_params TEXT,
        status TEXT NOT NULL,
        start_time DATETIME NOT NULL,
        end_time DATETIME,
        duration INTEGER,
        result TEXT,
        error_message TEXT,
        model_used TEXT,
        llm_calls INTEGER DEFAULT 0,
        cost REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_task_exec_task_id ON task_execution_history(execution_task_id);
      CREATE INDEX IF NOT EXISTS idx_task_exec_type ON task_execution_history(task_type);
      CREATE INDEX IF NOT EXISTS idx_task_exec_status ON task_execution_history(status);
      CREATE INDEX IF NOT EXISTS idx_task_exec_created ON task_execution_history(created_at)
    `);
    console.log('  ✓ 任务执行历史表创建成功\n');

    console.log('[4/4] 创建任务执行记忆表...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_execution_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_type TEXT NOT NULL UNIQUE,
        total_executions INTEGER DEFAULT 0,
        successful_executions INTEGER DEFAULT 0,
        failed_executions INTEGER DEFAULT 0,
        success_rate REAL DEFAULT 0,
        avg_duration INTEGER,
        avg_llm_calls REAL,
        avg_cost REAL,
        best_model TEXT,
        best_strategy TEXT,
        common_patterns TEXT,
        last_executed DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_task_memory_type ON task_execution_memory(task_type);
      CREATE INDEX IF NOT EXISTS idx_task_memory_rate ON task_execution_memory(success_rate);
      CREATE INDEX IF NOT EXISTS idx_task_memory_updated ON task_execution_memory(updated_at);
    `);
    console.log('  ✓ 任务执行记忆表创建成功\n');

    // 验证表创建
    console.log('验证表创建状态...');
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN (
        'task_decomposition_history',
        'tool_composition_history',
        'task_execution_history',
        'task_execution_memory'
      )
      ORDER BY name
    `).all();

    console.log(`  ✓ 已创建 ${tables.length}/4 个扩展表:\n`);
    tables.forEach(t => console.log(`    - ${t.name}`));
    console.log('');

    db.close();

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  ✅ P2扩展功能迁移成功！                                ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    console.log('📊 数据库表总览:');
    console.log('  P2核心表:');
    console.log('    - intent_fusion_history');
    console.log('    - knowledge_distillation_history');
    console.log('    - streaming_response_events');
    console.log('  P2扩展表:');
    console.log('    - task_decomposition_history');
    console.log('    - tool_composition_history');
    console.log('    - task_execution_history');
    console.log('    - task_execution_memory\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ 迁移失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runMigration();
