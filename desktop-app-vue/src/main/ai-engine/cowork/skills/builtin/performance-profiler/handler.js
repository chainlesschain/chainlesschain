/**
 * Performance Profiler Skill Handler
 *
 * Runtime performance profiling: process snapshots, command benchmarking,
 * memory analysis with growth trends, cold startup timing, snapshot
 * comparison, Node.js script profiling, and comprehensive report
 * generation. Uses only Node.js built-in APIs (no external dependencies).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, execFileSync } = require("child_process");
const { logger } = require("../../../../../utils/logger.js");

// ── Helpers ────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(2)} ${units[i]}`;
}

function formatMs(ms) {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(0)}us`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  }
  return `${(ms / 1000).toFixed(3)}s`;
}

function stddev(values, avg) {
  if (values.length < 2) {
    return 0;
  }
  const squareDiffs = values.map((v) => Math.pow(v - avg, 2));
  const avgSquareDiff =
    squareDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1);
  return Math.sqrt(avgSquareDiff);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hrtimeMs() {
  const t = process.hrtime.bigint();
  return Number(t) / 1e6;
}

function parseInput(input) {
  const parts = [];
  // Respect quoted strings when splitting
  const regex = /(?:"([^"]*)")|(?:'([^']*)')|(\S+)/g;
  let m;
  while ((m = regex.exec(input)) !== null) {
    parts.push(m[1] || m[2] || m[3]);
  }

  let action = "snapshot";
  let command = "";
  let runs = 5;
  let file1 = "";
  let file2 = "";
  let targetFile = "";
  let duration = 5;
  let outputFile = "";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--snapshot" || p === "snapshot") {
      action = "snapshot";
    } else if (p === "--benchmark" || p === "benchmark") {
      action = "benchmark";
      if (i + 1 < parts.length && !parts[i + 1].startsWith("--")) {
        command = parts[++i];
      }
    } else if (p === "--memory" || p === "memory") {
      action = "memory";
    } else if (p === "--startup" || p === "startup") {
      action = "startup";
      if (i + 1 < parts.length && !parts[i + 1].startsWith("--")) {
        command = parts[++i];
      }
    } else if (p === "--compare" || p === "compare") {
      action = "compare";
      if (i + 1 < parts.length && !parts[i + 1].startsWith("--")) {
        file1 = parts[++i];
      }
      if (i + 1 < parts.length && !parts[i + 1].startsWith("--")) {
        file2 = parts[++i];
      }
    } else if (p === "--profile" || p === "profile") {
      action = "profile";
      if (i + 1 < parts.length && !parts[i + 1].startsWith("--")) {
        targetFile = parts[++i];
      }
    } else if (p === "--report" || p === "report") {
      action = "report";
    } else if (p === "--runs") {
      const n = parseInt(parts[++i], 10);
      if (!isNaN(n) && n > 0 && n <= 100) {
        runs = n;
      }
    } else if (p === "--duration") {
      const d = parseInt(parts[++i], 10);
      if (!isNaN(d) && d > 0 && d <= 60) {
        duration = d;
      }
    } else if (p === "--output") {
      if (i + 1 < parts.length) {
        outputFile = parts[++i];
      }
    }
  }

  return {
    action,
    command,
    runs,
    file1,
    file2,
    targetFile,
    duration,
    outputFile,
  };
}

// ── Actions ───────────────────────────────────────────────────────

function captureSnapshot() {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const uptime = process.uptime();

  const snapshot = {
    timestamp: new Date().toISOString(),
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers || 0,
    },
    cpu: {
      user: cpu.user,
      system: cpu.system,
      userSeconds: (cpu.user / 1e6).toFixed(3),
      systemSeconds: (cpu.system / 1e6).toFixed(3),
    },
    uptime: parseFloat(uptime.toFixed(2)),
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    pid: process.pid,
  };

  // Try V8 heap stats
  try {
    const v8 = require("v8");
    const heapStats = v8.getHeapStatistics();
    snapshot.v8Heap = {
      totalHeapSize: heapStats.total_heap_size,
      usedHeapSize: heapStats.used_heap_size,
      heapSizeLimit: heapStats.heap_size_limit,
      mallocedMemory: heapStats.malloced_memory,
      peakMallocedMemory: heapStats.peak_malloced_memory,
      totalAvailableSize: heapStats.total_available_size,
      numberOfNativeContexts: heapStats.number_of_native_contexts,
      numberOfDetachedContexts: heapStats.number_of_detached_contexts,
    };
  } catch {
    // v8 not available
  }

  // Event loop lag estimation
  const lagStart = hrtimeMs();
  // Synchronous measurement: compare hrtime precision
  const lagEnd = hrtimeMs();
  snapshot.eventLoopLagMs = parseFloat((lagEnd - lagStart).toFixed(3));

  return snapshot;
}

function doSnapshot() {
  const snapshot = captureSnapshot();

  const heapPercent =
    snapshot.memory.heapTotal > 0
      ? ((snapshot.memory.heapUsed / snapshot.memory.heapTotal) * 100).toFixed(
          1,
        )
      : "0.0";

  const lines = [
    "## Performance Snapshot",
    `**Timestamp**: ${snapshot.timestamp}`,
    `**PID**: ${snapshot.pid} | **Node**: ${snapshot.nodeVersion} | **Platform**: ${snapshot.platform}/${snapshot.arch}`,
    "",
    "### Memory",
    `  RSS:          ${formatBytes(snapshot.memory.rss)}`,
    `  Heap Used:    ${formatBytes(snapshot.memory.heapUsed)} / ${formatBytes(snapshot.memory.heapTotal)} (${heapPercent}%)`,
    `  External:     ${formatBytes(snapshot.memory.external)}`,
    `  ArrayBuffers: ${formatBytes(snapshot.memory.arrayBuffers)}`,
  ];

  if (snapshot.v8Heap) {
    lines.push(
      "",
      "### V8 Heap",
      `  Heap Size Limit: ${formatBytes(snapshot.v8Heap.heapSizeLimit)}`,
      `  Total Available: ${formatBytes(snapshot.v8Heap.totalAvailableSize)}`,
      `  Malloced:        ${formatBytes(snapshot.v8Heap.mallocedMemory)}`,
      `  Peak Malloced:   ${formatBytes(snapshot.v8Heap.peakMallocedMemory)}`,
      `  Native Contexts: ${snapshot.v8Heap.numberOfNativeContexts}`,
      `  Detached Contexts: ${snapshot.v8Heap.numberOfDetachedContexts}`,
    );
  }

  lines.push(
    "",
    "### CPU",
    `  User:   ${snapshot.cpu.userSeconds}s`,
    `  System: ${snapshot.cpu.systemSeconds}s`,
    "",
    `**Uptime**: ${snapshot.uptime}s`,
    `**Event Loop Lag**: ${formatMs(snapshot.eventLoopLagMs)}`,
  );

  return {
    success: true,
    result: snapshot,
    message: lines.join("\n"),
  };
}

function doBenchmark(command, runs, projectRoot) {
  if (!command) {
    return {
      success: false,
      error: "No command specified",
      message: "Usage: --benchmark <command> [--runs N]",
    };
  }

  const timings = [];
  const errors = [];

  for (let i = 0; i < runs; i++) {
    const start = hrtimeMs();
    try {
      execSync(command, {
        cwd: projectRoot,
        encoding: "utf-8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      errors.push({ run: i + 1, message: err.message.slice(0, 120) });
    }
    const elapsed = hrtimeMs() - start;
    timings.push(elapsed);
  }

  if (timings.length === 0) {
    return {
      success: false,
      error: "All runs failed",
      message: `Benchmark failed: all ${runs} runs errored.`,
    };
  }

  const avg = timings.reduce((s, v) => s + v, 0) / timings.length;
  const min = Math.min(...timings);
  const max = Math.max(...timings);
  const sd = stddev(timings, avg);

  const result = {
    command,
    runs,
    successfulRuns: timings.length - errors.length,
    failedRuns: errors.length,
    timings: timings.map((t) => parseFloat(t.toFixed(3))),
    stats: {
      avg: parseFloat(avg.toFixed(3)),
      min: parseFloat(min.toFixed(3)),
      max: parseFloat(max.toFixed(3)),
      stddev: parseFloat(sd.toFixed(3)),
      median: (() => {
        const sorted = timings.slice().sort((a, b) => a - b);
        return parseFloat(sorted[Math.floor(timings.length / 2)].toFixed(3));
      })(),
    },
    errors: errors.length > 0 ? errors : undefined,
  };

  const lines = [
    "## Benchmark Results",
    `**Command**: \`${command}\``,
    `**Runs**: ${runs} (${result.successfulRuns} succeeded, ${result.failedRuns} failed)`,
    "",
    "### Timing Statistics",
    `  Average:  ${formatMs(result.stats.avg)}`,
    `  Median:   ${formatMs(result.stats.median)}`,
    `  Min:      ${formatMs(result.stats.min)}`,
    `  Max:      ${formatMs(result.stats.max)}`,
    `  Std Dev:  ${formatMs(result.stats.stddev)}`,
  ];

  if (errors.length > 0) {
    lines.push(
      "",
      "### Errors",
      ...errors.map((e) => `  Run ${e.run}: ${e.message}`),
    );
  }

  return { success: true, result, message: lines.join("\n") };
}

async function doMemoryAnalysis() {
  const samples = [];
  const sampleCount = 3;
  const intervalMs = 500;

  for (let i = 0; i < sampleCount; i++) {
    const mem = process.memoryUsage();
    samples.push({
      timestamp: Date.now(),
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
    });
    if (i < sampleCount - 1) {
      await sleep(intervalMs);
    }
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const durationSec = (last.timestamp - first.timestamp) / 1000;

  const heapGrowth = last.heapUsed - first.heapUsed;
  const rssGrowth = last.rss - first.rss;
  const heapGrowthPerSec = durationSec > 0 ? heapGrowth / durationSec : 0;
  const rssGrowthPerSec = durationSec > 0 ? rssGrowth / durationSec : 0;

  // GC pressure estimation based on heap used ratio and growth
  const heapRatio = last.heapUsed / last.heapTotal;
  let gcPressure = "low";
  if (heapRatio > 0.85 || Math.abs(heapGrowthPerSec) > 5 * 1024 * 1024) {
    gcPressure = "high";
  } else if (heapRatio > 0.7 || Math.abs(heapGrowthPerSec) > 1 * 1024 * 1024) {
    gcPressure = "moderate";
  }

  const heapPercent =
    last.heapTotal > 0
      ? ((last.heapUsed / last.heapTotal) * 100).toFixed(1)
      : "0.0";

  const result = {
    samples: samples.map((s) => ({
      rss: s.rss,
      heapUsed: s.heapUsed,
      heapTotal: s.heapTotal,
    })),
    current: {
      rss: last.rss,
      heapUsed: last.heapUsed,
      heapTotal: last.heapTotal,
      external: last.external,
      heapUsedPercent: parseFloat(heapPercent),
    },
    trend: {
      heapGrowthBytes: heapGrowth,
      heapGrowthPerSec: parseFloat(heapGrowthPerSec.toFixed(0)),
      rssGrowthBytes: rssGrowth,
      rssGrowthPerSec: parseFloat(rssGrowthPerSec.toFixed(0)),
      durationSec: parseFloat(durationSec.toFixed(2)),
      sampleCount,
    },
    gcPressure,
  };

  const growthSign = heapGrowthPerSec >= 0 ? "+" : "";

  const lines = [
    "## Memory Analysis",
    "",
    "### Current Usage",
    `  RSS:        ${formatBytes(last.rss)}`,
    `  Heap Used:  ${formatBytes(last.heapUsed)} / ${formatBytes(last.heapTotal)} (${heapPercent}%)`,
    `  External:   ${formatBytes(last.external)}`,
    "",
    `### Growth Trend (${sampleCount} samples over ${durationSec.toFixed(1)}s)`,
    `  Heap Growth: ${growthSign}${formatBytes(heapGrowthPerSec)}/s`,
    `  RSS Growth:  ${rssGrowthPerSec >= 0 ? "+" : ""}${formatBytes(rssGrowthPerSec)}/s`,
    "",
    `### GC Pressure: **${gcPressure}**`,
    gcPressure === "high"
      ? "  Warning: High heap utilization or rapid growth detected."
      : gcPressure === "moderate"
        ? "  Heap usage is elevated; monitor for sustained growth."
        : "  Heap usage looks healthy.",
  ];

  return { success: true, result, message: lines.join("\n") };
}

function doStartup(command, projectRoot) {
  if (!command) {
    return {
      success: false,
      error: "No command specified",
      message: "Usage: --startup <command>",
    };
  }

  let exitCode = 0;
  let stdout = "";
  let stderr = "";

  const start = hrtimeMs();
  try {
    stdout = execSync(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    exitCode = err.status || 1;
    stderr = (err.stderr || "").slice(0, 500);
    stdout = (err.stdout || "").slice(0, 500);
  }
  const elapsed = hrtimeMs() - start;

  const result = {
    command,
    startupMs: parseFloat(elapsed.toFixed(3)),
    exitCode,
    stdoutLength: (stdout || "").length,
    stderrPreview: stderr || undefined,
  };

  const lines = [
    "## Startup Timing",
    `**Command**: \`${command}\``,
    `**Cold Startup**: ${formatMs(elapsed)}`,
    `**Exit Code**: ${exitCode}`,
  ];

  if (stderr) {
    lines.push("", "### Stderr (preview)", `  ${stderr.slice(0, 200)}`);
  }

  return { success: true, result, message: lines.join("\n") };
}

function doCompare(file1, file2, projectRoot) {
  if (!file1 || !file2) {
    return {
      success: false,
      error: "Two snapshot files required",
      message: "Usage: --compare <snapshot1.json> <snapshot2.json>",
    };
  }

  const resolve = (f) =>
    path.isAbsolute(f) ? f : path.resolve(projectRoot, f);

  let snap1, snap2;
  try {
    snap1 = JSON.parse(fs.readFileSync(resolve(file1), "utf-8"));
  } catch (err) {
    return {
      success: false,
      error: `Cannot read ${file1}: ${err.message}`,
      message: `Failed to read first snapshot: ${err.message}`,
    };
  }
  try {
    snap2 = JSON.parse(fs.readFileSync(resolve(file2), "utf-8"));
  } catch (err) {
    return {
      success: false,
      error: `Cannot read ${file2}: ${err.message}`,
      message: `Failed to read second snapshot: ${err.message}`,
    };
  }

  function delta(a, b, label) {
    if (typeof a !== "number" || typeof b !== "number") {
      return null;
    }
    const diff = b - a;
    const pct = a !== 0 ? ((diff / a) * 100).toFixed(1) : "N/A";
    return { label, before: a, after: b, diff, percent: pct };
  }

  const mem1 = snap1.memory || {};
  const mem2 = snap2.memory || {};
  const cpu1 = snap1.cpu || {};
  const cpu2 = snap2.cpu || {};

  const deltas = [
    delta(mem1.rss, mem2.rss, "RSS"),
    delta(mem1.heapUsed, mem2.heapUsed, "Heap Used"),
    delta(mem1.heapTotal, mem2.heapTotal, "Heap Total"),
    delta(mem1.external, mem2.external, "External"),
    delta(cpu1.user, cpu2.user, "CPU User (us)"),
    delta(cpu1.system, cpu2.system, "CPU System (us)"),
    delta(snap1.uptime, snap2.uptime, "Uptime (s)"),
  ].filter(Boolean);

  const result = {
    file1: path.basename(file1),
    file2: path.basename(file2),
    timestamp1: snap1.timestamp,
    timestamp2: snap2.timestamp,
    deltas,
  };

  const lines = [
    "## Snapshot Comparison",
    `**Before**: ${path.basename(file1)} (${snap1.timestamp || "unknown"})`,
    `**After**: ${path.basename(file2)} (${snap2.timestamp || "unknown"})`,
    "",
    "### Deltas",
    "| Metric | Before | After | Delta | Change |",
    "| ------ | ------ | ----- | ----- | ------ |",
  ];

  for (const d of deltas) {
    const sign = d.diff >= 0 ? "+" : "";
    const isMemory = ["RSS", "Heap Used", "Heap Total", "External"].includes(
      d.label,
    );
    const fmtBefore = isMemory ? formatBytes(d.before) : d.before;
    const fmtAfter = isMemory ? formatBytes(d.after) : d.after;
    const fmtDiff = isMemory
      ? `${sign}${formatBytes(d.diff)}`
      : `${sign}${d.diff}`;
    lines.push(
      `| ${d.label} | ${fmtBefore} | ${fmtAfter} | ${fmtDiff} | ${sign}${d.percent}% |`,
    );
  }

  return { success: true, result, message: lines.join("\n") };
}

function doProfile(targetFile, duration, projectRoot) {
  if (!targetFile) {
    return {
      success: false,
      error: "No target file specified",
      message: "Usage: --profile <file.js> [--duration <sec>]",
    };
  }

  const resolved = path.isAbsolute(targetFile)
    ? targetFile
    : path.resolve(projectRoot, targetFile);

  if (!fs.existsSync(resolved)) {
    return {
      success: false,
      error: `File not found: ${resolved}`,
      message: `Cannot find file: ${resolved}`,
    };
  }

  // Read file to count functions and estimate require calls
  let source;
  try {
    source = fs.readFileSync(resolved, "utf-8");
  } catch (err) {
    return {
      success: false,
      error: `Cannot read ${resolved}: ${err.message}`,
      message: `Failed to read file: ${err.message}`,
    };
  }

  const functionCount = (
    source.match(/(?:async\s+)?function\s+\w+|=>\s*\{|\.prototype\.\w+\s*=/g) ||
    []
  ).length;
  const requireCount = (source.match(/require\s*\(/g) || []).length;
  const importCount = (source.match(/import\s+/g) || []).length;
  const lineCount = source.split("\n").length;

  // Run the script and measure
  const memBefore = process.memoryUsage();
  let exitCode = 0;
  let stdout = "";
  let stderr = "";

  const start = hrtimeMs();
  try {
    stdout = execFileSync("node", [resolved], {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: duration * 1000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    exitCode = err.status || 1;
    stderr = (err.stderr || "").slice(0, 500);
    stdout = (err.stdout || "").slice(0, 500);
  }
  const elapsed = hrtimeMs() - start;
  const memAfter = process.memoryUsage();

  const result = {
    file: targetFile,
    resolved,
    lineCount,
    functionCount,
    requireCount,
    importCount,
    executionMs: parseFloat(elapsed.toFixed(3)),
    exitCode,
    memoryDelta: {
      rss: memAfter.rss - memBefore.rss,
      heapUsed: memAfter.heapUsed - memBefore.heapUsed,
      heapTotal: memAfter.heapTotal - memBefore.heapTotal,
    },
    stdoutLength: (stdout || "").length,
    stderrPreview: stderr || undefined,
  };

  const lines = [
    "## Script Profile",
    `**File**: ${targetFile} (${lineCount} lines)`,
    `**Functions**: ${functionCount} | **require()**: ${requireCount} | **import**: ${importCount}`,
    "",
    "### Execution",
    `  Duration:  ${formatMs(elapsed)}`,
    `  Exit Code: ${exitCode}`,
    `  Stdout:    ${(stdout || "").length} bytes`,
    "",
    "### Memory Impact",
    `  RSS Delta:  ${memAfter.rss - memBefore.rss >= 0 ? "+" : ""}${formatBytes(memAfter.rss - memBefore.rss)}`,
    `  Heap Delta: ${memAfter.heapUsed - memBefore.heapUsed >= 0 ? "+" : ""}${formatBytes(memAfter.heapUsed - memBefore.heapUsed)}`,
  ];

  if (stderr) {
    lines.push("", "### Stderr (preview)", `  ${stderr.slice(0, 200)}`);
  }

  return { success: true, result, message: lines.join("\n") };
}

function doReport(outputFile, projectRoot) {
  // Gather all metrics into a comprehensive report
  const snapshot = captureSnapshot();
  const _mem = process.memoryUsage();
  const cpus = os.cpus();
  const cpuModel = cpus[0] ? cpus[0].model.trim() : "Unknown";

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const sysMemPercent = (((totalMem - freeMem) / totalMem) * 100).toFixed(1);

  const heapPercent =
    snapshot.memory.heapTotal > 0
      ? ((snapshot.memory.heapUsed / snapshot.memory.heapTotal) * 100).toFixed(
          1,
        )
      : "0.0";

  const report = {
    generatedAt: new Date().toISOString(),
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      cpuModel,
      cpuCores: cpus.length,
      totalMemory: totalMem,
      freeMemory: freeMem,
      systemMemoryUsage: `${sysMemPercent}%`,
    },
    process: snapshot,
    nodeVersion: process.version,
    uptime: process.uptime(),
  };

  const lines = [
    "## Comprehensive Performance Report",
    `**Generated**: ${report.generatedAt}`,
    "",
    "### System",
    `  Host:     ${report.system.hostname} (${report.system.platform}/${report.system.arch})`,
    `  CPU:      ${cpuModel} (${cpus.length} cores)`,
    `  OS:       ${report.system.release}`,
    `  Sys RAM:  ${formatBytes(totalMem - freeMem)} / ${formatBytes(totalMem)} (${sysMemPercent}%)`,
    "",
    "### Process",
    `  PID:          ${snapshot.pid}`,
    `  Node:         ${snapshot.nodeVersion}`,
    `  Uptime:       ${snapshot.uptime}s`,
    `  RSS:          ${formatBytes(snapshot.memory.rss)}`,
    `  Heap Used:    ${formatBytes(snapshot.memory.heapUsed)} / ${formatBytes(snapshot.memory.heapTotal)} (${heapPercent}%)`,
    `  External:     ${formatBytes(snapshot.memory.external)}`,
    `  CPU User:     ${snapshot.cpu.userSeconds}s`,
    `  CPU System:   ${snapshot.cpu.systemSeconds}s`,
  ];

  if (snapshot.v8Heap) {
    lines.push(
      "",
      "### V8 Heap",
      `  Heap Limit:      ${formatBytes(snapshot.v8Heap.heapSizeLimit)}`,
      `  Total Available: ${formatBytes(snapshot.v8Heap.totalAvailableSize)}`,
      `  Native Ctx:      ${snapshot.v8Heap.numberOfNativeContexts}`,
      `  Detached Ctx:    ${snapshot.v8Heap.numberOfDetachedContexts}`,
    );
  }

  // Write to file if requested
  if (outputFile) {
    const outPath = path.isAbsolute(outputFile)
      ? outputFile
      : path.resolve(projectRoot, outputFile);
    try {
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
      lines.push("", `**Report saved to**: ${outPath}`);
    } catch (err) {
      lines.push("", `**Failed to save report**: ${err.message}`);
    }
  }

  return { success: true, result: report, message: lines.join("\n") };
}

// ── Handler ───────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[performance-profiler] handler initialized for "${skill?.name || "performance-profiler"}"`,
    );
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();
    const {
      action,
      command,
      runs,
      file1,
      file2,
      targetFile,
      duration,
      outputFile,
    } = parseInput(input);

    logger.info(`[performance-profiler] Action: ${action}`, {
      command,
      runs,
      projectRoot,
    });

    try {
      switch (action) {
        case "benchmark":
          return doBenchmark(command, runs, projectRoot);
        case "memory":
          return await doMemoryAnalysis();
        case "startup":
          return doStartup(command, projectRoot);
        case "compare":
          return doCompare(file1, file2, projectRoot);
        case "profile":
          return doProfile(targetFile, duration, projectRoot);
        case "report":
          return doReport(outputFile, projectRoot);
        case "snapshot":
        default:
          return doSnapshot();
      }
    } catch (error) {
      logger.error(`[performance-profiler] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Performance profiler failed: ${error.message}`,
      };
    }
  },
};
