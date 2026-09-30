import { describe, expect, it, vi } from "vitest";
import { captureAgentExecutionPolicy } from "../../src/lib/agent-execution-policy.js";

describe("immutable agent execution policy", () => {
  it("copies nested restrictions without freezing live authority capabilities", () => {
    const owner = { revision: 0 };
    const provider = vi.fn();
    const input = {
      sandbox: { network: false, policy: { denyWrite: ["/private"] } },
      toolAdmission: {
        enforce: true,
        tools: { write_file: { policyAllowed: false } },
      },
      shellPolicyOverrides: [],
      classifyAllShell: true,
      enabledToolNames: [],
      additionalDirectories: ["/workspace"],
      hostManagedToolPolicyAuthority: owner,
      permissionRulesProvider: provider,
    };
    const captured = captureAgentExecutionPolicy(input);
    input.sandbox.policy.denyWrite.length = 0;
    input.toolAdmission.tools.write_file.policyAllowed = true;
    input.shellPolicyOverrides.push("network-download");
    input.enabledToolNames.push("write_file");
    expect(captured.sandbox.policy.denyWrite).toEqual(["/private"]);
    expect(captured.toolAdmission.tools.write_file.policyAllowed).toBe(false);
    expect(captured.shellPolicyOverrides).toEqual([]);
    expect(captured.enabledToolNames).toEqual([]);
    expect(Object.isFrozen(captured.sandbox.policy.denyWrite)).toBe(true);
    expect(Object.isFrozen(captured.toolAdmission.tools.write_file)).toBe(true);
    expect(Object.isFrozen(owner)).toBe(false);
    expect(captured).not.toHaveProperty("permissionRulesProvider");
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    { sandbox: { network: "false" } },
    { sandbox: { policy: { allowUnsandboxedCommands: "false" } } },
    { sandbox: { policy: { denyRead: "/private" } } },
    { toolAdmission: { enforce: "true" } },
    {
      toolAdmission: {
        enforce: true,
        tools: { write_file: { policyAllowed: "true" } },
      },
    },
    { shellPolicyOverrides: "network-download" },
    { classifyAllShell: "false" },
    { enabledToolNames: [() => "write_file"] },
    { additionalDirectories: Object.assign(new Array(2), { 1: "/workspace" }) },
  ])("rejects ambiguous startup authority %j", (input) => {
    expect(() => captureAgentExecutionPolicy(input)).toThrow(
      expect.objectContaining({ code: "CC_AGENT_EXECUTION_POLICY_INVALID" }),
    );
  });

  it("refuses getters, proxies and toJSON without evaluating them", () => {
    const getter = vi.fn(() => ({ enforce: false }));
    const input = Object.defineProperty({}, "toolAdmission", { get: getter });
    expect(() => captureAgentExecutionPolicy(input)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(() => ({ enforce: false }));
    expect(() =>
      captureAgentExecutionPolicy({ toolAdmission: { toJSON } }),
    ).toThrow();
    expect(toJSON).not.toHaveBeenCalled();
    const trap = vi.fn();
    expect(() =>
      captureAgentExecutionPolicy(new Proxy({}, { get: trap })),
    ).toThrow();
    expect(trap).not.toHaveBeenCalled();
    expect(() =>
      captureAgentExecutionPolicy(Object.create({ classifyAllShell: true })),
    ).toThrow();
  });

  it.each([false, "false", {}])(
    "does not treat %j as hermetic execution",
    (hermeticExecution) => {
      const captured = captureAgentExecutionPolicy(
        {
          hermeticExecution,
          toolAdmission: { enforce: true },
          unattendedActionPolicy: { unattended: true },
        },
        { hermetic: true },
      );
      expect(captured.toolAdmission.enforce).toBe(true);
      expect(captured.unattendedActionPolicy.unattended).toBe(true);
    },
  );
});
