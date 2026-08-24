import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { validate } from "../json-schema-validate.js";

const graphProtocolSchema = JSON.parse(
  readFileSync(
    new URL("../../generated/cc-agent-protocol.schema.json", import.meta.url),
    "utf8",
  ),
);

export const GRAPH_DEFINITION_VERSION = 1;
export const GRAPH_DEFINITION_MIN_VERSION = 1;
export const GRAPH_COMPILE_ERROR = "CC_GRAPH_COMPILE_FAILED";

const compiledGraphs = new WeakSet();
const REFERENCE_PATTERNS = Object.freeze([
  /\$\{node\.(.+?)\.output\.([A-Za-z0-9][A-Za-z0-9._:/-]*)[^}]*\}/gu,
  /\$\{step\.([^.}]+)\.([A-Za-z0-9][A-Za-z0-9._:/-]*)[^}]*\}/gu,
]);
const BUDGET_FIELDS = Object.freeze([
  "turns",
  "tokens",
  "costUsd",
  "wallMs",
  "spawnCount",
]);
const GRAPH_DEFINITION_SCHEMA = Object.freeze({
  ...graphProtocolSchema.$defs.GraphDefinition,
  $defs: graphProtocolSchema.$defs,
});

function stableValue(value, state = { seen: new WeakSet(), nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > 250_000) {
    throw new TypeError("graph definition exceeds canonicalization limits");
  }
  if (Array.isArray(value))
    return value.map((item) => stableValue(item, state));
  if (!value || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("graph definition contains a non-finite number");
    }
    if (["bigint", "function", "symbol", "undefined"].includes(typeof value)) {
      throw new TypeError("graph definition contains a non-JSON value");
    }
    return value;
  }
  if (state.seen.has(value)) {
    throw new TypeError("graph definition contains a cycle or repeated object");
  }
  state.seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("graph definition must contain plain JSON objects");
  }
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableValue(value[key], state)]),
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function canonicalGraphJson(value) {
  return JSON.stringify(stableValue(value));
}

export function graphDigest(value, domain = "cc.graph.definition/v1") {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonicalGraphJson(value))
    .digest("hex")}`;
}

export class GraphCompileError extends Error {
  constructor(diagnostics) {
    const sorted = [...diagnostics].sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.code.localeCompare(right.code),
    );
    super(
      `Graph compilation failed: ${sorted
        .slice(0, 8)
        .map((item) => `${item.code} at ${item.path}`)
        .join("; ")}`,
    );
    this.name = "GraphCompileError";
    this.code = GRAPH_COMPILE_ERROR;
    this.diagnostics = Object.freeze(sorted.map(Object.freeze));
    this.effectStarted = false;
  }
}

function diagnostic(diagnostics, code, path, message, details = {}) {
  diagnostics.push({ code, path, message, ...details });
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function outgoingMap(nodeIds, dependencies) {
  const output = new Map([...nodeIds].map((id) => [id, new Set()]));
  for (const [nodeId, parents] of dependencies) {
    for (const parent of parents) output.get(parent)?.add(nodeId);
  }
  return output;
}

function topologicalSort(nodeIds, dependencies, diagnostics) {
  const indegree = new Map(
    [...nodeIds].map((id) => [id, dependencies.get(id)?.size || 0]),
  );
  const outgoing = outgoingMap(nodeIds, dependencies);
  const ready = [...nodeIds].filter((id) => indegree.get(id) === 0).sort();
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const child of [...(outgoing.get(id) || [])].sort()) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }
  if (order.length !== nodeIds.size) {
    const cycleNodes = [...nodeIds].filter((id) => !order.includes(id)).sort();
    diagnostic(
      diagnostics,
      "GRAPH_DEPENDENCY_CYCLE",
      "#/nodes",
      `task dependency graph contains a cycle: ${cycleNodes.join(", ")}`,
      { nodeIds: cycleNodes },
    );
  }
  return { order, outgoing };
}

function transitiveSets(order, dependencies, outgoing) {
  const ancestors = new Map(
    [...dependencies.keys()].map((id) => [id, new Set()]),
  );
  for (const id of order) {
    const set = ancestors.get(id);
    for (const parent of dependencies.get(id) || []) {
      set.add(parent);
      for (const ancestor of ancestors.get(parent) || []) set.add(ancestor);
    }
  }
  const descendants = new Map(
    [...dependencies.keys()].map((id) => [id, new Set()]),
  );
  for (const id of [...order].reverse()) {
    const set = descendants.get(id);
    for (const child of outgoing.get(id) || []) {
      set.add(child);
      for (const descendant of descendants.get(child) || [])
        set.add(descendant);
    }
  }
  return { ancestors, descendants };
}

function portMap(node, field, diagnostics, index) {
  const ports = new Map();
  const values = node[field] || [];
  for (const [portIndex, port] of values.entries()) {
    if (ports.has(port.name)) {
      diagnostic(
        diagnostics,
        "GRAPH_DUPLICATE_PORT",
        `#/nodes/${index}/${field}/${portIndex}/name`,
        `duplicate ${field} port: ${port.name}`,
      );
    }
    ports.set(port.name, port);
  }
  return ports;
}

function schemaTypeSet(schema) {
  if (!schema || Object.keys(schema).length === 0) return null;
  const type = schema.type;
  if (Array.isArray(type)) return new Set(type);
  if (typeof type === "string") return new Set([type]);
  if (schema.const !== undefined) {
    if (schema.const === null) return new Set(["null"]);
    if (Array.isArray(schema.const)) return new Set(["array"]);
    return new Set([typeof schema.const]);
  }
  return null;
}

export function isPortSchemaAssignable(producer, consumer) {
  if (!consumer || Object.keys(consumer).length === 0) return true;
  if (canonicalGraphJson(producer) === canonicalGraphJson(consumer))
    return true;
  const sourceTypes = schemaTypeSet(producer);
  const targetTypes = schemaTypeSet(consumer);
  if (
    sourceTypes &&
    targetTypes &&
    [...sourceTypes].some((type) => !targetTypes.has(type))
  ) {
    return false;
  }
  if (Array.isArray(producer?.enum) && Array.isArray(consumer?.enum)) {
    const allowed = new Set(consumer.enum.map((item) => JSON.stringify(item)));
    if (producer.enum.some((item) => !allowed.has(JSON.stringify(item))))
      return false;
  }
  if (
    producer?.type === "object" &&
    consumer?.type === "object" &&
    consumer.properties
  ) {
    const sourceProperties = producer.properties || {};
    for (const required of consumer.required || []) {
      if (!Object.hasOwn(sourceProperties, required)) return false;
    }
    for (const [name, target] of Object.entries(consumer.properties)) {
      if (
        Object.hasOwn(sourceProperties, name) &&
        !isPortSchemaAssignable(sourceProperties[name], target)
      ) {
        return false;
      }
    }
  }
  if (producer?.type === "array" && consumer?.type === "array") {
    return isPortSchemaAssignable(producer.items || {}, consumer.items || {});
  }
  return true;
}

function normalizeScope(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/{2,}/gu, "/")
    .replace(/\/$/u, "");
}

function staticScopePrefix(value) {
  const scope = normalizeScope(value);
  const wildcard = scope.search(/[?*[\]{}]/u);
  return (wildcard < 0 ? scope : scope.slice(0, wildcard)).replace(/\/$/u, "");
}

export function writeScopesOverlap(left, right) {
  const a = staticScopePrefix(left);
  const b = staticScopePrefix(right);
  if (!a || !b) return true;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function loopMultipliers(definition, diagnostics, nodeIds) {
  const multiplier = new Map([...nodeIds].map((id) => [id, 1]));
  const membership = new Map();
  for (const [index, loop] of definition.loops.entries()) {
    for (const endpoint of [loop.entryNodeId, loop.exitNodeId]) {
      if (!nodeIds.has(endpoint)) {
        diagnostic(
          diagnostics,
          "GRAPH_UNKNOWN_LOOP_ENDPOINT",
          `#/loops/${index}`,
          `loop endpoint does not exist: ${endpoint}`,
        );
      }
    }
    for (const nodeId of loop.nodeIds) {
      if (!nodeIds.has(nodeId)) {
        diagnostic(
          diagnostics,
          "GRAPH_UNKNOWN_LOOP_NODE",
          `#/loops/${index}/nodeIds`,
          `loop node does not exist: ${nodeId}`,
        );
        continue;
      }
      const owners = membership.get(nodeId) || [];
      owners.push(loop.id);
      membership.set(nodeId, owners);
      multiplier.set(nodeId, multiplier.get(nodeId) * loop.maxIterations);
    }
    if (
      !loop.nodeIds.includes(loop.entryNodeId) ||
      !loop.nodeIds.includes(loop.exitNodeId)
    ) {
      diagnostic(
        diagnostics,
        "GRAPH_LOOP_BOUNDARY_OUTSIDE_REGION",
        `#/loops/${index}`,
        "loop entry and exit must be members of the region",
      );
    }
  }
  for (const [nodeId, owners] of membership) {
    if (owners.length > 1) {
      diagnostic(
        diagnostics,
        "GRAPH_OVERLAPPING_LOOP_REGION",
        "#/loops",
        `node belongs to overlapping loop regions: ${nodeId}`,
        { nodeId, loopIds: owners },
      );
    }
  }
  return multiplier;
}

function budgetUpperBound(definition, multiplier, diagnostics) {
  const total = Object.fromEntries(BUDGET_FIELDS.map((field) => [field, 0]));
  for (const node of definition.nodes) {
    for (const field of BUDGET_FIELDS) {
      total[field] +=
        Number(node.budget?.[field] || 0) * multiplier.get(node.id);
    }
  }
  for (const field of BUDGET_FIELDS) {
    const cap = definition.budget?.[field];
    if (cap != null && total[field] > cap) {
      diagnostic(
        diagnostics,
        "GRAPH_BUDGET_EXCEEDED",
        `#/budget/${field}`,
        `worst-case ${field} budget ${total[field]} exceeds cap ${cap}`,
        { field, required: total[field], cap },
      );
    }
  }
  return total;
}

function validateSubgraphs(definition, nodeIds, options, diagnostics) {
  const registry = options.subgraphs || new Map();
  const calls = new Map();
  for (const [index, call] of definition.subgraphCalls.entries()) {
    if (!nodeIds.has(call.nodeId)) {
      diagnostic(
        diagnostics,
        "GRAPH_UNKNOWN_SUBGRAPH_NODE",
        `#/subgraphCalls/${index}/nodeId`,
        `subgraph call node does not exist: ${call.nodeId}`,
      );
    }
    const target =
      registry instanceof Map
        ? registry.get(call.definitionId)
        : registry[call.definitionId];
    if (target && target.revisionDigest !== call.revisionDigest) {
      diagnostic(
        diagnostics,
        "GRAPH_SUBGRAPH_DIGEST_MISMATCH",
        `#/subgraphCalls/${index}/revisionDigest`,
        `subgraph digest does not match pinned revision: ${call.definitionId}`,
      );
    }
    calls.set(call.nodeId, call);
  }

  const definitions = new Map();
  definitions.set(definition.id, definition);
  if (registry instanceof Map) {
    for (const [id, value] of registry) {
      definitions.set(id, value.definition || value);
    }
  } else {
    for (const [id, value] of Object.entries(registry)) {
      definitions.set(id, value.definition || value);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, path = []) => {
    if (visiting.has(id)) {
      diagnostic(
        diagnostics,
        "GRAPH_SUBGRAPH_CALL_CYCLE",
        "#/subgraphCalls",
        `subgraph call cycle: ${[...path, id].join(" -> ")}`,
      );
      return;
    }
    if (visited.has(id)) return;
    const current = definitions.get(id);
    if (!current) return;
    visiting.add(id);
    for (const call of current.subgraphCalls || []) {
      visit(call.definitionId, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  visit(definition.id);
  return calls;
}

function migrateDefinition(input, options) {
  const sourceVersion = Number(input?.schemaVersion);
  if (sourceVersion === GRAPH_DEFINITION_VERSION) {
    return { definition: stableValue(input), migratedFrom: null };
  }
  const upcaster = options.upcasters?.[sourceVersion];
  if (
    sourceVersion === GRAPH_DEFINITION_VERSION - 1 &&
    typeof upcaster === "function"
  ) {
    const migrated = upcaster(stableValue(input));
    if (Number(migrated?.schemaVersion) !== GRAPH_DEFINITION_VERSION) {
      throw new TypeError("graph upcaster did not produce the current version");
    }
    return { definition: stableValue(migrated), migratedFrom: sourceVersion };
  }
  return { definition: stableValue(input), migratedFrom: null };
}

export function compileGraphDefinition(input, options = {}) {
  const diagnostics = [];
  let migrated;
  try {
    migrated = migrateDefinition(input, options);
  } catch (error) {
    throw new GraphCompileError([
      {
        code: "GRAPH_CANONICALIZATION_FAILED",
        path: "#",
        message: error.message,
      },
    ]);
  }
  const definition = migrated.definition;
  const schemaResult = validate(definition, GRAPH_DEFINITION_SCHEMA);
  for (const error of schemaResult.errors) {
    diagnostic(
      diagnostics,
      "GRAPH_SCHEMA_INVALID",
      error.instancePath || error.schemaPath || "#",
      error.message || "graph schema is invalid",
    );
  }
  if (!schemaResult.valid) throw new GraphCompileError(diagnostics);
  if (
    definition.schemaVersion < GRAPH_DEFINITION_MIN_VERSION ||
    definition.schemaVersion > GRAPH_DEFINITION_VERSION
  ) {
    diagnostic(
      diagnostics,
      "GRAPH_SCHEMA_VERSION_UNSUPPORTED",
      "#/schemaVersion",
      `supported GraphDefinition versions are ${GRAPH_DEFINITION_MIN_VERSION}-${GRAPH_DEFINITION_VERSION}`,
    );
  }

  for (const id of duplicateValues(definition.nodes.map((node) => node.id))) {
    diagnostic(
      diagnostics,
      "GRAPH_DUPLICATE_NODE_ID",
      "#/nodes",
      `duplicate node id: ${id}`,
    );
  }
  for (const id of duplicateValues(definition.edges.map((edge) => edge.id))) {
    diagnostic(
      diagnostics,
      "GRAPH_DUPLICATE_EDGE_ID",
      "#/edges",
      `duplicate edge id: ${id}`,
    );
  }
  for (const id of duplicateValues(definition.loops.map((loop) => loop.id))) {
    diagnostic(
      diagnostics,
      "GRAPH_DUPLICATE_REGION_ID",
      "#/loops",
      `duplicate loop region id: ${id}`,
    );
  }
  for (const id of duplicateValues(
    (definition.triggers || []).map((item) => item.id),
  )) {
    diagnostic(
      diagnostics,
      "GRAPH_DUPLICATE_TRIGGER_ID",
      "#/triggers",
      `duplicate trigger binding id: ${id}`,
    );
  }
  const declaredRegionIds = [
    ...definition.loops.map((region) => region.id),
    ...(definition.regions || []).map((region) => region.id),
  ];
  for (const id of duplicateValues(declaredRegionIds)) {
    diagnostic(
      diagnostics,
      "GRAPH_DUPLICATE_REGION_ID",
      "#/regions",
      `duplicate region id: ${id}`,
    );
  }
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodes.keys());
  for (const [index, trigger] of (definition.triggers || []).entries()) {
    if (!nodeIds.has(trigger.targetNodeId)) {
      diagnostic(
        diagnostics,
        "GRAPH_UNKNOWN_TRIGGER_TARGET",
        `#/triggers/${index}/targetNodeId`,
        `trigger targets unknown node: ${trigger.targetNodeId}`,
      );
    }
  }
  const regions = new Map(
    (definition.regions || []).map((region) => [region.id, region]),
  );
  for (const [index, region] of (definition.regions || []).entries()) {
    for (const regionNodeId of region.nodeIds) {
      if (!nodeIds.has(regionNodeId)) {
        diagnostic(
          diagnostics,
          "GRAPH_UNKNOWN_REGION_NODE",
          `#/regions/${index}/nodeIds`,
          `region contains unknown node: ${regionNodeId}`,
        );
      }
    }
    for (const [field, regionNodeId] of [
      ["entryNodeId", region.entryNodeId],
      ["exitNodeId", region.exitNodeId],
    ]) {
      if (regionNodeId && !region.nodeIds.includes(regionNodeId)) {
        diagnostic(
          diagnostics,
          "GRAPH_REGION_BOUNDARY_OUTSIDE_REGION",
          `#/regions/${index}/${field}`,
          `${field} must belong to region ${region.id}`,
        );
      }
    }
    if (region.parentRegionId && !regions.has(region.parentRegionId)) {
      diagnostic(
        diagnostics,
        "GRAPH_UNKNOWN_PARENT_REGION",
        `#/regions/${index}/parentRegionId`,
        `unknown parent region: ${region.parentRegionId}`,
      );
    }
    const parentPath = new Set([region.id]);
    let parentId = region.parentRegionId;
    while (parentId && regions.has(parentId)) {
      if (parentPath.has(parentId)) {
        diagnostic(
          diagnostics,
          "GRAPH_REGION_CYCLE",
          `#/regions/${index}/parentRegionId`,
          `region parent hierarchy contains a cycle at ${parentId}`,
        );
        break;
      }
      parentPath.add(parentId);
      parentId = regions.get(parentId).parentRegionId;
    }
  }
  const inputs = new Map();
  const outputs = new Map();
  const dependencies = new Map(
    definition.nodes.map((node) => [node.id, new Set(node.dependsOn)]),
  );
  for (const [index, node] of definition.nodes.entries()) {
    inputs.set(node.id, portMap(node, "inputs", diagnostics, index));
    outputs.set(node.id, portMap(node, "outputs", diagnostics, index));
    for (const dependency of node.dependsOn) {
      if (!nodeIds.has(dependency)) {
        diagnostic(
          diagnostics,
          "GRAPH_UNKNOWN_DEPENDENCY",
          `#/nodes/${index}/dependsOn`,
          `unknown dependency ${dependency} for ${node.id}`,
        );
      }
      if (dependency === node.id) {
        diagnostic(
          diagnostics,
          "GRAPH_SELF_DEPENDENCY",
          `#/nodes/${index}/dependsOn`,
          `node cannot depend on itself: ${node.id}`,
        );
      }
    }
    const allowedCapabilities = new Set(definition.allowedCapabilities || []);
    for (const capability of node.capabilities || []) {
      if (!allowedCapabilities.has(capability)) {
        diagnostic(
          diagnostics,
          "GRAPH_CAPABILITY_ESCALATION",
          `#/nodes/${index}/capabilities`,
          `node requests capability outside graph authority: ${capability}`,
        );
      }
    }
    if (
      ["workspace_write", "external"].includes(node.effectClass) &&
      !node.idempotencyKey
    ) {
      diagnostic(
        diagnostics,
        "GRAPH_EFFECT_MISSING_IDEMPOTENCY_KEY",
        `#/nodes/${index}/idempotencyKey`,
        `effectful node requires an idempotency key: ${node.id}`,
      );
    }
    if (
      node.effectClass === "workspace_write" &&
      node.workspaceIsolation !== "worktree" &&
      (!Array.isArray(node.writeSet) || node.writeSet.length === 0)
    ) {
      diagnostic(
        diagnostics,
        "GRAPH_WRITE_SCOPE_REQUIRED",
        `#/nodes/${index}/writeSet`,
        `writable node must use a worktree or declare a write set: ${node.id}`,
      );
    }
    if (node.join === "quorum" && !(node.quorum >= 1)) {
      diagnostic(
        diagnostics,
        "GRAPH_INVALID_QUORUM",
        `#/nodes/${index}/quorum`,
        "quorum join requires a positive quorum",
      );
    }
  }

  const dependencyPolicies = new Map(
    definition.nodes.map((node) => [
      node.id,
      new Map(node.dependsOn.map((dependency) => [dependency, "success"])),
    ]),
  );
  for (const [index, edge] of definition.edges.entries()) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from) {
      diagnostic(
        diagnostics,
        "GRAPH_UNKNOWN_EDGE_SOURCE",
        `#/edges/${index}/from`,
        `unknown edge source: ${edge.from}`,
      );
    }
    if (!to) {
      diagnostic(
        diagnostics,
        "GRAPH_UNKNOWN_EDGE_TARGET",
        `#/edges/${index}/to`,
        `unknown edge target: ${edge.to}`,
      );
    }
    if (!from || !to) continue;
    if (edge.kind !== "compensation") {
      dependencies.get(to.id).add(from.id);
      dependencyPolicies.get(to.id).set(from.id, edge.when);
    }
    if (edge.kind === "data") {
      const sourcePort = outputs.get(from.id).get(edge.fromPort);
      const targetPort = inputs.get(to.id).get(edge.toPort);
      if (!sourcePort) {
        diagnostic(
          diagnostics,
          "GRAPH_UNKNOWN_OUTPUT_PORT",
          `#/edges/${index}/fromPort`,
          `unknown output port ${edge.fromPort} on ${from.id}`,
        );
      }
      if (!targetPort) {
        diagnostic(
          diagnostics,
          "GRAPH_UNKNOWN_INPUT_PORT",
          `#/edges/${index}/toPort`,
          `unknown input port ${edge.toPort} on ${to.id}`,
        );
      }
      if (
        sourcePort &&
        targetPort &&
        !isPortSchemaAssignable(sourcePort.schema, targetPort.schema)
      ) {
        diagnostic(
          diagnostics,
          "GRAPH_PORT_TYPE_MISMATCH",
          `#/edges/${index}`,
          `${from.id}.${edge.fromPort} is not assignable to ${to.id}.${edge.toPort}`,
        );
      }
    }
  }

  const { order, outgoing } = topologicalSort(
    nodeIds,
    dependencies,
    diagnostics,
  );
  const { ancestors, descendants } = transitiveSets(
    order,
    dependencies,
    outgoing,
  );

  for (const [index, node] of definition.nodes.entries()) {
    for (const [inputName, binding] of Object.entries(
      node.inputBindings || {},
    )) {
      for (const pattern of REFERENCE_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of binding.matchAll(pattern)) {
          const [, sourceId, portName] = match;
          if (!nodes.has(sourceId)) {
            diagnostic(
              diagnostics,
              "GRAPH_UNKNOWN_DATA_REFERENCE",
              `#/nodes/${index}/inputBindings/${inputName}`,
              `input references unknown node: ${sourceId}`,
            );
          } else if (!ancestors.get(node.id)?.has(sourceId)) {
            diagnostic(
              diagnostics,
              "GRAPH_REFERENCE_OUTSIDE_DEPENDENCY_CLOSURE",
              `#/nodes/${index}/inputBindings/${inputName}`,
              `input references ${sourceId} without a transitive dependency`,
            );
          } else if (!outputs.get(sourceId)?.has(portName)) {
            diagnostic(
              diagnostics,
              "GRAPH_UNKNOWN_OUTPUT_PORT",
              `#/nodes/${index}/inputBindings/${inputName}`,
              `input references unknown output ${sourceId}.${portName}`,
            );
          }
        }
      }
    }
  }

  for (let leftIndex = 0; leftIndex < definition.nodes.length; leftIndex += 1) {
    const left = definition.nodes[leftIndex];
    if (!["workspace_write", "external"].includes(left.effectClass)) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < definition.nodes.length;
      rightIndex += 1
    ) {
      const right = definition.nodes[rightIndex];
      if (!["workspace_write", "external"].includes(right.effectClass))
        continue;
      if (
        ancestors.get(left.id)?.has(right.id) ||
        ancestors.get(right.id)?.has(left.id)
      ) {
        continue;
      }
      if (
        left.workspaceIsolation === "worktree" &&
        right.workspaceIsolation === "worktree"
      ) {
        continue;
      }
      const overlap = (left.writeSet || []).some((leftScope) =>
        (right.writeSet || []).some((rightScope) =>
          writeScopesOverlap(leftScope, rightScope),
        ),
      );
      if (
        overlap ||
        left.effectClass === "external" ||
        right.effectClass === "external"
      ) {
        diagnostic(
          diagnostics,
          "GRAPH_PARALLEL_WRITE_CONFLICT",
          "#/nodes",
          `unordered effectful nodes require worktrees or disjoint scopes: ${left.id}, ${right.id}`,
          { nodeIds: [left.id, right.id] },
        );
      }
    }
  }

  const multiplier = loopMultipliers(definition, diagnostics, nodeIds);
  const budget = budgetUpperBound(definition, multiplier, diagnostics);
  const subgraphCalls = validateSubgraphs(
    definition,
    nodeIds,
    options,
    diagnostics,
  );
  if (diagnostics.length) throw new GraphCompileError(diagnostics);

  const revisionDigest = graphDigest(
    definition,
    `cc.graph.definition/${definition.schemaVersion}`,
  );
  const compiled = {
    schema: "chainlesschain.compiled-graph/v1",
    schemaVersion: definition.schemaVersion,
    definition: deepFreeze(definition),
    definitionId: definition.id,
    revision: definition.revision,
    revisionDigest,
    migratedFrom: migrated.migratedFrom,
    nodes: deepFreeze(
      Object.fromEntries([...nodes].map(([id, value]) => [id, value])),
    ),
    topologicalOrder: Object.freeze(order),
    dependencies: deepFreeze(
      Object.fromEntries(
        [...dependencies].map(([id, values]) => [id, [...values].sort()]),
      ),
    ),
    dependencyPolicies: deepFreeze(
      Object.fromEntries(
        [...dependencyPolicies].map(([id, values]) => [
          id,
          Object.fromEntries([...values].sort()),
        ]),
      ),
    ),
    ancestors: deepFreeze(
      Object.fromEntries(
        [...ancestors].map(([id, values]) => [id, [...values].sort()]),
      ),
    ),
    descendants: deepFreeze(
      Object.fromEntries(
        [...descendants].map(([id, values]) => [id, [...values].sort()]),
      ),
    ),
    loopMultipliers: deepFreeze(Object.fromEntries(multiplier)),
    budgetUpperBound: deepFreeze(budget),
    subgraphCalls: deepFreeze(Object.fromEntries(subgraphCalls)),
    triggers: deepFreeze([...(definition.triggers || [])]),
    regions: deepFreeze([...(definition.regions || [])]),
  };
  deepFreeze(compiled);
  compiledGraphs.add(compiled);
  return compiled;
}

export function isCompiledGraph(value) {
  return compiledGraphs.has(value);
}

export function assertCompiledGraph(value) {
  if (!isCompiledGraph(value)) {
    const error = new TypeError(
      "Graph effects require an authenticated compileGraphDefinition result",
    );
    error.code = "CC_GRAPH_NOT_COMPILED";
    error.effectStarted = false;
    throw error;
  }
  return value;
}

export function migrateGraphDefinition(input, options = {}) {
  const { definition, migratedFrom } = migrateDefinition(input, options);
  const compiled = compileGraphDefinition(definition, options);
  return Object.freeze({
    dryRun: options.dryRun !== false,
    fromVersion: migratedFrom ?? definition.schemaVersion,
    toVersion: compiled.schemaVersion,
    definition: compiled.definition,
    revisionDigest: compiled.revisionDigest,
    backupRequired: migratedFrom != null,
  });
}

export function executionAttemptId(nodeId, iterationPath = [], attempt = 1) {
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new TypeError("attempt must be a positive integer");
  }
  const path = Array.isArray(iterationPath)
    ? iterationPath.map((value) => {
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number < 0) {
          throw new TypeError(
            "iterationPath must contain non-negative integers",
          );
        }
        return number;
      })
    : [];
  return `${nodeId}@${path.length ? path.join(".") : "root"}#${attempt}`;
}
