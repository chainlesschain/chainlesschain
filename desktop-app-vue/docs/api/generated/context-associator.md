# context-associator

**Source**: `src/main/memory/context-associator.js`

**Generated**: 2026-02-16T13:44:34.646Z

---

## const

```javascript
const
```

* ContextAssociator - Intelligent Context Association
 *
 * Provides cross-session knowledge extraction and association:
 * - Knowledge extraction from sessions
 * - Session relationship detection
 * - Conversation context tracking
 * - Topic taxonomy management
 * - Knowledge graph building
 *
 * @module context-associator
 * @version 1.0.0
 * @since 2026-01-18

---

## class ContextAssociator extends EventEmitter

```javascript
class ContextAssociator extends EventEmitter
```

* ContextAssociator class

---

## constructor(options =

```javascript
constructor(options =
```

* Create a ContextAssociator instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - SQLite database instance
   * @param {Object} [options.llmManager] - LLM Manager for AI extraction
   * @param {Object} [options.sessionManager] - SessionManager for session data

---

## async initialize()

```javascript
async initialize()
```

* Initialize the associator

---

## async _ensureTables()

```javascript
async _ensureTables()
```

* Ensure database tables exist
   * @private

---

## async extractKnowledgeFromSession(sessionId, options =

```javascript
async extractKnowledgeFromSession(sessionId, options =
```

* Extract knowledge from a session
   * @param {string} sessionId - Session ID
   * @param {Object} options - Extraction options
   * @returns {Promise<Array>} Extracted knowledge items

---

## async _getSessionMessages(sessionId, limit)

```javascript
async _getSessionMessages(sessionId, limit)
```

* Get session messages
   * @private

---

## async _extractWithLLM(sessionId, messages)

```javascript
async _extractWithLLM(sessionId, messages)
```

* Extract knowledge using LLM
   * @private

---

## _parseLLMResponse(response, sessionId)

```javascript
_parseLLMResponse(response, sessionId)
```

* Parse LLM response into knowledge items
   * @private

---

## async _extractWithRules(sessionId, messages)

```javascript
async _extractWithRules(sessionId, messages)
```

* Extract knowledge using rules
   * @private

---

## _extractTopics(text)

```javascript
_extractTopics(text)
```

* Extract topics from text
   * @private

---

## async _saveKnowledge(knowledge)

```javascript
async _saveKnowledge(knowledge)
```

* Save knowledge to database
   * @private

---

## async _updateConversationContext(sessionId, knowledge)

```javascript
async _updateConversationContext(sessionId, knowledge)
```

* Update conversation context
   * @private

---

## async _findAndCreateAssociations(sessionId, knowledge)

```javascript
async _findAndCreateAssociations(sessionId, knowledge)
```

* Find and create associations with other sessions
   * @private

---

## async _createAssociation(

```javascript
async _createAssociation(
```

* Create a session association
   * @private

---

## async findRelatedSessions(sessionId, options =

```javascript
async findRelatedSessions(sessionId, options =
```

* Find related sessions
   * @param {string} sessionId - Session ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Related sessions

---

## async analyzeConversation(conversationId)

```javascript
async analyzeConversation(conversationId)
```

* Analyze conversation context
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>} Conversation context

---

## async searchKnowledge(query, options =

```javascript
async searchKnowledge(query, options =
```

* Search knowledge
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Matching knowledge items

---

## async getSessionKnowledge(sessionId, options =

```javascript
async getSessionKnowledge(sessionId, options =
```

* Get knowledge for a session
   * @param {string} sessionId - Session ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Knowledge items

---

## async getOrCreateTopic(topicName, options =

```javascript
async getOrCreateTopic(topicName, options =
```

* Get or create a topic
   * @param {string} topicName - Topic name
   * @param {Object} options - Options
   * @returns {Promise<Object>} Topic

---

## async getPopularTopics(options =

```javascript
async getPopularTopics(options =
```

* Get popular topics
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Popular topics

---

## async getStats()

```javascript
async getStats()
```

* Get statistics
   * @returns {Promise<Object>} Statistics

---

