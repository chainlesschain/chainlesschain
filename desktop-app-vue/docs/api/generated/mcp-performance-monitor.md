# mcp-performance-monitor

**Source**: `src\main\mcp\mcp-performance-monitor.js`

**Generated**: 2026-01-27T06:44:03.843Z

---

## const

```javascript
const
```

* MCP Performance Monitor
 *
 * Tracks and analyzes performance metrics for MCP operations.
 * Helps identify bottlenecks and measure stdio overhead.
 *
 * @module MCPPerformanceMonitor

---

## recordConnection(serverName, duration, success)

```javascript
recordConnection(serverName, duration, success)
```

* Record connection attempt
   * @param {string} serverName - Server identifier
   * @param {number} duration - Connection time in ms
   * @param {boolean} success - Whether connection succeeded

---

## recordToolCall(serverName, toolName, duration, success, metadata =

```javascript
recordToolCall(serverName, toolName, duration, success, metadata =
```

* Record tool call
   * @param {string} serverName - Server identifier
   * @param {string} toolName - Tool name
   * @param {number} duration - Execution time in ms
   * @param {boolean} success - Whether call succeeded
   * @param {Object} metadata - Additional metadata

---

## recordError(type, error, context =

```javascript
recordError(type, error, context =
```

* Record error
   * @param {string} type - Error type (connection, tool_call, etc.)
   * @param {Error} error - Error object
   * @param {Object} context - Error context

---

## sampleMemory()

```javascript
sampleMemory()
```

* Sample memory usage

---

## setBaseline(type, latency)

```javascript
setBaseline(type, latency)
```

* Set baseline performance (for comparison)
   * @param {string} type - Baseline type (directCall, stdioCall)
   * @param {number} latency - Average latency in ms

---

## getSummary()

```javascript
getSummary()
```

* Get performance summary
   * @returns {Object} Performance summary statistics

---

## generateReport()

```javascript
generateReport()
```

* Generate performance report
   * @returns {string} Formatted report

---

## reset()

```javascript
reset()
```

* Reset all metrics

---

## _getAllToolCallLatencies()

```javascript
_getAllToolCallLatencies()
```

* Get all tool call latencies combined
   * @private

---

## _getOverallToolCallLatency()

```javascript
_getOverallToolCallLatency()
```

* Get overall average tool call latency
   * @private

---

## _getOverallToolCallMinLatency()

```javascript
_getOverallToolCallMinLatency()
```

* Get overall minimum tool call latency
   * @private

---

## _getOverallToolCallMaxLatency()

```javascript
_getOverallToolCallMaxLatency()
```

* Get overall maximum tool call latency
   * @private

---

## _getOverallToolCallP95Latency()

```javascript
_getOverallToolCallP95Latency()
```

* Get overall P95 tool call latency
   * @private

---

