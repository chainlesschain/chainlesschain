import { describe, expect, it, vi } from "vitest";
import {
  parseInputEvent,
  runAgentHeadlessStream,
} from "../../src/runtime/headless-stream.js";
import {
  executeSessionSlashCommand,
  parseSessionSlashCommandEvent,
  SESSION_SLASH_COMMANDS,
} from "../../src/runtime/session-slash-commands.js";

function slash(command, args = "", requestId = "req-1") {
  return parseSessionSlashCommandEvent({
    type: "slash_command",
    command,
    args,
    request_id: requestId,
  });
}

describe("stream-json slash_command parsing", () => {
  it("normalizes the command while preserving string arguments and request id", () => {
    expect(
      parseInputEvent(
        JSON.stringify({
          type: "slash_command",
          command: "/agents",
          args: "show reviewer",
          request_id: "req-agents",
        }),
      ),
    ).toEqual({
      slashCommand: {
        command: "agents",
        args: "show reviewer",
        argumentText: "show reviewer",
        requestId: "req-agents",
      },
    });
  });

  it("combines inline and raw string arguments", () => {
    const parsed = parseSessionSlashCommandEvent({
      type: "slash_command",
      command: "/agents show",
      args: "reviewer",
      request_id: "req-inline",
    });
    expect(parsed).toMatchObject({
      command: "agents",
      args: "reviewer",
      argumentText: "show reviewer",
      requestId: "req-inline",
    });
  });

  it("preserves an opaque request id byte-for-byte for correlation", () => {
    const requestId = "  req opaque  ";
    const parsed = parseSessionSlashCommandEvent({
      type: "slash_command",
      command: "status",
      args: "",
      request_id: requestId,
    });

    expect(parsed.requestId).toBe(requestId);
  });

  it("keeps malformed slash requests on the control path for an ok:false reply", () => {
    const missing = parseInputEvent(
      JSON.stringify({ type: "slash_command", request_id: "bad" }),
    );
    expect(missing.slashCommand).toMatchObject({
      command: "",
      requestId: "bad",
      validationError: expect.stringContaining("non-empty command"),
    });

    const badArgs = parseInputEvent(
      JSON.stringify({
        type: "slash_command",
        command: "status",
        args: { ignored: true },
      }),
    );
    expect(badArgs.slashCommand.validationError).toContain("must be a string");

    const badId = parseInputEvent(
      JSON.stringify({
        type: "slash_command",
        command: "status",
        args: "",
        request_id: 42,
      }),
    );
    expect(badId.slashCommand.validationError).toContain("string request_id");

    const slashOnly = parseInputEvent(
      JSON.stringify({
        type: "slash_command",
        command: "/",
        args: "",
        request_id: "slash-only",
      }),
    );
    expect(slashOnly.slashCommand.validationError).toContain(
      "non-empty command name",
    );
  });

  it("bounds correlation ids, command names and argument text", () => {
    const longId = parseInputEvent(
      JSON.stringify({
        type: "slash_command",
        command: "status",
        args: "",
        request_id: "r".repeat(129),
      }),
    );
    expect(longId.slashCommand).toMatchObject({
      requestId: null,
      validationError: expect.stringContaining("request_id exceeds 128"),
    });

    const longCommand = parseInputEvent(
      JSON.stringify({
        type: "slash_command",
        command: "s".repeat(129),
        args: "",
        request_id: "bounded-command",
      }),
    );
    expect(longCommand.slashCommand.command).toHaveLength(128);
    expect(longCommand.slashCommand.validationError).toContain(
      "command exceeds 128",
    );

    const longArgs = parseInputEvent(
      JSON.stringify({
        type: "slash_command",
        command: "status",
        args: "x".repeat(4097),
        request_id: "bounded-args",
      }),
    );
    expect(longArgs.slashCommand.argumentText).toBe("");
    expect(longArgs.slashCommand.validationError).toContain("args exceed 4096");
  });
});

describe("executeSessionSlashCommand", () => {
  const baseContext = {
    cwd: "C:\\workspace",
    provider: "openai",
    model: "gpt-test",
    sessionId: "session-1",
    messages: [{ role: "system" }, { role: "user" }],
    additionalDirectories: ["C:\\extra"],
    settingsHooks: { PreToolUse: [] },
    settingsFiles: [".claude/settings.json"],
    permissionRules: {
      allow: ["read_file"],
      ask: ["run_shell"],
      deny: ["write_file"],
    },
    permissionMode: "default",
    loadedInstructions: {
      files: [{ path: "C:\\workspace\\cc.md", scope: "project", bytes: 12 }],
      warnings: [],
    },
    projectMemoryEnabled: true,
    mcp: {
      connected: ["ide"],
      externalToolExecutors: {
        mcp__ide__getSelection: { kind: "mcp" },
      },
      mcpClient: {
        listServers: () => [
          {
            name: "ide",
            state: "connected",
            tools: 3,
            resources: 1,
            prompts: 2,
          },
        ],
        listResources: () => [],
        listPrompts: () => [],
      },
    },
  };

  it("renders status and doctor from live session state", async () => {
    const status = await executeSessionSlashCommand(
      slash("status"),
      baseContext,
      {
        version: "1.2.3",
        readDiskVersion: () => "1.2.3",
        ideToolNames: () => ["getSelection"],
        formatStatus: (info) => JSON.stringify(info),
      },
    );
    expect(status.ok).toBe(true);
    expect(JSON.parse(status.output)).toMatchObject({
      version: "1.2.3",
      provider: "openai",
      model: "gpt-test",
      sessionId: "session-1",
      messageCount: 2,
      cwd: "C:\\workspace",
      extraRoots: 1,
      ideConnected: true,
      mcpServers: 1,
      hookEvents: 1,
    });

    const doctor = await executeSessionSlashCommand(
      slash("doctor"),
      baseContext,
      {
        loadConfig: () => ({ llm: {} }),
        ideToolNames: () => ["getSelection"],
        buildDoctorChecks: (input) => input,
        renderDoctor: (input) =>
          `${input.config.llm.provider}/${input.config.llm.model};` +
          `${input.ideTools.length};${input.mcpServers.length}`,
      },
    );
    expect(doctor).toMatchObject({
      ok: true,
      output: "openai/gpt-test;1;1",
    });
  });

  it("renders live MCP, hook, permission and captured-memory state", async () => {
    const mcp = await executeSessionSlashCommand(slash("mcp"), baseContext, {
      renderMcpSurface: () => "surface",
    });
    expect(mcp.output).toContain("MCP servers (1):");
    expect(mcp.output).toContain(
      "ide: connected (3 tools, 1 resources, 2 prompts)",
    );
    expect(mcp.output).toContain("surface");

    const hooks = await executeSessionSlashCommand(
      slash("hooks"),
      baseContext,
      {
        formatSettingsHooks: (value) =>
          `hook-events:${Object.keys(value).join(",")}`,
      },
    );
    expect(hooks).toEqual({ ok: true, output: "hook-events:PreToolUse" });

    const permissions = await executeSessionSlashCommand(
      slash("permissions"),
      baseContext,
      {
        renderPermissions: (rules, opts) =>
          `${rules.allow.join(",")};${opts.files.join(",")}`,
      },
    );
    expect(permissions.output).toContain("read_file;.claude/settings.json");
    expect(permissions.output).toContain("Current mode: default");

    const memory = await executeSessionSlashCommand(
      slash("memory"),
      baseContext,
      {
        renderMemoryFiles: (loaded, opts) =>
          `${loaded.files[0].path};enabled=${opts.enabled}`,
      },
    );
    expect(memory).toEqual({
      ok: true,
      output: "C:\\workspace\\cc.md;enabled=true",
    });
  });

  it("supports read-only task listing and agent list/show", async () => {
    const tasks = await executeSessionSlashCommand(
      slash("tasks", "list"),
      baseContext,
      {
        listBackgroundShellTasks: () => [{ id: "bg-1", status: "running" }],
        formatBackgroundTasks: (items) => `tasks:${items[0].id}`,
      },
    );
    expect(tasks).toEqual({ ok: true, output: "tasks:bg-1" });

    const agents = [
      {
        name: "reviewer",
        scope: "project",
        file: "reviewer.md",
        tools: null,
        systemPrompt: "Review carefully.",
      },
    ];
    const deps = {
      discoverAgents: () => agents,
      getAgent: (name) => agents.find((item) => item.name === name) || null,
      listSubAgentProfiles: () => [],
      formatAgentsList: (items) => `agents:${items.map((a) => a.name)}`,
      formatAgentDetail: (item) => `agent:${item.name}`,
    };
    const listed = await executeSessionSlashCommand(
      slash("agents", "list"),
      baseContext,
      deps,
    );
    expect(listed).toEqual({ ok: true, output: "agents:reviewer" });

    const shown = await executeSessionSlashCommand(
      slash("agents", "show reviewer"),
      baseContext,
      deps,
    );
    expect(shown).toEqual({ ok: true, output: "agent:reviewer" });

    const missing = await executeSessionSlashCommand(
      slash("agents", "show missing"),
      baseContext,
      deps,
    );
    expect(missing).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("rejects unknown commands, ignored arguments and every mutating form", async () => {
    await expect(
      executeSessionSlashCommand(slash("nope"), baseContext),
    ).resolves.toMatchObject({ ok: false, code: "UNKNOWN_COMMAND" });
    await expect(
      executeSessionSlashCommand(slash("status", "extra"), baseContext),
    ).resolves.toMatchObject({
      ok: false,
      code: "UNSUPPORTED_ARGUMENTS",
    });
    await expect(
      executeSessionSlashCommand(slash("permissions", "trusted"), baseContext),
    ).resolves.toMatchObject({
      ok: false,
      code: "UNSUPPORTED_ARGUMENTS",
      error: expect.stringContaining("not supported"),
    });
    await expect(
      executeSessionSlashCommand(slash("tasks", "kill bg-1"), baseContext),
    ).resolves.toMatchObject({
      ok: false,
      code: "UNSUPPORTED_ARGUMENTS",
    });
    await expect(
      executeSessionSlashCommand(slash("agents", "new writer"), baseContext),
    ).resolves.toMatchObject({
      ok: false,
      code: "UNSUPPORTED_ARGUMENTS",
    });
  });

  it("bounds renderer output before placing it on the wire", async () => {
    const result = await executeSessionSlashCommand(
      slash("status"),
      baseContext,
      {
        version: "1.2.3",
        readDiskVersion: () => "1.2.3",
        ideToolNames: () => [],
        formatStatus: () => "x".repeat(256 * 1024 + 1),
      },
    );
    expect(result.ok).toBe(true);
    expect(result.output).toHaveLength(256 * 1024 + 21);
    expect(result.output.endsWith("\n… (output truncated)")).toBe(true);
  });
});

describe("runAgentHeadlessStream slash_command integration", () => {
  async function* input(...events) {
    yield events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  }

  function emitted(lines) {
    return lines
      .join("")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  it.each(SESSION_SLASH_COMMANDS)(
    "routes /%s through the correlated control pipeline without a model turn",
    async (command) => {
      const lines = [];
      const requestId = `request-${command}`;
      const agentLoop = vi.fn(async function* () {
        yield { type: "response-complete", content: "must not run" };
      });
      const outcome = await runAgentHeadlessStream(
        {
          cwd: process.cwd(),
          provider: "openai",
          model: "gpt-test",
          expandFileRefs: false,
          ephemeral: true,
        },
        {
          input: input({
            type: "slash_command",
            command: `/${command}`,
            args: "",
            request_id: requestId,
          }),
          bootstrap: async () => ({ db: null }),
          getApprovalGate: async () => null,
          resolveAgentMcp: async () => null,
          agentLoop,
          writeOut: (line) => lines.push(line),
          writeErr: () => {},
          genTraceId: () => `trace-${command}`,
          sessionSlashCommandDeps: {
            version: "1.2.3",
            readDiskVersion: () => "1.2.3",
            ideToolNames: () => [],
            formatStatus: () => "status-ok",
            loadConfig: () => ({ llm: {} }),
            buildDoctorChecks: (value) => value,
            renderDoctor: () => "doctor-ok",
            renderMcpSurface: () => "mcp-ok",
            formatSettingsHooks: () => "hooks-ok",
            renderPermissions: () => "permissions-ok",
            discoverAgents: () => [],
            listSubAgentProfiles: () => [],
            formatAgentsList: () => "agents-ok",
            listBackgroundShellTasks: () => [],
            formatBackgroundTasks: () => "tasks-ok",
            renderMemoryFiles: () => "memory-ok",
          },
        },
      );

      const events = emitted(lines);
      const result = events.find(
        (event) => event.type === "slash_command_result",
      );
      expect(result).toMatchObject({
        type: "slash_command_result",
        request_id: requestId,
        command,
        ok: true,
        text: expect.any(String),
      });
      expect(result).not.toHaveProperty("error");
      expect(agentLoop).not.toHaveBeenCalled();
      expect(outcome).toEqual({ exitCode: 0, turns: 0 });
      expect(events.at(-1)).toMatchObject({
        type: "system",
        subtype: "end",
        turns: 0,
      });
    },
  );

  it("emits correlated results without invoking or counting a model turn", async () => {
    const lines = [];
    const agentLoop = vi.fn(async function* () {
      yield { type: "response-complete", content: "must not run" };
    });
    const outcome = await runAgentHeadlessStream(
      {
        cwd: process.cwd(),
        provider: "openai",
        model: "gpt-test",
        expandFileRefs: false,
        ephemeral: true,
      },
      {
        input: input(
          {
            type: "slash_command",
            command: "/status",
            args: "",
            request_id: "status-1",
          },
          {
            type: "slash_command",
            command: "not-a-command",
            args: "preserved",
            request_id: "unknown-1",
          },
          {
            type: "slash_command",
            command: "status",
            args: "",
            request_id: 42,
          },
        ),
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        resolveAgentMcp: async () => null,
        agentLoop,
        writeOut: (line) => lines.push(line),
        writeErr: () => {},
        genTraceId: () => "trace-session-slash",
        sessionSlashCommandDeps: {
          version: "1.2.3",
          readDiskVersion: () => "1.2.3",
        },
      },
    );

    const results = emitted(lines).filter(
      (event) => event.type === "slash_command_result",
    );
    expect(emitted(lines)[0]).toMatchObject({
      type: "system",
      subtype: "init",
      slash_commands: [
        "status",
        "doctor",
        "mcp",
        "hooks",
        "permissions",
        "agents",
        "tasks",
        "memory",
      ],
    });
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      request_id: "status-1",
      command: "status",
      ok: true,
      text: expect.stringContaining("openai / gpt-test"),
    });
    expect(results[1]).toMatchObject({
      request_id: "unknown-1",
      command: "not-a-command",
      ok: false,
      error: {
        code: "UNKNOWN_COMMAND",
        message: expect.stringContaining("Unknown session slash command"),
      },
    });
    expect(results[2]).toMatchObject({
      request_id: "slash-1",
      command: "status",
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: expect.stringContaining("string request_id"),
      },
    });
    expect(agentLoop).not.toHaveBeenCalled();
    expect(outcome).toEqual({ exitCode: 0, turns: 0 });
    expect(emitted(lines).at(-1)).toMatchObject({
      type: "system",
      subtype: "end",
      turns: 0,
    });
  });

  it("turns an unexpected dispatcher exception into a structured failure", async () => {
    const lines = [];
    const agentLoop = vi.fn(async function* () {
      yield { type: "response-complete", content: "must not run" };
    });
    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false, ephemeral: true },
      {
        input: input({
          type: "slash_command",
          command: "status",
          args: "",
          request_id: "throws-1",
        }),
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        resolveAgentMcp: async () => null,
        executeSessionSlashCommand: async () => {
          throw new Error("renderer exploded");
        },
        agentLoop,
        writeOut: (line) => lines.push(line),
        writeErr: () => {},
        genTraceId: () => "trace-session-slash-failure",
      },
    );

    const result = emitted(lines).find(
      (event) => event.type === "slash_command_result",
    );
    expect(result).toMatchObject({
      request_id: "throws-1",
      command: "status",
      ok: false,
      error: {
        code: "COMMAND_FAILED",
        message: "renderer exploded",
      },
    });
    expect(agentLoop).not.toHaveBeenCalled();
    expect(outcome).toEqual({ exitCode: 0, turns: 0 });
  });
});
