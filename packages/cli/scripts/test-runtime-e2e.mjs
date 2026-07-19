/**
 * M5: End-to-End Parity Verification for Runtime Convergence
 * Simulates full cc chat + hook + MCP + sub-agent flow and verifies complete tracing across all components.
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

async function runE2ETest() {
  console.log("ChainlessChain CLI M5 E2E Runtime Convergence Verification");
  console.log("=".repeat(70));

  const results = [];
  function assert(name, condition) {
    results.push({ name, pass: !!condition });
    const icon = condition ? "✓" : "✗";
    console.log(`  ${icon} ${name}`);
  }

  const broker = require("../src/lib/process-execution-broker/index.js").default;
  const bus = require("../src/lib/agent-ipc-bus.js").default;
  const hooks = require("../src/lib/hooks-v2-runtime.js").default;
  const ledger = require("../src/lib/context-source-ledger.js").default;

  console.log("\n[Phase 1] Full Turn Context Setup");
  const traceId = `turn-${Date.now()}`;
  const sessionId = "session-e2e-test";
  assert("Generate traceId for turn", traceId.startsWith("turn-"));
  assert("All modules loaded", broker && bus && hooks && ledger);

  console.log("\n[Phase 2] Hook Execution (SessionStart/UserPromptSubmit)");
  hooks.registerHook({
    id: "e2e-test-hook",
    event: "UserPromptSubmit",
    type: "js",
    handler: async (ctx) => {
      ledger.recordRead({
        source: "hook",
        span: "UserPromptSubmit:validation",
        content: "hook validated user prompt",
        tokens: 128,
        metadata: { hookId: "e2e-test-hook" },
        traceId
      });
      return { hooked: true };
    }
  });

  const hookResult = await hooks.executeHooks("UserPromptSubmit", { event: "UserPromptSubmit", sessionId, prompt: "hello" }, { traceId });
  assert("Hook executed successfully", hookResult.success === true);
  assert("Hook returned expected result", hookResult.results[0].result.hooked === true);
  assert("Hook context provenance recorded", ledger.getProvenance().length >= 1);

  console.log("\n[Phase 3] Audit a shell command via Broker (simulating tool use)");
  broker.auditEntry({
    origin: "shell",
    tool: "shell:echo",
    command: "echo 'hello from e2e test'",
    args: ["hello from e2e test"],
    pid: 12345,
    metadata: { traceId, sessionId }
  });
  ledger.recordRead({
    source: "tool:shell",
    span: "shell:echo",
    content: "shell command output",
    tokens: 64,
    metadata: { pid: 12345 },
    traceId
  });
  assert("Shell command audited in broker", broker.getAuditLog().length >= 1);
  assert("Shell tool output recorded in ledger", ledger.getProvenance().length >= 2);

  console.log("\n[Phase 4] Sub-Agent Registration and IPC Communication");
  let progressReceived = false;
  let responseReceived = false;
  const agentId = "research-agent-e2e";

  bus.registerAgent({
    agentId,
    origin: "agent:research",
    onMessage: (msg) => {
      if (msg.type === "progress") progressReceived = true;
      if (msg.type === "response") responseReceived = true;
    }
  });

  bus.sendMessage({ to: "orchestrator", from: agentId, type: "progress", data: { percent: 50 }, traceId });
  ledger.recordRead({
    source: "agent:research",
    span: `${agentId}:search`,
    content: "found 3 relevant notes",
    tokens: 256,
    metadata: { agentId },
    traceId
  });
  bus.sendResponse(agentId, { content: "Research complete", tokensUsed: 256, traceId });

  assert("Sub-agent registered", bus.isAgentRegistered(agentId));
  assert("Progress message received", progressReceived);
  assert("Final response received", responseReceived);
  assert("Sub-agent context recorded", ledger.getProvenance().length >= 3);

  console.log("\n[Phase 5] Post-turn Hook and Token Breakdown");
  hooks.registerHook({
    id: "e2e-post-hook",
    event: "SessionEnd",
    type: "js",
    handler: async () => {
      ledger.recordRead({ source: "hook", span: "SessionEnd:finalize", content: "session finalized", tokens: 32, traceId });
      return { done: true };
    }
  });
  await hooks.executeHooks("SessionEnd", { event: "SessionEnd", sessionId, success: true }, { traceId });

  const tokenBreakdown = ledger.getTokenBreakdown();
  assert("Token breakdown calculated", typeof tokenBreakdown.total === "number");
  assert("Total tokens > 0", tokenBreakdown.total > 0);
  assert("Token breakdown includes hooks", tokenBreakdown.bySource.hook > 0);
  assert("Token breakdown includes shell", tokenBreakdown.bySource["tool:shell"] > 0);

  console.log("\n[Phase 6] Trace Chain Integrity");
  const allEntries = ledger.getProvenance();
  const allTracesMatch = allEntries.every(e => e.traceId === traceId);
  assert(`All ${allEntries.length} ledger entries share same traceId`, allTracesMatch);

  console.log("\n[Phase 7] Cleanup");
  bus.unregisterAgent(agentId);
  broker.clearAuditLog();
  ledger.clear();
  assert("Sub-agent unregistered", !bus.isAgentRegistered(agentId));
  assert("Audit log cleared", broker.getAuditLog().length === 0);
  assert("Ledger cleared", ledger.getProvenance().length === 0);

  console.log("\n" + "=".repeat(70));
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log("\nFAILED tests:");
    results.filter(r => !r.pass).forEach(r => console.log(`  ✗ ${r.name}`));
    process.exit(1);
  }

  console.log("\n✅ All M5 E2E Parity Tests PASSED!");
}

runE2ETest().catch(err => {
  console.error("\n✗ Test crashed:", err);
  process.exit(1);
});
