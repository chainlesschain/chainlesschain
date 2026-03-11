import { describe, it, expect } from "vitest";

/**
 * Unit tests for command registration in index.js
 *
 * Verifies all commands are properly registered with correct names and options.
 */
describe("command registration", () => {
  it("createProgram returns a Commander program", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    expect(program).toBeDefined();
    expect(typeof program.parse).toBe("function");
  });

  it("registers all expected commands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());

    // Original commands
    expect(commandNames).toContain("setup");
    expect(commandNames).toContain("start");
    expect(commandNames).toContain("stop");
    expect(commandNames).toContain("status");
    expect(commandNames).toContain("services");
    expect(commandNames).toContain("config");
    expect(commandNames).toContain("update");
    expect(commandNames).toContain("doctor");

    // New headless commands
    expect(commandNames).toContain("db");
    expect(commandNames).toContain("note");
    expect(commandNames).toContain("chat");
    expect(commandNames).toContain("ask");
    expect(commandNames).toContain("llm");
    expect(commandNames).toContain("agent");
    expect(commandNames).toContain("skill");
  });

  it("agent command has alias 'a'", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const agent = program.commands.find((c) => c.name() === "agent");
    expect(agent).toBeDefined();
    expect(agent.aliases()).toContain("a");
  });

  it("skill command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const skill = program.commands.find((c) => c.name() === "skill");
    expect(skill).toBeDefined();
    const subNames = skill.commands.map((c) => c.name());
    expect(subNames).toContain("list");
    expect(subNames).toContain("categories");
    expect(subNames).toContain("info");
    expect(subNames).toContain("search");
    expect(subNames).toContain("run");
  });

  it("db command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const db = program.commands.find((c) => c.name() === "db");
    expect(db).toBeDefined();
    const subNames = db.commands.map((c) => c.name());
    expect(subNames).toContain("init");
    expect(subNames).toContain("info");
    expect(subNames).toContain("backup");
    expect(subNames).toContain("restore");
  });

  it("note command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const note = program.commands.find((c) => c.name() === "note");
    expect(note).toBeDefined();
    const subNames = note.commands.map((c) => c.name());
    expect(subNames).toContain("add");
    expect(subNames).toContain("list");
    expect(subNames).toContain("show");
    expect(subNames).toContain("search");
    expect(subNames).toContain("delete");
  });

  it("llm command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const llm = program.commands.find((c) => c.name() === "llm");
    expect(llm).toBeDefined();
    const subNames = llm.commands.map((c) => c.name());
    expect(subNames).toContain("models");
    expect(subNames).toContain("test");
  });

  it("ask command accepts required question argument", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const ask = program.commands.find((c) => c.name() === "ask");
    expect(ask).toBeDefined();
    // Commander stores args as _args
    const args = ask.registeredArguments || ask._args;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0].required).toBe(true);
  });

  it("chat command has --agent option", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const chat = program.commands.find((c) => c.name() === "chat");
    expect(chat).toBeDefined();
    const optionNames = chat.options.map((o) => o.long);
    expect(optionNames).toContain("--agent");
    expect(optionNames).toContain("--model");
    expect(optionNames).toContain("--provider");
  });

  it("program has --verbose and --quiet global options", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const optionNames = program.options.map((o) => o.long);
    expect(optionNames).toContain("--verbose");
    expect(optionNames).toContain("--quiet");
  });
});
