# session-integration

**Source**: `src/main/cowork/integrations/session-integration.js`

**Generated**: 2026-02-17T10:13:18.252Z

---

## const

```javascript
const
```

* SessionManager Integration for Cowork
 *
 * Tracks Cowork team sessions with automatic compression and context management.
 * Integrates with ChainlessChain SessionManager for unified session tracking.
 *
 * @module CoworkSessionIntegration

---

## async startSession(team)

```javascript
async startSession(team)
```

* Start a new Cowork session for a team
   *
   * @param {Object} team - Team object
   * @returns {Promise<string>} Session ID

---

## async addEvent(teamId, event)

```javascript
async addEvent(teamId, event)
```

* Add event to team session
   *
   * @param {string} teamId - Team ID
   * @param {Object} event - Event to add
   * @returns {Promise<void>}

---

## async recordAgentAction(teamId, action)

```javascript
async recordAgentAction(teamId, action)
```

* Record agent action in session
   *
   * @param {string} teamId - Team ID
   * @param {Object} action - Agent action
   * @returns {Promise<void>}

---

## async recordTaskAssignment(teamId, task)

```javascript
async recordTaskAssignment(teamId, task)
```

* Record task assignment in session
   *
   * @param {string} teamId - Team ID
   * @param {Object} task - Task
   * @returns {Promise<void>}

---

## async recordTaskCompletion(teamId, task)

```javascript
async recordTaskCompletion(teamId, task)
```

* Record task completion in session
   *
   * @param {string} teamId - Team ID
   * @param {Object} task - Completed task
   * @returns {Promise<void>}

---

## async recordDecision(teamId, decision)

```javascript
async recordDecision(teamId, decision)
```

* Record decision in session
   *
   * @param {string} teamId - Team ID
   * @param {Object} decision - Decision object
   * @returns {Promise<void>}

---

## async endSession(teamId, summary =

```javascript
async endSession(teamId, summary =
```

* End team session
   *
   * @param {string} teamId - Team ID
   * @param {Object} summary - Session summary
   * @returns {Promise<void>}

---

## async getSession(teamId)

```javascript
async getSession(teamId)
```

* Get session for team
   *
   * @param {string} teamId - Team ID
   * @returns {Promise<Object|null>} Session object or null

---

## async getSessionHistory(teamId, options =

```javascript
async getSessionHistory(teamId, options =
```

* Get session history for team
   *
   * @param {string} teamId - Team ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Session history

---

## async compressSession(teamId)

```javascript
async compressSession(teamId)
```

* Compress session using SessionManager auto-compression
   *
   * @param {string} teamId - Team ID
   * @returns {Promise<Object>} Compression result

---

## async searchSession(teamId, query)

```javascript
async searchSession(teamId, query)
```

* Search session content
   *
   * @param {string} teamId - Team ID
   * @param {string} query - Search query
   * @returns {Promise<Array>} Search results

---

## async exportSession(teamId, format = 'json')

```javascript
async exportSession(teamId, format = 'json')
```

* Export session
   *
   * @param {string} teamId - Team ID
   * @param {string} format - Export format (json, markdown, pdf)
   * @returns {Promise<Object>} Export result

---

## _formatEventContent(event)

```javascript
_formatEventContent(event)
```

* Format event content for session
   *
   * @private
   * @param {Object} event - Event object
   * @returns {string} Formatted content

---

## _formatSessionSummary(summary)

```javascript
_formatSessionSummary(summary)
```

* Format session summary
   *
   * @private
   * @param {Object} summary - Summary object
   * @returns {string} Formatted summary

---

## getActiveSessionCount()

```javascript
getActiveSessionCount()
```

* Get active session count
   *
   * @returns {number} Number of active sessions

---

## hasActiveSession(teamId)

```javascript
hasActiveSession(teamId)
```

* Check if team has active session
   *
   * @param {string} teamId - Team ID
   * @returns {boolean} True if session is active

---

