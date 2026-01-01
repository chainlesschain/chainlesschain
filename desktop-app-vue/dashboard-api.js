/**
 * 监控仪表板 API
 * 提供监控数据的HTTP API服务
 *
 * 使用方法:
 *   node dashboard-api.js [端口]
 *
 * 示例:
 *   node dashboard-api.js 3000
 *   浏览器访问: http://localhost:3000
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.argv[2] || 3000;

/**
 * 获取监控数据
 */
async function getMonitoringData(days = 7) {
  const DatabaseManager = require('./src/main/database');
  const dbPath = path.join(__dirname, 'data/chainlesschain.db');
  const dbManager = new DatabaseManager(dbPath, { encryptionEnabled: false });
  await dbManager.initialize();
  const db = dbManager.db;

  const data = {
    timestamp: new Date().toISOString(),
    timeRange: `${days} days`,

    // P2 意图融合
    intentFusion: {
      totalFusions: 0,
      avgSavingsRate: 0,
      totalLLMSaved: 0,
      lastFusion: null,
      history: []
    },

    // P2 知识蒸馏
    knowledgeDistillation: {
      modelDistribution: [],
      smallModelRate: 0,
      totalTasks: 0
    },

    // P2 流式响应
    streamingResponse: {
      totalTasks: 0,
      totalEvents: 0,
      avgEventsPerTask: 0,
      lastEvent: null
    },

    // P1 自我修正
    selfCorrection: {
      totalCorrections: 0,
      avgAttempts: 0,
      successfulCorrections: 0,
      successRate: 0
    },

    // P1 多意图识别
    multiIntent: {
      totalRecognitions: 0,
      multiIntentCount: 0,
      multiIntentRate: 0,
      avgIntentCount: 0
    },

    // P1 检查点校验
    checkpointValidation: {
      totalValidations: 0,
      passedCount: 0,
      passRate: 0
    },

    // 用户反馈
    userFeedback: {
      totalFeedback: 0,
      avgRating: 0,
      positiveRate: 0,
      pendingCount: 0
    },

    // 功能使用热度
    featurePopularity: [],

    // 性能问题热点
    performanceHotspots: []
  };

  try {
    // 1. 意图融合
    const fusionStats = db.prepare(`
      SELECT
        COUNT(*) as total_fusions,
        AVG(CAST(reduction_rate AS REAL)) as avg_savings_rate,
        SUM(llm_calls_saved) as total_llm_saved,
        MAX(created_at) as last_fusion
      FROM intent_fusion_history
      WHERE created_at >= datetime('now', '-${days} days')
    `).get();

    if (fusionStats) {
      data.intentFusion = {
        totalFusions: fusionStats.total_fusions || 0,
        avgSavingsRate: fusionStats.avg_savings_rate || 0,
        totalLLMSaved: fusionStats.total_llm_saved || 0,
        lastFusion: fusionStats.last_fusion
      };

      // 历史趋势
      const fusionHistory = db.prepare(`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as count,
          AVG(CAST(reduction_rate AS REAL)) as avg_rate
        FROM intent_fusion_history
        WHERE created_at >= datetime('now', '-${days} days')
        GROUP BY DATE(created_at)
        ORDER BY date
      `).all();

      data.intentFusion.history = fusionHistory;
    }

    // 2. 知识蒸馏
    const distillationStats = db.prepare(`
      SELECT
        actual_model,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
      FROM knowledge_distillation_history
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY actual_model
      ORDER BY count DESC
    `).all();

    if (distillationStats && distillationStats.length > 0) {
      data.knowledgeDistillation.modelDistribution = distillationStats;
      data.knowledgeDistillation.totalTasks = distillationStats.reduce((sum, s) => sum + s.count, 0);

      const smallModel = distillationStats.find(s => s.actual_model?.includes('1.5b'));
      data.knowledgeDistillation.smallModelRate = smallModel ? smallModel.percentage : 0;
    }

    // 3. 流式响应
    const streamingStats = db.prepare(`
      SELECT
        COUNT(DISTINCT task_id) as total_tasks,
        COUNT(*) as total_events,
        MAX(timestamp) as last_event
      FROM streaming_response_events
      WHERE timestamp >= datetime('now', '-${days} days')
    `).get();

    if (streamingStats) {
      data.streamingResponse = {
        totalTasks: streamingStats.total_tasks || 0,
        totalEvents: streamingStats.total_events || 0,
        avgEventsPerTask: streamingStats.total_tasks > 0
          ? (streamingStats.total_events / streamingStats.total_tasks).toFixed(1)
          : 0,
        lastEvent: streamingStats.last_event
      };
    }

    // 4. 自我修正
    const correctionStats = db.prepare(`
      SELECT
        COUNT(*) as total_corrections,
        AVG(attempts) as avg_attempts,
        SUM(final_success) as successful_corrections,
        SUM(final_success) * 100.0 / COUNT(*) as success_rate
      FROM self_correction_history
      WHERE created_at >= datetime('now', '-${days} days')
    `).get();

    if (correctionStats) {
      data.selfCorrection = {
        totalCorrections: correctionStats.total_corrections || 0,
        avgAttempts: correctionStats.avg_attempts || 0,
        successfulCorrections: correctionStats.successful_corrections || 0,
        successRate: correctionStats.success_rate || 0
      };
    }

    // 5. 多意图识别
    const multiIntentStats = db.prepare(`
      SELECT
        COUNT(*) as total_recognitions,
        SUM(CASE WHEN is_multi_intent = 1 THEN 1 ELSE 0 END) as multi_intent_count,
        AVG(intent_count) as avg_intent_count
      FROM multi_intent_history
      WHERE created_at >= datetime('now', '-${days} days')
    `).get();

    if (multiIntentStats) {
      data.multiIntent = {
        totalRecognitions: multiIntentStats.total_recognitions || 0,
        multiIntentCount: multiIntentStats.multi_intent_count || 0,
        multiIntentRate: multiIntentStats.total_recognitions > 0
          ? ((multiIntentStats.multi_intent_count / multiIntentStats.total_recognitions) * 100).toFixed(1)
          : 0,
        avgIntentCount: multiIntentStats.avg_intent_count || 0
      };
    }

    // 6. 检查点校验
    const checkpointStats = db.prepare(`
      SELECT
        COUNT(*) as total_validations,
        SUM(passed) as passed_count,
        SUM(passed) * 100.0 / COUNT(*) as pass_rate
      FROM checkpoint_validations
      WHERE created_at >= datetime('now', '-${days} days')
    `).get();

    if (checkpointStats) {
      data.checkpointValidation = {
        totalValidations: checkpointStats.total_validations || 0,
        passedCount: checkpointStats.passed_count || 0,
        passRate: checkpointStats.pass_rate || 0
      };
    }

    // 7. 用户反馈
    const feedbackStats = db.prepare(`
      SELECT
        COUNT(*) as total_feedback,
        AVG(rating) as avg_rating,
        COUNT(CASE WHEN rating >= 4 THEN 1 END) * 100.0 / COUNT(*) as positive_rate,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
      FROM user_feedback
      WHERE created_at >= datetime('now', '-${days} days')
    `).get();

    if (feedbackStats) {
      data.userFeedback = {
        totalFeedback: feedbackStats.total_feedback || 0,
        avgRating: feedbackStats.avg_rating || 0,
        positiveRate: feedbackStats.positive_rate || 0,
        pendingCount: feedbackStats.pending_count || 0
      };
    }

    // 8. 功能热度
    const featurePopularity = db.prepare(`
      SELECT * FROM v_feature_popularity
      LIMIT 10
    `).all();

    data.featurePopularity = featurePopularity || [];

    // 9. 性能热点
    const performanceHotspots = db.prepare(`
      SELECT * FROM v_performance_hotspots
      LIMIT 10
    `).all();

    data.performanceHotspots = performanceHotspots || [];

  } catch (error) {
    console.error('获取监控数据失败:', error);
  } finally {
    dbManager.close();
  }

  return data;
}

/**
 * HTTP请求处理
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 设置CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API路由
  if (url.pathname === '/api/monitoring') {
    const days = parseInt(url.searchParams.get('days')) || 7;

    try {
      const data = await getMonitoringData(days);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // 提供仪表板HTML
  if (url.pathname === '/' || url.pathname === '/dashboard') {
    const dashboardPath = path.join(__dirname, 'dashboard.html');

    if (fs.existsSync(dashboardPath)) {
      const html = fs.readFileSync(dashboardPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Dashboard not found. Please create dashboard.html');
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

/**
 * 启动服务器
 */
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     监控仪表板 API 服务                                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`✓ 服务已启动: http://localhost:${PORT}`);
  console.log(`✓ API 端点: http://localhost:${PORT}/api/monitoring`);
  console.log(`✓ 仪表板: http://localhost:${PORT}/dashboard`);
  console.log('\n按 Ctrl+C 停止服务\n');
});
