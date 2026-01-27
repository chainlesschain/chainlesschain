# learned-pattern-manager

**Source**: `src\main\memory\learned-pattern-manager.js`

**Generated**: 2026-01-27T06:44:03.841Z

---

## const

```javascript
const
```

* LearnedPatternManager - Learned Pattern Management
 *
 * Manages learned patterns from user interactions:
 * - Prompt patterns (successful prompts for reuse)
 * - Error fix patterns (learned error-fix associations)
 * - Code snippets (reusable code snippets)
 * - Workflow patterns (common user workflows)
 *
 * Integrates with ErrorMonitor for automatic pattern learning.
 *
 * @module learned-pattern-manager
 * @version 1.0.0
 * @since 2026-01-17

---

## class LearnedPatternManager extends EventEmitter

```javascript
class LearnedPatternManager extends EventEmitter
```

* LearnedPatternManager class

---

## constructor(options =

```javascript
constructor(options =
```

* Create a LearnedPatternManager instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - SQLite database instance
   * @param {string} options.patternsDir - Directory for pattern backups
   * @param {Object} [options.llmManager] - LLM Manager for AI-powered analysis
   * @param {Object} [options.errorMonitor] - ErrorMonitor for integration

---

## async initialize()

```javascript
async initialize()
```

* Initialize the manager

---

## async _ensureTables()

```javascript
async _ensureTables()
```

* Ensure database tables exist
   * @private

---

## async recordPromptPattern(params)

```javascript
async recordPromptPattern(params)
```

* Record a prompt pattern
   * @param {Object} params - Pattern parameters
   * @param {string} params.template - The prompt template
   * @param {string} [params.category] - Category (coding, writing, etc.)
   * @param {string[]} [params.tags] - Tags
   * @param {string} [params.preferredModel] - Preferred LLM model
   * @param {string} [params.exampleInput] - Example input
   * @param {string} [params.exampleOutput] - Example output
   * @returns {Promise<Object>} The created pattern

---

## async updatePromptPatternUsage(id, options =

```javascript
async updatePromptPatternUsage(id, options =
```

* Update prompt pattern usage and success
   * @param {string} id - Pattern ID
   * @param {Object} options - Update options
   * @param {boolean} [options.success] - Whether the usage was successful
   * @param {number} [options.quality] - Quality score (0-1)

---

## async getPromptSuggestions(context =

```javascript
async getPromptSuggestions(context =
```

* Get prompt suggestions based on context
   * @param {Object} context - Context for suggestions
   * @param {string} [context.category] - Filter by category
   * @param {string[]} [context.tags] - Filter by tags
   * @param {number} [context.limit=5] - Maximum suggestions
   * @returns {Promise<Array>} Prompt suggestions

---

## async searchPromptPatterns(query, options =

```javascript
async searchPromptPatterns(query, options =
```

* Search prompt patterns
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Matching patterns

---

## async recordErrorFix(params)

```javascript
async recordErrorFix(params)
```

* Record an error fix pattern
   * @param {Object} params - Pattern parameters
   * @param {string} params.errorPattern - Regex or substring pattern
   * @param {string} params.errorClassification - Classification
   * @param {string} params.fixStrategy - Fix strategy
   * @param {string[]} [params.fixSteps] - Fix steps
   * @param {string} [params.fixCode] - Fix code
   * @param {boolean} [params.success=true] - Whether fix succeeded
   * @param {string} [params.source='user'] - Source
   * @returns {Promise<Object>} The created pattern

---

## async getErrorFixSuggestions(error, limit = 3)

```javascript
async getErrorFixSuggestions(error, limit = 3)
```

* Get error fix suggestions
   * @param {Object} error - Error object
   * @param {string} error.message - Error message
   * @param {string} [error.classification] - Error classification
   * @param {number} [limit=3] - Maximum suggestions
   * @returns {Promise<Array>} Fix suggestions

---

## async saveCodeSnippet(snippet)

```javascript
async saveCodeSnippet(snippet)
```

* Save a code snippet
   * @param {Object} snippet - Snippet data
   * @param {string} snippet.title - Title
   * @param {string} snippet.language - Programming language
   * @param {string} snippet.code - The code
   * @param {string} [snippet.description] - Description
   * @param {string[]} [snippet.tags] - Tags
   * @param {string} [snippet.source] - Source
   * @returns {Promise<Object>} The saved snippet

---

## async getCodeSnippets(options =

```javascript
async getCodeSnippets(options =
```

* Get code snippets
   * @param {Object} options - Query options
   * @param {string} [options.language] - Filter by language
   * @param {string[]} [options.tags] - Filter by tags
   * @param {boolean} [options.favoritesOnly] - Only favorites
   * @param {number} [options.limit=20] - Maximum results
   * @returns {Promise<Array>} Snippets

---

## async useCodeSnippet(id)

```javascript
async useCodeSnippet(id)
```

* Update snippet usage
   * @param {string} id - Snippet ID

---

## async toggleSnippetFavorite(id)

```javascript
async toggleSnippetFavorite(id)
```

* Toggle snippet favorite status
   * @param {string} id - Snippet ID
   * @returns {Promise<boolean>} New favorite status

---

## async deleteCodeSnippet(id)

```javascript
async deleteCodeSnippet(id)
```

* Delete a snippet
   * @param {string} id - Snippet ID

---

## async recordWorkflow(workflow)

```javascript
async recordWorkflow(workflow)
```

* Record a workflow pattern
   * @param {Object} workflow - Workflow data
   * @param {string} workflow.name - Workflow name
   * @param {Object[]} workflow.steps - Workflow steps
   * @param {string} [workflow.description] - Description
   * @param {string} [workflow.category] - Category
   * @param {Object} [workflow.triggerContext] - When to suggest
   * @returns {Promise<Object>} The recorded workflow

---

## async getWorkflowSuggestions(context =

```javascript
async getWorkflowSuggestions(context =
```

* Get workflow suggestions
   * @param {Object} context - Current context
   * @param {string} [context.category] - Category filter
   * @param {number} [context.limit=5] - Maximum suggestions
   * @returns {Promise<Array>} Workflow suggestions

---

## async updateWorkflowUsage(id, options =

```javascript
async updateWorkflowUsage(id, options =
```

* Update workflow usage
   * @param {string} id - Workflow ID
   * @param {Object} options - Update options
   * @param {boolean} [options.completed] - Whether workflow was completed
   * @param {number} [options.durationMs] - Duration in milliseconds

---

## async getStats()

```javascript
async getStats()
```

* Get statistics
   * @returns {Promise<Object>} Statistics

---

## async backupToFiles()

```javascript
async backupToFiles()
```

* Backup patterns to files
   * @returns {Promise<Object>} Backup result

---

## async cleanup(options =

```javascript
async cleanup(options =
```

* Cleanup old patterns
   * @param {Object} options - Options
   * @param {number} [options.minUseCount=0] - Minimum use count to keep
   * @param {number} [options.olderThanDays=180] - Delete patterns older than N days
   * @returns {Promise<Object>} Cleanup result

---

