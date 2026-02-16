# collaboration-session-manager

**Source**: `src/main/knowledge/collaboration-session-manager.js`

**Generated**: 2026-02-16T13:44:34.658Z

---

## const

```javascript
const
```

* Collaboration Session Manager
 *
 * Manages real-time collaboration sessions for knowledge base items.
 * Tracks active users, cursor positions, and presence information.
 *
 * Features:
 * - Session lifecycle management
 * - User presence tracking
 * - Cursor position synchronization
 * - Activity monitoring
 * - Session statistics

---

## async createSession(params)

```javascript
async createSession(params)
```

* Create a new collaboration session
   * @param {Object} params - Session parameters
   * @returns {Object} Session info

---

## async updateSession(sessionId, updates)

```javascript
async updateSession(sessionId, updates)
```

* Update session activity (cursor position, selection)
   * @param {string} sessionId - Session ID
   * @param {Object} updates - Updates to apply

---

## async endSession(sessionId)

```javascript
async endSession(sessionId)
```

* End a collaboration session
   * @param {string} sessionId - Session ID

---

## getActiveSessions(knowledgeId)

```javascript
getActiveSessions(knowledgeId)
```

* Get active sessions for a knowledge item
   * @param {string} knowledgeId - Knowledge item ID
   * @returns {Array} Active sessions

---

## getAllActiveSessions()

```javascript
getAllActiveSessions()
```

* Get all active sessions
   * @returns {Object} Map of knowledge ID to sessions

---

## getSessionStats(knowledgeId = null)

```javascript
getSessionStats(knowledgeId = null)
```

* Get session statistics
   * @param {string} knowledgeId - Knowledge item ID (optional)
   * @returns {Object} Statistics

---

## async _broadcastSessionEvent(knowledgeId, event)

```javascript
async _broadcastSessionEvent(knowledgeId, event)
```

* Broadcast session event to peers
   * @private

---

## _startHeartbeatMonitor()

```javascript
_startHeartbeatMonitor()
```

* Start heartbeat monitor to detect inactive sessions
   * @private

---

## _generateUserColor()

```javascript
_generateUserColor()
```

* Generate a random user color
   * @private

---

## async cleanup()

```javascript
async cleanup()
```

* Clean up all sessions

---

