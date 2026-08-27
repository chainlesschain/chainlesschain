import { afterEach, describe, expect, it } from "vitest";
const {
  assertDesktopLegacyMutationAllowed,
  desktopGraphAuthorityMode,
  desktopLegacyRuntimeClaims,
} = require("../desktop-runtime-authority.js");
const { AgentCoordinator } = require("../../agents/agent-coordinator.js");
const { WorkflowPipeline } = require("../../../workflow/workflow-pipeline.js");
const { WorkflowEngine } = require("../../workflow/workflow-engine.js");
const {
  SkillWorkflowEngine,
} = require("../../cowork/skills/skill-workflow-engine.js");
const {
  assertBrowserWorkflowEnabled,
  browserWorkflowRuntimeClaims,
} = require("../../../browser/workflow/browser-workflow-authority.js");

const originalDesktopMode = process.env.CHAINLESSCHAIN_GRAPH_DESKTOP;
const originalReadOnly = process.env.CHAINLESSCHAIN_DESKTOP_LEGACY_READ_ONLY;

afterEach(() => {
  if (originalDesktopMode === undefined) {
    delete process.env.CHAINLESSCHAIN_GRAPH_DESKTOP;
  } else {
    process.env.CHAINLESSCHAIN_GRAPH_DESKTOP = originalDesktopMode;
  }
  if (originalReadOnly === undefined) {
    delete process.env.CHAINLESSCHAIN_DESKTOP_LEGACY_READ_ONLY;
  } else {
    process.env.CHAINLESSCHAIN_DESKTOP_LEGACY_READ_ONLY = originalReadOnly;
  }
});

describe("Desktop Graph authority retirement", () => {
  it("publishes truthful legacy, shadow, and canonical claims", () => {
    expect(desktopGraphAuthorityMode({})).toBe("legacy");
    expect(
      desktopLegacyRuntimeClaims({ CHAINLESSCHAIN_GRAPH_DESKTOP: "shadow" }),
    ).toMatchObject({
      authorityMode: "shadow",
      authoritySource: "graph_kernel_shadow",
      execution: "legacy",
      legacyReadOnly: false,
    });
    expect(
      desktopLegacyRuntimeClaims({
        CHAINLESSCHAIN_GRAPH_DESKTOP: "canonical",
      }),
    ).toMatchObject({
      authoritySource: "graph_kernel",
      execution: "designer-only",
      legacyReadOnly: true,
    });
  });

  it("fails every classified legacy mutation closed in canonical mode", async () => {
    process.env.CHAINLESSCHAIN_GRAPH_DESKTOP = "canonical";
    const expected = expect.objectContaining({
      code: "CC_DESKTOP_LEGACY_RUNTIME_READ_ONLY",
      authoritySource: "graph_kernel",
    });
    expect(() => assertDesktopLegacyMutationAllowed("fixture")).toThrowError(
      expected,
    );
    await expect(new AgentCoordinator().orchestrate("task")).resolves.toEqual(
      expect.objectContaining({
        success: false,
        code: "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE",
      }),
    );
    await expect(
      new AgentCoordinator().assignTask("agent", "task"),
    ).resolves.toEqual(
      expect.objectContaining({
        success: false,
        code: "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE",
      }),
    );
    await expect(
      new AgentCoordinator().cancelTask("task"),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Active Graph task not found"),
    });
    await expect(new WorkflowPipeline().execute({})).resolves.toEqual(
      expect.objectContaining({
        success: false,
        code: "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE",
      }),
    );
    await expect(
      new WorkflowEngine().executeWorkflow("workflow"),
    ).rejects.toEqual(expected);
    await expect(
      new SkillWorkflowEngine().executeWorkflow("workflow"),
    ).rejects.toEqual(expected);
  });

  it("keeps Browser workflow non-durable and disabled by default", () => {
    expect(browserWorkflowRuntimeClaims({})).toMatchObject({
      execution: "disabled",
      persistence: "non_durable",
      featureGated: true,
    });
    expect(() =>
      assertBrowserWorkflowEnabled("browser:workflow:execute", {}),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_BROWSER_WORKFLOW_EXPERIMENTAL_DISABLED",
      }),
    );
    expect(
      assertBrowserWorkflowEnabled("browser:workflow:execute", {
        CHAINLESSCHAIN_BROWSER_WORKFLOW_EXPERIMENTAL: "1",
      }),
    ).toBe(true);
  });
});
