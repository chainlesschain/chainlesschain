import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CC_AGENT_PROTOCOL_FEATURES,
  CC_AGENT_PROTOCOL_MIN_VERSION,
  CC_AGENT_PROTOCOL_SCHEMA,
  CC_AGENT_PROTOCOL_SCHEMA_DIGEST,
  CC_AGENT_PROTOCOL_VERSION,
  assertProtocolCompatible,
  compareProtocolSchemas,
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
});

test("package metadata exposes only supported public entry points", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.name, "@chainlesschain/agent-protocol");
  assert.equal(manifest.version, "0.1.1");
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
