/**
 * 工具组合系统 (Tool Composition System)
 * P2 扩展功能之二
 *
 * 功能:
 * - 智能工具链组合
 * - 工具依赖分析
 * - 工具效果预测
 * - 自动工具选择优化
 *
 * 版本: v0.20.0
 * 创建: 2026-01-02
 */

const CompositionStrategy = {
  PIPELINE: 'pipeline',         // 管道式(A的输出给B)
  PARALLEL: 'parallel',         // 并行式(同时执行)
  CONDITIONAL: 'conditional',   // 条件式(根据结果选择)
  ITERATIVE: 'iterative'        // 迭代式(循环执行)
};

class ToolCompositionSystem {
  constructor(config = {}) {
    this.config = {
      enableAutoComposition: true,
      enableEffectPrediction: true,
      enableOptimization: true,
      maxCompositionDepth: 5,
      ...config
    };

    this.db = null;
    this.toolRegistry = new Map();
    this.compositionPatterns = new Map();

    this.stats = {
      totalCompositions: 0,
      successfulCompositions: 0,
      avgToolsPerComposition: 0
    };
  }

  setDatabase(db) { this.db = db; }

  registerTool(name, tool) {
    this.toolRegistry.set(name, {
      name,
      execute: tool.execute,
      inputs: tool.inputs || [],
      outputs: tool.outputs || [],
      dependencies: tool.dependencies || [],
      cost: tool.cost || 1
    });
  }

  async composeTools(goal, context = {}) {
    this.stats.totalCompositions++;

    const toolChain = await this._buildToolChain(goal, context);
    const optimized = this._optimizeToolChain(toolChain);

    await this._recordComposition(goal, optimized, context);

    this.stats.successfulCompositions++;
    this.stats.avgToolsPerComposition =
      (this.stats.avgToolsPerComposition * (this.stats.successfulCompositions - 1) +
       optimized.length) / this.stats.successfulCompositions;

    return optimized;
  }

  async _buildToolChain(goal, context) {
    const chain = [];
    const availableTools = Array.from(this.toolRegistry.values());

    // Simple greedy approach for demo
    for (const tool of availableTools) {
      if (this._matchesGoal(tool, goal)) {
        chain.push({
          tool: tool.name,
          strategy: CompositionStrategy.PIPELINE,
          estimatedCost: tool.cost
        });
      }
    }

    return chain;
  }

  _matchesGoal(tool, goal) {
    return tool.outputs.some(output => 
      goal.toLowerCase().includes(output.toLowerCase())
    );
  }

  _optimizeToolChain(toolChain) {
    // Identify parallel opportunities
    const optimized = [];
    const parallelGroup = [];

    for (const step of toolChain) {
      if (parallelGroup.length === 0 || this._canParallelize(step, parallelGroup)) {
        parallelGroup.push(step);
      } else {
        if (parallelGroup.length > 1) {
          optimized.push({
            tools: parallelGroup,
            strategy: CompositionStrategy.PARALLEL
          });
        } else {
          optimized.push(parallelGroup[0]);
        }
        parallelGroup.length = 0;
        parallelGroup.push(step);
      }
    }

    if (parallelGroup.length > 0) {
      optimized.push(parallelGroup.length > 1 ? {
        tools: parallelGroup,
        strategy: CompositionStrategy.PARALLEL
      } : parallelGroup[0]);
    }

    return optimized;
  }

  _canParallelize(step, group) {
    // Simplified: check if no data dependencies
    return group.every(s =>
      !this._hasDependency(step.tool, s.tool)
    );
  }

  _hasDependency(tool1, tool2) {
    const t1 = this.toolRegistry.get(tool1);
    const t2 = this.toolRegistry.get(tool2);
    return t1 && t2 && t1.dependencies.includes(tool2);
  }

  async executeComposition(composition, inputs = {}) {
    const results = [];

    for (const step of composition) {
      if (step.strategy === CompositionStrategy.PARALLEL && step.tools) {
        const parallelResults = await Promise.all(
          step.tools.map(s => this._executeTool(s.tool, inputs))
        );
        results.push(...parallelResults);
      } else {
        const result = await this._executeTool(step.tool, inputs);
        results.push(result);
        inputs = { ...inputs, ...result }; // Pipeline data flow
      }
    }

    return results;
  }

  async _executeTool(toolName, inputs) {
    const tool = this.toolRegistry.get(toolName);
    if (!tool || !tool.execute) {
      throw new Error(`Tool "${toolName}" not found or not executable`);
    }

    return await tool.execute(inputs);
  }

  async _recordComposition(goal, composition, context) {
    if (!this.db) return;

    try {
      const insertStmt = this.db.prepare(`
        INSERT INTO tool_composition_history (session_id, goal, composition, tool_count, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `);

      insertStmt.run(
        context.sessionId || 'unknown',
        goal,
        JSON.stringify(composition),
        composition.length
      );
    } catch (error) {
      console.error('[ToolComp] 记录组合历史失败:', error);
    }
  }

  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalCompositions > 0
        ? (this.stats.successfulCompositions / this.stats.totalCompositions * 100).toFixed(2) + '%'
        : '0%',
      registeredTools: this.toolRegistry.size
    };
  }

  cleanup() {
    this.toolRegistry.clear();
    this.compositionPatterns.clear();
    this.db = null;
  }
}

module.exports = { ToolCompositionSystem, CompositionStrategy };
