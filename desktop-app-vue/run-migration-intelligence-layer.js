/**
 * P2智能层数据库迁移执行脚本
 * 创建用户画像、工具使用追踪、推荐系统相关表
 *
 * Version: v0.21.0
 * Date: 2026-01-02
 */

const Database = require('better-sqlite3');
const path = require('path');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      P2智能层 - 数据库迁移脚本                          ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function runMigration() {
  try {
    const dbPath = path.join(__dirname, 'data/chainlesschain.db');
    const db = new Database(dbPath);
    console.log(`  ✅ 数据库已打开: ${dbPath}\n`);

    console.log('[1/4] 创建用户画像表 (user_profiles)...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL UNIQUE,

        -- 技能水平
        overall_skill_level TEXT NOT NULL DEFAULT 'intermediate',
        domain_skills TEXT,

        -- 偏好设置
        preferred_tools TEXT,
        preferred_workflow TEXT DEFAULT 'sequential',
        response_expectation TEXT DEFAULT 'balanced',

        -- 统计信息
        total_tasks INTEGER DEFAULT 0,
        success_rate REAL DEFAULT 0,
        avg_task_duration INTEGER,
        most_used_tools TEXT,

        -- 时间模式
        active_hours TEXT,
        temporal_patterns TEXT,

        -- 元数据
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_profiles_skill_level ON user_profiles(overall_skill_level);
      CREATE INDEX IF NOT EXISTS idx_user_profiles_updated ON user_profiles(updated_at)
    `);
    console.log('  ✓ 用户画像表创建成功\n');

    console.log('[2/4] 创建工具使用事件表 (tool_usage_events)...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS tool_usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,

        -- 工具信息
        tool_name TEXT NOT NULL,
        tool_category TEXT,
        task_type TEXT,
        task_context TEXT,

        -- 执行结果
        execution_time INTEGER,
        success INTEGER NOT NULL DEFAULT 1,
        error_message TEXT,

        -- 用户反馈
        user_feedback TEXT,
        explicit_rating INTEGER,

        -- 上下文
        previous_tool TEXT,
        next_tool TEXT,
        is_recommended INTEGER DEFAULT 0,

        -- 时间戳
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tool_usage_user ON tool_usage_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_tool_usage_tool ON tool_usage_events(tool_name);
      CREATE INDEX IF NOT EXISTS idx_tool_usage_session ON tool_usage_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_usage_timestamp ON tool_usage_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tool_usage_success ON tool_usage_events(success)
    `);
    console.log('  ✓ 工具使用事件表创建成功\n');

    console.log('[3/4] 创建推荐记录表 (tool_recommendations)...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS tool_recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,

        -- 任务信息
        task_description TEXT NOT NULL,
        task_context TEXT,

        -- 推荐内容
        recommended_tools TEXT NOT NULL,
        recommendation_scores TEXT,
        algorithm_used TEXT,
        recommendation_reasons TEXT,

        -- 用户行为
        user_action TEXT,
        actual_tools_used TEXT,
        time_to_action INTEGER,

        -- 推荐质量评估
        recommendation_quality REAL,
        was_helpful INTEGER,

        -- 元数据
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tool_rec_user ON tool_recommendations(user_id);
      CREATE INDEX IF NOT EXISTS idx_tool_rec_session ON tool_recommendations(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_rec_created ON tool_recommendations(created_at);
      CREATE INDEX IF NOT EXISTS idx_tool_rec_action ON tool_recommendations(user_action)
    `);
    console.log('  ✓ 推荐记录表创建成功\n');

    console.log('[4/4] 创建ML模型元数据表 (ml_model_metadata)...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS ml_model_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_name TEXT NOT NULL UNIQUE,
        model_type TEXT NOT NULL,

        -- 版本信息
        version TEXT NOT NULL,
        training_date DATETIME,

        -- 训练数据
        training_data_size INTEGER,
        training_duration INTEGER,
        feature_count INTEGER,

        -- 性能指标
        performance_metrics TEXT,
        test_accuracy REAL,
        test_f1_score REAL,

        -- 模型状态
        is_active INTEGER DEFAULT 0,
        model_path TEXT,
        model_size_bytes INTEGER,

        -- 部署信息
        deployed_at DATETIME,
        last_used DATETIME,
        usage_count INTEGER DEFAULT 0,

        -- 元数据
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ml_model_name ON ml_model_metadata(model_name);
      CREATE INDEX IF NOT EXISTS idx_ml_model_active ON ml_model_metadata(is_active);
      CREATE INDEX IF NOT EXISTS idx_ml_model_type ON ml_model_metadata(model_type)
    `);
    console.log('  ✓ ML模型元数据表创建成功\n');

    // 验证表创建
    console.log('验证表创建状态...');
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN (
        'user_profiles',
        'tool_usage_events',
        'tool_recommendations',
        'ml_model_metadata'
      )
      ORDER BY name
    `).all();

    console.log(`  ✓ 已创建 ${tables.length}/4 个智能层表:\n`);
    tables.forEach(t => console.log(`    - ${t.name}`));
    console.log('');

    // 统计索引数量
    const indexes = db.prepare(`
      SELECT COUNT(*) as count FROM sqlite_master
      WHERE type='index' AND (
        name LIKE 'idx_user_profiles_%' OR
        name LIKE 'idx_tool_usage_%' OR
        name LIKE 'idx_tool_rec_%' OR
        name LIKE 'idx_ml_model_%'
      )
    `).get();

    console.log(`  ✓ 创建索引: ${indexes.count}个\n`);

    db.close();

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  ✅ P2智能层迁移成功！                                  ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    console.log('📊 智能层数据库表总览:');
    console.log('  用户画像:');
    console.log('    - user_profiles (用户画像表)');
    console.log('  数据收集:');
    console.log('    - tool_usage_events (工具使用事件表)');
    console.log('  推荐系统:');
    console.log('    - tool_recommendations (推荐记录表)');
    console.log('  模型管理:');
    console.log('    - ml_model_metadata (ML模型元数据表)\n');

    console.log('📈 下一步:');
    console.log('  1. 实现 DataCollector 模块');
    console.log('  2. 添加事件埋点到现有工具');
    console.log('  3. 开始收集用户使用数据\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ 迁移失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runMigration();
