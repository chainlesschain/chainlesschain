import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  assertProtocolCompatible,
  compareProtocolSchemas,
} from "./compatibility.mjs";

const schemaText = readFileSync(
  new URL("../schema/cc-agent-protocol.schema.json", import.meta.url),
  "utf8",
);
const schema = JSON.parse(schemaText);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const CC_AGENT_PROTOCOL_SCHEMA = deepFreeze(schema);
export const CC_AGENT_PROTOCOL_VERSION = schema["x-cc-protocol"].version;
export const CC_AGENT_PROTOCOL_MIN_VERSION =
  schema["x-cc-protocol"].minimumCompatibleVersion;
export const CC_AGENT_PROTOCOL_FEATURES = Object.freeze([
  ...schema["x-cc-protocol"].features,
]);
export const CC_AGENT_PROTOCOL_SCHEMA_DIGEST = `sha256:${createHash("sha256")
  .update(schemaText)
  .digest("hex")}`;

export { assertProtocolCompatible, compareProtocolSchemas };

export default CC_AGENT_PROTOCOL_SCHEMA;
