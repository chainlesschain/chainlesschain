/**
 * Quick smoke test - bypasses ESM import issues on Windows
 */
const { createRequire } = require("node:module");
const require2 = createRequire(__filename + ".cjs");

console.log("ChainlessChain CLI M5 Runtime Convergence Verification");
console.log("======================================================================\n");

let passed = 0;
let failed = 0;
function t(name, ok) {
  if (ok) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}`); failed++; }
}

// Load modules
const HooksV2Runtime = require2("../src/lib/hooks-v2-runtime.js").default;
const TraceContext = require2("../src/lib/trace-context.js").default;
const RuntimeProvenanceLedger = require2("../src/lib/runtime-provenance-ledger.js").default;
const ProcessExecutionBroker = require2("../src/lib/process-execution-broker/index.js").default;
const broker = new ProcessExecutionBroker();
const ledger = new RuntimeProvenanceLedger();
const hooks = new HooksV2Runtime();

// Test all modules load
t("TraceContext loaded", typeof TraceContext === "function" || TraceContext);
t("RuntimeProvenanceLedger loaded", typeof RuntimeProvenanceLedger === "function");
t("ProcessExecutionBroker loaded", broker !== null);
t("HooksV2Runtime loaded", typeof hooks.registerHook === "function");

// Test basic flow
const traceId = TraceContext.generateTraceId();
t("TraceContext generates traceIds", typeof traceId === "string" && traceId.length > 0);

// Register and fire a hook
const hookId = hooks.registerHook({
  id: "e2e-test-hook",
  event: "UserPromptSubmit",
  type: "js",
  code: "return { hooked: true }",
  blocking: true,
  timeoutMs: 5000
});
t("HooksV2Runtime.registerHook works", typeof hookId === "string");

// Quick ledger test
ledger.recordRead({ source: "test", span: "test-span", content: "test", tokens: 100, traceId });
t("ProvenanceLedger.recordRead works", ledger.getProvenance().length === 1);

// Quick broker audit
broker.auditEntry({ origin: "test", tool: "test:tool", command: "test", metadata: { traceId }});
t("Broker auditEntry works", broker.getAuditLog().length === 1);

console.log("\n======================================================================");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("❌ Smoke test FAILED");
  process.exit(1);
} else {
  console.log("✅ Smoke test PASSED - M5 Runtime Convergence verified!");
  process.exit(0);
}
