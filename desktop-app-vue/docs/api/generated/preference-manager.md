# preference-manager

**Source**: `src/main/memory/preference-manager.js`

**Generated**: 2026-02-17T10:13:18.222Z

---

## const

```javascript
const
```

* PreferenceManager - User Preference Management
 *
 * Manages user preferences, usage history, and search history.
 * Integrates with the Memory Bank system for persistent storage.
 *
 * Features:
 * - CRUD operations for preferences by category/key
 * - Usage history recording and analysis
 * - Search history with suggestions
 * - File-based backup to .chainlesschain/memory/preferences/
 *
 * @module preference-manager
 * @version 1.0.0
 * @since 2026-01-17

---

## class PreferenceManager extends EventEmitter

```javascript
class PreferenceManager extends EventEmitter
```

* PreferenceManager class

---

## constructor(options =

```javascript
constructor(options =
```

* Create a PreferenceManager instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - SQLite database instance
   * @param {string} options.preferencesDir - Directory for preference backups

---

## async initialize()

```javascript
async initialize()
```

* Initialize the manager (ensure tables and directories exist)

---

## async _ensureTables()

```javascript
async _ensureTables()
```

* Ensure database tables exist
   * @private

---

## async _loadCache()

```javascript
async _loadCache()
```

* Load all preferences into cache
   * @private

---

## async get(category, key, defaultValue = null)

```javascript
async get(category, key, defaultValue = null)
```

* Get a preference value
   * @param {string} category - Preference category
   * @param {string} key - Preference key
   * @param {*} defaultValue - Default value if not found
   * @returns {Promise<*>} The preference value

---

## async set(category, key, value, options =

```javascript
async set(category, key, value, options =
```

* Set a preference value
   * @param {string} category - Preference category
   * @param {string} key - Preference key
   * @param {*} value - The value to set
   * @param {Object} options - Additional options
   * @param {string} [options.description] - Description of the preference
   * @returns {Promise<boolean>} Success status

---

## async delete(category, key)

```javascript
async delete(category, key)
```

* Delete a preference
   * @param {string} category - Preference category
   * @param {string} key - Preference key
   * @returns {Promise<boolean>} Success status

---

## async getCategory(category)

```javascript
async getCategory(category)
```

* Get all preferences in a category
   * @param {string} category - Preference category
   * @returns {Promise<Object>} Object with all key-value pairs

---

## async setCategory(category, values)

```javascript
async setCategory(category, values)
```

* Set multiple preferences in a category
   * @param {string} category - Preference category
   * @param {Object} values - Object with key-value pairs
   * @returns {Promise<boolean>} Success status

---

## async getAll()

```javascript
async getAll()
```

* Get all preferences
   * @returns {Promise<Object>} Object with categories as keys

---

## async recordUsage(feature, options =

```javascript
async recordUsage(feature, options =
```

* Record a feature usage event
   * @param {string} feature - Feature name
   * @param {Object} options - Additional options
   * @param {string} [options.action] - Action performed
   * @param {Object} [options.metadata] - Additional metadata
   * @param {number} [options.durationMs] - Duration in milliseconds
   * @param {boolean} [options.success=true] - Whether the action succeeded
   * @returns {Promise<string>} The usage record ID

---

## async getRecentHistory(options =

```javascript
async getRecentHistory(options =
```

* Get recent usage history
   * @param {Object} options - Query options
   * @param {string} [options.feature] - Filter by feature
   * @param {number} [options.limit=50] - Maximum records
   * @param {number} [options.days=7] - Number of days to look back
   * @returns {Promise<Array>} Usage records

---

## async getUsageStats(options =

```javascript
async getUsageStats(options =
```

* Get usage statistics
   * @param {Object} options - Query options
   * @param {number} [options.days=7] - Number of days to analyze
   * @returns {Promise<Object>} Usage statistics

---

## async addSearchHistory(query, options =

```javascript
async addSearchHistory(query, options =
```

* Add a search query to history
   * @param {string} query - The search query
   * @param {Object} options - Additional options
   * @param {string} [options.context] - Search context
   * @param {number} [options.resultCount=0] - Number of results
   * @param {string} [options.selectedResult] - Selected result ID/title
   * @param {number} [options.selectedPosition] - Position of selected result
   * @returns {Promise<string>} The search record ID

---

## async getSearchHistory(options =

```javascript
async getSearchHistory(options =
```

* Get search history
   * @param {Object} options - Query options
   * @param {string} [options.context] - Filter by context
   * @param {number} [options.limit=20] - Maximum records
   * @returns {Promise<Array>} Search records

---

## async getSearchSuggestions(prefix, options =

```javascript
async getSearchSuggestions(prefix, options =
```

* Get search suggestions based on history
   * @param {string} prefix - Query prefix
   * @param {Object} options - Options
   * @param {number} [options.limit=5] - Maximum suggestions
   * @returns {Promise<Array>} Search suggestions

---

## async clearSearchHistory(options =

```javascript
async clearSearchHistory(options =
```

* Clear search history
   * @param {Object} options - Options
   * @param {number} [options.olderThanDays] - Clear records older than N days
   * @returns {Promise<number>} Number of deleted records

---

## async _backupCategory(category)

```javascript
async _backupCategory(category)
```

* Backup a category to file
   * @private
   * @param {string} category - Category to backup

---

## async backupAll()

```javascript
async backupAll()
```

* Backup all preferences to files
   * @returns {Promise<Object>} Backup result

---

## async restoreFromBackup(options =

```javascript
async restoreFromBackup(options =
```

* Restore preferences from backup files
   * @param {Object} options - Options
   * @param {boolean} [options.overwrite=false] - Overwrite existing preferences
   * @returns {Promise<Object>} Restore result

---

## async getStats()

```javascript
async getStats()
```

* Get statistics about stored preferences
   * @returns {Promise<Object>} Statistics

---

## clearCache()

```javascript
clearCache()
```

* Clear the in-memory cache

---

## async cleanup(options =

```javascript
async cleanup(options =
```

* Cleanup old records
   * @param {Object} options - Options
   * @param {number} [options.usageHistoryDays=90] - Keep usage records for N days
   * @param {number} [options.searchHistoryDays=30] - Keep search records for N days
   * @returns {Promise<Object>} Cleanup result

---

