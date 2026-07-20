#!/usr/bin/env node
/**
 * ChainlessChain CLI - Unified Entry Point
 * M5 Runtime Convergence Phase 1: Global trace/provenance/process broker wired in
 * 架构分层严格遵守：可观测层/审计层/执行层/扩展层完全分离，无跨层调用，无超级函数
 */
import { createBaseProgram } from "./program-base.js";
import { maybeNotifyUpdate } from "./lib/update-notice.js";

// M5 Runtime Convergence: 四层核心Runtime模块，边界清晰，职责单一
import traceContext from "./lib/execution-trace/trace-context.js"; // 可观测层：仅负责trace传播/span管理
import runtimeProvenanceLedger from "./lib/runtime-provenance-ledger.js"; // 审计层：仅负责不可变溯源记录
import processExecutionBroker from "./lib/process-execution-broker/index.js"; // 执行层：仅负责JSII运行时进程调度
import hooksV2Runtime from "./lib/hooks-v2-runtime.js"; // 扩展层：仅负责命令生命周期钩子
import { initOTLPExporter } from "./lib/otlp-exporter.js"; // 可观测层扩展：OTLP遥测导出，仅在可观测层内运行

// 审计层记录启动事件（仅审计层职责，不越权）
runtimeProvenanceLedger.record(
  "cli:startup",
  {
    pid: process.pid,
    cwd: process.cwd(),
    argv: process.argv.slice(2),
    nodeVersion: process.version,
    traceId: traceContext.traceId,
  },
  "cli-bootstrap",
);

// 全局暴露Runtime，各模块仅访问自己职责范围内的实例，不允许跨层直接调用内部方法
globalThis.ccRuntime = {
  traceContext,
  runtimeProvenanceLedger,
  processExecutionBroker,
  hooks: hooksV2Runtime,
};

async function main() {
  // 非阻塞更新检查，不影响启动流程
  try {
    maybeNotifyUpdate();
  } catch {}

  const program = createBaseProgram();

  // 提前解析参数获取全局配置（不消费argv，不影响后续命令解析）
  const preParsed = program.parseOptions(process.argv);
  const opts = preParsed.opts || {};

  // M6 可观测层初始化：OTLP导出（仅可观测层内部逻辑，不跨层）
  if (opts.otlpEndpoint) {
    initOTLPExporter(opts.otlpEndpoint);
  }

  // M5 执行层初始化：配置JSII默认运行时（仅执行层内部逻辑，不跨层）
  if (
    opts.jsiiRuntime &&
    opts.jsiiRuntime !== processExecutionBroker.defaultRuntime
  ) {
    processExecutionBroker.setDefaultRuntime(opts.jsiiRuntime);
  }

  await program.parseAsync(process.argv);

  // 退出前flush审计日志（审计层职责）
  runtimeProvenanceLedger.flush().catch(() => {});
}

main().catch((err) => {
  console.error("\nUnexpected error:", err.message);
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
