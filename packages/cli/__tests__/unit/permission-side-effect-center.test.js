import { describe, expect, it } from "vitest";
import {
  PERMISSION_SIDE_EFFECT_CENTER_SCHEMA,
  buildPermissionSideEffectCenter,
  collectToolResourceIdentifiers,
} from "../../src/lib/permission-side-effect-center.js";

describe("permission side-effect center resource collection", () => {
  it("keeps actual resource identities while dropping credential values", () => {
    const resources = collectToolResourceIdentifiers("run_shell", {
      command: 'NPM_CONFIG_USERCONFIG="C:/tmp/npmrc" npm publish',
      cwd: "C:/repo",
      endpoint: "https://user:password@example.test/api?token=secret",
      env: {
        NPM_TOKEN: "do-not-persist",
        NORMAL_FLAG: "visible-but-irrelevant",
      },
    });

    expect(resources).toEqual({
      files: ["C:/repo"],
      network: ["https://example.test"],
      processes: ["npm"],
      credentials: ["NPM_TOKEN"],
    });
    expect(JSON.stringify(resources)).not.toContain("do-not-persist");
    expect(JSON.stringify(resources)).not.toContain("password");
    expect(JSON.stringify(resources)).not.toContain("token=secret");
  });

  it("records runtime and credential names for code execution", () => {
    expect(
      collectToolResourceIdentifiers("run_code", {
        language: "python",
        API_KEY: "secret-value",
      }),
    ).toEqual({
      files: [],
      network: [],
      processes: ["runtime:python"],
      credentials: ["API_KEY"],
    });
  });

  it("moves URL-shaped file arguments to a credential-free network origin", () => {
    const resources = collectToolResourceIdentifiers("write_file", {
      path: "https://user:password@example.test/private?token=secret",
    });
    expect(resources).toEqual({
      files: [],
      network: ["https://example.test"],
      processes: [],
      credentials: [],
    });
  });
});

describe("permission side-effect center projection", () => {
  it("joins actual resources, decision, call chain, and turn recovery coverage", () => {
    const projection = buildPermissionSideEffectCenter({
      sessionId: "session-1",
      operations: [
        {
          opId: "op-1",
          kind: "shell",
          key: "must-not-render --token secret",
          state: "unknown",
          idempotent: false,
          preparedAt: 10,
          settledAt: 20,
          meta: {
            tool: "run_shell",
            toolUseId: "tool-1",
            turnId: "turn-1",
            resources: {
              files: ["C:/repo"],
              network: ["https://registry.example.test"],
              processes: ["npm"],
              credentials: ["NPM_TOKEN"],
            },
            permissionDecision: {
              decision: "ask",
              via: "approval-gate",
              rule: "Bash(npm publish:*)",
              source: "C:/repo/.claude/settings.json",
              reason: "external publish NPM_TOKEN=do-not-persist",
            },
          },
        },
      ],
      turns: [
        {
          turnId: "turn-1",
          toolCallIds: ["tool-1"],
          coverage: "partial",
          fileCheckpointId: "cp-1",
        },
      ],
    });

    expect(projection).toMatchObject({
      schema: PERMISSION_SIDE_EFFECT_CENTER_SCHEMA,
      authority: "cli",
      sessionId: "session-1",
      summary: {
        total: 1,
        irreversible: 1,
        inspect: 1,
        incompleteCoverage: 1,
      },
    });
    expect(projection.entries[0]).toMatchObject({
      tool: "run_shell",
      kind: "shell",
      state: "unknown",
      irreversible: true,
      resources: {
        files: ["C:/repo"],
        network: ["https://registry.example.test"],
        processes: ["npm"],
        credentials: ["NPM_TOKEN"],
      },
      decision: {
        decision: "ask",
        via: "approval-gate",
        rule: "Bash(npm publish:*)",
      },
      callChain: {
        sessionId: "session-1",
        turnId: "turn-1",
        toolUseId: "tool-1",
        opId: "op-1",
      },
      recovery: {
        coverage: "none",
        action: "inspect",
        checkpointId: "cp-1",
        coveredResources: [],
        uncoveredResources: [
          "files:C:/repo",
          "network:https://registry.example.test",
          "processes:npm",
          "credentials:NPM_TOKEN",
        ],
      },
    });
    expect(JSON.stringify(projection)).not.toContain("must-not-render");
    expect(JSON.stringify(projection)).not.toContain("do-not-persist");
  });

  it("never extends a file checkpoint to external process or network resources", () => {
    const projection = buildPermissionSideEffectCenter({
      sessionId: "mixed",
      operations: [
        {
          opId: "mixed-op",
          kind: "shell",
          state: "committed",
          idempotent: false,
          meta: {
            tool: "run_shell",
            turnId: "mixed-turn",
            resources: {
              files: ["C:/repo/package.json"],
              network: [
                "https://user:secret@registry.example.test/publish?token=x",
              ],
              processes: ["npm publish --token secret"],
              credentials: ["NPM_TOKEN", "must-not-render"],
            },
          },
        },
      ],
      turns: [
        {
          turnId: "mixed-turn",
          coverage: "full",
          fileCheckpointId: "cp-mixed",
        },
      ],
    });

    expect(projection.entries[0].recovery).toMatchObject({
      coverage: "partial",
      coveredResources: ["files:C:/repo/package.json"],
      uncoveredResources: [
        "network:https://registry.example.test",
        "processes:npm",
        "credentials:NPM_TOKEN",
      ],
    });
    expect(JSON.stringify(projection)).not.toContain("secret");
    expect(JSON.stringify(projection)).not.toContain("must-not-render");
  });

  it("projects legacy file records and names unresolved network targets", () => {
    const projection = buildPermissionSideEffectCenter({
      sessionId: "legacy",
      operations: [
        {
          opId: "file-op",
          kind: "file-delete",
          key: "src/old.ts",
          state: "committed",
          idempotent: false,
          meta: { tool: "delete_file" },
        },
        {
          opId: "network-op",
          kind: "network-mutation",
          key: "notification title",
          state: "started",
          idempotent: false,
          meta: { tool: "notify" },
        },
      ],
    });

    const entriesByOperation = new Map(
      projection.entries.map((entry) => [entry.opId, entry]),
    );
    expect(entriesByOperation.get("network-op").unresolvedResources).toEqual([
      "network target was not present in the recorded arguments",
    ]);
    expect(entriesByOperation.get("file-op").resources.files).toEqual([
      "src/old.ts",
    ]);
    expect(entriesByOperation.get("file-op").recovery.coverage).toBe("none");
    expect(entriesByOperation.get("network-op").recovery.coverage).toBe(
      "unknown",
    );
  });

  it("includes actual MCP scopes and conservative open-world recovery", () => {
    const projection = buildPermissionSideEffectCenter({
      sessionId: "mcp-session",
      mcpRecords: [
        {
          ledgerId: "mcp-1",
          sessionId: "mcp-session",
          turnId: "turn-mcp",
          serverName: "github",
          toolName: "create_issue",
          status: "started",
          startedAt: "2026-08-15T00:00:00.000Z",
          settledAt: null,
          resourceScopes: ["repo:chainlesschain/chainlesschain"],
          networkScopes: ["https://api.github.com"],
          effectContract: {
            effect: "write",
            sideEffecting: true,
            destructive: false,
            idempotent: false,
            trusted: true,
            source: "managed-mcp-policy",
          },
        },
      ],
    });

    expect(projection.entries[0]).toMatchObject({
      tool: "mcp:github/create_issue",
      kind: "mcp-write",
      state: "started",
      irreversible: true,
      resources: {
        files: ["repo:chainlesschain/chainlesschain"],
        network: ["https://api.github.com"],
        processes: ["mcp:github"],
        credentials: [],
      },
      decision: {
        decision: "executed",
        via: "mcp-host-admission",
        source: "managed-mcp-policy",
      },
      recovery: {
        coverage: "none",
        action: "inspect",
      },
    });
  });

  it("redacts URL data hidden in MCP resource scopes", () => {
    const projection = buildPermissionSideEffectCenter({
      sessionId: "mcp-redaction",
      mcpRecords: [
        {
          ledgerId: "mcp-redacted",
          serverName: "host",
          toolName: "call",
          status: "started",
          resourceScopes: [
            "resource:https://user:password@example.test/private?token=secret",
            "repo:https://user:password@example.test/private?token=secret",
          ],
          networkScopes: [],
          effectContract: { effect: "unknown", trusted: false },
        },
      ],
    });

    expect(projection.entries[0].resources.network).toEqual([
      "https://example.test",
    ]);
    expect(projection.entries[0].unresolvedResources).toEqual([
      "untyped MCP resource scope (resource) was redacted",
      "repo MCP scope carried a URL; only its origin is shown",
    ]);
    expect(JSON.stringify(projection)).not.toContain("password");
    expect(JSON.stringify(projection)).not.toContain("token=secret");
  });

  it("does not invent rollback work for a host-authorized read", () => {
    const projection = buildPermissionSideEffectCenter({
      sessionId: "mcp-read",
      mcpRecords: [
        {
          ledgerId: "mcp-read-1",
          serverName: "docs",
          toolName: "lookup",
          status: "completed",
          resourceScopes: ["repo:org/repo"],
          networkScopes: ["https://docs.example.test"],
          effectContract: {
            effect: "read",
            sideEffecting: false,
            trusted: true,
            source: "managed-mcp-policy",
          },
        },
      ],
    });

    expect(projection.entries[0]).toMatchObject({
      irreversible: false,
      recovery: {
        coverage: "full",
        action: "skip",
        coveredResources: [],
        uncoveredResources: [],
      },
    });
  });
});
