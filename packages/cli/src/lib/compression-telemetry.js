import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { getHomeDir } from "./paths.js";

function getMetricsDir() {
  const dir = join(getHomeDir(), "metrics");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function telemetryPath() {
  return join(getMetricsDir(), "compression.jsonl");
}

export function recordCompressionMetric(stats, meta = {}) {
  if (!stats || typeof stats !== "object") return;

  const event = {
    timestamp: Date.now(),
    stats,
    meta,
  };

  try {
    appendFileSync(telemetryPath(), JSON.stringify(event) + "\n", "utf-8");
  } catch (_err) {
    // Non-critical
  }
}

export function getCompressionTelemetrySummary(options = {}) {
  const filePath = telemetryPath();
  const limit = options.limit || 500;
  if (!existsSync(filePath)) {
    return emptyCompressionSummary();
  }

  const lines = readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .slice(-limit);

  const samples = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.stats) samples.push(parsed);
    } catch {
      // Skip malformed lines
    }
  }

  if (samples.length === 0) {
    return emptyCompressionSummary();
  }

  const variantDistribution = {};
  const strategyMap = new Map();
  let totalSavedTokens = 0;
  let totalOriginalTokens = 0;
  let totalCompressedTokens = 0;
  let compressedSamples = 0;

  for (const sample of samples) {
    const stats = sample.stats || {};
    totalSavedTokens += stats.saved || 0;
    totalOriginalTokens += stats.originalTokens || 0;
    totalCompressedTokens += stats.compressedTokens || 0;
    if ((stats.saved || 0) > 0 || stats.strategy !== "none") {
      compressedSamples++;
    }

    const variant = stats.abVariant || "default";
    variantDistribution[variant] = (variantDistribution[variant] || 0) + 1;

    const strategies = String(stats.strategy || "none").split("+");
    for (const strategy of strategies) {
      const key = strategy || "none";
      const current = strategyMap.get(key) || {
        strategy: key,
        hits: 0,
        savedTokens: 0,
      };
      current.hits += 1;
      current.savedTokens += stats.saved || 0;
      strategyMap.set(key, current);
    }
  }

  const strategyDistribution = [...strategyMap.values()]
    .map((entry) => ({
      ...entry,
      hitRate: samples.length > 0 ? entry.hits / samples.length : 0,
    }))
    .sort((a, b) => b.hits - a.hits);

  return {
    samples: samples.length,
    compressedSamples,
    hitRate: samples.length > 0 ? compressedSamples / samples.length : 0,
    totalSavedTokens,
    averageSavedTokens:
      samples.length > 0 ? Math.round(totalSavedTokens / samples.length) : 0,
    totalOriginalTokens,
    totalCompressedTokens,
    netSavingsRate:
      totalOriginalTokens > 0
        ? (totalOriginalTokens - totalCompressedTokens) / totalOriginalTokens
        : 0,
    variantDistribution,
    strategyDistribution,
  };
}

export function resetCompressionTelemetry() {
  try {
    rmSync(telemetryPath(), { force: true });
  } catch (_err) {
    // Non-critical
  }
}

function emptyCompressionSummary() {
  return {
    samples: 0,
    compressedSamples: 0,
    hitRate: 0,
    totalSavedTokens: 0,
    averageSavedTokens: 0,
    totalOriginalTokens: 0,
    totalCompressedTokens: 0,
    netSavingsRate: 0,
    variantDistribution: {},
    strategyDistribution: [],
  };
}
