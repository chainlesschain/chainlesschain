import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  assertProtocolCompatible,
  compareProtocolSchemas,
} from "./compatibility.mjs";
import { createProtocolValidators } from "./validation.mjs";

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

const validators = createProtocolValidators(CC_AGENT_PROTOCOL_SCHEMA);

export function validateProtocolMessage(value) {
  return validators.validateProtocolMessage(value);
}

export function validateProtocolDefinition(name, value) {
  return validators.validateProtocolDefinition(name, value);
}

export function validateApprovalDecision(value) {
  return validateProtocolDefinition("ApprovalDecision", value);
}

export function assertProtocolMessage(value) {
  const result = validateProtocolMessage(value);
  if (!result.ok) {
    throw new TypeError(
      `Invalid CC Agent protocol message: ${result.errors
        .map((error) => `${error.path} ${error.message}`)
        .join("; ")}`,
    );
  }
}

export function assertApprovalDecision(value) {
  const result = validateApprovalDecision(value);
  if (!result.ok) {
    throw new TypeError(
      `Invalid ApprovalDecision: ${result.errors
        .map((error) => `${error.path} ${error.message}`)
        .join("; ")}`,
    );
  }
}

export { assertProtocolCompatible, compareProtocolSchemas };

export default CC_AGENT_PROTOCOL_SCHEMA;
