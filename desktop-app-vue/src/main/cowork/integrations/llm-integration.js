/**
 * LLM (Large Language Model) Integration for Cowork
 *
 * Provides AI-powered decision-making for Cowork agents using Ollama LLM:
 * - Task analysis and decomposition
 * - Agent assignment recommendations
 * - Conflict resolution
 * - Strategy selection
 *
 * @module CoworkLLMIntegration
 */

const { logger, createLogger } = require('../../utils/logger');

const llmLogger = createLogger('cowork-llm');

class CoworkLLMIntegration {
  constructor(llmService) {
    this.llmService = llmService;
    this.model = 'qwen2:7b';  // Default model
    this.temperature = 0.7;   // Creativity vs. consistency
    this.maxTokens = 1000;
  }

  /**
   * Analyze task complexity and recommend agent configuration
   *
   * @param {Object} task - Task to analyze
   * @returns {Promise<Object>} Analysis and recommendations
   */
  async analyzeTask(task) {
    try {
      llmLogger.info(`Analyzing task: ${task.description.substring(0, 100)}...`);

      const prompt = this._buildTaskAnalysisPrompt(task);

      const response = await this.llmService.generate({
        model: this.model,
        prompt,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      });

      const analysis = this._parseTaskAnalysis(response.text);

      llmLogger.info(`Task analysis complete: complexity=${analysis.complexity}, recommended=${analysis.recommendedAgents} agents`);

      return analysis;
    } catch (error) {
      llmLogger.error('Task analysis failed:', error);

      // Fallback to simple heuristics
      return this._fallbackTaskAnalysis(task);
    }
  }

  /**
   * Recommend best agent for a task
   *
   * @param {Object} params - Recommendation parameters
   * @param {Object} params.task - Task to assign
   * @param {Array} params.availableAgents - Available agents
   * @returns {Promise<Object>} Agent recommendation
   */
  async recommendAgent(params) {
    const { task, availableAgents } = params;

    try {
      llmLogger.info(`Recommending agent for task: ${task.description.substring(0, 50)}...`);

      const prompt = this._buildAgentRecommendationPrompt(task, availableAgents);

      const response = await this.llmService.generate({
        model: this.model,
        prompt,
        temperature: 0.3,  // Lower temperature for more deterministic choice
        maxTokens: 500,
      });

      const recommendation = this._parseAgentRecommendation(response.text, availableAgents);

      llmLogger.info(`Agent recommendation: ${recommendation.agentId} (confidence: ${recommendation.confidence})`);

      return recommendation;
    } catch (error) {
      llmLogger.error('Agent recommendation failed:', error);

      // Fallback: Choose agent with most matching capabilities
      return this._fallbackAgentRecommendation(task, availableAgents);
    }
  }

  /**
   * Decompose complex task into subtasks
   *
   * @param {Object} task - Complex task to decompose
   * @returns {Promise<Array>} Subtasks
   */
  async decomposeTask(task) {
    try {
      llmLogger.info(`Decomposing task: ${task.description}`);

      const prompt = this._buildTaskDecompositionPrompt(task);

      const response = await this.llmService.generate({
        model: this.model,
        prompt,
        temperature: 0.5,
        maxTokens: 1500,
      });

      const subtasks = this._parseSubtasks(response.text, task);

      llmLogger.info(`Task decomposed into ${subtasks.length} subtasks`);

      return subtasks;
    } catch (error) {
      llmLogger.error('Task decomposition failed:', error);
      return [];
    }
  }

  /**
   * Resolve conflict between agents
   *
   * @param {Object} params - Conflict parameters
   * @param {Array} params.conflictingOpinions - Different agent opinions
   * @param {Object} params.context - Conflict context
   * @returns {Promise<Object>} Conflict resolution
   */
  async resolveConflict(params) {
    const { conflictingOpinions, context } = params;

    try {
      llmLogger.info(`Resolving conflict with ${conflictingOpinions.length} opinions`);

      const prompt = this._buildConflictResolutionPrompt(conflictingOpinions, context);

      const response = await this.llmService.generate({
        model: this.model,
        prompt,
        temperature: 0.4,
        maxTokens: 800,
      });

      const resolution = this._parseConflictResolution(response.text);

      llmLogger.info(`Conflict resolved: ${resolution.decision}`);

      return resolution;
    } catch (error) {
      llmLogger.error('Conflict resolution failed:', error);

      // Fallback: Majority vote
      return this._fallbackConflictResolution(conflictingOpinions);
    }
  }

  /**
   * Generate task execution strategy
   *
   * @param {Object} task - Task to execute
   * @param {Object} resources - Available resources
   * @returns {Promise<Object>} Execution strategy
   */
  async generateStrategy(task, resources) {
    try {
      llmLogger.info(`Generating strategy for task: ${task.description.substring(0, 50)}...`);

      const prompt = this._buildStrategyPrompt(task, resources);

      const response = await this.llmService.generate({
        model: this.model,
        prompt,
        temperature: 0.6,
        maxTokens: 1200,
      });

      const strategy = this._parseStrategy(response.text);

      llmLogger.info(`Strategy generated: ${strategy.approach}`);

      return strategy;
    } catch (error) {
      llmLogger.error('Strategy generation failed:', error);

      return {
        approach: 'sequential',
        steps: ['Execute task'],
        estimatedTime: 'Unknown',
      };
    }
  }

  // ==========================================
  // Prompt Building Methods
  // ==========================================

  /**
   * Build task analysis prompt
   *
   * @private
   */
  _buildTaskAnalysisPrompt(task) {
    return `Analyze the following task and provide recommendations:

**Task Description**: ${task.description}
**Task Type**: ${task.type || 'Unknown'}
**Priority**: ${task.priority || 'Medium'}
${task.input ? `**Input Data**: ${JSON.stringify(task.input, null, 2)}` : ''}

Please analyze this task and provide:
1. **Complexity Level** (1-10): How complex is this task?
2. **Estimated Time**: Approximate time to complete (in minutes)
3. **Required Skills**: What skills/capabilities are needed?
4. **Recommended Agents**: How many agents should work on this? (1 for simple, multiple for complex)
5. **Parallelization**: Can this task be parallelized? (Yes/No)
6. **Risk Level** (Low/Medium/High): Potential risks or challenges

Format your response as JSON:
{
  "complexity": <number>,
  "estimatedTime": <number>,
  "requiredSkills": ["skill1", "skill2"],
  "recommendedAgents": <number>,
  "canParallelize": <boolean>,
  "riskLevel": "Low|Medium|High",
  "reasoning": "Brief explanation"
}`;
  }

  /**
   * Build agent recommendation prompt
   *
   * @private
   */
  _buildAgentRecommendationPrompt(task, availableAgents) {
    const agentsInfo = availableAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      capabilities: agent.capabilities || [],
      status: agent.status,
    }));

    return `Given the following task and available agents, recommend the best agent:

**Task**: ${task.description}
**Task Type**: ${task.type}
**Required Skills**: ${task.requiredSkills || 'Unknown'}

**Available Agents**:
${JSON.stringify(agentsInfo, null, 2)}

Choose the best agent based on:
1. Capability match with required skills
2. Current workload/status
3. Past performance

Respond in JSON format:
{
  "agentId": "<selected agent ID>",
  "confidence": <0.0-1.0>,
  "reasoning": "Why this agent was chosen"
}`;
  }

  /**
   * Build task decomposition prompt
   *
   * @private
   */
  _buildTaskDecompositionPrompt(task) {
    return `Decompose the following complex task into smaller, manageable subtasks:

**Task**: ${task.description}
**Task Type**: ${task.type}
${task.input ? `**Input**: ${JSON.stringify(task.input)}` : ''}

Break this down into 3-7 subtasks that can be executed sequentially or in parallel.
Each subtask should be:
- Specific and actionable
- Testable/verifiable
- Estimated with time duration

Respond in JSON format:
{
  "subtasks": [
    {
      "description": "Subtask description",
      "estimatedTime": <minutes>,
      "dependencies": ["subtask index that must complete first"],
      "requiredSkills": ["skill1", "skill2"]
    }
  ]
}`;
  }

  /**
   * Build conflict resolution prompt
   *
   * @private
   */
  _buildConflictResolutionPrompt(opinions, context) {
    return `Resolve the following conflict between agents:

**Context**: ${context.description || 'Team decision-making'}

**Conflicting Opinions**:
${opinions.map((op, i) => `
**Agent ${i + 1}** (${op.agentId}):
  - Position: ${op.position}
  - Reasoning: ${op.reasoning}
`).join('\n')}

Analyze the arguments and provide a resolution that:
1. Weighs the merits of each position
2. Considers the context and goals
3. Provides a clear decision
4. Explains the rationale

Respond in JSON format:
{
  "decision": "Clear decision statement",
  "chosenPosition": <index of chosen opinion or "hybrid">,
  "reasoning": "Detailed explanation",
  "confidence": <0.0-1.0>
}`;
  }

  /**
   * Build strategy generation prompt
   *
   * @private
   */
  _buildStrategyPrompt(task, resources) {
    return `Generate an execution strategy for the following task:

**Task**: ${task.description}
**Task Type**: ${task.type}
**Available Resources**:
  - Agents: ${resources.agentCount || 0}
  - Time Limit: ${resources.timeLimit || 'Unlimited'}
  - Budget: ${resources.budget || 'N/A'}

Provide a detailed execution strategy including:
1. Overall approach (sequential, parallel, hybrid)
2. Step-by-step plan
3. Resource allocation
4. Risk mitigation
5. Success criteria

Respond in JSON format:
{
  "approach": "sequential|parallel|hybrid",
  "steps": ["step 1", "step 2", ...],
  "resourceAllocation": {
    "agents": <number>,
    "estimatedTime": <minutes>
  },
  "risks": ["risk 1", "risk 2"],
  "successCriteria": ["criterion 1", "criterion 2"]
}`;
  }

  // ==========================================
  // Response Parsing Methods
  // ==========================================

  /**
   * Parse task analysis response
   *
   * @private
   */
  _parseTaskAnalysis(responseText) {
    try {
      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const analysis = JSON.parse(jsonMatch[0]);

      return {
        complexity: analysis.complexity || 5,
        estimatedTime: analysis.estimatedTime || 30,
        requiredSkills: analysis.requiredSkills || [],
        recommendedAgents: analysis.recommendedAgents || 1,
        canParallelize: analysis.canParallelize || false,
        riskLevel: analysis.riskLevel || 'Medium',
        reasoning: analysis.reasoning || '',
      };
    } catch (error) {
      llmLogger.error('Failed to parse task analysis:', error);
      return this._fallbackTaskAnalysis();
    }
  }

  /**
   * Parse agent recommendation response
   *
   * @private
   */
  _parseAgentRecommendation(responseText, availableAgents) {
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const recommendation = JSON.parse(jsonMatch[0]);

      return {
        agentId: recommendation.agentId,
        confidence: recommendation.confidence || 0.5,
        reasoning: recommendation.reasoning || '',
      };
    } catch (error) {
      llmLogger.error('Failed to parse agent recommendation:', error);
      return this._fallbackAgentRecommendation({}, availableAgents);
    }
  }

  /**
   * Parse subtasks from response
   *
   * @private
   */
  _parseSubtasks(responseText, parentTask) {
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return parsed.subtasks.map((st, index) => ({
        description: st.description,
        estimatedTime: st.estimatedTime || 15,
        dependencies: st.dependencies || [],
        requiredSkills: st.requiredSkills || [],
        parentTaskId: parentTask.id,
        order: index + 1,
      }));
    } catch (error) {
      llmLogger.error('Failed to parse subtasks:', error);
      return [];
    }
  }

  /**
   * Parse conflict resolution response
   *
   * @private
   */
  _parseConflictResolution(responseText) {
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const resolution = JSON.parse(jsonMatch[0]);

      return {
        decision: resolution.decision,
        chosenPosition: resolution.chosenPosition,
        reasoning: resolution.reasoning || '',
        confidence: resolution.confidence || 0.5,
      };
    } catch (error) {
      llmLogger.error('Failed to parse conflict resolution:', error);
      return { decision: 'Unable to resolve', confidence: 0 };
    }
  }

  /**
   * Parse strategy response
   *
   * @private
   */
  _parseStrategy(responseText) {
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      llmLogger.error('Failed to parse strategy:', error);
      return {
        approach: 'sequential',
        steps: ['Execute task'],
        resourceAllocation: { agents: 1, estimatedTime: 30 },
        risks: [],
        successCriteria: [],
      };
    }
  }

  // ==========================================
  // Fallback Methods (When LLM unavailable)
  // ==========================================

  /**
   * Fallback task analysis using heuristics
   *
   * @private
   */
  _fallbackTaskAnalysis(task = {}) {
    const descLength = (task.description || '').length;
    const complexity = Math.min(10, Math.max(1, Math.ceil(descLength / 50)));

    return {
      complexity,
      estimatedTime: complexity * 5,
      requiredSkills: [],
      recommendedAgents: complexity > 7 ? 3 : 1,
      canParallelize: complexity > 7,
      riskLevel: complexity > 7 ? 'High' : 'Low',
      reasoning: 'Fallback heuristic analysis (LLM unavailable)',
    };
  }

  /**
   * Fallback agent recommendation
   *
   * @private
   */
  _fallbackAgentRecommendation(task, availableAgents) {
    // Choose first available agent
    const agent = availableAgents.find((a) => a.status === 'active') || availableAgents[0];

    return {
      agentId: agent?.id || 'unknown',
      confidence: 0.3,
      reasoning: 'Fallback selection (LLM unavailable)',
    };
  }

  /**
   * Fallback conflict resolution using majority vote
   *
   * @private
   */
  _fallbackConflictResolution(opinions) {
    // Count votes for each position
    const votes = {};
    opinions.forEach((op) => {
      votes[op.position] = (votes[op.position] || 0) + 1;
    });

    // Find majority
    const majority = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];

    return {
      decision: majority[0],
      chosenPosition: 'majority',
      reasoning: `Majority vote: ${majority[1]}/${opinions.length} agents`,
      confidence: majority[1] / opinions.length,
    };
  }

  /**
   * Set LLM model
   *
   * @param {string} model - Model name (e.g., 'qwen2:7b', 'llama2', 'mistral')
   */
  setModel(model) {
    this.model = model;
    llmLogger.info(`LLM model set to: ${model}`);
  }

  /**
   * Set temperature
   *
   * @param {number} temperature - Temperature (0.0-1.0)
   */
  setTemperature(temperature) {
    this.temperature = Math.max(0, Math.min(1, temperature));
    llmLogger.info(`LLM temperature set to: ${this.temperature}`);
  }
}

module.exports = CoworkLLMIntegration;
