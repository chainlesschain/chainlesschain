/**
 * 质量门禁管理器
 *
 * 管理工作流各阶段的质量检查
 *
 * 质量门禁检查项:
 * - 完整性检查 (completeness)
 * - 一致性验证 (consistency)
 * - LLM质量评估 (llm_quality)
 * - 格式验证 (format)
 * - 依赖验证 (dependency)
 *
 * v0.27.0: 新建文件
 */

const { EventEmitter } = require('events');
const { logger } = require('../utils/logger.js');

/**
 * 质量门禁状态枚举
 */
const GateStatus = {
  PENDING: 'pending',     // 等待检查
  CHECKING: 'checking',   // 检查中
  PASSED: 'passed',       // 通过
  FAILED: 'failed',       // 失败
  SKIPPED: 'skipped',     // 跳过
};

/**
 * 预定义质量门禁配置
 */
const DEFAULT_QUALITY_GATES = {
  STAGE_1_ANALYSIS: {
    id: 'gate_1_analysis',
    name: '需求分析质量门禁',
    stageId: 'stage_1',
    checks: ['intent_clarity', 'context_completeness', 'rag_relevance'],
    threshold: 0.7,
    blocking: true,
    description: '验证需求理解的准确性和上下文的完整性',
  },
  STAGE_2_DESIGN: {
    id: 'gate_2_design',
    name: '方案设计质量门禁',
    stageId: 'stage_2',
    checks: ['task_feasibility', 'resource_availability', 'dependency_valid'],
    threshold: 0.8,
    blocking: true,
    description: '验证方案的可行性和资源可用性',
  },
  STAGE_3_GENERATION: {
    id: 'gate_3_generation',
    name: '内容生成质量门禁',
    stageId: 'stage_3',
    checks: ['content_completeness', 'format_valid', 'no_hallucination'],
    threshold: 0.75,
    blocking: true,
    description: '验证生成内容的质量和准确性',
  },
  STAGE_4_VALIDATION: {
    id: 'gate_4_validation',
    name: '质量验证门禁',
    stageId: 'stage_4',
    checks: ['llm_quality_score', 'consistency_check', 'reference_valid'],
    threshold: 0.8,
    blocking: true,
    description: '综合质量评估和一致性验证',
  },
  STAGE_5_INTEGRATION: {
    id: 'gate_5_integration',
    name: '集成优化门禁',
    stageId: 'stage_5',
    checks: ['format_correct', 'size_optimal', 'metadata_complete'],
    threshold: 0.85,
    blocking: false,
    description: '验证集成和优化结果',
  },
  STAGE_6_DELIVERY: {
    id: 'gate_6_delivery',
    name: '交付确认门禁',
    stageId: 'stage_6',
    checks: ['preview_ready', 'export_valid', 'user_confirmed'],
    threshold: 1.0,
    blocking: true,
    description: '最终交付前的确认检查',
  },
};

/**
 * 检查项执行器映射
 */
const CHECK_EXECUTORS = {
  // 意图清晰度检查
  intent_clarity: async (result, context) => {
    const score = result.intent && result.intent.confidence ? result.intent.confidence : 0.5;
    return {
      name: '意图清晰度',
      passed: score >= 0.7,
      score,
      message: score >= 0.7 ? '意图识别清晰' : '意图识别不够明确',
    };
  },

  // 上下文完整性检查
  context_completeness: async (result, context) => {
    const requiredFields = ['userRequest', 'projectContext'];
    const presentFields = requiredFields.filter(f => context[f] != null);
    const score = presentFields.length / requiredFields.length;
    return {
      name: '上下文完整性',
      passed: score >= 0.8,
      score,
      message: `上下文字段: ${presentFields.length}/${requiredFields.length}`,
    };
  },

  // RAG相关性检查
  rag_relevance: async (result, context) => {
    const ragResults = result.ragResults || [];
    const avgRelevance = ragResults.length > 0
      ? ragResults.reduce((sum, r) => sum + (r.score || 0), 0) / ragResults.length
      : 0.5;
    return {
      name: 'RAG相关性',
      passed: avgRelevance >= 0.6,
      score: avgRelevance,
      message: `平均相关性: ${(avgRelevance * 100).toFixed(1)}%`,
    };
  },

  // 任务可行性检查
  task_feasibility: async (result, context) => {
    const tasks = result.tasks || result.subtasks || [];
    const feasible = tasks.filter(t => t.feasible !== false).length;
    const score = tasks.length > 0 ? feasible / tasks.length : 0;
    return {
      name: '任务可行性',
      passed: score >= 0.8,
      score,
      message: `可行任务: ${feasible}/${tasks.length}`,
    };
  },

  // 资源可用性检查
  resource_availability: async (result, context) => {
    const resources = result.requiredResources || [];
    const available = resources.filter(r => r.available !== false).length;
    const score = resources.length > 0 ? available / resources.length : 1;
    return {
      name: '资源可用性',
      passed: score >= 0.9,
      score,
      message: `可用资源: ${available}/${resources.length}`,
    };
  },

  // 依赖有效性检查
  dependency_valid: async (result, context) => {
    const dependencies = result.dependencies || [];
    const valid = dependencies.filter(d => d.valid !== false).length;
    const score = dependencies.length > 0 ? valid / dependencies.length : 1;
    return {
      name: '依赖有效性',
      passed: score >= 1.0,
      score,
      message: `有效依赖: ${valid}/${dependencies.length}`,
    };
  },

  // 内容完整性检查
  content_completeness: async (result, context) => {
    const content = result.content || result.output || '';
    const minLength = context.minContentLength || 100;
    const hasContent = content.length >= minLength;
    const score = hasContent ? Math.min(content.length / (minLength * 2), 1) : content.length / minLength;
    return {
      name: '内容完整性',
      passed: hasContent,
      score,
      message: hasContent ? `内容长度: ${content.length}` : '内容过短',
    };
  },

  // 格式有效性检查
  format_valid: async (result, context) => {
    const expectedFormat = context.expectedFormat || 'text';
    let valid = true;
    let message = '格式正确';

    if (expectedFormat === 'json') {
      try {
        JSON.parse(typeof result.content === 'string' ? result.content : JSON.stringify(result.content));
      } catch (e) {
        valid = false;
        message = 'JSON格式无效';
      }
    } else if (expectedFormat === 'html') {
      valid = typeof result.content === 'string' && result.content.includes('<');
    }

    return {
      name: '格式有效性',
      passed: valid,
      score: valid ? 1 : 0,
      message,
    };
  },

  // 无幻觉检查 (简化版，实际可用LLM验证)
  no_hallucination: async (result, context) => {
    // 简化实现：检查是否有明确的引用或依据
    const hasReferences = result.references && result.references.length > 0;
    const score = hasReferences ? 0.9 : 0.7; // 有引用得分更高
    return {
      name: '幻觉检查',
      passed: true, // 默认通过，实际应用中可调用LLM验证
      score,
      message: hasReferences ? '有参考依据' : '无明确引用',
    };
  },

  // LLM质量评分
  llm_quality_score: async (result, context) => {
    const score = result.qualityScore || 0.75;
    return {
      name: 'LLM质量评分',
      passed: score >= 0.7,
      score,
      message: `质量评分: ${(score * 100).toFixed(1)}%`,
    };
  },

  // 一致性检查
  consistency_check: async (result, context) => {
    const inconsistencies = result.inconsistencies || [];
    const score = inconsistencies.length === 0 ? 1 : Math.max(0, 1 - inconsistencies.length * 0.1);
    return {
      name: '一致性检查',
      passed: inconsistencies.length === 0,
      score,
      message: inconsistencies.length === 0 ? '无不一致' : `发现${inconsistencies.length}处不一致`,
    };
  },

  // 引用有效性检查
  reference_valid: async (result, context) => {
    const references = result.references || [];
    const valid = references.filter(r => r.valid !== false).length;
    const score = references.length > 0 ? valid / references.length : 1;
    return {
      name: '引用有效性',
      passed: score >= 0.9,
      score,
      message: `有效引用: ${valid}/${references.length}`,
    };
  },

  // 格式正确性
  format_correct: async (result, context) => {
    const errors = result.formatErrors || [];
    const score = errors.length === 0 ? 1 : Math.max(0, 1 - errors.length * 0.2);
    return {
      name: '格式正确性',
      passed: errors.length === 0,
      score,
      message: errors.length === 0 ? '格式正确' : `${errors.length}处格式问题`,
    };
  },

  // 大小优化
  size_optimal: async (result, context) => {
    const size = result.size || result.contentLength || 0;
    const maxSize = context.maxSize || 10 * 1024 * 1024; // 10MB
    const optimal = size <= maxSize;
    const score = optimal ? 1 : maxSize / size;
    return {
      name: '大小优化',
      passed: optimal,
      score,
      message: optimal ? `大小: ${(size / 1024).toFixed(1)}KB` : '文件过大',
    };
  },

  // 元数据完整性
  metadata_complete: async (result, context) => {
    const requiredMeta = ['title', 'createdAt', 'version'];
    const metadata = result.metadata || {};
    const present = requiredMeta.filter(m => metadata[m] != null).length;
    const score = present / requiredMeta.length;
    return {
      name: '元数据完整性',
      passed: score >= 1,
      score,
      message: `元数据: ${present}/${requiredMeta.length}`,
    };
  },

  // 预览就绪
  preview_ready: async (result, context) => {
    const hasPreview = result.preview || result.previewUrl || result.previewData;
    return {
      name: '预览就绪',
      passed: !!hasPreview,
      score: hasPreview ? 1 : 0,
      message: hasPreview ? '预览已生成' : '预览未生成',
    };
  },

  // 导出有效性
  export_valid: async (result, context) => {
    const exportResult = result.export || result.exportPath;
    const valid = !!exportResult;
    return {
      name: '导出有效性',
      passed: valid,
      score: valid ? 1 : 0,
      message: valid ? '导出成功' : '导出失败',
    };
  },

  // 用户确认
  user_confirmed: async (result, context) => {
    const confirmed = result.userConfirmed === true;
    return {
      name: '用户确认',
      passed: confirmed,
      score: confirmed ? 1 : 0,
      message: confirmed ? '已确认' : '待确认',
    };
  },
};

/**
 * 质量门禁管理器类
 */
class QualityGateManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.llmService = options.llmService;
    this.gates = new Map();
    this.gateStatuses = new Map();
    this.checkResults = new Map();

    // 初始化默认门禁
    this._initializeDefaultGates();

    logger.info('[QualityGateManager] 初始化质量门禁管理器');
  }

  /**
   * 初始化默认门禁
   * @private
   */
  _initializeDefaultGates() {
    Object.values(DEFAULT_QUALITY_GATES).forEach(gate => {
      this.registerGate(gate);
    });
  }

  /**
   * 注册质量门禁
   * @param {Object} gate - 门禁配置
   */
  registerGate(gate) {
    this.gates.set(gate.id, gate);
    this.gateStatuses.set(gate.id, GateStatus.PENDING);
    logger.info(`[QualityGateManager] 注册门禁: ${gate.name}`);
  }

  /**
   * 获取门禁配置
   * @param {string} gateId - 门禁ID
   * @returns {Object|null} 门禁配置
   */
  getGate(gateId) {
    return this.gates.get(gateId) || null;
  }

  /**
   * 获取阶段对应的门禁
   * @param {string} stageId - 阶段ID
   * @returns {Object|null} 门禁配置
   */
  getGateByStage(stageId) {
    for (const gate of this.gates.values()) {
      if (gate.stageId === stageId) {
        return gate;
      }
    }
    return null;
  }

  /**
   * 执行质量门禁检查
   * @param {string} gateIdOrStageId - 门禁ID或阶段ID
   * @param {Object} result - 阶段执行结果
   * @param {Object} context - 上下文信息
   * @returns {Object} 检查结果
   */
  async check(gateIdOrStageId, result, context = {}) {
    // 查找门禁配置
    let gate = this.gates.get(gateIdOrStageId);
    if (!gate) {
      gate = this.getGateByStage(gateIdOrStageId);
    }

    if (!gate) {
      logger.warn(`[QualityGateManager] 未找到门禁: ${gateIdOrStageId}`);
      return {
        gateId: gateIdOrStageId,
        passed: true,
        score: 1,
        blocking: false,
        checks: [],
        message: '门禁未配置，默认通过',
      };
    }

    // 更新状态为检查中
    this.gateStatuses.set(gate.id, GateStatus.CHECKING);
    this.emit('gate-checking', { gateId: gate.id, gateName: gate.name });

    const checkResults = [];
    let totalScore = 0;

    // 执行每个检查项
    for (const checkName of gate.checks) {
      const executor = CHECK_EXECUTORS[checkName];
      if (!executor) {
        logger.warn(`[QualityGateManager] 未找到检查执行器: ${checkName}`);
        continue;
      }

      try {
        const checkResult = await executor(result, context);
        checkResults.push({
          ...checkResult,
          checkId: checkName,
        });
        totalScore += checkResult.score;

        // 发送单个检查完成事件
        this.emit('check-completed', {
          gateId: gate.id,
          checkId: checkName,
          result: checkResult,
        });
      } catch (error) {
        logger.error(`[QualityGateManager] 检查执行失败: ${checkName}`, error);
        checkResults.push({
          checkId: checkName,
          name: checkName,
          passed: false,
          score: 0,
          message: `检查执行失败: ${error.message}`,
          error: error.message,
        });
      }
    }

    // 计算总分
    const avgScore = checkResults.length > 0 ? totalScore / checkResults.length : 0;
    const passed = avgScore >= gate.threshold;

    // 更新状态
    const finalStatus = passed ? GateStatus.PASSED : GateStatus.FAILED;
    this.gateStatuses.set(gate.id, finalStatus);

    const gateResult = {
      gateId: gate.id,
      gateName: gate.name,
      passed,
      score: avgScore,
      threshold: gate.threshold,
      blocking: gate.blocking,
      checks: checkResults,
      passedChecks: checkResults.filter(c => c.passed).length,
      totalChecks: checkResults.length,
      message: passed
        ? `门禁通过 (${(avgScore * 100).toFixed(1)}% >= ${gate.threshold * 100}%)`
        : `门禁失败 (${(avgScore * 100).toFixed(1)}% < ${gate.threshold * 100}%)`,
      timestamp: Date.now(),
    };

    // 保存检查结果
    this.checkResults.set(gate.id, gateResult);

    // 发送门禁完成事件
    this.emit('gate-completed', gateResult);

    logger.info(`[QualityGateManager] 门禁检查完成: ${gate.name} - ${passed ? '通过' : '失败'}`);

    return gateResult;
  }

  /**
   * 手动覆盖门禁（跳过）
   * @param {string} gateId - 门禁ID
   * @param {string} reason - 跳过原因
   * @returns {boolean} 是否成功
   */
  override(gateId, reason = '手动跳过') {
    const gate = this.gates.get(gateId);
    if (!gate) {
      return false;
    }

    if (gate.blocking) {
      logger.warn(`[QualityGateManager] 阻塞门禁需要用户确认才能跳过: ${gate.name}`);
    }

    this.gateStatuses.set(gateId, GateStatus.SKIPPED);

    this.emit('gate-overridden', {
      gateId,
      gateName: gate.name,
      reason,
      timestamp: Date.now(),
    });

    logger.info(`[QualityGateManager] 门禁已跳过: ${gate.name} - ${reason}`);
    return true;
  }

  /**
   * 获取所有门禁状态
   * @returns {Object} 门禁状态映射
   */
  getAllStatuses() {
    const statuses = {};
    for (const [id, status] of this.gateStatuses) {
      const gate = this.gates.get(id);
      const result = this.checkResults.get(id);
      statuses[id] = {
        id,
        name: gate ? gate.name : id,
        status,
        score: result ? result.score : null,
        passed: result ? result.passed : null,
        blocking: gate ? gate.blocking : false,
      };
    }
    return statuses;
  }

  /**
   * 获取门禁检查结果
   * @param {string} gateId - 门禁ID
   * @returns {Object|null} 检查结果
   */
  getCheckResult(gateId) {
    return this.checkResults.get(gateId) || null;
  }

  /**
   * 重置所有门禁状态
   */
  reset() {
    for (const gateId of this.gateStatuses.keys()) {
      this.gateStatuses.set(gateId, GateStatus.PENDING);
    }
    this.checkResults.clear();
    logger.info('[QualityGateManager] 所有门禁状态已重置');
  }

  /**
   * 重置单个门禁状态
   * @param {string} gateId - 门禁ID
   */
  resetGate(gateId) {
    this.gateStatuses.set(gateId, GateStatus.PENDING);
    this.checkResults.delete(gateId);
  }
}

module.exports = {
  QualityGateManager,
  GateStatus,
  DEFAULT_QUALITY_GATES,
  CHECK_EXECUTORS,
};
