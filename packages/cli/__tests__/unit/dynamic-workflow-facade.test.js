import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DYNAMIC_WORKFLOW_DEFINITION_SCHEMA,
  DYNAMIC_WORKFLOW_PREFLIGHT_SCHEMA,
  buildDynamicWorkflowPreflight,
  createDynamicWorkflowManifest,
} from "../../src/lib/dynamic-workflow-facade.js";
import { createExecutionLocationBinding } from "../../src/lib/execution-location-contract.js";

const WORKFLOW = JSON.parse(
  readFileSync(
    new URL("../fixtures/dynamic-workflow-facade-valid.json", import.meta.url),
    "utf8",
  ),
);

function executionLocation(overrides = {}) {
  return createExecutionLocationBinding({
    location: "local",
    observed: true,
    observedAt: "2026-08-15T00:00:00.000Z",
    source: {
      cwd: "/repo",
      git: { root: "/repo", commit: "a".repeat(40) },
    },
    runtime: { platform: "linux", arch: "x64", tools: ["node"] },
    permissions: {
      status: "declared",
      file: "read",
      shell: false,
      network: false,
      mcp: false,
      externalSystems: false,
    },
    policy: {
      network: "offline",
      sandbox: "strong",
      dataBoundary: { kind: "repository", root: "/repo" },
    },
    ...overrides,
  });
}

describe("dynamic workflow manifest", () => {
  it("produces a deterministic versioned digest, DAG plan, and honest runtime claims", () => {
    const manifest = createDynamicWorkflowManifest(WORKFLOW);
    const reordered = {
      facade: WORKFLOW.facade,
      steps: WORKFLOW.steps,
      name: WORKFLOW.name,
      id: WORKFLOW.id,
    };

    expect(manifest.schema).toBe(DYNAMIC_WORKFLOW_DEFINITION_SCHEMA);
    expect(manifest.definitionDigest).toBe(
      createDynamicWorkflowManifest(reordered).definitionDigest,
    );
    expect(manifest.plan.batches.map((batch) => batch.steps)).toEqual([
      ["collect", "scan"],
      ["review"],
    ]);
    expect(manifest.plan.worstCaseTaskCalls).toBe(4);
    expect(manifest.usedCapabilities).toEqual([
      "cowork-task",
      "dag",
      "parallel",
      "retry",
      "variables",
    ]);
    expect(manifest.runtimeClaims).toEqual({
      durablePauseResume: false,
      exactlyOnceAfterResume: false,
      historyDurability: "best-effort",
      needsInputBetweenStages: false,
    });
    expect(Object.isFrozen(manifest.definition.steps)).toBe(true);
  });

  it("rejects credential values before the raw definition can be projected", () => {
    const unsafe = structuredClone(WORKFLOW);
    unsafe.facade.requirements.credentials = [
      { name: "GH_TOKEN", source: "env", scope: "repo", api_key: "secret" },
    ];

    expect(() => createDynamicWorkflowManifest(unsafe)).toThrow(
      /credential requirements must not contain values/,
    );
  });
});

describe("dynamic workflow preflight", () => {
  it("allows a fully declared workflow within capability, scale, and cost budgets", () => {
    const preflight = buildDynamicWorkflowPreflight({
      workflow: WORKFLOW,
      executionLocation: executionLocation(),
      maxParallel: 2,
    });

    expect(preflight.schema).toBe(DYNAMIC_WORKFLOW_PREFLIGHT_SCHEMA);
    expect(preflight.allowed).toBe(true);
    expect(preflight.blockers).toEqual([]);
    expect(preflight.scale).toMatchObject({
      expansionKnown: true,
      worstCaseTaskCalls: 4,
      requestedParallel: 2,
    });
    expect(preflight.cost).toMatchObject({
      projectedTokens: 400,
      projectedUsd: 0.04,
      projectedDurationMs: 3000,
      projectedDurationSlots: 3,
    });
    expect(preflight.permissions.credentialValuesTransferred).toBe(false);
  });

  it("blocks parallel and token budget overruns", () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.facade.budget.maxTokens = 300;
    const preflight = buildDynamicWorkflowPreflight({
      workflow,
      executionLocation: executionLocation(),
      maxParallel: 3,
    });

    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers).toContain("parallel-budget-exceeded");
    expect(preflight.blockers).toContain("token-budget-exceeded");
  });

  it("does not treat a network grant as an override for an offline policy", () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.facade.requirements.permissions.network = true;
    const binding = executionLocation({
      permissions: {
        status: "declared",
        file: "read",
        shell: false,
        network: true,
        mcp: false,
        externalSystems: false,
      },
    });
    const preflight = buildDynamicWorkflowPreflight({
      workflow,
      executionLocation: binding,
      maxParallel: 2,
    });

    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers).toContain(
      "environment-network-policy-insufficient",
    );
  });

  it("requires credential references to match observed environment sources", () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.facade.requirements.credentials = [
      { name: "GH_TOKEN", source: "env", scope: "repo" },
    ];
    const missing = buildDynamicWorkflowPreflight({
      workflow,
      executionLocation: executionLocation(),
      maxParallel: 2,
    });
    const available = buildDynamicWorkflowPreflight({
      workflow,
      executionLocation: executionLocation({
        credentials: [{ name: "GH_TOKEN", source: "env", scope: "repo" }],
      }),
      maxParallel: 2,
    });

    expect(missing.allowed).toBe(false);
    expect(missing.blockers).toContain(
      "environment-credential-missing:GH_TOKEN",
    );
    expect(available.allowed).toBe(true);
  });

  it("enforces the engine task-call ceiling and rejects invalid parallel input", () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.facade.budget.maxExpandedTasks = 1000;
    const preflight = buildDynamicWorkflowPreflight({
      workflow,
      executionLocation: executionLocation(),
      maxParallel: "many",
    });

    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers).toContain(
      "expanded-task-budget-exceeds-engine-limit",
    );
    expect(preflight.blockers).toContain("requested-parallel-invalid");
    expect(preflight.scale.hardTaskLimit).toBe(64);
  });

  it("blocks runtime-sized fan-out instead of guessing a cost", () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.steps[0].forEach = "${step.source.items}";
    workflow.facade.requirements.capabilities.push("for-each");
    const preflight = buildDynamicWorkflowPreflight({
      workflow,
      executionLocation: executionLocation(),
      maxParallel: 2,
    });

    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers).toContain("runtime-expansion-unknown");
    expect(preflight.blockers).toContain("token-budget-unevaluable");
    expect(preflight.cost.projectedTokens).toBeNull();
  });

  it("blocks unknown capabilities, unobserved environment authority, and digest drift", () => {
    const workflow = structuredClone(WORKFLOW);
    workflow.facade.requirements.capabilities.push("teleport");
    const manifest = {
      ...createDynamicWorkflowManifest(workflow),
      definitionDigest: `sha256:${"f".repeat(64)}`,
    };
    const binding = executionLocation({
      permissions: { status: "not-observed", file: "read" },
      policy: {
        network: "unknown",
        sandbox: "unknown",
        dataBoundary: { kind: "unknown" },
      },
    });
    const preflight = buildDynamicWorkflowPreflight({
      manifest,
      executionLocation: binding,
      maxParallel: 2,
    });

    expect(preflight.allowed).toBe(false);
    expect(preflight.blockers).toEqual(
      expect.arrayContaining([
        "definition-digest-mismatch",
        "unsupported-capability:teleport",
        "environment-permissions-not-observed",
        "environment-sandbox-unknown",
        "environment-data-boundary-unknown",
      ]),
    );
  });
});
