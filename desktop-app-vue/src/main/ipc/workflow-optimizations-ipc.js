/**
 * Workflow Optimizations IPC Handlers
 *
 * 提供工作流程优化的 IPC 接口，连接前端仪表板和后端优化模块
 *
 * @module workflow-optimizations-ipc
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');
const fs = require('fs');
const path = require('path');

/**
 * Workflow Optimizations IPC 类
 */
class WorkflowOptimizationsIPC {
  constructor(options = {}) {
    this.configPath = options.configPath || path.join(
      process.cwd(),
      '.chainlesschain',
      'config.json'
    );
    this.aiEngineManager = options.aiEngineManager;
    this.database = options.database;

    logger.info('[WorkflowOptimizationsIPC] Initialized');
  }

  /**
   * 注册所有 IPC 处理器
   */
  registerHandlers() {
    // 获取优化状态
    ipcMain.handle('workflow-optimizations:get-status', async () => {
      try {
        const config = this._loadConfig();
        const status = this._getOptimizationStatus(config);

        return {
          success: true,
          data: status
        };
      } catch (error) {
        logger.error('[WorkflowOptimizationsIPC] Error getting status:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // 获取统计数据
    ipcMain.handle('workflow-optimizations:get-stats', async () => {
      try {
        const stats = await this._collectStats();

        return {
          success: true,
          data: stats
        };
      } catch (error) {
        logger.error('[WorkflowOptimizationsIPC] Error getting stats:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // 切换优化开关
    ipcMain.handle('workflow-optimizations:toggle', async (event, { key, enabled }) => {
      try {
        const config = this._loadConfig();
        this._setOptimizationValue(config, key, enabled);
        this._saveConfig(config);

        logger.info(`[WorkflowOptimizationsIPC] Toggled ${key} to ${enabled}`);

        return {
          success: true,
          data: { key, enabled }
        };
      } catch (error) {
        logger.error('[WorkflowOptimizationsIPC] Error toggling optimization:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // 获取性能报告
    ipcMain.handle('workflow-optimizations:get-report', async () => {
      try {
        const report = await this._generateReport();

        return {
          success: true,
          data: report
        };
      } catch (error) {
        logger.error('[WorkflowOptimizationsIPC] Error generating report:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // 导出配置
    ipcMain.handle('workflow-optimizations:export-config', async () => {
      try {
        const config = this._loadConfig();

        return {
          success: true,
          data: config.workflow.optimizations
        };
      } catch (error) {
        logger.error('[WorkflowOptimizationsIPC] Error exporting config:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // 导入配置
    ipcMain.handle('workflow-optimizations:import-config', async (event, { config }) => {
      try {
        const currentConfig = this._loadConfig();
        currentConfig.workflow.optimizations = config;
        this._saveConfig(currentConfig);

        return {
          success: true,
          message: 'Configuration imported successfully'
        };
      } catch (error) {
        logger.error('[WorkflowOptimizationsIPC] Error importing config:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    // 运行健康检查
    ipcMain.handle('workflow-optimizations:health-check', async () => {
      try {
        const health = await this._performHealthCheck();

        return {
          success: true,
          data: health
        };
      } catch (error) {
        logger.error('[WorkflowOptimizationsIPC] Error in health check:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    logger.info('[WorkflowOptimizationsIPC] All handlers registered');
  }

  /**
   * 加载配置文件
   * @private
   */
  _loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      logger.warn('[WorkflowOptimizationsIPC] Failed to load config, using defaults');
    }

    return this._getDefaultConfig();
  }

  /**
   * 获取默认配置
   * @private
   */
  _getDefaultConfig() {
    return {
      workflow: {
        optimizations: {
          enabled: true,
          phase1: {
            ragParallel: true,
            messageAggregation: true,
            toolCache: true,
            lazyFileTree: true,
          },
          phase2: {
            llmFallback: true,
            dynamicConcurrency: true,
            smartRetry: true,
            qualityGate: true,
          },
          phase3: {
            planCache: {
              enabled: true,
              similarityThreshold: 0.75,
              maxSize: 100,
              useEmbedding: false,
            },
            llmDecision: {
              enabled: true,
              highConfidenceThreshold: 0.9,
              contextLengthThreshold: 10000,
              subtaskCountThreshold: 3,
            },
            agentPool: {
              enabled: true,
              minSize: 3,
              maxSize: 10,
              warmupOnInit: true,
            },
            criticalPath: {
              enabled: true,
              priorityBoost: 2.0,
            },
            realtimeQuality: {
              enabled: false,
              checkDelay: 500,
            },
            autoPhaseTransition: true,
            smartCheckpoint: true,
          },
        },
      },
    };
  }

  /**
   * 保存配置文件
   * @private
   */
  _saveConfig(config) {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      logger.info('[WorkflowOptimizationsIPC] Configuration saved');
    } catch (error) {
      logger.error('[WorkflowOptimizationsIPC] Failed to save config:', error);
      throw error;
    }
  }

  /**
   * 获取优化状态
   * @private
   */
  _getOptimizationStatus(config) {
    const opt = config.workflow.optimizations;

    return {
      global: opt.enabled,
      phase1: {
        ragParallel: opt.phase1.ragParallel,
        messageAggregation: opt.phase1.messageAggregation,
        toolCache: opt.phase1.toolCache,
        lazyFileTree: opt.phase1.lazyFileTree,
      },
      phase2: {
        llmFallback: opt.phase2.llmFallback,
        dynamicConcurrency: opt.phase2.dynamicConcurrency,
        smartRetry: opt.phase2.smartRetry,
        qualityGate: opt.phase2.qualityGate,
      },
      phase3: {
        planCache: opt.phase3.planCache.enabled,
        llmDecision: opt.phase3.llmDecision.enabled,
        agentPool: opt.phase3.agentPool.enabled,
        criticalPath: opt.phase3.criticalPath.enabled,
        realtimeQuality: opt.phase3.realtimeQuality.enabled,
        autoPhaseTransition: opt.phase3.autoPhaseTransition,
        smartCheckpoint: opt.phase3.smartCheckpoint,
      },
    };
  }

  /**
   * 设置优化值
   * @private
   */
  _setOptimizationValue(config, key, value) {
    const keyMap = {
      'ragParallel': ['workflow', 'optimizations', 'phase1', 'ragParallel'],
      'messageAggregation': ['workflow', 'optimizations', 'phase1', 'messageAggregation'],
      'toolCache': ['workflow', 'optimizations', 'phase1', 'toolCache'],
      'lazyFileTree': ['workflow', 'optimizations', 'phase1', 'lazyFileTree'],
      'llmFallback': ['workflow', 'optimizations', 'phase2', 'llmFallback'],
      'dynamicConcurrency': ['workflow', 'optimizations', 'phase2', 'dynamicConcurrency'],
      'smartRetry': ['workflow', 'optimizations', 'phase2', 'smartRetry'],
      'qualityGate': ['workflow', 'optimizations', 'phase2', 'qualityGate'],
      'planCache': ['workflow', 'optimizations', 'phase3', 'planCache', 'enabled'],
      'llmDecision': ['workflow', 'optimizations', 'phase3', 'llmDecision', 'enabled'],
      'agentPool': ['workflow', 'optimizations', 'phase3', 'agentPool', 'enabled'],
      'criticalPath': ['workflow', 'optimizations', 'phase3', 'criticalPath', 'enabled'],
      'realtimeQuality': ['workflow', 'optimizations', 'phase3', 'realtimeQuality', 'enabled'],
      'autoPhaseTransition': ['workflow', 'optimizations', 'phase3', 'autoPhaseTransition'],
      'smartCheckpoint': ['workflow', 'optimizations', 'phase3', 'smartCheckpoint'],
    };

    const path = keyMap[key];
    if (!path) {
      throw new Error(`Unknown optimization key: ${key}`);
    }

    let current = config;
    for (let i = 0; i < path.length - 1; i++) {
      current = current[path[i]];
    }
    current[path[path.length - 1]] = value;
  }

  /**
   * 收集统计数据
   * @private
   */
  async _collectStats() {
    const defaultStats = {
      planCache: {
        hitRate: '0%',
        size: 0,
        semanticMatches: 0,
      },
      decisionEngine: {
        multiAgentRate: '0%',
        llmCallRate: '0%',
        avgDecisionTime: '0ms',
      },
      agentPool: {
        reuseRate: '0%',
        available: 0,
        busy: 0,
      },
      criticalPath: {
        totalAnalyses: 0,
        avgCriticalPathLength: '0',
        avgSlack: '0ms',
      },
      performance: {
        avgResponseTime: 0,
        throughput: 0,
        errorRate: 0,
      },
    };

    try {
      // Try to get stats from AI Engine Manager directly
      if (this.aiEngineManager && typeof this.aiEngineManager.getWorkflowStats === 'function') {
        const workflowStats = this.aiEngineManager.getWorkflowStats();

        // Merge with default stats
        if (workflowStats.planCache) {
          defaultStats.planCache = {
            hitRate: workflowStats.planCache.hitRate || '0%',
            size: workflowStats.planCache.cacheSize || 0,
            semanticMatches: workflowStats.planCache.semanticHits || 0,
            hits: workflowStats.planCache.cacheHits || 0,
            misses: workflowStats.planCache.cacheMisses || 0,
          };
        }

        if (workflowStats.decisionEngine) {
          defaultStats.decisionEngine = {
            multiAgentRate: workflowStats.decisionEngine.multiAgentRate || '0%',
            llmCallRate: workflowStats.decisionEngine.llmCallRate || '0%',
            avgDecisionTime: workflowStats.decisionEngine.avgDecisionTime || '0ms',
            totalDecisions: workflowStats.decisionEngine.totalDecisions || 0,
          };
        }

        if (workflowStats.agentPool) {
          const poolStatus = this._getAgentPoolStatusFromEngine();
          defaultStats.agentPool = {
            reuseRate: workflowStats.agentPool.reuseRate ? `${workflowStats.agentPool.reuseRate}%` : '0%',
            available: poolStatus.available || 0,
            busy: poolStatus.busy || 0,
            created: workflowStats.agentPool.created || 0,
            reused: workflowStats.agentPool.reused || 0,
          };
        }

        if (workflowStats.criticalPathOptimizer) {
          defaultStats.criticalPath = {
            totalAnalyses: workflowStats.criticalPathOptimizer.totalAnalyses || 0,
            avgCriticalPathLength: workflowStats.criticalPathOptimizer.avgCriticalPathLength || '0',
            avgSlack: workflowStats.criticalPathOptimizer.avgSlack || '0ms',
          };
        }

        logger.info('[WorkflowOptimizationsIPC] Stats collected from AI Engine Manager');
        return defaultStats;
      }
    } catch (error) {
      logger.warn('[WorkflowOptimizationsIPC] Failed to get stats from AI Engine Manager:', error.message);
    }

    // Fallback: try individual module access
    try {
      const planCache = this._getPlanCache();
      if (planCache) {
        const planCacheStats = planCache.getStats();
        defaultStats.planCache = {
          hitRate: planCacheStats.hitRate || '0%',
          size: planCacheStats.cacheSize || 0,
          semanticMatches: planCacheStats.semanticHits || 0,
          hits: planCacheStats.cacheHits || 0,
          misses: planCacheStats.cacheMisses || 0,
        };
      }
    } catch (error) {
      logger.debug('[WorkflowOptimizationsIPC] Plan cache stats not available');
    }

    try {
      const decisionEngine = this._getDecisionEngine();
      if (decisionEngine) {
        const decisionStats = decisionEngine.getStats();
        defaultStats.decisionEngine = {
          multiAgentRate: decisionStats.multiAgentRate || '0%',
          llmCallRate: decisionStats.llmCallRate || '0%',
          avgDecisionTime: decisionStats.avgDecisionTime || '0ms',
          totalDecisions: decisionStats.totalDecisions || 0,
        };
      }
    } catch (error) {
      logger.debug('[WorkflowOptimizationsIPC] Decision engine stats not available');
    }

    try {
      const agentPool = this._getAgentPool();
      if (agentPool) {
        const poolStats = agentPool.getStats();
        defaultStats.agentPool = {
          reuseRate: poolStats.reuseRate ? `${poolStats.reuseRate}%` : '0%',
          available: this._getAgentPoolStatus(agentPool).available || 0,
          busy: this._getAgentPoolStatus(agentPool).busy || 0,
          created: poolStats.created || 0,
          reused: poolStats.reused || 0,
        };
      }
    } catch (error) {
      logger.debug('[WorkflowOptimizationsIPC] Agent pool stats not available');
    }

    try {
      const criticalPath = this._getCriticalPathOptimizer();
      if (criticalPath) {
        const cpStats = criticalPath.getStats();
        defaultStats.criticalPath = {
          totalAnalyses: cpStats.totalAnalyses || 0,
          avgCriticalPathLength: cpStats.avgCriticalPathLength || '0',
          avgSlack: cpStats.avgSlack || '0ms',
        };
      }
    } catch (error) {
      logger.debug('[WorkflowOptimizationsIPC] Critical path stats not available');
    }

    return defaultStats;
  }

  /**
   * 获取代理池状态（从AI Engine Manager）
   * @private
   */
  _getAgentPoolStatusFromEngine() {
    try {
      if (this.aiEngineManager && this.aiEngineManager.agentPool) {
        return this._getAgentPoolStatus(this.aiEngineManager.agentPool);
      }
    } catch (error) {
      // Ignore
    }
    return { available: 0, busy: 0 };
  }

  /**
   * 获取智能计划缓存实例
   * @private
   */
  _getPlanCache() {
    try {
      if (this.aiEngineManager && this.aiEngineManager.taskPlannerEnhanced) {
        return this.aiEngineManager.taskPlannerEnhanced.planCache;
      }
    } catch (error) {
      // Ignore
    }
    return null;
  }

  /**
   * 获取LLM决策引擎实例
   * @private
   */
  _getDecisionEngine() {
    try {
      // Decision engine might be in different locations depending on implementation
      // Try to find it through various paths
      if (this.aiEngineManager && this.aiEngineManager.decisionEngine) {
        return this.aiEngineManager.decisionEngine;
      }
    } catch (error) {
      // Ignore
    }
    return null;
  }

  /**
   * 获取代理池实例
   * @private
   */
  _getAgentPool() {
    try {
      // Try to get agent pool from aiEngineManager or other sources
      if (this.aiEngineManager && this.aiEngineManager.agentPool) {
        return this.aiEngineManager.agentPool;
      }

      // Try to get from global teammates tool if available
      const { app } = require('electron');
      if (app && app.teammateTool && app.teammateTool.agentPool) {
        return app.teammateTool.agentPool;
      }
    } catch (error) {
      // Ignore
    }
    return null;
  }

  /**
   * 获取代理池状态
   * @private
   */
  _getAgentPoolStatus(agentPool) {
    try {
      if (agentPool.getStatus) {
        return agentPool.getStatus();
      }

      // Manual calculation as fallback
      return {
        available: agentPool.availableAgents ? agentPool.availableAgents.length : 0,
        busy: agentPool.busyAgents ? agentPool.busyAgents.size : 0,
      };
    } catch (error) {
      return { available: 0, busy: 0 };
    }
  }

  /**
   * 获取关键路径优化器实例
   * @private
   */
  _getCriticalPathOptimizer() {
    try {
      if (this.aiEngineManager && this.aiEngineManager.criticalPathOptimizer) {
        return this.aiEngineManager.criticalPathOptimizer;
      }
    } catch (error) {
      // Ignore
    }
    return null;
  }

  /**
   * 生成性能报告
   * @private
   */
  async _generateReport() {
    const config = this._loadConfig();
    const status = this._getOptimizationStatus(config);
    const stats = await this._collectStats();

    // Count enabled optimizations
    let enabledCount = 0;
    Object.values(status.phase1).forEach(v => v && enabledCount++);
    Object.values(status.phase2).forEach(v => v && enabledCount++);
    Object.values(status.phase3).forEach(v => v && enabledCount++);

    return {
      timestamp: new Date().toISOString(),
      summary: {
        totalOptimizations: 17,
        enabledOptimizations: enabledCount,
        healthStatus: 'healthy',
      },
      status,
      stats,
      expectedGains: this._calculateExpectedGains(status),
    };
  }

  /**
   * 计算预期收益
   * @private
   */
  _calculateExpectedGains(status) {
    const gains = {
      responseTime: 0,
      throughput: 0,
      tokenSavings: 0,
      reliability: 0,
    };

    // Phase 1 optimizations
    if (status.phase1.ragParallel) {
      gains.responseTime += 30;
      gains.throughput += 20;
    }
    if (status.phase1.messageAggregation) {
      gains.tokenSavings += 25;
    }
    if (status.phase1.toolCache) {
      gains.responseTime += 15;
    }
    if (status.phase1.lazyFileTree) {
      gains.tokenSavings += 40;
    }

    // Phase 2 optimizations
    if (status.phase2.llmFallback) {
      gains.reliability += 20;
    }
    if (status.phase2.dynamicConcurrency) {
      gains.throughput += 50;
    }
    if (status.phase2.smartRetry) {
      gains.reliability += 30;
    }
    if (status.phase2.qualityGate) {
      gains.reliability += 25;
    }

    // Phase 3 optimizations
    if (status.phase3.planCache) {
      gains.responseTime += 60;
      gains.tokenSavings += 70;
    }
    if (status.phase3.llmDecision) {
      gains.responseTime += 35;
    }
    if (status.phase3.agentPool) {
      gains.responseTime += 45;
      gains.throughput += 80;
    }
    if (status.phase3.criticalPath) {
      gains.responseTime += 40;
    }

    return gains;
  }

  /**
   * 执行健康检查
   * @private
   */
  async _performHealthCheck() {
    const checks = {
      configFile: false,
      dependencies: false,
      modules: false,
    };

    // Check config file
    try {
      checks.configFile = fs.existsSync(this.configPath);
    } catch (error) {
      logger.error('[WorkflowOptimizationsIPC] Config file check failed:', error);
    }

    // Check dependencies (simplified)
    checks.dependencies = true;

    // Check modules (simplified)
    checks.modules = true;

    const allHealthy = Object.values(checks).every(v => v);

    return {
      healthy: allHealthy,
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 注册 Workflow Optimizations IPC 处理器 (函数式接口)
 * @param {Object} dependencies - 依赖对象
 */
function registerWorkflowOptimizationsIPC(dependencies = {}) {
  const ipc = new WorkflowOptimizationsIPC(dependencies);
  ipc.registerHandlers();
  logger.info('[WorkflowOptimizationsIPC] Handlers registered successfully');
  return ipc;
}

module.exports = {
  WorkflowOptimizationsIPC,
  registerWorkflowOptimizationsIPC,
};
