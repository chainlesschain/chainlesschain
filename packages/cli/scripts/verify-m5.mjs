/**
 * M5 Runtime Convergence - Quick verification test (ESM)
 */
console.log("ChainlessChain CLI M5 Runtime Convergence Verification");
console.log("=".repeat(70) + "\n");

let passed = 0;
let failed = 0;
function t(name, ok) {
  if (ok) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}`); failed++; }
}

// Import all core modules
import TraceContext from "../src/lib/trace-context.js";
import RuntimeProvenanceLedger from "../src/lib/runtime-provenance-ledger.js";
import broker from "../src/lib/process-execution-broker/index.js";
import HooksV2Runtime from "../src/lib/hooks-v2-runtime.js";

// Test 1: All modules load
t("TraceContext module loaded", TraceContext !== undefined);
t("RuntimeProvenanceLedger module loaded", RuntimeProvenanceLedger !== undefined);
t("ProcessExecutionBroker singleton loaded", broker !== undefined);
t("HooksV2Runtime module loaded", HooksV2Runtime !== undefined);

// Test 2: TraceContext functionality
const traceId = TraceContext.generateTraceId();
t("TraceContext generates 32-char traceId", traceId.length === 32);

const spanId = TraceContext.generateSpanId();
t("TraceContext generates 16-char spanId", spanId.length === 16);

const ctx = new TraceContext();
const child = ctx.childSpan("test-span");
t("TraceContext creates child spans", child.parentSpanId === ctx.spanId);
t("TraceContext child shares traceId", child.traceId === ctx.traceId);

const tp = ctx.toTraceParent();
t("TraceContext serializes traceparent", tp.startsWith("00-"));
t("TraceContext parses traceparent", TraceContext.parseTraceParent(tp) !== null);

// Test 3: Provenance Ledger
const ledger = new RuntimeProvenanceLedger();
ledger.recordRead({
  source: "test-rag",
  span: child.spanId,
  traceId: child.traceId,
  content: "test content",
  tokens: 100,
});
ledger.recordToolCall({
  tool: "test:tool",
  span: child.spanId,
  traceId: child.traceId,
  args: { foo: "bar" },
  durationMs: 50,
});
t("ProvenanceLedger records entries", ledger.getProvenance().length === 2);
t("ProvenanceLedger indexes by trace", ledger.getTraceEntries(child.traceId).length === 2);
t("ProvenanceLedger chain integrity verified", ledger.verifyIntegrity() === true);
const exported = ledger.export();
t("ProvenanceLedger exports JSON", exported.verified === true && exported.entries.length === 2);

// Test 4: ProcessExecutionBroker audit
broker.addAuditor((event, record) => {});
t("Broker supports auditor registration", broker._auditors.length >= 1);
const counts = broker.getCountsByOrigin();
t("Broker getCountsByOrigin works", typeof counts === "object");

// Test 5: Hooks V2 Runtime (already exists as singleton in project)
const hooks = HooksV2Runtime;
t("HooksV2Runtime instantiated", hooks !== null);
t("HooksV2Runtime has registerHook", typeof hooks.registerHook === "function");
t("HooksV2Runtime has emitEvent", typeof hooks.emitEvent === "function");

console.log("\n" + "=".repeat(70));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("❌ M5 Core verification FAILED");
  process.exit(1);
} else {
  console.log("✅ M5 Runtime Convergence - Core modules VERIFIED!");
  console.log("");
  console.log("Deliverables:");
  console.log("  - src/lib/trace-context.js          (W3C distributed tracing)");
  console.log("  - src/lib/runtime-provenance-ledger.js  (Hash-chained immutable audit)");
  console.log("  - src/lib/process-execution-broker/index.js  (Unified spawn broker)");
  console.log("  - src/lib/hooks-v2-runtime.js       (18 hook events, 5 executors)");
  console.log("  - docs/CLAUDE_CODE_CLI_CURRENT_GAPS_AND_OPTIMIZATIONS_2026-07-18.md (gap analysis)");
  process.exit(0);
}
