# benchmark-mcp-performance

**Source**: `src/main/mcp/__tests__/benchmark-mcp-performance.js`

**Generated**: 2026-03-16T05:44:52.449Z

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

