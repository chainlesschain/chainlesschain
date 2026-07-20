/**
 * ExecutionTrace - M3 执行追踪统一导出
 *
 * 包含分布式追踪和指标收集功能：
 * - TraceContext: W3C Trace Context 兼容的上下文传播
 * - MetricsCollector: 轻量级性能指标收集
 */

export * from "./trace-context.js";
export * from "./metrics-collector.js";
