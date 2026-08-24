import { describe, expect, it } from "vitest";
import {
  GraphCompileError,
  assertCompiledGraph,
  compileGraphDefinition,
  executionAttemptId,
  isCompiledGraph,
  isPortSchemaAssignable,
  migrateGraphDefinition,
  writeScopesOverlap,
} from "../../src/lib/graph-kernel/compiler.js";

function node(id, overrides = {}) {
  return {
    id,
    kind: "task",
    dependsOn: [],
    inputs: [],
    outputs: [],
    effectClass: "none",
    ...overrides,
  };
}

function graph(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "graph-1",
    revision: 1,
    nodes: [node("root")],
    edges: [],
    loops: [],
    subgraphCalls: [],
    budget: {},
    allowedCapabilities: [],
    metadata: {},
    ...overrides,
  };
}

function diagnosticCodes(error) {
  expect(error).toBeInstanceOf(GraphCompileError);
  expect(error.effectStarted).toBe(false);
  return error.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("typed Graph Compiler", () => {
  it("compiles a typed DAG into deterministic immutable indexes", () => {
    const definition = graph({
      allowedCapabilities: ["repo.read", "repo.write"],
      budget: { turns: 8, tokens: 1000 },
      nodes: [
        node("inspect", {
          capabilities: ["repo.read"],
          outputs: [
            { name: "result", schema: { type: "string" }, required: true },
          ],
          budget: { turns: 1, tokens: 100 },
        }),
        node("edit", {
          dependsOn: ["inspect"],
          capabilities: ["repo.write"],
          inputs: [
            { name: "source", schema: { type: "string" }, required: true },
          ],
          inputBindings: { source: "${node.inspect.output.result}" },
          outputs: [
            {
              name: "patch",
              schema: {
                type: "object",
                required: ["digest"],
                properties: { digest: { type: "string" } },
              },
              required: true,
            },
          ],
          budget: { turns: 2, tokens: 400 },
          effectClass: "workspace_write",
          workspaceIsolation: "declared_scope",
          writeSet: ["src/**"],
          idempotencyKey: "edit-v1",
        }),
      ],
      edges: [
        {
          id: "inspect-to-edit",
          from: "inspect",
          to: "edit",
          kind: "data",
          when: "success",
          fromPort: "result",
          toPort: "source",
        },
      ],
    });
    const compiled = compileGraphDefinition(definition);
    expect(isCompiledGraph(compiled)).toBe(true);
    expect(compiled.topologicalOrder).toEqual(["inspect", "edit"]);
    expect(compiled.dependencies.edit).toEqual(["inspect"]);
    expect(compiled.ancestors.edit).toEqual(["inspect"]);
    expect(compiled.descendants.inspect).toEqual(["edit"]);
    expect(compiled.budgetUpperBound).toMatchObject({ turns: 3, tokens: 500 });
    expect(compiled.revisionDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(compiled.definition.nodes[0])).toBe(true);
    expect(assertCompiledGraph(compiled)).toBe(compiled);
  });

  it("rejects cycles and unknown dependencies before effects", () => {
    const definition = graph({
      nodes: [
        node("a", { dependsOn: ["b"] }),
        node("b", { dependsOn: ["a", "missing"] }),
      ],
    });
    expect(() => compileGraphDefinition(definition)).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_COMPILE_FAILED",
        effectStarted: false,
      }),
    );
    try {
      compileGraphDefinition(definition);
    } catch (error) {
      expect(diagnosticCodes(error)).toEqual(
        expect.arrayContaining([
          "GRAPH_DEPENDENCY_CYCLE",
          "GRAPH_UNKNOWN_DEPENDENCY",
        ]),
      );
    }
  });

  it("rejects references outside dependency closure and typed-port drift", () => {
    const definition = graph({
      nodes: [
        node("producer", {
          outputs: [
            { name: "count", schema: { type: "integer" }, required: true },
          ],
        }),
        node("consumer", {
          inputs: [
            { name: "count", schema: { type: "string" }, required: true },
          ],
          inputBindings: { count: "${node.producer.output.count}" },
        }),
      ],
      edges: [
        {
          id: "data-1",
          from: "producer",
          to: "consumer",
          kind: "data",
          when: "success",
          fromPort: "count",
          toPort: "count",
        },
      ],
    });
    try {
      compileGraphDefinition(definition);
    } catch (error) {
      expect(diagnosticCodes(error)).toContain("GRAPH_PORT_TYPE_MISMATCH");
    }

    definition.edges = [];
    try {
      compileGraphDefinition(definition);
    } catch (error) {
      expect(diagnosticCodes(error)).toContain(
        "GRAPH_REFERENCE_OUTSIDE_DEPENDENCY_CLOSURE",
      );
    }
  });

  it("rejects capability escalation and worst-case loop budget overflow", () => {
    const definition = graph({
      budget: { turns: 2 },
      nodes: [
        node("repeat", {
          capabilities: ["network.egress"],
          budget: { turns: 1 },
        }),
      ],
      loops: [
        {
          id: "loop-1",
          entryNodeId: "repeat",
          exitNodeId: "repeat",
          nodeIds: ["repeat"],
          maxIterations: 3,
          condition: "until done",
          budget: { turns: 3 },
        },
      ],
    });
    try {
      compileGraphDefinition(definition);
    } catch (error) {
      expect(diagnosticCodes(error)).toEqual(
        expect.arrayContaining([
          "GRAPH_CAPABILITY_ESCALATION",
          "GRAPH_BUDGET_EXCEEDED",
        ]),
      );
    }
  });

  it("rejects unordered write conflicts but accepts worktree isolation", () => {
    const writer = (id, scope, workspaceIsolation = "declared_scope") =>
      node(id, {
        effectClass: "workspace_write",
        workspaceIsolation,
        writeSet: [scope],
        idempotencyKey: `${id}-effect`,
      });
    const conflicting = graph({
      nodes: [writer("a", "src/**"), writer("b", "src/core/**")],
    });
    try {
      compileGraphDefinition(conflicting);
    } catch (error) {
      expect(diagnosticCodes(error)).toContain("GRAPH_PARALLEL_WRITE_CONFLICT");
    }
    const isolated = graph({
      nodes: [
        writer("a", "src/**", "worktree"),
        writer("b", "src/**", "worktree"),
      ],
    });
    expect(compileGraphDefinition(isolated).topologicalOrder).toEqual([
      "a",
      "b",
    ]);
  });

  it("compiles isolated inverse-effect handlers outside the forward schedule", () => {
    const compiled = compileGraphDefinition(
      graph({
        nodes: [
          node("apply", {
            effectClass: "external",
            idempotencyKey: "apply-v1",
            compensationNodeId: "undo",
          }),
          node("undo", {
            effectClass: "external",
            idempotencyKey: "undo-v1",
          }),
        ],
        edges: [
          {
            id: "apply-compensation",
            from: "apply",
            to: "undo",
            kind: "compensation",
            when: "always",
          },
        ],
      }),
    );

    expect(compiled.forwardTopologicalOrder).toEqual(["apply"]);
    expect(compiled.compensationByNode).toEqual({ apply: "undo" });
    expect(compiled.compensationNodeIds).toEqual(["undo"]);
    expect(Object.isFrozen(compiled.compensationByNode)).toBe(true);
  });

  it("rejects unsafe, missing, reused, or forward-scheduled compensation handlers", () => {
    const definition = graph({
      nodes: [
        node("plain", { compensationNodeId: "missing" }),
        node("apply-a", {
          effectClass: "external",
          idempotencyKey: "apply-a-v1",
          compensationNodeId: "undo",
        }),
        node("apply-b", {
          dependsOn: ["apply-a"],
          effectClass: "external",
          idempotencyKey: "apply-b-v1",
          compensationNodeId: "undo",
        }),
        node("undo", {
          dependsOn: ["apply-b"],
          effectClass: "external",
          idempotencyKey: "undo-v1",
        }),
      ],
    });

    try {
      compileGraphDefinition(definition);
    } catch (error) {
      expect(diagnosticCodes(error)).toEqual(
        expect.arrayContaining([
          "GRAPH_UNKNOWN_COMPENSATION_TARGET",
          "GRAPH_COMPENSATION_TARGET_REUSED",
          "GRAPH_COMPENSATION_TARGET_IN_FORWARD_GRAPH",
        ]),
      );
    }
  });

  it("detects subgraph call cycles and pinned digest drift", () => {
    const definition = graph({
      id: "root-graph",
      nodes: [node("call", { kind: "subgraph" })],
      subgraphCalls: [
        {
          nodeId: "call",
          definitionId: "child-graph",
          revisionDigest: `sha256:${"a".repeat(64)}`,
          maxDepth: 2,
        },
      ],
    });
    const child = graph({
      id: "child-graph",
      nodes: [node("back", { kind: "subgraph" })],
      subgraphCalls: [
        {
          nodeId: "back",
          definitionId: "root-graph",
          revisionDigest: `sha256:${"b".repeat(64)}`,
          maxDepth: 2,
        },
      ],
    });
    try {
      compileGraphDefinition(definition, {
        subgraphs: new Map([
          [
            "child-graph",
            { definition: child, revisionDigest: `sha256:${"c".repeat(64)}` },
          ],
        ]),
      });
    } catch (error) {
      expect(diagnosticCodes(error)).toEqual(
        expect.arrayContaining([
          "GRAPH_SUBGRAPH_CALL_CYCLE",
          "GRAPH_SUBGRAPH_DIGEST_MISMATCH",
        ]),
      );
    }
  });

  it("requires an authenticated compiler result at the effect boundary", () => {
    expect(() => assertCompiledGraph(graph())).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_NOT_COMPILED",
        effectStarted: false,
      }),
    );
  });

  it("provides deterministic attempt ids and schema/scope helpers", () => {
    expect(executionAttemptId("task", [0, 2], 3)).toBe("task@0.2#3");
    expect(writeScopesOverlap("src/**", "src/core/file.js")).toBe(true);
    expect(writeScopesOverlap("src/**", "docs/**")).toBe(false);
    expect(
      isPortSchemaAssignable(
        {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" }, extra: { type: "number" } },
        },
        {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      ),
    ).toBe(true);
  });

  it("dry-runs the N-1 upcast without mutating the source definition", () => {
    const legacy = graph({ schemaVersion: 0, metadata: { legacy: true } });
    const before = structuredClone(legacy);
    const upcasters = {
      0: (definition) => ({
        ...definition,
        schemaVersion: 1,
        metadata: { ...definition.metadata, upcast: "v0-to-v1" },
      }),
    };

    const migration = migrateGraphDefinition(legacy, {
      dryRun: true,
      upcasters,
    });
    expect(migration).toMatchObject({
      dryRun: true,
      fromVersion: 0,
      toVersion: 1,
      backupRequired: true,
      definition: {
        schemaVersion: 1,
        metadata: { legacy: true, upcast: "v0-to-v1" },
      },
    });
    expect(migration.revisionDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(legacy).toEqual(before);
    expect(compileGraphDefinition(legacy, { upcasters }).migratedFrom).toBe(0);

    expect(() =>
      compileGraphDefinition(legacy, {
        upcasters: { 0: (definition) => ({ ...definition, schemaVersion: 2 }) },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_COMPILE_FAILED",
        diagnostics: [
          expect.objectContaining({ code: "GRAPH_CANONICALIZATION_FAILED" }),
        ],
      }),
    );
  });

  it("validates trigger targets and structured region hierarchy before effects", () => {
    const valid = compileGraphDefinition(
      graph({
        triggers: [
          {
            id: "manual-1",
            kind: "manual",
            targetNodeId: "root",
            authorityDigest: `sha256:${"a".repeat(64)}`,
          },
        ],
        regions: [
          {
            id: "region-1",
            kind: "sequence",
            nodeIds: ["root"],
            entryNodeId: "root",
            exitNodeId: "root",
          },
        ],
      }),
    );
    expect(valid).toMatchObject({
      triggers: [expect.objectContaining({ targetNodeId: "root" })],
      regions: [expect.objectContaining({ id: "region-1" })],
    });

    try {
      compileGraphDefinition(
        graph({
          triggers: [
            {
              id: "manual-1",
              kind: "manual",
              targetNodeId: "missing",
              authorityDigest: `sha256:${"a".repeat(64)}`,
            },
          ],
          regions: [
            {
              id: "region-a",
              kind: "sequence",
              nodeIds: ["root"],
              parentRegionId: "region-b",
            },
            {
              id: "region-b",
              kind: "sequence",
              nodeIds: ["missing"],
              parentRegionId: "region-a",
            },
          ],
        }),
      );
    } catch (error) {
      expect(diagnosticCodes(error)).toEqual(
        expect.arrayContaining([
          "GRAPH_UNKNOWN_TRIGGER_TARGET",
          "GRAPH_UNKNOWN_REGION_NODE",
          "GRAPH_REGION_CYCLE",
        ]),
      );
    }
  });
});
