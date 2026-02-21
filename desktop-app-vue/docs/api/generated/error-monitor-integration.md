# error-monitor-integration

**Source**: `src/main/cowork/integrations/error-monitor-integration.js`

**Generated**: 2026-02-21T20:04:16.257Z

---

## const

```javascript
const
```

* ErrorMonitor Integration for Cowork
 *
 * Sends Cowork errors to the ErrorMonitor system for AI-powered diagnosis
 * and automatic fix suggestions.
 *
 * @module CoworkErrorMonitorIntegration

---

## async reportError(params)

```javascript
async reportError(params)
```

* Report Cowork error to ErrorMonitor
   *
   * @param {Object} params - Error parameters
   * @param {Error} params.error - Error object
   * @param {string} params.category - Error category
   * @param {Object} params.context - Error context
   * @param {string} params.severity - Error severity (low, medium, high, critical)
   * @returns {Promise<Object>} Error report result

---

## async reportTaskFailure(task, error)

```javascript
async reportTaskFailure(task, error)
```

* Report task execution failure
   *
   * @param {Object} task - Failed task
   * @param {Error} error - Error that occurred
   * @returns {Promise<Object>} Report result with fix suggestions

---

## async reportPermissionDenied(params)

```javascript
async reportPermissionDenied(params)
```

* Report permission denial
   *
   * @param {Object} params - Permission denial parameters
   * @returns {Promise<Object>} Report result

---

## async reportFileOperationFailure(params, error)

```javascript
async reportFileOperationFailure(params, error)
```

* Report file operation failure
   *
   * @param {Object} params - File operation parameters
   * @param {Error} error - Error that occurred
   * @returns {Promise<Object>} Report result

---

## async reportDatabaseError(error, context =

```javascript
async reportDatabaseError(error, context =
```

* Report database error
   *
   * @param {Error} error - Database error
   * @param {Object} context - Error context
   * @returns {Promise<Object>} Report result

---

## async reportIPCError(error, context =

```javascript
async reportIPCError(error, context =
```

* Report IPC communication error
   *
   * @param {Error} error - IPC error
   * @param {Object} context - Error context
   * @returns {Promise<Object>} Report result

---

## async reportAgentCommunicationFailure(params, error)

```javascript
async reportAgentCommunicationFailure(params, error)
```

* Report agent communication failure
   *
   * @param {Object} params - Communication parameters
   * @param {Error} error - Error that occurred
   * @returns {Promise<Object>} Report result

---

## async reportSkillExecutionFailure(params, error)

```javascript
async reportSkillExecutionFailure(params, error)
```

* Report skill execution failure
   *
   * @param {Object} params - Skill execution parameters
   * @param {Error} error - Error that occurred
   * @returns {Promise<Object>} Report result

---

## async getErrorStats(filters =

```javascript
async getErrorStats(filters =
```

* Get error statistics from ErrorMonitor
   *
   * @param {Object} filters - Query filters
   * @returns {Promise<Object>} Error statistics

---

## async getRecentDiagnoses(limit = 10)

```javascript
async getRecentDiagnoses(limit = 10)
```

* Get AI diagnosis for recent errors
   *
   * @param {number} limit - Number of recent errors to analyze
   * @returns {Promise<Array>} Diagnoses

---

## async applySuggestedFix(errorId)

```javascript
async applySuggestedFix(errorId)
```

* Apply suggested fix for an error
   *
   * @param {string} errorId - Error ID
   * @returns {Promise<Object>} Fix application result

---

