/**
 * Runtime Convergence smoke test
 * Verifies all M0-M4 runtime modules can be loaded without errors
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;

function t(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log("ChainlessChain CLI Runtime Convergence Verification\n" + "=" .repeat(60));

// M1: ProcessExecutionBroker
const SRC = "../src/lib";
t("M1 ProcessExecutionBroker loads", () => {
  const broker = require(`${SRC}/process-execution-broker/index.js`).default;
  if (!broker || typeof broker.spawn !== "function") throw new Error("missing spawn()");
});

t("M1 ProcessExecutionBroker has addPolicyEnforcer", () => {
  const broker = require(`${SRC}/process-execution-broker/index.js`).default;
  if (typeof broker.addPolicyEnforcer !== "function") throw new Error("missing addPolicyEnforcer");
});

// M2: AgentIPCBus
t("M2 AgentIPCBus loads", () => {
  const bus = require(`${SRC}/agent-ipc-bus.js`).default;
  if (!bus || typeof bus.requestInteraction !== "function") throw new Error("missing requestInteraction");
});

t("M2 AgentIPCBus supports registerAgent/respond/cancel", () => {
  const bus = require(`${SRC}/agent-ipc-bus.js`).default;
  if (typeof bus.registerAgent !== "function") throw new Error("missing registerAgent");
  if (typeof bus.respond !== "function") throw new Error("missing respond");
  if (typeof bus.cancel !== "function") throw new Error("missing cancel");
});

// M3: HooksV2Runtime
t("M3 HooksV2Runtime loads", () => {
  const hooks = require(`${SRC}/hooks-v2-runtime.js`).default;
  const { VALID_HOOK_EVENTS, VALID_EXECUTOR_TYPES } = require(`${SRC}/hooks-v2-runtime.js`);
  if (VALID_HOOK_EVENTS.size !== 18) throw new Error(`expected 18 hook events, got ${VALID_HOOK_EVENTS.size}`);
  if (VALID_EXECUTOR_TYPES.size !== 5) throw new Error(`expected 5 executor types, got ${VALID_EXECUTOR_TYPES.size}`);
});

t("M3 HooksV2Runtime supports all 18 events", () => {
  const { VALID_HOOK_EVENTS } = require(`${SRC}/hooks-v2-runtime.js`);
  const required = ["PreToolUse","PostToolUse","Notification","Stop","SubagentStop",
    "PreCommit","PostCommit","UserPromptSubmit","SessionStart","SessionEnd",
    "PreCompact","ModelSelection","ConfigChange","PermissionAllow","PermissionDeny",
    "TimelineEntry","McpRequest","McpResponse"];
  for (const ev of required) {
    if (!VALID_HOOK_EVENTS.has(ev)) throw new Error(`missing event: ${ev}`);
  }
});

t("M3 HooksV2Runtime supports 5 executor types", () => {
  const { VALID_EXECUTOR_TYPES } = require(`${SRC}/hooks-v2-runtime.js`);
  for (const typ of ["command","http","prompt","agent","js"]) {
    if (!VALID_EXECUTOR_TYPES.has(typ)) throw new Error(`missing executor: ${typ}`);
  }
});

// M4: ContextSourceLedger
t("M4 ContextSourceLedger loads", () => {
  const ledger = require(`${SRC}/context-source-ledger.js`).default;
  if (!ledger || typeof ledger.record !== "function") throw new Error("missing record()");
});

t("M4 ContextSourceLedger can record and query provenance", () => {
  const ledger = require(`${SRC}/context-source-ledger.js`).default;
  ledger.record({
    sessionId: "test-session",
    turnId: "test-turn",
    sourceType: "tool",
    sourceId: "Read",
    permissionMode: "agent",
    confidence: 0.95,
    tokenCount: 100,
    summary: "test context",
  });
  const provenance = ledger.getTurnProvenance("test-turn");
  if (provenance.totalEntries < 1) throw new Error("expected at least 1 entry");
  if (!provenance.byType.tool) throw new Error("expected tool entry");
  ledger.clearSession("test-session");
});

// Verify package name
t("package.json name is chainlesschain (binary: cc)", () => {
  const pkg = JSON.parse(require("node:fs").readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  if (pkg.name !== "chainlesschain") throw new Error(`expected chainlesschain, got ${pkg.name}`);
});

console.log("\n" + "=" .repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
console.log("All runtime convergence tests PASSED! M0-M4 modules are available.");
process.exit(0);
