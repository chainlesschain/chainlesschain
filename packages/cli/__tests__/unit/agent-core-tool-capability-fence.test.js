import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentLoop } from "../../src/runtime/agent-core.js";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-tool-fence-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function drive(toolCall, options = {}) {
  let calls = 0;
  const chatFn = vi.fn(async () => {
    calls += 1;
    if (calls === 1) {
      return {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [toolCall],
        },
        usage: {},
      };
    }
    return {
      message: { role: "assistant", content: "done" },
      usage: {},
    };
  });
  const events = [];
  for await (const event of agentLoop(
    [{ role: "user", content: "test capability fence" }],
    {
      cwd: tmp,
      chatFn,
      autoCompact: false,
      runnableProviderFallback: false,
      ...options,
    },
  )) {
    events.push(event);
  }
  return events;
}

describe("agent-loop execution-time tool capability fence", () => {
  it("blocks a provider-emitted built-in tool omitted from the schema", async () => {
    const target = path.join(tmp, "must-not-exist.txt");
    const events = await drive(
      {
        id: "call-write",
        type: "function",
        function: {
          name: "write_file",
          arguments: JSON.stringify({ path: target, content: "forbidden" }),
        },
      },
      { enabledToolNames: ["read_file"] },
    );

    const result = events.find((event) => event.type === "tool-result")?.result;
    expect(result).toMatchObject({
      policy: { decision: "blocked", via: "effective-tool-set" },
    });
    expect(result.error).toContain("outside this run's effective tool set");
    expect(fs.existsSync(target)).toBe(false);
  });

  it("blocks an external executor when the effective allowlist is empty", async () => {
    const mcpClient = { callTool: vi.fn() };
    const name = "mcp__weather__delete";
    const events = await drive(
      {
        id: "call-mcp",
        type: "function",
        function: { name, arguments: "{}" },
      },
      {
        enabledToolNames: [],
        extraToolDefinitions: [
          {
            type: "function",
            function: {
              name,
              description: "Delete weather data",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        externalToolDescriptors: { [name]: { name, kind: "mcp" } },
        externalToolExecutors: {
          [name]: { kind: "mcp", serverName: "weather", toolName: "delete" },
        },
        mcpClient,
      },
    );

    const result = events.find((event) => event.type === "tool-result")?.result;
    expect(result).toMatchObject({
      policy: { decision: "blocked", via: "effective-tool-set" },
    });
    expect(mcpClient.callTool).not.toHaveBeenCalled();
  });

  it("blocks an external executor outside a non-empty exact child ceiling", async () => {
    const mcpClient = { callTool: vi.fn() };
    const name = "mcp__weather__delete";
    const events = await drive(
      {
        id: "call-mcp-exact",
        type: "function",
        function: { name, arguments: "{}" },
      },
      {
        enabledToolNames: ["read_file"],
        exactToolNames: true,
        extraToolDefinitions: [
          {
            type: "function",
            function: {
              name,
              description: "Delete weather data",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        externalToolDescriptors: { [name]: { name, kind: "mcp" } },
        externalToolExecutors: {
          [name]: { kind: "mcp", serverName: "weather", toolName: "delete" },
        },
        mcpClient,
      },
    );

    const result = events.find((event) => event.type === "tool-result")?.result;
    expect(result).toMatchObject({
      policy: { decision: "blocked", via: "effective-tool-set" },
    });
    expect(mcpClient.callTool).not.toHaveBeenCalled();
  });

  it("denies an out-of-scope mutation before checkpoint or execution events", async () => {
    fs.writeFileSync(path.join(tmp, "allowed.txt"), "allowed", "utf8");
    fs.writeFileSync(path.join(tmp, "sibling.txt"), "sibling", "utf8");
    const settingsHook = vi.fn();
    const events = await drive(
      {
        id: "call-scoped-write",
        type: "function",
        function: {
          name: "write_file",
          arguments: JSON.stringify({
            path: "sibling.txt",
            content: "forbidden",
          }),
        },
      },
      {
        enabledToolNames: [
          "read_file",
          "list_dir",
          "write_file",
          "edit_file",
          "edit_file_hashed",
        ],
        exactToolNames: true,
        hermeticExecution: true,
        fileMutationScope: {
          exact: true,
          worktreeRoot: fs.realpathSync(tmp),
          allowedPaths: ["allowed.txt"],
        },
        autoCheckpoint: true,
        managedCheckpoint: true,
        settingsHooks: {
          PreToolUse: [{ matcher: "write_file", hooks: [settingsHook] }],
        },
      },
    );

    const result = events.find((event) => event.type === "tool-result")?.result;
    expect(result).toMatchObject({
      policy: {
        decision: "deny",
        via: "exact-file-mutation-scope",
        reason: "path-not-allowed",
      },
    });
    expect(
      events.some((event) =>
        [
          "checkpoint",
          "managed-checkpoint",
          "managed-checkpoint-error",
          "tool-executing",
        ].includes(event.type),
      ),
    ).toBe(false);
    expect(settingsHook).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(tmp, "allowed.txt"), "utf8")).toBe(
      "allowed",
    );
    expect(fs.readFileSync(path.join(tmp, "sibling.txt"), "utf8")).toBe(
      "sibling",
    );
  });

  it("ignores ambient project persona policy in a hermetic exact-file run", async () => {
    const configDir = path.join(tmp, ".chainlesschain");
    fs.mkdirSync(configDir);
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ persona: { toolsDisabled: ["write_file"] } }),
      "utf8",
    );
    fs.writeFileSync(path.join(tmp, "allowed.txt"), "before", "utf8");

    const events = await drive(
      {
        id: "call-hermetic-write",
        type: "function",
        function: {
          name: "write_file",
          arguments: JSON.stringify({
            path: "allowed.txt",
            content: "after",
          }),
        },
      },
      {
        enabledToolNames: [
          "read_file",
          "list_dir",
          "write_file",
          "edit_file",
          "edit_file_hashed",
        ],
        exactToolNames: true,
        hermeticExecution: true,
        fileMutationScope: {
          exact: true,
          worktreeRoot: fs.realpathSync(tmp),
          allowedPaths: ["allowed.txt"],
        },
      },
    );

    const result = events.find((event) => event.type === "tool-result")?.result;
    expect(result).toMatchObject({ success: true });
    expect(fs.readFileSync(path.join(tmp, "allowed.txt"), "utf8")).toBe(
      "after",
    );
  });
});
