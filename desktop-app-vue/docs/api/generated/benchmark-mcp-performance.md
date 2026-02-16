# benchmark-mcp-performance

**Source**: `src/main/mcp/__tests__/benchmark-mcp-performance.js`

**Generated**: 2026-02-16T13:44:34.650Z

---

## const

```javascript
const
```

* MCP Performance Benchmark
 *
 * Measures performance of MCP operations and compares with direct calls.
 * Run with: node src/main/mcp/__tests__/benchmark-mcp-performance.js

---

## async benchmarkConnection()

```javascript
async benchmarkConnection()
```

* Benchmark 1: Connection time

---

## async benchmarkDirectFileRead()

```javascript
async benchmarkDirectFileRead()
```

* Benchmark 2: Direct file read (baseline)

---

## async benchmarkMCPFileRead()

```javascript
async benchmarkMCPFileRead()
```

* Benchmark 3: MCP file read

---

## calculateOverhead()

```javascript
calculateOverhead()
```

* Calculate overhead

---

## generateReport()

```javascript
generateReport()
```

* Generate final report

---

## async run()

```javascript
async run()
```

* Run all benchmarks

---

