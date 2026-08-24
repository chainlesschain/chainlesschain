import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativeUrl) {
  return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

test("generated clients preserve protocol field names across language keywords", () => {
  const python = read(
    "../../agent-sdk-python/src/chainlesschain_agent_sdk/generated_app_protocol.py",
  );
  const kotlin = read("../generated/kotlin/CcAgentProtocol.kt");
  const swift = read("../generated/swift/CcAgentProtocol.swift");

  assert.match(python, /"from": "Identifier"/u);
  assert.doesNotMatch(python, /^\s+from:/mu);
  assert.match(kotlin, /val `when`: String/u);
  assert.match(swift, /public indirect enum JSONValue: Codable, Sendable/u);
});
