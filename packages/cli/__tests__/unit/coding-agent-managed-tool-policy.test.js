import { describe, expect, it } from "vitest";
import sharedManagedToolPolicy from "../../src/runtime/coding-agent-managed-tool-policy.cjs";

const {
  DEFAULT_ALLOWED_MANAGED_TOOL_NAMES,
  DEFAULT_ALLOWED_MCP_SERVER_NAMES,
  createTrustedMcpServerMap,
  normalizeBoolean,
  normalizeRiskLevel,
  resolveManagedToolPolicy,
  resolveMcpServerPolicy,
  selectHigherRiskLevel,
} = sharedManagedToolPolicy;

describe("coding-agent managed tool policy", () => {
  it("normalizes risk levels and booleans for managed tool metadata", () => {
    expect(normalizeRiskLevel(1)).toBe("low");
    expect(normalizeRiskLevel("2")).toBe("medium");
    expect(selectHigherRiskLevel("low", "high")).toBe("high");
    expect(normalizeBoolean("true")).toBe(true);
    expect(normalizeBoolean("0", true)).toBe(false);
  });

  it("allows only allowlisted managed tools and blocks core-name collisions", () => {
    expect(
      resolveManagedToolPolicy({
        name: DEFAULT_ALLOWED_MANAGED_TOOL_NAMES[0],
        enabled: 1,
        risk_level: 1,
      }),
    ).toMatchObject({
      allowed: true,
      decision: "allow",
      riskLevel: "low",
      isReadOnly: true,
    });

    expect(
      resolveManagedToolPolicy(
        {
          name: "write_file",
          enabled: 1,
        },
        {
          coreToolNames: ["read_file", "write_file"],
        },
      ),
    ).toMatchObject({
      allowed: false,
      decision: "deny",
    });

    expect(
      resolveManagedToolPolicy({
        name: "git_commit",
        enabled: 1,
      }),
    ).toMatchObject({
      allowed: false,
      decision: "deny",
    });
  });

  it("allows trusted low-risk MCP servers but blocks untrusted or high-risk servers by default", () => {
    const trustedMcpServers = createTrustedMcpServerMap({
      trustedServers: [
        {
          id: DEFAULT_ALLOWED_MCP_SERVER_NAMES[0],
          securityLevel: "low",
          requiredPermissions: ["network:http"],
          capabilities: ["tools"],
        },
        {
          id: "github",
          securityLevel: "high",
          requiredPermissions: ["network:http", "github:issues"],
          capabilities: ["tools", "resources"],
        },
      ],
    });

    expect(
      resolveMcpServerPolicy(
        DEFAULT_ALLOWED_MCP_SERVER_NAMES[0],
        {
          state: "connected",
        },
        {
          trustedMcpServers,
        },
      ),
    ).toMatchObject({
      allowed: true,
      trusted: true,
      securityLevel: "low",
    });

    expect(
      resolveMcpServerPolicy(
        "custom-server",
        { state: "connected" },
        {
          trustedMcpServers,
          allowedMcpServerNames: ["custom-server"],
        },
      ),
    ).toMatchObject({
      allowed: false,
      trusted: false,
      decision: "deny",
    });

    expect(
      resolveMcpServerPolicy(
        "github",
        { state: "ready" },
        {
          trustedMcpServers,
          allowedMcpServerNames: ["github"],
        },
      ),
    ).toMatchObject({
      allowed: false,
      trusted: true,
      securityLevel: "high",
      decision: "deny",
    });

    expect(
      resolveMcpServerPolicy(
        "github",
        { state: "ready" },
        {
          trustedMcpServers,
          allowedMcpServerNames: ["github"],
          allowHighRiskMcpServers: true,
        },
      ),
    ).toMatchObject({
      allowed: true,
      trusted: true,
      securityLevel: "high",
    });
  });
});
