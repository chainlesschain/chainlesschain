/**
 * M5 Runtime Convergence - Quick Smoke Test
 * Verifies all core modules load and basic functionality works
 */

console.log("ChainlessChain CLI M5 Runtime Convergence - Smoke Test");
console.log("=".repeat(70) + "\n");

let passed = 0;
let failed = 0;
function assert(name, condition) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

async function main() {
  // Use dynamic import for ESM modules
  const [
    { default: TraceContext },
    { default: RuntimeProvenanceLedger },
    brokerModule,
    { default: HooksV2Runtime }
  ] = await Promise.all([
    import("../src/lib/trace-context.js"),
    import("../src/lib/runtime-provenance-ledger.js"),
    import("../src/lib/process-execution-broker/index.js"),
    import("../src/lib/hooks-v2-runtime.js")
  ]);

  const ProcessExecutionBroker = brokerModule.default;

  // Phase 1: Module Loading
  console.log("[Phase 1] Module Loading");
  assert("TraceContext module loaded", TraceContext !== null);
  assert("RuntimeProvenanceLedger module loaded", RuntimeProvenanceLedger !== null);
  assert("ProcessExecutionBroker module loaded", ProcessExecutionBroker !== null);
  assert("HooksV2Runtime module loaded", HooksV2Runtime !== null);

  // Phase 2: Instantiation
  console.log("\n[Phase 2] Instance Creation");
  const ledger = new RuntimeProvenanceLedger();
  const broker = new ProcessExecutionBroker();
  const hooks = new HooksV2Runtime();
  assert("ProvenanceLedger instance created", ledger !== null);
  assert("ProcessBroker instance created", broker !== null);
  assert("HooksRuntime instance created", hooks !== null);

  // Phase 3: Trace Context
  console.log("\n[Phase 3] Trace Context");
  const traceId = TraceContext.generateTraceId();
  const spanId = TraceContext.generateSpanId();
  assert("generateTraceId works", typeof traceId === "string" && traceId.length === 32);
  assert("generateSpanId works", typeof spanId === "string" && spanId.length === 16);
  assert("TraceContext is AsyncLocalStorage", TraceContext.traceAsyncLocalStorage !== undefined);

  // Phase 4: Provenance Ledger
  console.log("\n[Phase 4] Runtime Provenance Ledger");
  ledger.recordRead({
    source: "user",
    span: "prompt",
    content: "hello world test prompt",
    tokens: 6,
    traceId
  });
  ledger.recordTransformation({
    tool: "prompt:compress",
    span: "compression",
    inputTokens: 6,
    outputTokens: 6,
    traceId
  });
  ledger.recordWrite({
    destination: "llm:request",
    span: "api-call",
    tokens: 512,
    traceId
  });
  const provenance = ledger.getProvenance(traceId);
  assert("recordRead() works", provenance.reads.length === 1);
  assert("recordTransformation() works", provenance.transformations.length === 1);
  assert("recordWrite() works", provenance.writes.length === 1);
  assert("Token accounting works", provenance.summary.totalTokensIn === 6);

  // Phase 5: Process Execution Broker
  console.log("\n[Phase 5] Process Execution Broker");
  broker.auditEntry({
    origin: "test",
    tool: "test:tool",
    command: "echo smoke-test",
    args: ["smoke-test"],
    metadata: { traceId, test: true }
  });
  const auditLog = broker.getAuditLog();
  assert("auditEntry() records events", auditLog.length === 1);
  assert("Audit log includes traceId", auditLog[0].metadata.traceId === traceId);
  assert("Default interceptors registered", broker.interceptors.size >= 1);

  // Phase 6: Hooks V2 Runtime
  console.log("\n[Phase 6] Hooks V2 Runtime");
  assert("registerHook method exists", typeof hooks.registerHook === "function");
  assert("emitEvent method exists", typeof hooks.emitEvent === "function");
  assert("unregisterHook method exists", typeof hooks.unregisterHook === "function");
  assert("Supports 18 lifecycle events", hooks.supportedEvents.length >= 18);

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log("\n❌ Smoke test FAILED");
    process.exit(1);
  } else {
    console.log("\n✅ ALL SMOKE TESTS PASSED!");
    console.log("   M5 Runtime Convergence core modules verified.");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("\n❌ Test crashed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
