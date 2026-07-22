import { describe, expect, it } from "vitest";
import { executeTool } from "../../src/runtime/agent-core.js";

describe("agent-core tool admission integration", () => {
  it("blocks an extension tool before execution and records safe attribution", async () => {
    const result = await executeTool(
      "run_skill",
      { skill: "example", args: {} },
      {
        toolCallId: "call-denied",
        toolAdmission: {
          enforce: true,
          policyAllowed: true,
          budgetOk: true,
          capabilityGranted: false,
          permissionGranted: true,
          uiSupported: true,
        },
      },
    );

    expect(result.error).toContain("Tool Admission");
    expect(result.toolAttribution).toMatchObject({
      tool: "run_skill",
      tier: "extension",
      callId: "call-denied",
      admitted: false,
      reason: "capability-not-granted",
    });
  });

  it("attaches attribution to an admitted built-in result", async () => {
    const result = await executeTool(
      "read_file",
      { path: "missing-admission-fixture.txt" },
      {
        toolCallId: "call-mvp",
        toolAdmission: {
          enforce: true,
          policyAllowed: true,
          budgetOk: true,
        },
      },
    );

    expect(result.error).toContain("File not found");
    expect(result.toolAttribution).toMatchObject({
      tool: "read_file",
      tier: "mvp",
      callId: "call-mvp",
      admitted: true,
      reason: "ok",
    });
  });

  it("lets a host deny one tool without weakening the session defaults", async () => {
    const result = await executeTool(
      "notify",
      { title: "should not be delivered" },
      {
        toolCallId: "call-host-denied",
        toolAdmission: {
          enforce: true,
          source: "vscode-extension",
          capabilityGranted: true,
          policyAllowed: true,
          permissionGranted: true,
          budgetOk: true,
          uiSupported: true,
          tools: { notify: { policyAllowed: false } },
        },
      },
    );

    expect(result.error).toContain("policy-blocked");
    expect(result.toolAttribution).toMatchObject({
      tool: "notify",
      source: "vscode-extension",
      callId: "call-host-denied",
      admitted: false,
      reason: "policy-blocked",
    });
  });
});
