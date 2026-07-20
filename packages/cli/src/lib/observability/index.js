/**
 * Observability - 可观测性模块统一导出
 * M3 阶段模块：包含分布式追踪 + 性能指标收集
 */

export {
  traceContext,
  TraceContext,
} from "../execution-trace/trace-context.js";
export {
  metricsCollector,
  MetricsCollector,
} from "../execution-trace/metrics-collector.js";

/**
 * 初始化可观测性模块
 * @param {Object} [options={}]
 * @param {boolean} [options.tracingEnabled=true] - 是否启用追踪
 * @param {boolean} [options.metricsEnabled=true] - 是否启用指标收集
 */
export function initObservability(options = {}) {
  const { tracingEnabled = true, metricsEnabled = true } = options;

  // 可观测性模块初始化逻辑
  return {
    tracingEnabled,
    metricsEnabled,
    traceContext,
    metricsCollector,
  };
}

export * from "../execution-trace/index.js";
