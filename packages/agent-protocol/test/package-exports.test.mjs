import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CC_AGENT_PROTOCOL_FEATURES,
  CC_AGENT_PROTOCOL_MIN_VERSION,
  CC_AGENT_PROTOCOL_SCHEMA,
  CC_AGENT_PROTOCOL_SCHEMA_DIGEST,
  CC_AGENT_STREAM_EVENT_TYPES,
  CC_AGENT_PROTOCOL_VERSION,
  assertAgentStreamEvent,
  assertProtocolCompatible,
  assertApprovalDecision,
  compareProtocolSchemas,
  validateAgentStreamEvent,
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
  assert.equal(manifest.version, "0.1.4");
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
