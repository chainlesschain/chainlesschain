/**
 * Process-level observability runtime.
 *
 * It bridges the existing W3C TraceContext / MetricsCollector and the
 * TelemetryRecorder used by agent, eval and team runs into one standard OTLP
 * Collector exporter. Collector export is opt-in and content remains absent
 * unless the caller explicitly enabled the existing `--otlp-content` switch.
 */

import {
  traceContext,
  TraceContext,
} from "../execution-trace/trace-context.js";
import {
  metricsCollector,
  MetricsCollector,
} from "../execution-trace/metrics-collector.js";
import { OtlpExporter, resolveOtlpConfig } from "./otlp-exporter.js";

export {
  traceContext,
  TraceContext,
  metricsCollector,
  MetricsCollector,
  OtlpExporter,
  resolveOtlpConfig,
};

function collectedMetrics(collector) {
  const raw = collector?.collect?.();
  const source = raw?.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics || [];
  return source.map((metric) => {
    if (metric.type === "counter") {
      return {
        name: metric.name,
        type: "sum",
        value: metric.value,
        attributes: metric.labels,
      };
    }
    if (metric.type === "histogram") {
      return {
        name: metric.name,
        type: "histogram",
        count: metric.count,
        sum: metric.sum,
        attributes: metric.labels,
      };
    }
    return {
      name: metric.name,
      type: "gauge",
      value: metric.value,
      attributes: metric.labels,
    };
  });
}

export class ObservabilityRuntime {
  constructor(options = {}, deps = {}) {
    this.traceContext = deps.traceContext || traceContext;
    this.metricsCollector = deps.metricsCollector || metricsCollector;
    this.exporter =
      deps.exporter ||
      new OtlpExporter(
        {
          ...options,
          config:
            options.config ||
            resolveOtlpConfig(options, deps.env || process.env, deps),
        },
        deps,
      );
    this._closed = false;
    this._onSpanEnd = (span) => this.exporter.exportSpans([span]);
    if (this.exporter.enabled) {
      this.traceContext.on("span:end", this._onSpanEnd);
    }
  }

  get enabled() {
    return this.exporter.enabled && !this._closed;
  }

  exportRecorder(recorder, { redact = true } = {}) {
    if (!this.enabled || !recorder?.toOtlp) return false;
    return this.exporter.exportTracePayload(recorder.toOtlp({ redact }), {
      redact,
    });
  }

  exportTeamSummary({ workflowRunId, workflowName, summary, budget } = {}) {
    if (!this.enabled) return false;
    const attributes = {
      "workflow.run_id": workflowRunId || "unknown",
      "workflow.name": workflowName || "team",
    };
    const stats = summary?.stats || {};
    const budgetStatus = budget?.status?.() || budget || {};
    return this.exporter.exportMetrics([
      {
        name: "chainlesschain.team.tasks",
        type: "gauge",
        unit: "{task}",
        value: Number(budgetStatus.tasks ?? summary?.executions) || 0,
        attributes,
      },
      {
        name: "chainlesschain.team.tokens",
        type: "gauge",
        unit: "{token}",
        value: Number(budgetStatus.tokens) || 0,
        attributes,
      },
      {
        name: "chainlesschain.team.cost",
        type: "gauge",
        unit: "USD",
        value: Number(budgetStatus.spentUsd) || 0,
        attributes,
      },
      {
        name: "chainlesschain.team.failures",
        type: "gauge",
        unit: "{failure}",
        value: Number(stats.failed) || 0,
        attributes,
      },
      {
        name: "chainlesschain.team.completed",
        type: "gauge",
        unit: "{task}",
        value: Number(stats.completed) || 0,
        attributes,
      },
    ]);
  }

  /**
   * Export one migrated-command invocation without command arguments or any
   * session/workspace identity. Collection remains opt-in because a disabled
   * OTLP runtime returns before constructing or queueing the metric payload.
   */
  exportCommandLifecycleInvocation(value = {}) {
    if (!this.enabled) return false;
    const command = normalizeLifecycleDimension(
      value.command,
      /^[a-z0-9][a-z0-9-]{0,63}$/,
      "unknown",
    );
    const route = ["legacy", "replacement"].includes(value.route)
      ? value.route
      : "unknown";
    const outcome = ["completed", "error"].includes(value.outcome)
      ? value.outcome
      : "unknown";
    const version = normalizeLifecycleDimension(
      value.version,
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      "unknown",
    );
    const deprecatedSince = normalizeLifecycleDimension(
      value.deprecatedSince,
      /^\d+\.\d+\.\d+$/,
      "unknown",
    );
    const removalNotBefore = normalizeLifecycleDimension(
      value.removalNotBefore,
      /^\d+\.\d+\.\d+$/,
      "unknown",
    );
    const durationMs = Math.max(0, Number(value.durationMs) || 0);
    const attributes = {
      "command.name": command,
      "command.route": route,
      "command.outcome": outcome,
      "cli.version": version,
      "command.deprecated_since": deprecatedSince,
      "command.removal_not_before": removalNotBefore,
    };
    try {
      return this.exporter.exportMetrics([
        {
          name: "chainlesschain.cli.command.lifecycle.invocations",
          type: "sum",
          unit: "{invocation}",
          value: 1,
          monotonic: true,
          aggregationTemporality: 1,
          attributes,
        },
        {
          name: "chainlesschain.cli.command.lifecycle.duration",
          type: "histogram",
          unit: "ms",
          count: 1,
          sum: durationMs,
          aggregationTemporality: 1,
          attributes,
        },
      ]);
    } catch {
      // Observability is advisory and must never change the command result.
      return false;
    }
  }

  captureMetrics() {
    if (!this.enabled) return false;
    const metrics = collectedMetrics(this.metricsCollector);
    return metrics.length > 0 ? this.exporter.exportMetrics(metrics) : false;
  }

  async shutdown(options = {}) {
    if (this._closed) return this.exporter.getStats();
    this.traceContext.off("span:end", this._onSpanEnd);
    this.captureMetrics();
    const stats = await this.exporter.shutdown(options);
    this._closed = true;
    return stats;
  }

  getStats() {
    return this.exporter.getStats();
  }
}

function normalizeLifecycleDimension(value, pattern, fallback) {
  return typeof value === "string" && pattern.test(value) ? value : fallback;
}

let defaultRuntime = null;

export function resolveOtlpEndpointFromArgv(argv = process.argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === "--otlp-endpoint") return args[index + 1] || null;
    if (token.startsWith("--otlp-endpoint=")) {
      return token.slice("--otlp-endpoint=".length) || null;
    }
  }
  return null;
}

export function initObservability(options = {}, deps = {}) {
  if (defaultRuntime && !defaultRuntime._closed) return defaultRuntime;
  defaultRuntime = new ObservabilityRuntime(options, deps);
  return defaultRuntime;
}

export function getObservabilityRuntime() {
  return defaultRuntime;
}

export function isOtlpCollectorEnabled() {
  return defaultRuntime?.enabled === true;
}

export function exportTelemetryRecorder(recorder, options) {
  return defaultRuntime?.exportRecorder(recorder, options) || false;
}

export function exportTeamTelemetry(summary) {
  return defaultRuntime?.exportTeamSummary(summary) || false;
}

export async function shutdownObservability(options) {
  return defaultRuntime?.shutdown(options);
}

/** Test-only lifecycle seam; avoids state leaking across module-level tests. */
export async function resetObservabilityForTests() {
  if (defaultRuntime && !defaultRuntime._closed) {
    await defaultRuntime.shutdown({ timeoutMs: 0 });
  }
  defaultRuntime = null;
}

export * from "../execution-trace/index.js";
