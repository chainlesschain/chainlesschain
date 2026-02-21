# rag-integration

**Source**: `src/main/cowork/integrations/rag-integration.js`

**Generated**: 2026-02-21T22:04:25.842Z

---

## const

```javascript
const
```

* RAG (Retrieval-Augmented Generation) Integration for Cowork
 *
 * Allows Cowork agents to query the RAG knowledge base for:
 * - Task-relevant information
 * - Historical decisions
 * - Domain knowledge
 * - Best practices
 *
 * @module CoworkRAGIntegration

---

## async queryKnowledge(params)

```javascript
async queryKnowledge(params)
```

* Query RAG for task-relevant information
   *
   * @param {Object} params - Query parameters
   * @param {string} params.query - Natural language query
   * @param {string} params.teamId - Team ID for context
   * @param {string} params.taskType - Task type (office, coding, etc.)
   * @param {number} params.limit - Max results to return
   * @returns {Promise<Object>} Query results with relevant documents

---

## async findSimilarTasks(task)

```javascript
async findSimilarTasks(task)
```

* Query for similar past tasks
   *
   * @param {Object} task - Current task
   * @returns {Promise<Array>} Similar past tasks

---

## async storeTaskSolution(params)

```javascript
async storeTaskSolution(params)
```

* Store task solution in knowledge base
   *
   * @param {Object} params - Storage parameters
   * @param {Object} params.task - Completed task
   * @param {Object} params.solution - Task solution
   * @param {Object} params.metadata - Additional metadata
   * @returns {Promise<boolean>} Success status

---

## async queryDomainKnowledge(domain, question)

```javascript
async queryDomainKnowledge(domain, question)
```

* Query for domain knowledge
   *
   * @param {string} domain - Domain name (e.g., "Excel formulas", "Python debugging")
   * @param {string} question - Specific question
   * @returns {Promise<Object>} Domain knowledge

---

## _buildEnhancedQuery(query, taskType)

```javascript
_buildEnhancedQuery(query, taskType)
```

* Build enhanced query with context
   *
   * @private
   * @param {string} query - Original query
   * @param {string} taskType - Task type
   * @returns {string} Enhanced query

---

## _processResults(results, query)

```javascript
_processResults(results, query)
```

* Process and rank RAG results
   *
   * @private
   * @param {Array} results - Raw RAG results
   * @param {string} query - Original query
   * @returns {Object} Processed results

---

## clearCache()

```javascript
clearCache()
```

* Clear query cache

---

## getCacheStats()

```javascript
getCacheStats()
```

* Get cache statistics
   *
   * @returns {Object} Cache stats

---

