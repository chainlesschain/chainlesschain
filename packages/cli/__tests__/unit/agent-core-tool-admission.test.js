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
});
