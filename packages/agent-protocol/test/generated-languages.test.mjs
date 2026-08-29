import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativeUrl) {
  return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

test("generated clients preserve protocol field names across language keywords", () => {
  const typescript = read("../../agent-sdk/src/generated/app-protocol.ts");
  const python = read(
    "../../agent-sdk-python/src/chainlesschain_agent_sdk/generated_app_protocol.py",
  );
  const kotlin = read("../generated/kotlin/CcAgentProtocol.kt");
  const swift = read("../generated/swift/CcAgentProtocol.swift");

  assert.match(python, /"from": "Identifier"/u);
  assert.doesNotMatch(python, /^\s+from:/mu);
  assert.match(python, /def validate_approval_decision\(/u);
  assert.match(python, /def validate_agent_stream_event\(/u);
  assert.match(python, /def validate_canonical_agent_stream_event\(/u);
  assert.match(python, /AgentStreamEventPayload: TypeAlias = Union\[/u);
  assert.match(python, /AgentStreamEventType: TypeAlias = Literal\[/u);
  assert.match(python, /class AgentStreamEventEnvelope\(/u);
  assert.match(kotlin, /val `when`: String/u);
  assert.match(kotlin, /val `trusted-system`: Long\?/u);
  assert.match(kotlin, /sealed interface ApprovalDecision/u);
  assert.match(
    kotlin,
    /data class AcceptForSession\([\s\S]*permissions: List<PermissionGrant>\?/u,
  );
  assert.match(kotlin, /fun parseApprovalDecision\(value: Any\?\)/u);
  assert.match(kotlin, /fun ApprovalDecision\.toWireValue\(\)/u);
  assert.match(kotlin, /approvalPermissionsWireValue/u);
  assert.match(kotlin, /unexpected ApprovalDecision properties/u);
  assert.match(
    kotlin,
    /enum class AgentStreamEventType\(val wireValue: String\)/u,
  );
  assert.match(kotlin, /STRUCTURED_RESULT\("structured_result"\)/u);
  assert.match(kotlin, /data class AgentStreamEventEnvelope\(/u);
  assert.match(kotlin, /val type: AgentStreamEventType/u);
  assert.match(kotlin, /sealed interface AgentStreamEventPayload/u);
  assert.match(
    kotlin,
    /data class AgentToolUseStreamEvent\([\s\S]*: AgentStreamEventPayload/u,
  );
  assert.match(swift, /public indirect enum JSONValue: Codable, Sendable/u);
  assert.match(swift, /public let trustedSystem: Int\?/u);
  assert.match(swift, /case trustedSystem = "trusted-system"/u);
  assert.match(swift, /case `public` = "public"/u);
  assert.match(swift, /case `internal` = "internal"/u);
  assert.match(swift, /public enum ApprovalDecision: Codable, Sendable/u);
  assert.match(
    swift,
    /case acceptForSession\(permissions: \[PermissionGrant\]\?\)/u,
  );
  assert.match(swift, /unexpected ApprovalDecision properties/u);
  assert.match(
    swift,
    /public enum AgentStreamEventType: String, Codable, Sendable/u,
  );
  assert.match(swift, /case structuredResult = "structured_result"/u);
  assert.match(
    swift,
    /public struct AgentStreamEventEnvelope: Codable, Sendable/u,
  );
  assert.match(swift, /public let type: AgentStreamEventType/u);
  assert.match(typescript, /export type AgentStreamEventPayload =/u);
  assert.match(
    typescript,
    /export function validateCanonicalAgentStreamEvent/u,
  );
  assert.match(
    swift,
    /public enum AgentStreamEventPayload: Codable, Sendable/u,
  );
  assert.match(swift, /case toolUse\(AgentToolUseStreamEvent\)/u);
});
