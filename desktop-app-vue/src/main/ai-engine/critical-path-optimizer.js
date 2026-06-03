/**
 * CriticalPathOptimizer - 关键路径优化器
 *
 * 使用关键路径分析（CPM）优化任务调度顺序
 *
 * 核心功能:
 * 1. DAG分析识别关键路径
 * 2. 计算最早/最晚开始时间
 * 3. 优先调度关键任务
 * 4. 动态优先级调整
 *
 * @module ai-engine/critical-path-optimizer
 */

const { logger } = require('../utils/logger.js');

/**
 * 任务节点（用于关键路径分析）
 */
class TaskNode {
  constructor(task) {
    this.id = task.id;
    this.task = task;
    this.duration = task.estimatedDuration || task.duration || 1000; // 默认1秒
    this.dependencies = task.dependencies || [];

    // CPM计算属性
    this.earliestStart = 0;      // 最早开始时间
    this.earliestFinish = 0;     // 最早完成时间
    this.latestStart = Infinity; // 最晚开始时间
    this.latestFinish = Infinity;// 最晚完成时间
    this.slack = 0;              // 松弛时间（浮动时间）
    this.isCritical = false;     // 是否在关键路径上

    // 调度属性
    this.priority = 0;           // 动态优先级
    this.depth = 0;              // DAG深度
  }
}

/**
 * CriticalPathOptimizer 类
 */
class CriticalPathOptimizer {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.priorityBoost = options.priorityBoost || 2.0; // 关键任务优先级加成
    this.slackThreshold = options.slackThreshold || 1000; // 松弛时间阈值（ms）

    // 统计信息
    this.stats = {
      totalAnalyses: 0,
      criticalPathsFound: 0,
      avgCriticalPathLength: 0,
      avgSlack: 0,
      tasksOptimized: 0,
    };

    logger.info('[CriticalPathOptimizer] 关键路径优化器已初始化', {
      enabled: this.enabled,
      priorityBoost: this.priorityBoost,
    });
  }

  /**
   * 优化任务调度顺序
   * @param {Array} tasks - 任务列表
   * @returns {Array} 优化后的任务列表（按优先级排序）
   */
  optimize(tasks) {
    if (!this.enabled || !tasks || tasks.length === 0) {
      return tasks;
    }

    logger.info(`[CriticalPathOptimizer] 开始关键路径分析，任务数: ${tasks.length}`);
    this.stats.totalAnalyses++;

    try {
      // 1. 构建任务节点
      const nodes = this._buildNodes(tasks);

      // 2. 拓扑排序（检测循环依赖）
      const sortedNodes = this._topologicalSort(nodes);

      if (!sortedNodes) {
        logger.error('[CriticalPathOptimizer] 检测到循环依赖，跳过优化');
        return tasks;
      }

      // 3. 前向传递：计算最早开始/完成时间
      this._forwardPass(sortedNodes, nodes);

      // 4. 后向传递：计算最晚开始/完成时间
      this._backwardPass(sortedNodes, nodes);

      // 5. 识别关键路径
      const criticalPath = this._identifyCriticalPath(nodes);

      if (criticalPath.length > 0) {
        this.stats.criticalPathsFound++;
        this.stats.avgCriticalPathLength =
          (this.stats.avgCriticalPathLength * (this.stats.criticalPathsFound - 1) + criticalPath.length)
          / this.stats.criticalPathsFound;

        logger.info(`[CriticalPathOptimizer] ✅ 关键路径: ${criticalPath.map(n => n.id).join(' → ')}`);
      }

      // 6. 计算动态优先级
      this._calculatePriorities(nodes);

      // 7. 按优先级排序任务
      const optimizedTasks = this._sortByPriority(tasks, nodes);

      this.stats.tasksOptimized += optimizedTasks.length;

      logger.info('[CriticalPathOptimizer] ✅ 优化完成', {
        criticalPathLength: criticalPath.length,
        avgSlack: this._calculateAvgSlack(nodes).toFixed(2) + 'ms',
      });

      return optimizedTasks;

    } catch (error) {
      logger.error('[CriticalPathOptimizer] 优化失败:', error.message);
      return tasks; // 失败时返回原始任务
    }
  }

  /**
   * 构建任务节点映射
   * @private
   */
  _buildNodes(tasks) {
    const nodes = new Map();

    for (const task of tasks) {
      nodes.set(task.id, new TaskNode(task));
    }

    return nodes;
  }

  /**
   * 拓扑排序（Kahn算法）
   * @private
   */
  _topologicalSort(nodes) {
    // 计算入度
    const inDegree = new Map();
    const adjList = new Map();

    for (const node of nodes.values()) {
      inDegree.set(node.id, 0);
      adjList.set(node.id, []);
    }

    for (const node of nodes.values()) {
      for (const depId of node.dependencies) {
        if (nodes.has(depId)) {
          adjList.get(depId).push(node.id);
          inDegree.set(node.id, inDegree.get(node.id) + 1);
        }
      }
    }

    // Kahn算法
    const queue = [];
    const sorted = [];

    for (const [id, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const currentId = queue.shift();
      sorted.push(nodes.get(currentId));

      for (const neighborId of adjList.get(currentId)) {
        inDegree.set(neighborId, inDegree.get(neighborId) - 1);
        if (inDegree.get(neighborId) === 0) {
          queue.push(neighborId);
        }
      }
    }

    // 检测循环依赖
    if (sorted.length !== nodes.size) {
      logger.warn('[CriticalPathOptimizer] 检测到循环依赖');
      return null;
    }

    return sorted;
  }

  /**
   * 前向传递：计算最早开始/完成时间
   * @private
   */
  _forwardPass(sortedNodes, nodes) {
    for (const node of sortedNodes) {
      // 最早开始时间 = max(所有前驱任务的最早完成时间)
      let maxPredecessorFinish = 0;

      for (const depId of node.dependencies) {
        const depNode = nodes.get(depId);
        if (depNode) {
          maxPredecessorFinish = Math.max(maxPredecessorFinish, depNode.earliestFinish);
        }
      }

      node.earliestStart = maxPredecessorFinish;
      node.earliestFinish = node.earliestStart + node.duration;
    }
  }

  /**
   * 后向传递：计算最晚开始/完成时间
   * @private
   */
  _backwardPass(sortedNodes, nodes) {
    // 找出所有终点任务（没有后继）
    const hasSuccessors = new Set();
    for (const node of nodes.values()) {
      for (const depId of node.dependencies) {
        hasSuccessors.add(depId);
      }
    }

    // 初始化终点任务的最晚完成时间
    let maxFinishTime = 0;
    for (const node of sortedNodes) {
      if (!hasSuccessors.has(node.id)) {
        maxFinishTime = Math.max(maxFinishTime, node.earliestFinish);
      }
    }

    for (const node of sortedNodes) {
      if (!hasSuccessors.has(node.id)) {
        node.latestFinish = maxFinishTime;
      }
    }

    // 反向遍历
    for (let i = sortedNodes.length - 1; i >= 0; i--) {
      const node = sortedNodes[i];

      // 找出所有后继任务
      const successors = [];
      for (const otherNode of nodes.values()) {
        if (otherNode.dependencies.includes(node.id)) {
          successors.push(otherNode);
        }
      }

      // 最晚完成时间 = min(所有后继任务的最晚开始时间)
      if (successors.length > 0) {
        let minSuccessorStart = Infinity;
        for (const successor of successors) {
          minSuccessorStart = Math.min(minSuccessorStart, successor.latestStart);
        }
        node.latestFinish = minSuccessorStart;
      }

      node.latestStart = node.latestFinish - node.duration;
      node.slack = node.latestStart - node.earliestStart;
    }
  }

  /**
   * 识别关键路径
   * @private
   */
  _identifyCriticalPath(nodes) {
    const criticalPath = [];

    for (const node of nodes.values()) {
      // 松弛时间接近0的任务在关键路径上
      if (node.slack <= this.slackThreshold) {
        node.isCritical = true;
        criticalPath.push(node);
      }
    }

    // 按开始时间排序
    criticalPath.sort((a, b) => a.earliestStart - b.earliestStart);

    return criticalPath;
  }

  /**
   * 计算动态优先级
   * @private
   */
  _calculatePriorities(nodes) {
    for (const node of nodes.values()) {
      let priority = 0;

      // 基础优先级（原始优先级）
      priority += node.task.priority || 0;

      // 关键任务加成
      if (node.isCritical) {
        priority += this.priorityBoost * 10;
      }

      // 松弛时间惩罚（松弛时间越小，优先级越高）
      const slackPenalty = Math.max(0, 10 - (node.slack / 1000));
      priority += slackPenalty;

      // 深度加成（依赖链越长，优先级越高）
      priority += node.depth * 0.5;

      // 持续时间因素（长任务稍微提高优先级）
      priority += Math.log(node.duration + 1) * 0.1;

      node.priority = priority;
    }
  }

  /**
   * 按优先级排序任务
   * @private
   */
  _sortByPriority(tasks, nodes) {
    return tasks.slice().sort((a, b) => {
      const nodeA = nodes.get(a.id);
      const nodeB = nodes.get(b.id);

      if (!nodeA || !nodeB) {
        return 0;
      }

      // 优先级降序排序
      return nodeB.priority - nodeA.priority;
    });
  }

  /**
   * 计算平均松弛时间
   * @private
   */
  _calculateAvgSlack(nodes) {
    let totalSlack = 0;
    let count = 0;

    for (const node of nodes.values()) {
      if (node.slack < Infinity) {
        totalSlack += node.slack;
        count++;
      }
    }

    const avgSlack = count > 0 ? totalSlack / count : 0;
    this.stats.avgSlack = avgSlack;

    return avgSlack;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      avgCriticalPathLength: this.stats.avgCriticalPathLength.toFixed(2),
      avgSlack: this.stats.avgSlack.toFixed(2) + 'ms',
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalAnalyses: 0,
      criticalPathsFound: 0,
      avgCriticalPathLength: 0,
      avgSlack: 0,
      tasksOptimized: 0,
    };
  }
}

module.exports = { CriticalPathOptimizer, TaskNode };
