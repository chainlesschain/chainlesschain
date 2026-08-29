import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(root, "..", "..");
export const protocolSchemaPath = resolve(root, "schema", "cc-agent-protocol.schema.json");
export const contextMemorySchemaPath = resolve(
  repositoryRoot,
  "packages",
  "context-memory-kernel",
  "schema",
  "context-memory-kernel.schema.json",
);

export const contextMemoryMethods = Object.freeze({
  "context/plan": ["ContextPlanRequest", "ContextPlan"],
  "context/compact": ["ContextCompactRequest", "ContextCompactionReceipt"],
  "memory/recall": ["MemoryRecallRequest", "MemoryRecallResult"],
  "memory/propose": ["MemoryProposalRequest", "MemoryMutationReceipt"],
  "memory/decide": ["MemoryDecisionRequest", "MemoryMutationReceipt"],
  "memory/delete": ["MemoryDeletionRequest", "MemoryDeletionReceipt"],
  "memory/reconcile": ["MemoryReconcileRequest", "ContextMemoryJsonValue"],
});

export const contextMemoryLifecycleEvents = Object.freeze([
  "context.plan.created",
  "context.plan.rejected",
  "context.compaction.started",
  "context.compaction.committed",
  "context.compaction.aborted",
  "context.compaction.reconciliation_required",
  "memory.candidate.created",
  "memory.activated",
  "memory.reinforced",
  "memory.superseded",
  "memory.expired",
  "memory.deleted",
  "memory.purged",
  "memory.recalled",
]);

const baseDefinitionNames = Object.freeze({
  Identifier: "ContextMemoryIdentifier",
  Digest: "ContextMemoryDigest",
  Timestamp: "ContextMemoryTimestamp",
  JsonValue: "ContextMemoryJsonValue",
});

function mappedName(name) {
  return baseDefinitionNames[name] || name;
}

function transformNode(value) {
  if (Array.isArray(value)) return value.map(transformNode);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string" && child.startsWith("#/$defs/")) {
      output[key] = `#/$defs/${mappedName(child.slice("#/$defs/".length))}`;
    } else {
      output[key] = transformNode(child);
    }
  }
  return output;
}

export function protocolContextMemoryDefinitions(contextMemorySchema) {
  return Object.fromEntries(
    Object.entries(contextMemorySchema.$defs).map(([name, definition]) => [
      mappedName(name),
      transformNode(definition),
    ]),
  );
}

function streamDefinitionName(type) {
  return `Agent${type
    .split(/[._-]/u)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("")}StreamEvent`;
}

function lifecycleStreamDefinition(type) {
  const properties = {
    type: { const: type },
    operation_id: { $ref: "#/$defs/ContextMemoryIdentifier" },
    request_id: { $ref: "#/$defs/ContextMemoryIdentifier" },
    session_id: { $ref: "#/$defs/ContextMemoryIdentifier" },
    memory_id: { $ref: "#/$defs/ContextMemoryIdentifier" },
    revision: { type: "integer", minimum: 1 },
    record_digest: { $ref: "#/$defs/ContextMemoryDigest" },
    reason_code: { type: "string", minLength: 1, maxLength: 160 },
  };
  const required = ["type"];
  if (type === "context.plan.created") {
    required.push("plan");
    properties.plan = { $ref: "#/$defs/ContextPlan" };
  } else if (type === "context.plan.rejected") {
    required.push("reason_code");
  } else if (type === "context.compaction.committed") {
    required.push("operation_id", "receipt");
    properties.receipt = { $ref: "#/$defs/ContextCompactionReceipt" };
  } else if (type === "context.compaction.reconciliation_required") {
    required.push("operation_id", "receipt");
    properties.receipt = { $ref: "#/$defs/ContextCompactionReceipt" };
  } else if (type.startsWith("context.compaction.")) {
    required.push("operation_id");
    if (type.endsWith("aborted")) required.push("reason_code");
  } else if (type === "memory.recalled") {
    required.push("result");
    properties.result = { $ref: "#/$defs/MemoryRecallResult" };
  } else {
    required.push("memory_id", "revision", "record_digest");
    if (type === "memory.purged") {
      properties.receipt = { $ref: "#/$defs/MemoryDeletionReceipt" };
    } else {
      properties.record = { $ref: "#/$defs/MemoryRecord" };
    }
  }
  return { type: "object", required, properties };
}

function appendUnique(values, additions) {
  const seen = new Set(values);
  for (const addition of additions) {
    if (!seen.has(addition)) {
      values.push(addition);
      seen.add(addition);
    }
  }
}

export function composeContextMemoryProtocolSchema(protocolSchema, contextMemorySchema, contextMemoryText) {
  const next = structuredClone(protocolSchema);
  const sourceDigest = `sha256:${createHash("sha256").update(contextMemoryText).digest("hex")}`;
  appendUnique(next["x-cc-protocol"].features, ["context_memory_kernel"]);
  next["x-cc-protocol"].contextMemory = {
    schemaId: contextMemorySchema.$id,
    schemaVersion: contextMemorySchema["x-cc-context-memory"].version,
    sourceDigest,
    methods: Object.fromEntries(
      Object.entries(contextMemoryMethods).map(([method, [request, response]]) => [
        method,
        { request, response },
      ]),
    ),
    lifecycleEvents: [...contextMemoryLifecycleEvents],
  };

  Object.assign(next.$defs, protocolContextMemoryDefinitions(contextMemorySchema));
  const eventTypes = next.$defs.AgentStreamEventType.enum;
  appendUnique(eventTypes, contextMemoryLifecycleEvents);
  const eventPayloads = next.$defs.AgentStreamEventPayload.oneOf;
  const payloadReferences = new Set(eventPayloads.map((entry) => entry.$ref));
  for (const type of contextMemoryLifecycleEvents) {
    const name = streamDefinitionName(type);
    next.$defs[name] = lifecycleStreamDefinition(type);
    const reference = `#/$defs/${name}`;
    if (!payloadReferences.has(reference)) eventPayloads.push({ $ref: reference });
  }

  const clientVariants = next.$defs.ClientRequest.allOf[1].oneOf;
  const typedMethods = new Set(
    clientVariants.map((branch) => branch?.properties?.method?.const).filter(Boolean),
  );
  for (const [method, [request]] of Object.entries(contextMemoryMethods)) {
    if (typedMethods.has(method)) continue;
    clientVariants.push({
      required: ["params"],
      properties: {
        method: { const: method },
        params: { $ref: `#/$defs/${request}` },
      },
    });
  }
  appendUnique(next.$defs.ServerNotification.properties.method.enum, ["context/event", "memory/event"]);
  return next;
}

export function synchronizeContextMemoryProtocolSchema({ checkOnly = false } = {}) {
  const protocolText = readFileSync(protocolSchemaPath, "utf8");
  const contextMemoryText = readFileSync(contextMemorySchemaPath, "utf8");
  const desired = composeContextMemoryProtocolSchema(
    JSON.parse(protocolText),
    JSON.parse(contextMemoryText),
    contextMemoryText,
  );
  const desiredText = `${JSON.stringify(desired, null, 2)}\n`;
  if (protocolText === desiredText) return { stale: false, schema: desired };
  if (checkOnly) {
    throw new Error("Agent Protocol context/memory schema projection is stale; run npm run context-memory:sync");
  }
  writeFileSync(protocolSchemaPath, desiredText, "utf8");
  return { stale: true, schema: desired };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = synchronizeContextMemoryProtocolSchema({ checkOnly: process.argv.includes("--check") });
  console.error(result.stale ? `Wrote ${protocolSchemaPath}` : "Context/Memory protocol projection is current");
}
