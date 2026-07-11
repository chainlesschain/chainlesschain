/**
 * Slash command parity tests - cc CLI vs Claude Code
 * Verifies all 12 parity commands are registered and functional
 */
import { describe, it, expect } from "vitest";

describe("Slash command parity (cc vs Claude Code)", () => {
  const parityCommands = [
    "/bug",
    "/clear",
    "/compact",
    "/config",
    "/cost",
    "/doctor",
    "/help",
    "/init",
    "/login",
    "/logout",
    "/pr",
    "/resume",
    "/review",
    "/tasks",
    "/publish",
    "/vim",
  ];

  it("should have all parity commands registered", async () => {
    const { SlashCommandRegistry } =
      await import("../../src/repl/slash-command-registry.js");
    const registry = SlashCommandRegistry.getInstance();
    const registeredCommands = registry.getAllCommands().map((c) => c.name);

    for (const cmd of parityCommands) {
      expect(registeredCommands).toContain(cmd);
    }
  });

  it("resolves /checkup as an alias of /doctor (Claude-Code 2.1.205 parity)", async () => {
    const { SlashCommandRegistry } =
      await import("../../src/repl/slash-command-registry.js");
    const registry = SlashCommandRegistry.getInstance();
    const cmd = registry.getCommand("/checkup");
    expect(cmd).toBeDefined();
    expect(cmd.name).toBe("/doctor");
    expect(registry.hasCommand("/checkup")).toBe(true);
    // an unknown name still misses
    expect(registry.getCommand("/nope")).toBeUndefined();
  });

  it("should have /login command handler", async () => {
    const { SlashCommandRegistry } =
      await import("../../src/repl/slash-command-registry.js");
    const registry = SlashCommandRegistry.getInstance();
    const cmd = registry.getCommand("/login");
    expect(cmd).toBeDefined();
    expect(typeof cmd.handler).toBe("function");
  });

  it("should have /publish command handler", async () => {
    const { SlashCommandRegistry } =
      await import("../../src/repl/slash-command-registry.js");
    const registry = SlashCommandRegistry.getInstance();
    const cmd = registry.getCommand("/publish");
    expect(cmd).toBeDefined();
    expect(typeof cmd.handler).toBe("function");
  });

  it("should have /review command handler", async () => {
    const { SlashCommandRegistry } =
      await import("../../src/repl/slash-command-registry.js");
    const registry = SlashCommandRegistry.getInstance();
    const cmd = registry.getCommand("/review");
    expect(cmd).toBeDefined();
    expect(typeof cmd.handler).toBe("function");
  });

  it("should have /pr command handler", async () => {
    const { SlashCommandRegistry } =
      await import("../../src/repl/slash-command-registry.js");
    const registry = SlashCommandRegistry.getInstance();
    const cmd = registry.getCommand("/pr");
    expect(cmd).toBeDefined();
    expect(typeof cmd.handler).toBe("function");
  });

  it("should have /tasks command handler", async () => {
    const { SlashCommandRegistry } =
      await import("../../src/repl/slash-command-registry.js");
    const registry = SlashCommandRegistry.getInstance();
    const cmd = registry.getCommand("/tasks");
    expect(cmd).toBeDefined();
    expect(typeof cmd.handler).toBe("function");
  });

  it("should have /resume command handler", async () => {
    const { SlashCommandRegistry } =
      await import("../../src/repl/slash-command-registry.js");
    const registry = SlashCommandRegistry.getInstance();
    const cmd = registry.getCommand("/resume");
    expect(cmd).toBeDefined();
    expect(typeof cmd.handler).toBe("function");
  });
});
