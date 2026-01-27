# dashboard-ipc

**Source**: `src\main\organization\dashboard-ipc.js`

**Generated**: 2026-01-27T06:44:03.836Z

---

## const

```javascript
const
```

* Enterprise Dashboard IPC Handlers
 *
 * Provides data for the enterprise dashboard including:
 * - Statistics and metrics
 * - Activity analytics
 * - Member engagement
 * - Knowledge graph visualization
 * - Storage and resource usage

---

## function registerDashboardIPC(

```javascript
function registerDashboardIPC(
```

* Register all dashboard IPC handlers
 * @param {Object} dependencies
 * @param {Object} dependencies.database - Database manager
 * @param {Object} dependencies.organizationManager - Organization manager

---

## async function getStats(database, organizationManager, orgId, dateRange)

```javascript
async function getStats(database, organizationManager, orgId, dateRange)
```

* Get dashboard statistics

---

## async function getTopContributors(database, orgId, limit)

```javascript
async function getTopContributors(database, orgId, limit)
```

* Get top contributors

---

## async function getRecentActivities(database, orgId, limit)

```javascript
async function getRecentActivities(database, orgId, limit)
```

* Get recent activities

---

## async function getRoleStats(database, orgId)

```javascript
async function getRoleStats(database, orgId)
```

* Get role statistics

---

## async function getActivityTimeline(database, orgId, days)

```javascript
async function getActivityTimeline(database, orgId, days)
```

* Get activity timeline

---

## async function getActivityBreakdown(database, orgId)

```javascript
async function getActivityBreakdown(database, orgId)
```

* Get activity breakdown

---

## async function getKnowledgeGraph(database, orgId)

```javascript
async function getKnowledgeGraph(database, orgId)
```

* Get knowledge graph data

---

## async function getStorageBreakdown(database, orgId)

```javascript
async function getStorageBreakdown(database, orgId)
```

* Get storage breakdown

---

## async function getMemberEngagement(database, orgId)

```javascript
async function getMemberEngagement(database, orgId)
```

* Get member engagement

---

## async function getActivityHeatmap(database, orgId)

```javascript
async function getActivityHeatmap(database, orgId)
```

* Get activity heatmap

---

