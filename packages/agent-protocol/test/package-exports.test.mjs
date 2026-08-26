import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  assertDeclaredEquivalenceClasses,
  projectCausalAgentStream,
} from "../../agent-sdk/__fixtures__/protocol/causal-conformance.mjs";
import {
  CC_AGENT_PROTOCOL_FEATURES,
  CC_AGENT_PROTOCOL_MIN_VERSION,
  CC_AGENT_PROTOCOL_SCHEMA,
  CC_AGENT_PROTOCOL_SCHEMA_DIGEST,
  CC_AGENT_STREAM_EVENT_TYPES,
  CC_AGENT_PROTOCOL_VERSION,
  assertAgentStreamEvent,
  assertCanonicalAgentStreamEvent,
  assertProtocolCompatible,
  assertApprovalDecision,
  compareProtocolSchemas,
  validateAgentStreamEvent,
  validateCanonicalAgentStreamEvent,
  validateApprovalDecision,
  validateProtocolDefinition,
  validateProtocolMessage,
} from "@chainlesschain/agent-protocol";

test("public root export matches the canonical schema", () => {
  assert.equal(CC_AGENT_PROTOCOL_VERSION, 1);
  assert.equal(CC_AGENT_PROTOCOL_MIN_VERSION, 1);
  assert.match(CC_AGENT_PROTOCOL_SCHEMA_DIGEST, /^sha256:[a-f0-9]{64}$/u);
  assert.ok(CC_AGENT_PROTOCOL_FEATURES.includes("typed_graph"));
  assert.equal(CC_AGENT_PROTOCOL_SCHEMA["x-cc-protocol"].version, 1);
  assert.equal(Object.isFrozen(CC_AGENT_PROTOCOL_SCHEMA), true);
  assert.equal(Object.isFrozen(CC_AGENT_PROTOCOL_SCHEMA.$defs), true);
  assert.equal(typeof assertProtocolCompatible, "function");
  assert.equal(typeof compareProtocolSchemas, "function");
  assert.equal(typeof validateProtocolMessage, "function");
  assert.equal(typeof validateProtocolDefinition, "function");
  assert.equal(typeof validateAgentStreamEvent, "function");
  assert.ok(CC_AGENT_PROTOCOL_FEATURES.includes("agent_stream_events"));
  assert.ok(CC_AGENT_PROTOCOL_FEATURES.includes("agent_stream_payloads"));
  assert.deepEqual(
    CC_AGENT_STREAM_EVENT_TYPES,
    CC_AGENT_PROTOCOL_SCHEMA.$defs.AgentStreamEventType.enum,
  );
  assert.equal(Object.isFrozen(CC_AGENT_STREAM_EVENT_TYPES), true);
});

test("public validator derives the known Agent stream event inventory", () => {
  assert.ok(CC_AGENT_STREAM_EVENT_TYPES.length >= 30);
  assert.ok(CC_AGENT_STREAM_EVENT_TYPES.includes("hook_started"));
  for (const type of CC_AGENT_STREAM_EVENT_TYPES) {
    assert.equal(validateAgentStreamEvent({ type }).ok, true, type);
  }
  assert.equal(validateAgentStreamEvent({ type: "future_event_v2" }).ok, false);
  assert.throws(
    () => assertAgentStreamEvent({ type: "result", seq: 0 }),
    /Invalid AgentStreamEvent/u,
  );
});

test("public validator matches the shared Agent stream event fixture", () => {
  const cases = JSON.parse(
    readFileSync(
      new URL("./fixtures/agent-stream-events.json", import.meta.url),
      "utf8",
    ),
  );
  for (const fixture of cases) {
    const value = structuredClone(fixture.value);
    if (fixture.injectUndefinedAt === "payload.missing") {
      value.payload.missing = undefined;
    }
    assert.equal(
      validateAgentStreamEvent(value).ok,
      fixture.valid,
      fixture.name,
    );
  }
});

test("canonical payload validator matches shared positive and negative fixtures", () => {
  const cases = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/canonical-agent-stream-payloads.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const fixture of cases) {
    assert.equal(
      validateCanonicalAgentStreamEvent(fixture.value).ok,
      fixture.valid,
      fixture.name,
    );
  }
  assert.throws(
    () => assertCanonicalAgentStreamEvent({ type: "tool_use" }),
    /Invalid canonical AgentStreamEvent/u,
  );
});

test("canonical payload union covers every discriminator in the shared corpus", () => {
  const seen = new Set();
  const fixtureRoot = new URL("../../agent-sdk/__fixtures__/protocol/", import.meta.url);
  for (const file of readdirSync(fixtureRoot).filter((name) => name.endsWith(".ndjson"))) {
    for (const line of readFileSync(new URL(file, fixtureRoot), "utf8")
      .split(/\r?\n/u)
      .filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.type === "slash_command" || event.type === "totally_new_event_v9") continue;
      assert.equal(validateCanonicalAgentStreamEvent(event).ok, true, `${file}: ${event.type}`);
      seen.add(event.type);
    }
  }
  const payloadCases = JSON.parse(
    readFileSync(
      new URL("./fixtures/canonical-agent-stream-payloads.json", import.meta.url),
      "utf8",
    ),
  );
  for (const fixture of payloadCases.filter((entry) => entry.valid)) {
    seen.add(fixture.value.type);
  }
  assert.deepEqual([...seen].sort(), [...CC_AGENT_STREAM_EVENT_TYPES].sort());
});

test("causal Agent stream fixture preserves partial order across interleavings", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../../agent-sdk/__fixtures__/protocol/causal-conformance.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(
    fixture.schema,
    "chainlesschain.agent-stream-causal-conformance/v1",
  );

  let baseline = null;
  for (const fixtureCase of fixture.cases) {
    for (const event of fixtureCase.events) {
      assert.equal(
        validateCanonicalAgentStreamEvent(event).ok,
        true,
        `${fixtureCase.name}: ${event.type}`,
      );
    }
    const projection = projectCausalAgentStream(fixtureCase.events);
    assert.deepEqual(projection, {
      nodes: fixture.expected.nodes,
      partialOrder: fixture.expected.partialOrder,
      approvalBinding: fixture.expected.approvalBinding,
      terminal: fixture.expected.terminal,
    });
    assert.equal(
      assertDeclaredEquivalenceClasses(
        projection,
        fixture.expected.equivalenceClasses,
      ),
      true,
    );
    baseline ??= projection;
    assert.deepEqual(projection, baseline, fixtureCase.name);
  }
});

test("public validators derive ApprovalDecision from the canonical schema", () => {
  assert.deepEqual(validateApprovalDecision({ kind: "acceptOnce" }), {
    ok: true,
    errors: [],
  });
  assert.equal(
    validateApprovalDecision({
      kind: "acceptForSession",
      permissions: [{ capability: "tool:run_shell", scope: "npm test" }],
    }).ok,
    true,
  );
  assert.equal(
    validateApprovalDecision({ kind: "acceptOnce", unexpected: true }).ok,
    false,
  );
  assert.throws(
    () => assertApprovalDecision({ kind: "allowEverything" }),
    /Invalid ApprovalDecision/u,
  );
});

test("public validator matches the shared ApprovalDecision conformance fixture", () => {
  const cases = JSON.parse(
    readFileSync(
      new URL("./fixtures/approval-decisions.json", import.meta.url),
      "utf8",
    ),
  );
  for (const fixture of cases) {
    assert.equal(
      validateApprovalDecision(fixture.value).ok,
      fixture.valid,
      fixture.name,
    );
  }
});

test("package metadata exposes only supported public entry points", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.name, "@chainlesschain/agent-protocol");
  assert.equal(manifest.version, "0.1.5");
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal(manifest.exports["."], "./src/index.mjs");
  assert.equal(
    manifest.exports["./schema"],
    "./schema/cc-agent-protocol.schema.json",
  );
  assert.deepEqual(manifest.files, [
    "src/",
    "schema/",
    "generated/",
    "README.md",
    "LICENSE",
  ]);
});

test("SDK wire event aliases do not mirror the generated union", () => {
  const typescriptProtocol = readFileSync(
    new URL("../../agent-sdk/src/protocol.ts", import.meta.url),
    "utf8",
  );
  const pythonProtocol = readFileSync(
    new URL(
      "../../agent-sdk-python/src/chainlesschain_agent_sdk/protocol.py",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    typescriptProtocol,
    /export type KnownAgentStreamEvent = CanonicalAgentStreamEvent;/u,
  );
  assert.match(
    typescriptProtocol,
    /export type AgentStreamEvent = KnownAgentStreamEvent \| UnknownAgentEvent;/u,
  );
  assert.doesNotMatch(
    typescriptProtocol,
    /export type AgentStreamEvent\s*=\s*\n\s*\|/u,
  );

  assert.match(pythonProtocol, /^AgentStreamEvent = AgentEvent$/mu);
  assert.match(pythonProtocol, /AgentEvent\.__subclasses__\(\)/u);
  assert.doesNotMatch(pythonProtocol, /^KnownAgentEvent = Union\[/mu);
});
