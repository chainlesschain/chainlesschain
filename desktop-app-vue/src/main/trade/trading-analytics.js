/**
 * 交易分析模块
 *
 * 提供交易数据分析和可视化功能，包括：
 * - 交易统计和趋势分析
 * - 资产表现分析
 * - 风险评估
 * - 收益分析
 * - 市场洞察
 */

const EventEmitter = require('events');

/**
 * 时间范围
 */
const TimeRange = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  QUARTER: 'quarter',
  YEAR: 'year',
  ALL: 'all'
};

/**
 * 分析类型
 */
const AnalysisType = {
  TRADING_VOLUME: 'trading_volume',       // 交易量分析
  PROFIT_LOSS: 'profit_loss',             // 盈亏分析
  ASSET_PERFORMANCE: 'asset_performance', // 资产表现
  RISK_ASSESSMENT: 'risk_assessment',     // 风险评估
  MARKET_TREND: 'market_trend'            // 市场趋势
};

/**
 * 交易分析引擎类
 */
class TradingAnalytics extends EventEmitter {
  constructor(database, assetManager, marketplaceManager) {
    super();

    this.database = database;
    this.assetManager = assetManager;
    this.marketplaceManager = marketplaceManager;

    this.initialized = false;
    this.cache = new Map(); // 分析结果缓存
    this.cacheExpiry = 5 * 60 * 1000; // 缓存5分钟
  }

  /**
   * 初始化分析引擎
   */
  async initialize() {
    console.log('[TradingAnalytics] 初始化交易分析引擎...');

    try {
      // 初始化数据库表
      await this.initializeTables();

      this.initialized = true;
      console.log('[TradingAnalytics] 交易分析引擎初始化成功');
    } catch (error) {
      console.error('[TradingAnalytics] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化数据库表
   */
  async initializeTables() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS trading_analytics (
        id TEXT PRIMARY KEY,
        analysis_type TEXT NOT NULL,
        time_range TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;

    await this.database.run(createTableSQL);
  }

  /**
   * 获取交易概览
   * @param {string} timeRange - 时间范围
   * @returns {Promise<Object>} 交易概览数据
   */
  async getTradingOverview(timeRange = TimeRange.MONTH) {
    const cacheKey = `overview_${timeRange}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { startTime, endTime } = this.getTimeRange(timeRange);

      // 获取交易统计
      const stats = await this.getTransactionStats(startTime, endTime);

      // 获取资产统计
      const assetStats = await this.getAssetStats(startTime, endTime);

      // 获取订单统计
      const orderStats = await this.getOrderStats(startTime, endTime);

      const overview = {
        timeRange,
        period: { startTime, endTime },
        transactions: stats,
        assets: assetStats,
        orders: orderStats,
        timestamp: Date.now()
      };

      this.setCache(cacheKey, overview);
      return overview;
    } catch (error) {
      console.error('[TradingAnalytics] 获取交易概览失败:', error);
      throw error;
    }
  }

  /**
   * 获取交易统计
   */
  async getTransactionStats(startTime, endTime) {
    const sql = `
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
        SUM(amount) as total_volume,
        AVG(amount) as avg_amount
      FROM transactions
      WHERE created_at >= ? AND created_at <= ?
    `;

    const result = await this.database.get(sql, [startTime, endTime]);
    return result || {
      total_count: 0,
      completed_count: 0,
      cancelled_count: 0,
      total_volume: 0,
      avg_amount: 0
    };
  }

  /**
   * 获取资产统计
   */
  async getAssetStats(startTime, endTime) {
    const sql = `
      SELECT
        asset_type,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count
      FROM assets
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY asset_type
    `;

    const results = await this.database.all(sql, [startTime, endTime]);
    return results || [];
  }

  /**
   * 获取订单统计
   */
  async getOrderStats(startTime, endTime) {
    const sql = `
      SELECT
        order_type,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(price * quantity) as total_value
      FROM marketplace_orders
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY order_type
    `;

    const results = await this.database.all(sql, [startTime, endTime]);
    return results || [];
  }

  /**
   * 获取盈亏分析
   * @param {string} timeRange - 时间范围
   * @returns {Promise<Object>} 盈亏数据
   */
  async getProfitLossAnalysis(timeRange = TimeRange.MONTH) {
    const cacheKey = `profit_loss_${timeRange}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { startTime, endTime } = this.getTimeRange(timeRange);

      // 获取收入
      const income = await this.getIncome(startTime, endTime);

      // 获取支出
      const expenses = await this.getExpenses(startTime, endTime);

      // 计算净利润
      const netProfit = income.total - expenses.total;
      const profitMargin = income.total > 0 ? (netProfit / income.total) * 100 : 0;

      const analysis = {
        timeRange,
        period: { startTime, endTime },
        income,
        expenses,
        netProfit,
        profitMargin,
        timestamp: Date.now()
      };

      this.setCache(cacheKey, analysis);
      return analysis;
    } catch (error) {
      console.error('[TradingAnalytics] 获取盈亏分析失败:', error);
      throw error;
    }
  }

  /**
   * 获取收入
   */
  async getIncome(startTime, endTime) {
    const sql = `
      SELECT
        SUM(amount) as total,
        COUNT(*) as count,
        AVG(amount) as average
      FROM transactions
      WHERE type = 'income'
        AND status = 'completed'
        AND created_at >= ?
        AND created_at <= ?
    `;

    const result = await this.database.get(sql, [startTime, endTime]);
    return result || { total: 0, count: 0, average: 0 };
  }

  /**
   * 获取支出
   */
  async getExpenses(startTime, endTime) {
    const sql = `
      SELECT
        SUM(amount) as total,
        COUNT(*) as count,
        AVG(amount) as average
      FROM transactions
      WHERE type = 'expense'
        AND status = 'completed'
        AND created_at >= ?
        AND created_at <= ?
    `;

    const result = await this.database.get(sql, [startTime, endTime]);
    return result || { total: 0, count: 0, average: 0 };
  }

  /**
   * 获取资产表现分析
   * @param {string} assetId - 资产ID（可选）
   * @param {string} timeRange - 时间范围
   * @returns {Promise<Object>} 资产表现数据
   */
  async getAssetPerformance(assetId = null, timeRange = TimeRange.MONTH) {
    const cacheKey = `asset_performance_${assetId || 'all'}_${timeRange}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { startTime, endTime } = this.getTimeRange(timeRange);

      let sql, params;

      if (assetId) {
        // 单个资产分析
        sql = `
          SELECT
            a.id,
            a.name,
            a.asset_type,
            COUNT(t.id) as transaction_count,
            SUM(t.amount) as total_volume,
            AVG(t.amount) as avg_price,
            MAX(t.amount) as max_price,
            MIN(t.amount) as min_price
          FROM assets a
          LEFT JOIN transactions t ON t.asset_id = a.id
            AND t.created_at >= ? AND t.created_at <= ?
          WHERE a.id = ?
          GROUP BY a.id
        `;
        params = [startTime, endTime, assetId];
      } else {
        // 所有资产分析
        sql = `
          SELECT
            a.id,
            a.name,
            a.asset_type,
            COUNT(t.id) as transaction_count,
            SUM(t.amount) as total_volume,
            AVG(t.amount) as avg_price
          FROM assets a
          LEFT JOIN transactions t ON t.asset_id = a.id
            AND t.created_at >= ? AND t.created_at <= ?
          GROUP BY a.id
          ORDER BY total_volume DESC
          LIMIT 20
        `;
        params = [startTime, endTime];
      }

      const results = await this.database.all(sql, params);

      const performance = {
        timeRange,
        period: { startTime, endTime },
        assets: results || [],
        timestamp: Date.now()
      };

      this.setCache(cacheKey, performance);
      return performance;
    } catch (error) {
      console.error('[TradingAnalytics] 获取资产表现失败:', error);
      throw error;
    }
  }

  /**
   * 获取风险评估
   * @returns {Promise<Object>} 风险评估数据
   */
  async getRiskAssessment() {
    const cacheKey = 'risk_assessment';
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      // 获取资产集中度风险
      const concentrationRisk = await this.getConcentrationRisk();

      // 获取流动性风险
      const liquidityRisk = await this.getLiquidityRisk();

      // 获取交易对手风险
      const counterpartyRisk = await this.getCounterpartyRisk();

      // 计算综合风险评分 (0-100)
      const overallRisk = this.calculateOverallRisk({
        concentrationRisk,
        liquidityRisk,
        counterpartyRisk
      });

      const assessment = {
        overallRisk,
        concentrationRisk,
        liquidityRisk,
        counterpartyRisk,
        riskLevel: this.getRiskLevel(overallRisk),
        recommendations: this.generateRiskRecommendations(overallRisk),
        timestamp: Date.now()
      };

      this.setCache(cacheKey, assessment);
      return assessment;
    } catch (error) {
      console.error('[TradingAnalytics] 获取风险评估失败:', error);
      throw error;
    }
  }

  /**
   * 获取资产集中度风险
   */
  async getConcentrationRisk() {
    const sql = `
      SELECT
        asset_type,
        COUNT(*) as count,
        SUM(value) as total_value
      FROM assets
      WHERE status = 'active'
      GROUP BY asset_type
    `;

    const results = await this.database.all(sql);

    if (!results || results.length === 0) {
      return { score: 0, distribution: [] };
    }

    const totalValue = results.reduce((sum, r) => sum + (r.total_value || 0), 0);
    const distribution = results.map(r => ({
      type: r.asset_type,
      count: r.count,
      value: r.total_value || 0,
      percentage: totalValue > 0 ? (r.total_value / totalValue) * 100 : 0
    }));

    // 计算集中度风险评分（基于赫芬达尔指数）
    const herfindahlIndex = distribution.reduce((sum, d) => {
      const share = d.percentage / 100;
      return sum + (share * share);
    }, 0);

    const score = herfindahlIndex * 100; // 0-100

    return { score, distribution };
  }

  /**
   * 获取流动性风险
   */
  async getLiquidityRisk() {
    const sql = `
      SELECT
        COUNT(*) as total_assets,
        SUM(CASE WHEN last_traded_at > ? THEN 1 ELSE 0 END) as liquid_assets
      FROM assets
      WHERE status = 'active'
    `;

    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const result = await this.database.get(sql, [thirtyDaysAgo]);

    if (!result || result.total_assets === 0) {
      return { score: 0, liquidityRatio: 0 };
    }

    const liquidityRatio = (result.liquid_assets / result.total_assets) * 100;
    const score = 100 - liquidityRatio; // 流动性越低，风险越高

    return { score, liquidityRatio };
  }

  /**
   * 获取交易对手风险
   */
  async getCounterpartyRisk() {
    const sql = `
      SELECT
        counterparty_did,
        COUNT(*) as transaction_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN status = 'disputed' THEN 1 ELSE 0 END) as disputed_count
      FROM transactions
      WHERE created_at > ?
      GROUP BY counterparty_did
    `;

    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
    const results = await this.database.all(sql, [ninetyDaysAgo]);

    if (!results || results.length === 0) {
      return { score: 0, counterparties: [] };
    }

    const counterparties = results.map(r => {
      const completionRate = r.transaction_count > 0
        ? (r.completed_count / r.transaction_count) * 100
        : 0;
      const disputeRate = r.transaction_count > 0
        ? (r.disputed_count / r.transaction_count) * 100
        : 0;

      return {
        did: r.counterparty_did,
        transactionCount: r.transaction_count,
        completionRate,
        disputeRate,
        riskScore: disputeRate * 2 + (100 - completionRate) // 简化风险评分
      };
    });

    const avgRiskScore = counterparties.reduce((sum, c) => sum + c.riskScore, 0) / counterparties.length;

    return { score: avgRiskScore, counterparties };
  }

  /**
   * 计算综合风险评分
   */
  calculateOverallRisk(risks) {
    const weights = {
      concentrationRisk: 0.3,
      liquidityRisk: 0.3,
      counterpartyRisk: 0.4
    };

    return (
      risks.concentrationRisk.score * weights.concentrationRisk +
      risks.liquidityRisk.score * weights.liquidityRisk +
      risks.counterpartyRisk.score * weights.counterpartyRisk
    );
  }

  /**
   * 获取风险等级
   */
  getRiskLevel(score) {
    if (score < 20) return 'low';
    if (score < 40) return 'moderate';
    if (score < 60) return 'medium';
    if (score < 80) return 'high';
    return 'critical';
  }

  /**
   * 生成风险建议
   */
  generateRiskRecommendations(score) {
    const recommendations = [];

    if (score >= 60) {
      recommendations.push('建议分散资产配置，降低集中度风险');
      recommendations.push('增加流动性较好的资产比例');
      recommendations.push('审慎选择交易对手，优先选择信用评分高的用户');
    } else if (score >= 40) {
      recommendations.push('适当调整资产配置，保持多样化');
      recommendations.push('关注资产流动性变化');
    } else {
      recommendations.push('当前风险水平较低，继续保持');
    }

    return recommendations;
  }

  /**
   * 获取市场趋势
   * @param {string} timeRange - 时间范围
   * @returns {Promise<Object>} 市场趋势数据
   */
  async getMarketTrend(timeRange = TimeRange.MONTH) {
    const cacheKey = `market_trend_${timeRange}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    try {
      const { startTime, endTime } = this.getTimeRange(timeRange);

      // 获取交易量趋势
      const volumeTrend = await this.getVolumeTrend(startTime, endTime);

      // 获取价格趋势
      const priceTrend = await this.getPriceTrend(startTime, endTime);

      // 获取活跃度趋势
      const activityTrend = await this.getActivityTrend(startTime, endTime);

      const trend = {
        timeRange,
        period: { startTime, endTime },
        volumeTrend,
        priceTrend,
        activityTrend,
        timestamp: Date.now()
      };

      this.setCache(cacheKey, trend);
      return trend;
    } catch (error) {
      console.error('[TradingAnalytics] 获取市场趋势失败:', error);
      throw error;
    }
  }

  /**
   * 获取交易量趋势
   */
  async getVolumeTrend(startTime, endTime) {
    const interval = this.getInterval(startTime, endTime);

    const sql = `
      SELECT
        (created_at / ${interval}) * ${interval} as period,
        COUNT(*) as count,
        SUM(amount) as volume
      FROM transactions
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY period
      ORDER BY period ASC
    `;

    const results = await this.database.all(sql, [startTime, endTime]);
    return results || [];
  }

  /**
   * 获取价格趋势
   */
  async getPriceTrend(startTime, endTime) {
    const interval = this.getInterval(startTime, endTime);

    const sql = `
      SELECT
        (created_at / ${interval}) * ${interval} as period,
        AVG(price) as avg_price,
        MAX(price) as max_price,
        MIN(price) as min_price
      FROM marketplace_orders
      WHERE created_at >= ? AND created_at <= ? AND status = 'completed'
      GROUP BY period
      ORDER BY period ASC
    `;

    const results = await this.database.all(sql, [startTime, endTime]);
    return results || [];
  }

  /**
   * 获取活跃度趋势
   */
  async getActivityTrend(startTime, endTime) {
    const interval = this.getInterval(startTime, endTime);

    const sql = `
      SELECT
        (created_at / ${interval}) * ${interval} as period,
        COUNT(DISTINCT user_did) as active_users,
        COUNT(*) as total_actions
      FROM transactions
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY period
      ORDER BY period ASC
    `;

    const results = await this.database.all(sql, [startTime, endTime]);
    return results || [];
  }

  /**
   * 获取时间范围
   */
  getTimeRange(range) {
    const now = Date.now();
    let startTime;

    switch (range) {
      case TimeRange.DAY:
        startTime = now - (24 * 60 * 60 * 1000);
        break;
      case TimeRange.WEEK:
        startTime = now - (7 * 24 * 60 * 60 * 1000);
        break;
      case TimeRange.MONTH:
        startTime = now - (30 * 24 * 60 * 60 * 1000);
        break;
      case TimeRange.QUARTER:
        startTime = now - (90 * 24 * 60 * 60 * 1000);
        break;
      case TimeRange.YEAR:
        startTime = now - (365 * 24 * 60 * 60 * 1000);
        break;
      case TimeRange.ALL:
        startTime = 0;
        break;
      default:
        startTime = now - (30 * 24 * 60 * 60 * 1000);
    }

    return { startTime, endTime: now };
  }

  /**
   * 获取时间间隔（用于分组）
   */
  getInterval(startTime, endTime) {
    const duration = endTime - startTime;
    const day = 24 * 60 * 60 * 1000;

    if (duration <= day) {
      return 60 * 60 * 1000; // 1小时
    } else if (duration <= 7 * day) {
      return 6 * 60 * 60 * 1000; // 6小时
    } else if (duration <= 30 * day) {
      return day; // 1天
    } else {
      return 7 * day; // 1周
    }
  }

  /**
   * 获取缓存
   */
  getCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }
    return null;
  }

  /**
   * 设置缓存
   */
  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * 销毁分析引擎
   */
  async destroy() {
    this.clearCache();
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  TradingAnalytics,
  TimeRange,
  AnalysisType
};
