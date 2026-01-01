/**
 * 工具使用统计仪表板
 * 提供工具使用情况的实时统计和分析
 */

const path = require('path');
const DatabaseManager = require('../database');

class ToolStatsDashboard {
  constructor(database) {
    this.db = database;
  }

  /**
   * 获取工具使用概览
   */
  async getOverview() {
    try {
      const stats = await this.db.get(`
        SELECT
          COUNT(*) as totalTools,
          SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabledTools,
          SUM(usage_count) as totalInvocations,
          SUM(success_count) as totalSuccesses,
          AVG(avg_execution_time) as avgExecutionTime,
          SUM(CASE WHEN usage_count > 0 THEN 1 ELSE 0 END) as usedTools
        FROM tools
        WHERE handler_path LIKE '%additional-tools-v3-handler%'
      `);

      const successRate = stats.totalInvocations > 0
        ? (stats.totalSuccesses / stats.totalInvocations * 100).toFixed(2)
        : 0;

      return {
        totalTools: stats.totalTools || 0,
        enabledTools: stats.enabledTools || 0,
        usedTools: stats.usedTools || 0,
        totalInvocations: stats.totalInvocations || 0,
        totalSuccesses: stats.totalSuccesses || 0,
        successRate: `${successRate}%`,
        avgExecutionTime: parseFloat((stats.avgExecutionTime || 0).toFixed(2)),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[Dashboard] 获取概览失败:', error);
      throw error;
    }
  }

  /**
   * 获取工具排行榜
   */
  async getToolRankings(limit = 10) {
    try {
      // 按使用次数排行
      const byUsage = await this.db.all(`
        SELECT
          name,
          display_name,
          category,
          usage_count,
          success_count,
          avg_execution_time,
          last_used_at
        FROM tools
        WHERE handler_path LIKE '%additional-tools-v3-handler%'
          AND usage_count > 0
        ORDER BY usage_count DESC
        LIMIT ?
      `, [limit]);

      // 按成功率排行
      const bySuccessRate = await this.db.all(`
        SELECT
          name,
          display_name,
          category,
          usage_count,
          success_count,
          CAST(success_count AS FLOAT) / usage_count * 100 as success_rate
        FROM tools
        WHERE handler_path LIKE '%additional-tools-v3-handler%'
          AND usage_count >= 5
        ORDER BY success_rate DESC
        LIMIT ?
      `, [limit]);

      // 按执行速度排行（最快的）
      const bySpeed = await this.db.all(`
        SELECT
          name,
          display_name,
          category,
          usage_count,
          avg_execution_time
        FROM tools
        WHERE handler_path LIKE '%additional-tools-v3-handler%'
          AND usage_count > 0
        ORDER BY avg_execution_time ASC
        LIMIT ?
      `, [limit]);

      return {
        mostUsed: byUsage,
        highestSuccessRate: bySuccessRate.map(tool => ({
          ...tool,
          success_rate: parseFloat(tool.success_rate.toFixed(2))
        })),
        fastest: bySpeed,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[Dashboard] 获取排行榜失败:', error);
      throw error;
    }
  }

  /**
   * 获取分类统计
   */
  async getCategoryStats() {
    try {
      const stats = await this.db.all(`
        SELECT
          COALESCE(category, 'unknown') as category,
          COUNT(*) as toolCount,
          SUM(usage_count) as totalUsage,
          SUM(success_count) as totalSuccess,
          AVG(avg_execution_time) as avgTime
        FROM tools
        WHERE handler_path LIKE '%additional-tools-v3-handler%'
        GROUP BY category
        ORDER BY totalUsage DESC
      `);

      return stats.map(stat => ({
        category: stat.category,
        toolCount: stat.toolCount,
        totalUsage: stat.totalUsage || 0,
        totalSuccess: stat.totalSuccess || 0,
        successRate: stat.totalUsage > 0
          ? parseFloat((stat.totalSuccess / stat.totalUsage * 100).toFixed(2))
          : 0,
        avgTime: parseFloat((stat.avgTime || 0).toFixed(2))
      }));
    } catch (error) {
      console.error('[Dashboard] 获取分类统计失败:', error);
      throw error;
    }
  }

  /**
   * 获取最近使用的工具
   */
  async getRecentlyUsedTools(limit = 20) {
    try {
      const tools = await this.db.all(`
        SELECT
          name,
          display_name,
          category,
          usage_count,
          success_count,
          avg_execution_time,
          last_used_at
        FROM tools
        WHERE handler_path LIKE '%additional-tools-v3-handler%'
          AND last_used_at IS NOT NULL
        ORDER BY last_used_at DESC
        LIMIT ?
      `, [limit]);

      return tools.map(tool => ({
        ...tool,
        last_used_at: new Date(tool.last_used_at).toISOString(),
        timeSinceLastUse: this._formatTimeSince(tool.last_used_at)
      }));
    } catch (error) {
      console.error('[Dashboard] 获取最近使用失败:', error);
      throw error;
    }
  }

  /**
   * 获取每日统计
   */
  async getDailyStats(days = 7) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const startDateStr = startDate.toISOString().split('T')[0];

      const stats = await this.db.all(`
        SELECT
          stat_date,
          SUM(invoke_count) as totalInvokes,
          SUM(success_count) as totalSuccess,
          SUM(failure_count) as totalFailure,
          AVG(avg_duration) as avgDuration
        FROM tool_stats
        WHERE stat_date >= ?
        GROUP BY stat_date
        ORDER BY stat_date DESC
      `, [startDateStr]);

      return stats.map(stat => ({
        date: stat.stat_date,
        invokes: stat.totalInvokes || 0,
        success: stat.totalSuccess || 0,
        failure: stat.totalFailure || 0,
        successRate: stat.totalInvokes > 0
          ? parseFloat((stat.totalSuccess / stat.totalInvokes * 100).toFixed(2))
          : 0,
        avgDuration: parseFloat((stat.avgDuration || 0).toFixed(2))
      }));
    } catch (error) {
      console.error('[Dashboard] 获取每日统计失败:', error);
      throw error;
    }
  }

  /**
   * 获取性能指标
   */
  async getPerformanceMetrics() {
    try {
      const metrics = await this.db.all(`
        SELECT
          name,
          display_name,
          usage_count,
          avg_execution_time,
          CASE
            WHEN avg_execution_time < 10 THEN 'excellent'
            WHEN avg_execution_time < 50 THEN 'good'
            WHEN avg_execution_time < 100 THEN 'fair'
            ELSE 'slow'
          END as performance_rating
        FROM tools
        WHERE handler_path LIKE '%additional-tools-v3-handler%'
          AND usage_count > 0
        ORDER BY avg_execution_time DESC
      `);

      const distribution = {
        excellent: 0,
        good: 0,
        fair: 0,
        slow: 0
      };

      metrics.forEach(metric => {
        distribution[metric.performance_rating]++;
      });

      return {
        tools: metrics,
        distribution,
        totalTools: metrics.length,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[Dashboard] 获取性能指标失败:', error);
      throw error;
    }
  }

  /**
   * 获取完整仪表板数据
   */
  async getDashboardData() {
    try {
      const [overview, rankings, categoryStats, recentTools, dailyStats, performanceMetrics] = await Promise.all([
        this.getOverview(),
        this.getToolRankings(10),
        this.getCategoryStats(),
        this.getRecentlyUsedTools(15),
        this.getDailyStats(7),
        this.getPerformanceMetrics()
      ]);

      return {
        overview,
        rankings,
        categoryStats,
        recentTools,
        dailyStats,
        performanceMetrics,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('[Dashboard] 获取仪表板数据失败:', error);
      throw error;
    }
  }

  /**
   * 生成文本格式的仪表板
   */
  async generateTextDashboard() {
    const data = await this.getDashboardData();

    let output = '';

    output += '╔════════════════════════════════════════════════════════════╗\n';
    output += '║          工具使用统计仪表板 - Additional Tools V3          ║\n';
    output += '╚════════════════════════════════════════════════════════════╝\n\n';

    // 概览
    output += '【概览】\n';
    output += `  总工具数: ${data.overview.totalTools}\n`;
    output += `  已启用: ${data.overview.enabledTools}\n`;
    output += `  已使用: ${data.overview.usedTools}\n`;
    output += `  总调用次数: ${data.overview.totalInvocations.toLocaleString()}\n`;
    output += `  成功次数: ${data.overview.totalSuccesses.toLocaleString()}\n`;
    output += `  成功率: ${data.overview.successRate}\n`;
    output += `  平均响应时间: ${data.overview.avgExecutionTime}ms\n`;
    output += '\n';

    // 最常用工具
    output += '【最常用工具 Top 5】\n';
    data.rankings.mostUsed.slice(0, 5).forEach((tool, index) => {
      output += `  ${index + 1}. ${tool.display_name || tool.name}\n`;
      output += `     使用次数: ${tool.usage_count} | 成功率: ${(tool.success_count / tool.usage_count * 100).toFixed(1)}% | 平均时间: ${tool.avg_execution_time.toFixed(2)}ms\n`;
    });
    output += '\n';

    // 分类统计
    output += '【分类统计】\n';
    data.categoryStats.forEach(cat => {
      output += `  ${cat.category.toUpperCase()}: ${cat.toolCount}个工具, ${cat.totalUsage}次使用, ${cat.successRate}%成功率\n`;
    });
    output += '\n';

    // 性能分布
    output += '【性能分布】\n';
    const perf = data.performanceMetrics.distribution;
    const total = data.performanceMetrics.totalTools;
    output += `  优秀 (<10ms): ${perf.excellent} (${(perf.excellent / total * 100).toFixed(1)}%)\n`;
    output += `  良好 (10-50ms): ${perf.good} (${(perf.good / total * 100).toFixed(1)}%)\n`;
    output += `  一般 (50-100ms): ${perf.fair} (${(perf.fair / total * 100).toFixed(1)}%)\n`;
    output += `  较慢 (>100ms): ${perf.slow} (${(perf.slow / total * 100).toFixed(1)}%)\n`;
    output += '\n';

    // 最近使用
    output += '【最近使用】\n';
    data.recentTools.slice(0, 5).forEach(tool => {
      output += `  ${tool.display_name || tool.name} - ${tool.timeSinceLastUse}\n`;
    });
    output += '\n';

    output += `生成时间: ${data.generatedAt}\n`;

    return output;
  }

  /**
   * 格式化时间差
   */
  _formatTimeSince(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}天前`;
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    return `${seconds}秒前`;
  }
}

/**
 * CLI工具
 */
async function showDashboard() {
  try {
    console.log('正在加载统计数据...\n');

    // 初始化数据库
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../../data/chainlesschain.db');
    const db = new DatabaseManager(dbPath, { encryptionEnabled: false });
    await db.initialize();

    // 创建仪表板
    const dashboard = new ToolStatsDashboard(db);

    // 生成并显示文本仪表板
    const textDashboard = await dashboard.generateTextDashboard();
    console.log(textDashboard);

    // 可选：保存JSON格式
    const jsonData = await dashboard.getDashboardData();
    console.log('\n完整JSON数据已准备就绪，可通过API访问。');

    // 关闭数据库
    await db.db.close();

  } catch (error) {
    console.error('显示仪表板失败:', error);
    process.exit(1);
  }
}

// 如果直接运行
if (require.main === module) {
  showDashboard();
}

module.exports = ToolStatsDashboard;
