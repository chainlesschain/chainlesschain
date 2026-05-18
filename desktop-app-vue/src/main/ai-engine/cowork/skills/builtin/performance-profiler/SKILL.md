---
name: performance-profiler
display-name: Performance Profiler
description: Application performance profiling - runtime snapshots, benchmarking, memory analysis, startup timing, and bottleneck detection
version: 1.0.0
category: devops
user-invocable: true
tags:
  [performance, profiling, bottleneck, latency, metrics, benchmark, optimize]
capabilities:
  [
    performance-snapshot,
    command-benchmark,
    memory-analysis,
    startup-timing,
    snapshot-comparison,
    script-profiling,
    report-generation,
  ]
tools:
  - process_info
  - command_executor
  - file_reader
instructions: |
  Use this skill to profile application performance at runtime. Captures
  process memory, CPU usage, V8 heap statistics, and event loop lag. Can
  benchmark shell commands, analyze memory growth trends, measure cold
  startup time, compare saved snapshots, profile Node.js scripts, and
  generate comprehensive reports. All measurements use Node.js built-in
  APIs with zero external dependencies.
examples:
  - input: "/performance-profiler --snapshot"
    output: "RSS: 85.3 MB, Heap: 42.1/64.0 MB (65.8%), CPU user: 1.2s, uptime: 312s"
  - input: '/performance-profiler --benchmark "node -e ''console.log(1)" --runs 10'
    output: "10 runs: avg 98.2ms, min 92.1ms, max 112.4ms, stddev 6.1ms"
  - input: "/performance-profiler --memory"
    output: "Heap: 42.1/64.0 MB, growth +1.2 MB/s over 3 samples, GC pressure: moderate"
  - input: '/performance-profiler --startup "node src/main/index.js"'
    output: "Cold startup: 1.34s (command exited with code 0)"
  - input: "/performance-profiler --compare snapshot-before.json snapshot-after.json"
    output: "RSS: +12.5 MB (+14.7%), heapUsed: +8.3 MB (+19.7%), CPU user: +0.4s"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# Performance Profiler

Application performance profiling skill using Node.js built-in APIs.

## Features

| Action    | Command                                  | Description                                  |
| --------- | ---------------------------------------- | -------------------------------------------- |
| Snapshot  | `--snapshot`                             | Capture current process performance snapshot |
| Benchmark | `--benchmark <command> [--runs N]`       | Run a command N times, measure timing stats  |
| Memory    | `--memory`                               | Detailed memory analysis with growth trend   |
| Startup   | `--startup <command>`                    | Measure cold startup time of a command       |
| Compare   | `--compare <file1> <file2>`              | Compare two saved snapshot JSON files        |
| Profile   | `--profile <file.js> [--duration <sec>]` | Profile a Node.js script execution           |
| Report    | `--report [--output <file>]`             | Generate comprehensive performance report    |
| (default) | (no flags)                               | Same as --snapshot                           |

## Output

- All timing in milliseconds or seconds as appropriate
- Memory sizes in human-readable format (MB/GB)
- Benchmark statistics include avg, min, max, and standard deviation
- Snapshot comparison shows absolute and percentage deltas
