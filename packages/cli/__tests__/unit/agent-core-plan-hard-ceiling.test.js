import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../../src/runtime/agent-core.js";

let tmp;

function planManager({ executionLock = null, allowed = false } = {}) {
  const items = [];
  return {
    executionLock,
    isActive: () => true,
    isToolAllowed: vi.fn(() => allowed),
    addPlanItem: vi.fn((item) => items.push(item)),
    items,
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plan-ceiling-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("interactive Plan Mode hard capability ceiling", () => {
  it("blocks a settings allow rule from widening planning tools", async () => {
    const target = path.join(tmp, "blocked.txt");
    const manager = planManager();

    const result = await executeTool(
      "write_file",
      { path: target, content: "must-not-exist" },
      {
        cwd: tmp,
        planManager: manager,
        permissionRules: { allow: ["Write"] },
      },
    );

    expect(result).toMatchObject({
      policy: { decision: "blocked", via: "plan-mode" },
    });
    expect(result.error).toContain("[Plan Mode]");
    expect(manager.addPlanItem).toHaveBeenCalledOnce();
    expect(fs.existsSync(target)).toBe(false);
  });

  it("blocks before a settings ask can prompt", async () => {
    const confirm = vi.fn(async () => true);
    const target = path.join(tmp, "blocked-ask.txt");

    const result = await executeTool(
      "write_file",
      { path: target, content: "must-not-exist" },
      {
        cwd: tmp,
        planManager: planManager(),
        permissionRules: { ask: ["Write"] },
        permissionConfirm: confirm,
      },
    );

    expect(result.error).toContain("[Plan Mode]");
    expect(confirm).not.toHaveBeenCalled();
    expect(fs.existsSync(target)).toBe(false);
  });

  it("blocks an external host tool even when host policy says allowed", async () => {
    const interaction = { requestHostTool: vi.fn() };
    const name = "mcp_weather_delete_forecast";

    const result = await executeTool(
      name,
      { city: "Shanghai" },
      {
        cwd: tmp,
        planManager: planManager({ allowed: true }),
        interaction,
        hostManagedToolPolicy: {
          toolDefinitions: [
            {
              type: "function",
              function: {
                name,
                description: "Delete a forecast",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
          tools: { [name]: { allowed: true, riskLevel: "low" } },
        },
      },
    );

    expect(result.error).toContain("[Plan Mode]");
    expect(interaction.requestHostTool).not.toHaveBeenCalled();
  });

  it("does not let settings allow widen an approved execution lock", async () => {
    const target = path.join(tmp, "outside-lock.txt");
    const manager = planManager({
      executionLock: { allowedTools: ["read_file"] },
    });

    const result = await executeTool(
      "write_file",
      { path: target, content: "must-not-exist" },
      {
        cwd: tmp,
        planManager: manager,
        permissionRules: { allow: ["Write"] },
      },
    );

    expect(result).toMatchObject({
      policy: { decision: "blocked", via: "plan-execution-lock" },
    });
    expect(result.error).toContain("[Plan Execution Lock]");
    expect(manager.addPlanItem).not.toHaveBeenCalled();
    expect(fs.existsSync(target)).toBe(false);
  });

  it("blocks a self-described read-only external tool without trusted provenance", async () => {
    const name = "mcp_weather_get_forecast";
    const mcpClient = { callTool: vi.fn() };

    const result = await executeTool(
      name,
      { city: "Shanghai" },
      {
        cwd: tmp,
        planManager: planManager({ allowed: true }),
        mcpClient,
        externalToolDescriptors: {
          [name]: {
            name,
            source: "mcp:weather",
            riskLevel: "low",
            isReadOnly: true,
          },
        },
        externalToolExecutors: {
          [name]: {
            kind: "mcp",
            serverName: "weather",
            toolName: "get_forecast",
          },
        },
      },
    );

    expect(result.error).toContain("[Plan Mode]");
    expect(mcpClient.callTool).not.toHaveBeenCalled();
  });

  it("does not let an external descriptor self-authorize a read effect", async () => {
    const name = "mcp_weather_get_forecast";
    const mcpClient = {
      callTool: vi.fn(async () => ({
        content: [{ type: "text", text: "sunny" }],
        isError: false,
      })),
    };

    const result = await executeTool(
      name,
      { city: "Shanghai" },
      {
        cwd: tmp,
        planManager: planManager({ allowed: true }),
        mcpClient,
        externalToolDescriptors: {
          [name]: {
            name,
            source: "mcp:weather",
            riskLevel: "low",
            isReadOnly: true,
            effectContract: {
              version: 1,
              effect: "read",
              trusted: true,
              provenance: "trusted-mcp-server",
            },
          },
        },
        externalToolExecutors: {
          [name]: {
            kind: "mcp",
            serverName: "weather",
            toolName: "get_forecast",
          },
        },
      },
    );

    expect(result.error).toContain("[Plan Mode]");
    expect(mcpClient.callTool).not.toHaveBeenCalled();
  });

  it("does not execute mutating Pre/PostToolUse command hooks while planning", async () => {
    const source = path.join(tmp, "source.txt");
    const sentinel = path.join(tmp, "hook-mutated.txt");
    const hook = path.join(tmp, "mutating-hook.cjs");
    fs.writeFileSync(source, "safe-read");
    fs.writeFileSync(
      hook,
      `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "mutated")`,
    );
    const commandHook = { type: "command", command: `node "${hook}"` };

    const result = await executeTool(
      "read_file",
      { path: source },
      {
        cwd: tmp,
        planManager: planManager({ allowed: true }),
        settingsHooks: {
          PreToolUse: [{ matcher: "Read", hooks: [commandHook] }],
          PostToolUse: [{ matcher: "Read", hooks: [commandHook] }],
        },
      },
    );

    expect(result).toMatchObject({ content: "safe-read" });
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("does not execute PermissionRequest command hooks while planning", async () => {
    const source = path.join(tmp, "permission-source.txt");
    const sentinel = path.join(tmp, "permission-hook-mutated.txt");
    const hook = path.join(tmp, "permission-hook.cjs");
    const confirm = vi.fn(async () => true);
    fs.writeFileSync(source, "safe-read");
    fs.writeFileSync(
      hook,
      `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "mutated")`,
    );

    const result = await executeTool(
      "read_file",
      { path: source },
      {
        cwd: tmp,
        planManager: planManager({ allowed: true }),
        permissionRules: { ask: ["Read"] },
        permissionConfirm: confirm,
        settingsHooks: {
          PermissionRequest: [
            {
              matcher: "Read",
              hooks: [{ type: "command", command: `node "${hook}"` }],
            },
          ],
        },
      },
    );

    expect(result).toMatchObject({ content: "safe-read" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(fs.existsSync(sentinel)).toBe(false);
  });
});
