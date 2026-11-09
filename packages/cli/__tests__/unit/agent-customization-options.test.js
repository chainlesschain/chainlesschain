import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { applyCustomizationOptions } from "../../src/lib/safe-mode.js";
import { registerAgentCommand } from "../../src/commands/agent.js";

describe("explicit agent output-token limit", () => {
  function command() {
    const program = new Command();
    registerAgentCommand(program);
    const agent = program.commands.find((item) => item.name() === "agent");
    agent.exitOverride().configureOutput({ writeErr: () => {} });
    return agent;
  }
  it("accepts the cap through the actual agent grammar and leaves defaults unset", () => {
    const capped = command();
    expect(
      capped.parseOptions(["--max-output-tokens", "1024"]).unknown,
    ).toEqual([]);
    expect(capped.opts().maxOutputTokens).toBe(1024);
    expect(command().opts().maxOutputTokens).toBeUndefined();
  });
  it.each(["0", "-1", "1.5", "1e3", "Infinity", "9007199254740992"])(
    "rejects invalid output cap %s before an action can dispatch",
    (value) => {
      expect(() =>
        command().parseOptions(["--max-output-tokens", value]),
      ).toThrow();
    },
  );
});

describe("independent agent customization restrictions", () => {
  it("parses actual reconstructed CLI flags before applying runtime restrictions", () => {
    const program = new Command();
    registerAgentCommand(program);
    const agent = program.commands.find(
      (command) => command.name() === "agent",
    );
    expect(
      agent.parseOptions([
        "--no-plugins",
        "--no-mcp-auto-connect",
        "--ide",
        "--mcp-config",
        "explicit.json",
      ]).unknown,
    ).toEqual([]);
    const options = agent.opts(),
      env = {};
    expect(options).toMatchObject({
      plugins: false,
      mcpAutoConnect: false,
      ide: true,
      mcpConfig: "explicit.json",
    });
    applyCustomizationOptions(options, env);
    expect(env.CC_PLUGINS).toBe("0");
    expect(options).toMatchObject({
      mcp: false,
      ide: true,
      pdh: false,
      jetbrains: false,
      mcpConfig: "explicit.json",
    });
  });
  it("disables plugins without changing skills, permission rules or project memory", () => {
    const env = { CC_PLUGINS: "1", CC_SKILLS: "1", CC_PROJECT_MEMORY: "1" };
    const options = { plugins: false };
    applyCustomizationOptions(options, env);
    expect(env).toEqual({
      CC_PLUGINS: "0",
      CC_SKILLS: "1",
      CC_PROJECT_MEMORY: "1",
    });
    expect(options).toEqual({ plugins: false });
  });

  it("disables registered and implicit bridges while retaining explicit config", () => {
    const options = { mcpAutoConnect: false, mcpConfig: "explicit.json" };
    applyCustomizationOptions(options, {});
    expect(options).toEqual({
      mcpAutoConnect: false,
      mcpConfig: "explicit.json",
      mcp: false,
      ide: false,
      pdh: false,
      jetbrains: false,
    });
  });

  it("preserves explicit bridge choices and never re-enables an environment restriction", () => {
    const options = {
      plugins: true,
      mcpAutoConnect: false,
      ide: true,
      pdh: false,
      jetbrains: true,
    };
    const env = { CC_PLUGINS: "0" };
    applyCustomizationOptions(options, env);
    expect(options).toMatchObject({
      mcp: false,
      ide: true,
      pdh: false,
      jetbrains: true,
    });
    expect(env.CC_PLUGINS).toBe("0");
  });

  it("leaves ordinary launch defaults and user configuration unchanged", () => {
    const options = {},
      env = { CC_PLUGINS: "1" };
    applyCustomizationOptions(options, env);
    expect(options).toEqual({});
    expect(env).toEqual({ CC_PLUGINS: "1" });
  });
});
