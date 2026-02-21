# usage-report-generator

**Source**: `src/main/memory/usage-report-generator.js`

**Generated**: 2026-02-21T22:04:25.813Z

---

## const

```javascript
const
```

* UsageReportGenerator - Usage Analytics and Report Generation
 *
 * Generates comprehensive usage reports:
 * - Weekly and monthly usage reports
 * - LLM cost analysis and optimization recommendations
 * - Feature usage statistics
 * - Export to Markdown, JSON, CSV formats
 *
 * @module usage-report-generator
 * @version 1.0.0
 * @since 2026-01-18

---

## class UsageReportGenerator extends EventEmitter

```javascript
class UsageReportGenerator extends EventEmitter
```

* UsageReportGenerator class

---

## constructor(options =

```javascript
constructor(options =
```

* Create a UsageReportGenerator instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - SQLite database instance
   * @param {string} options.reportsDir - Directory for report files
   * @param {Object} [options.tokenTracker] - TokenTracker instance for LLM stats
   * @param {Object} [options.configManager] - UnifiedConfigManager instance

---

## async initialize()

```javascript
async initialize()
```

* Initialize the generator

---

## async _ensureTables()

```javascript
async _ensureTables()
```

* Ensure database tables exist
   * @private

---

## _startScheduleChecker()

```javascript
_startScheduleChecker()
```

* Start schedule checker
   * @private

---

## stopScheduleChecker()

```javascript
stopScheduleChecker()
```

* Stop schedule checker

---

## async _checkAndRunSubscriptions()

```javascript
async _checkAndRunSubscriptions()
```

* Check and run due subscriptions
   * @private

---

## _calculateNextGeneration(subscription)

```javascript
_calculateNextGeneration(subscription)
```

* Calculate next generation time
   * @param {Object} subscription - Subscription config
   * @returns {number} Next generation timestamp
   * @private

---

## async generateWeeklyReport(options =

```javascript
async generateWeeklyReport(options =
```

* Generate a weekly report
   * @param {Object} options - Report options
   * @returns {Promise<Object>} Generated report

---

## async generateMonthlyReport(options =

```javascript
async generateMonthlyReport(options =
```

* Generate a monthly report
   * @param {Object} options - Report options
   * @returns {Promise<Object>} Generated report

---

## async generateCostAnalysis(startDate, endDate)

```javascript
async generateCostAnalysis(startDate, endDate)
```

* Generate cost analysis
   * @param {number} startDate - Start timestamp
   * @param {number} endDate - End timestamp
   * @returns {Promise<Object>} Cost analysis

---

## async exportReport(reportId, options =

```javascript
async exportReport(reportId, options =
```

* Export report to file
   * @param {string} reportId - Report ID
   * @param {Object} options - Export options
   * @returns {Promise<Object>} Export result

---

## async _getLLMStats(startDate, endDate)

```javascript
async _getLLMStats(startDate, endDate)
```

* Get LLM usage statistics
   * @param {number} startDate - Start timestamp
   * @param {number} endDate - End timestamp
   * @returns {Promise<Object>} LLM statistics
   * @private

---

## _getEmptyLLMStats()

```javascript
_getEmptyLLMStats()
```

* Get empty LLM stats
   * @private

---

## async _getFeatureStats(startDate, endDate)

```javascript
async _getFeatureStats(startDate, endDate)
```

* Get feature usage statistics
   * @param {number} startDate - Start timestamp
   * @param {number} endDate - End timestamp
   * @returns {Promise<Object>} Feature statistics
   * @private

---

## _getEmptyFeatureStats()

```javascript
_getEmptyFeatureStats()
```

* Get empty feature stats
   * @private

---

## _generateRecommendations(llmStats, featureStats)

```javascript
_generateRecommendations(llmStats, featureStats)
```

* Generate recommendations based on stats
   * @param {Object} llmStats - LLM statistics
   * @param {Object} featureStats - Feature statistics
   * @returns {Array} Recommendations
   * @private

---

## _formatPeriodLabel(startDate, endDate)

```javascript
_formatPeriodLabel(startDate, endDate)
```

* Format period label
   * @param {number} startDate - Start timestamp
   * @param {number} endDate - End timestamp
   * @returns {string} Period label
   * @private

---

## _formatMarkdownReport(report, summary, details, recommendations)

```javascript
_formatMarkdownReport(report, summary, details, recommendations)
```

* Format Markdown report
   * @private

---

## _formatCSVReport(summary, details)

```javascript
_formatCSVReport(summary, details)
```

* Format CSV report
   * @private

---

## async _saveReport(reportData)

```javascript
async _saveReport(reportData)
```

* Save report to database
   * @param {Object} reportData - Report data
   * @returns {Promise<Object>} Saved report
   * @private

---

## async getReport(reportId)

```javascript
async getReport(reportId)
```

* Get report by ID
   * @param {string} reportId - Report ID
   * @returns {Promise<Object|null>} Report or null

---

## async listReports(options =

```javascript
async listReports(options =
```

* List reports
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of reports

---

## async configureSubscription(config)

```javascript
async configureSubscription(config)
```

* Configure subscription
   * @param {Object} config - Subscription config
   * @returns {Promise<Object>} Created subscription

---

## async getSubscriptions()

```javascript
async getSubscriptions()
```

* Get subscriptions
   * @returns {Promise<Array>} List of subscriptions

---

## async deleteSubscription(id)

```javascript
async deleteSubscription(id)
```

* Delete subscription
   * @param {string} id - Subscription ID

---

