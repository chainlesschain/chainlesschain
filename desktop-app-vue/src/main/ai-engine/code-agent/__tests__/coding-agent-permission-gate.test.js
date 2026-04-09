import { describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const {
  CodingAgentPermissionGate,
  RISK_LEVELS,
} = require("../coding-agent-permission-gate.js");
const { CodingAgentToolAdapter } = require("../coding-agent-tool-adapter.js");

describe("CodingAgentPermissionGate", () => {
  it("allows low-risk tools without plan approval", () => {
    const gate = new CodingAgentPermissionGate();

    const result = gate.evaluateToolCall({
      toolName: "read_file",
      session: { planModeState: "inactive" },
    });

    expect(result).toMatchObject({
      allowed: true,
      decision: "allow",
      riskLevel: RISK_LEVELS.LOW,
      requiresPlanApproval: false,
    });
  });

  it("requires an approved plan for medium-risk tools", () => {
    const gate = new CodingAgentPermissionGate();

    const blocked = gate.evaluateToolCall({
      toolName: "write_file",
      session: { planModeState: "plan_ready" },
    });
    const allowed = gate.evaluateToolCall({
      toolName: "write_file",
      session: { planModeState: "approved" },
    });

    expect(blocked).toMatchObject({
      allowed: false,
      decision: "require_plan",
      riskLevel: RISK_LEVELS.MEDIUM,
    });
    expect(allowed).toMatchObject({
      allowed: true,
      decision: "allow",
      riskLevel: RISK_LEVELS.MEDIUM,
    });
  });

  it("requires both plan approval and confirmation for high-risk tools", () => {
    const gate = new CodingAgentPermissionGate();

    const beforeApproval = gate.evaluateToolCall({
      toolName: "run_shell",
      session: { planModeState: "inactive" },
    });
    const afterApproval = gate.evaluateToolCall({
      toolName: "run_shell",
      session: { planModeState: "approved" },
    });
    const confirmed = gate.evaluateToolCall({
      toolName: "run_shell",
      session: { planModeState: "approved" },
      confirmed: true,
    });

    expect(beforeApproval).toMatchObject({
      allowed: false,
      decision: "require_plan",
      riskLevel: RISK_LEVELS.HIGH,
    });
    expect(afterApproval).toMatchObject({
      allowed: false,
      decision: "require_confirmation",
      requiresConfirmation: true,
    });
    expect(confirmed).toMatchObject({
      allowed: true,
      decision: "allow",
    });
  });

  it("allows readonly git commands during plan mode", () => {
    const gate = new CodingAgentPermissionGate();

    const result = gate.evaluateToolCall({
      toolName: "git",
      session: { planModeState: "analyzing" },
      toolArgs: { command: "status" },
    });

    expect(result).toMatchObject({
      allowed: true,
      decision: "allow",
      riskLevel: RISK_LEVELS.LOW,
      category: "read",
    });
  });

  it("still blocks mutating git commands until plan approval", () => {
    const gate = new CodingAgentPermissionGate();

    const result = gate.evaluateToolCall({
      toolName: "git",
      session: { planModeState: "analyzing" },
      toolArgs: { command: "commit -m test" },
    });

    expect(result).toMatchObject({
      allowed: false,
      decision: "require_plan",
      riskLevel: RISK_LEVELS.HIGH,
      requiresPlanApproval: true,
    });
  });

  it("honors an explicit managed-tool descriptor when evaluating tool calls", () => {
    const gate = new CodingAgentPermissionGate();

    const result = gate.evaluateToolCall({
      toolName: "info_searcher",
      toolDescriptor: {
        name: "info_searcher",
        isReadOnly: true,
        riskLevel: RISK_LEVELS.LOW,
      },
      session: { planModeState: "inactive" },
    });

    expect(result).toMatchObject({
      allowed: true,
      decision: "allow",
      riskLevel: RISK_LEVELS.LOW,
      requiresPlanApproval: false,
      requiresConfirmation: false,
    });
  });

  it("uses cached MCP descriptors when evaluating tool calls", async () => {
    const toolAdapter = new CodingAgentToolAdapter({
      mcpManager: {
        servers: new Map([["weather", { state: "connected" }]]),
        listTools: vi.fn().mockResolvedValue([
          {
            name: "get_forecast",
            description: "Get the forecast",
            inputSchema: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
            },
          },
        ]),
      },
    });
    await toolAdapter.listAvailableTools();

    const gate = new CodingAgentPermissionGate({ toolAdapter });
    const result = gate.evaluateToolCall({
      toolName: "mcp_weather_get_forecast",
      session: { planModeState: "inactive" },
    });

    expect(result).toMatchObject({
      allowed: true,
      decision: "allow",
      riskLevel: RISK_LEVELS.LOW,
      category: "read",
      requiresPlanApproval: false,
      requiresConfirmation: false,
    });
  });

  it("uses canonical dynamic descriptor fields for managed tools", () => {
    const gate = new CodingAgentPermissionGate();

    const result = gate.evaluateToolCall({
      toolName: "info_searcher",
      toolDescriptor: {
        name: "info_searcher",
        category: "read",
        isReadOnly: true,
        riskLevel: RISK_LEVELS.LOW,
        availableInPlanMode: true,
        planModeBehavior: "allow",
      },
      session: { planModeState: "inactive" },
    });

    expect(result).toMatchObject({
      allowed: true,
      decision: "allow",
      category: "read",
      riskLevel: RISK_LEVELS.LOW,
    });
  });

  it("detects plan-mode blocked tool results from the CLI event payload", () => {
    const gate = new CodingAgentPermissionGate();

    const assessment = gate.getToolResultAssessment(
      {
        result: {
          error:
            '[Plan Mode] Tool "write_file" is blocked during planning. It has been added to the plan. Use /plan approve to execute.',
        },
      },
      { planModeState: "analyzing" },
    );

    expect(assessment).toMatchObject({
      blocked: true,
      toolName: "write_file",
      decision: "require_plan",
      requiresPlanApproval: true,
      riskLevel: RISK_LEVELS.MEDIUM,
    });
  });

  it("detects host-policy blocked tool results from the CLI event payload", () => {
    const gate = new CodingAgentPermissionGate();

    const assessment = gate.getToolResultAssessment(
      {
        tool: "run_shell",
        result: {
          error:
            '[Host Policy] Tool "run_shell" is blocked by desktop host policy. High-risk tools require an explicit second confirmation.',
        },
      },
      { planModeState: "approved" },
    );

    expect(assessment).toMatchObject({
      blocked: true,
      toolName: "run_shell",
      source: "host-policy",
      decision: "require_confirmation",
      requiresConfirmation: true,
      riskLevel: RISK_LEVELS.HIGH,
    });
  });

  it("extracts high-risk tools from plan items", () => {
    const gate = new CodingAgentPermissionGate();

    const result = gate.getHighRiskToolsFromPlanItems([
      { id: "1", tool: "edit_file", title: "Edit file" },
      { id: "2", tool: "run_shell", title: "Run tests" },
    ]);

    expect(result).toEqual([
      {
        toolName: "run_shell",
        riskLevel: RISK_LEVELS.HIGH,
        title: "Run tests",
      },
    ]);
  });
});
