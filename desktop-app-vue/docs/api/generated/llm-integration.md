# llm-integration

**Source**: `src/main/cowork/integrations/llm-integration.js`

**Generated**: 2026-02-15T07:37:13.842Z

---

## const

```javascript
const
```

* LLM (Large Language Model) Integration for Cowork
 *
 * Provides AI-powered decision-making for Cowork agents using Ollama LLM:
 * - Task analysis and decomposition
 * - Agent assignment recommendations
 * - Conflict resolution
 * - Strategy selection
 *
 * @module CoworkLLMIntegration

---

## async analyzeTask(task)

```javascript
async analyzeTask(task)
```

* Analyze task complexity and recommend agent configuration
   *
   * @param {Object} task - Task to analyze
   * @returns {Promise<Object>} Analysis and recommendations

---

## async recommendAgent(params)

```javascript
async recommendAgent(params)
```

* Recommend best agent for a task
   *
   * @param {Object} params - Recommendation parameters
   * @param {Object} params.task - Task to assign
   * @param {Array} params.availableAgents - Available agents
   * @returns {Promise<Object>} Agent recommendation

---

## async decomposeTask(task)

```javascript
async decomposeTask(task)
```

* Decompose complex task into subtasks
   *
   * @param {Object} task - Complex task to decompose
   * @returns {Promise<Array>} Subtasks

---

## async resolveConflict(params)

```javascript
async resolveConflict(params)
```

* Resolve conflict between agents
   *
   * @param {Object} params - Conflict parameters
   * @param {Array} params.conflictingOpinions - Different agent opinions
   * @param {Object} params.context - Conflict context
   * @returns {Promise<Object>} Conflict resolution

---

## async generateStrategy(task, resources)

```javascript
async generateStrategy(task, resources)
```

* Generate task execution strategy
   *
   * @param {Object} task - Task to execute
   * @param {Object} resources - Available resources
   * @returns {Promise<Object>} Execution strategy

---

## _buildTaskAnalysisPrompt(task)

```javascript
_buildTaskAnalysisPrompt(task)
```

* Build task analysis prompt
   *
   * @private

---

## _buildAgentRecommendationPrompt(task, availableAgents)

```javascript
_buildAgentRecommendationPrompt(task, availableAgents)
```

* Build agent recommendation prompt
   *
   * @private

---

## _buildTaskDecompositionPrompt(task)

```javascript
_buildTaskDecompositionPrompt(task)
```

* Build task decomposition prompt
   *
   * @private

---

## _buildConflictResolutionPrompt(opinions, context)

```javascript
_buildConflictResolutionPrompt(opinions, context)
```

* Build conflict resolution prompt
   *
   * @private

---

## _buildStrategyPrompt(task, resources)

```javascript
_buildStrategyPrompt(task, resources)
```

* Build strategy generation prompt
   *
   * @private

---

## _parseTaskAnalysis(responseText)

```javascript
_parseTaskAnalysis(responseText)
```

* Parse task analysis response
   *
   * @private

---

## _parseAgentRecommendation(responseText, availableAgents)

```javascript
_parseAgentRecommendation(responseText, availableAgents)
```

* Parse agent recommendation response
   *
   * @private

---

## _parseSubtasks(responseText, parentTask)

```javascript
_parseSubtasks(responseText, parentTask)
```

* Parse subtasks from response
   *
   * @private

---

## _parseConflictResolution(responseText)

```javascript
_parseConflictResolution(responseText)
```

* Parse conflict resolution response
   *
   * @private

---

## _parseStrategy(responseText)

```javascript
_parseStrategy(responseText)
```

* Parse strategy response
   *
   * @private

---

## _fallbackTaskAnalysis(task =

```javascript
_fallbackTaskAnalysis(task =
```

* Fallback task analysis using heuristics
   *
   * @private

---

## _fallbackAgentRecommendation(task, availableAgents)

```javascript
_fallbackAgentRecommendation(task, availableAgents)
```

* Fallback agent recommendation
   *
   * @private

---

## _fallbackConflictResolution(opinions)

```javascript
_fallbackConflictResolution(opinions)
```

* Fallback conflict resolution using majority vote
   *
   * @private

---

## setModel(model)

```javascript
setModel(model)
```

* Set LLM model
   *
   * @param {string} model - Model name (e.g., 'qwen2:7b', 'llama2', 'mistral')

---

## setTemperature(temperature)

```javascript
setTemperature(temperature)
```

* Set temperature
   *
   * @param {number} temperature - Temperature (0.0-1.0)

---

