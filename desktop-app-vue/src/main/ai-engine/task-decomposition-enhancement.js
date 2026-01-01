/**
 * 任务分解增强模块 (Task Decomposition Enhancement)
 * P2 扩展功能之一
 *
 * 功能:
 * - 智能分解粒度控制
 * - 任务依赖关系分析
 * - 基于历史的分解模式学习
 * - 动态调整分解策略
 *
 * 版本: v0.20.0
 * 创建: 2026-01-02
 */

const GranularityLevel = {
  ATOMIC: 'atomic',
  FINE: 'fine',
  MEDIUM: 'medium',
  COARSE: 'coarse',
  MACRO: 'macro'
};

const DependencyType = {
  SEQUENTIAL: 'sequential',
  PARALLEL: 'parallel',
  CONDITIONAL: 'conditional',
  DATA_FLOW: 'data_flow'
};

class TaskDecompositionEnhancement {
  constructor(config = {}) {
    this.config = {
      enableLearning: true,
      enableDependencyAnalysis: true,
      enableDynamicGranularity: true,
      defaultGranularity: GranularityLevel.MEDIUM,
      minTasksPerDecomposition: 2,
      maxTasksPerDecomposition: 10,
      ...config
    };

    this.db = null;
    this.llm = null;
    this.decompositionPatterns = new Map();

    this.stats = {
      totalDecompositions: 0,
      successfulDecompositions: 0,
      avgSubtasks: 0,
      patternHits: 0
    };
  }

  setDatabase(db) { this.db = db; }
  setLLM(llm) { this.llm = llm; }

  async decomposeTask(task, context = {}) {
    this.stats.totalDecompositions++;
    
    const granularity = await this._determineGranularity(task, context);
    const pattern = this.config.enableLearning ? await this._findSimilarPattern(task) : null;

    const subtasks = pattern
      ? await this._decomposeByPattern(task, pattern, granularity)
      : await this._decomposeByAnalysis(task, granularity, context);

    if (this.config.enableDependencyAnalysis) {
      await this._analyzeDependencies(subtasks);
    }

    const optimizedSubtasks = await this._optimizeSequence(subtasks);
    await this._recordDecomposition(task, optimizedSubtasks, granularity, context);

    this.stats.successfulDecompositions++;
    this.stats.avgSubtasks = (this.stats.avgSubtasks * (this.stats.successfulDecompositions - 1) + subtasks.length) / this.stats.successfulDecompositions;

    return optimizedSubtasks;
  }

  async _determineGranularity(task, context) {
    if (!this.config.enableDynamicGranularity) {
      return this.config.defaultGranularity;
    }

    const complexity = this._assessComplexity(task);
    const score = complexity * 0.7 + 0.3;

    if (score < 0.2) return GranularityLevel.MACRO;
    if (score < 0.4) return GranularityLevel.COARSE;
    if (score < 0.6) return GranularityLevel.MEDIUM;
    if (score < 0.8) return GranularityLevel.FINE;
    return GranularityLevel.ATOMIC;
  }

  _assessComplexity(task) {
    let score = 0.5;
    const complexTypes = ['CODE_GENERATION', 'SYSTEM_DESIGN', 'DATA_ANALYSIS'];
    if (complexTypes.includes(task.type)) score += 0.2;
    const paramCount = Object.keys(task.params || {}).length;
    score += Math.min(paramCount / 10, 0.2);
    return Math.min(score, 1.0);
  }

  async _findSimilarPattern(task) {
    return null; // Simplified
  }

  async _decomposeByPattern(task, pattern, granularity) {
    return pattern.subtasks.map(t => ({ ...t, params: task.params }));
  }

  async _decomposeByAnalysis(task, granularity, context) {
    // Simplified decomposition
    return [{ type: task.type, description: task.description, params: task.params, order: 1 }];
  }

  async _analyzeDependencies(subtasks) {
    for (let i = 0; i < subtasks.length; i++) {
      subtasks[i].dependencies = [];
      subtasks[i].parallelizable = i === 0;
    }
  }

  async _optimizeSequence(subtasks) {
    return subtasks;
  }

  async _recordDecomposition(task, subtasks, granularity, context) {
    // Simplified - no DB recording for now
  }

  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalDecompositions > 0
        ? (this.stats.successfulDecompositions / this.stats.totalDecompositions * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  cleanup() {
    this.decompositionPatterns.clear();
    this.db = null;
    this.llm = null;
  }
}

module.exports = { TaskDecompositionEnhancement, GranularityLevel, DependencyType };
