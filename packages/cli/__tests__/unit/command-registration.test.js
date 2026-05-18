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

    // Headless commands
    expect(commandNames).toContain("db");
    expect(commandNames).toContain("note");
    expect(commandNames).toContain("chat");
    expect(commandNames).toContain("ask");
    expect(commandNames).toContain("llm");
    expect(commandNames).toContain("agent");
    expect(commandNames).toContain("skill");

    // Phase 1: AI intelligence layer
    expect(commandNames).toContain("search");
    expect(commandNames).toContain("tokens");
    expect(commandNames).toContain("memory");
    expect(commandNames).toContain("session");

    // Phase 2: Knowledge & content management
    expect(commandNames).toContain("import");
    expect(commandNames).toContain("export");
    expect(commandNames).toContain("git");

    // Phase 3: MCP & external integration
    expect(commandNames).toContain("mcp");
    expect(commandNames).toContain("browse");
    expect(commandNames).toContain("instinct");

    // Phase 4: Security & identity
    expect(commandNames).toContain("did");
    expect(commandNames).toContain("encrypt");
    expect(commandNames).toContain("auth");
    expect(commandNames).toContain("audit");
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
    expect(subNames).toContain("history");
    expect(subNames).toContain("diff");
    expect(subNames).toContain("revert");
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

  it("search command accepts required query argument", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const search = program.commands.find((c) => c.name() === "search");
    expect(search).toBeDefined();
    const args = search.registeredArguments || search._args;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0].required).toBe(true);
    // Check options
    const optionNames = search.options.map((o) => o.long);
    expect(optionNames).toContain("--mode");
    expect(optionNames).toContain("--top-k");
    expect(optionNames).toContain("--json");
  });

  it("tokens command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const tokens = program.commands.find((c) => c.name() === "tokens");
    expect(tokens).toBeDefined();
    const subNames = tokens.commands.map((c) => c.name());
    expect(subNames).toContain("show");
    expect(subNames).toContain("breakdown");
    expect(subNames).toContain("recent");
    expect(subNames).toContain("cache");
  });

  it("memory command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const memory = program.commands.find((c) => c.name() === "memory");
    expect(memory).toBeDefined();
    const subNames = memory.commands.map((c) => c.name());
    expect(subNames).toContain("show");
    expect(subNames).toContain("add");
    expect(subNames).toContain("search");
    expect(subNames).toContain("delete");
    expect(subNames).toContain("daily");
    expect(subNames).toContain("file");
  });

  it("session command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const session = program.commands.find((c) => c.name() === "session");
    expect(session).toBeDefined();
    const subNames = session.commands.map((c) => c.name());
    expect(subNames).toContain("list");
    expect(subNames).toContain("show");
    expect(subNames).toContain("resume");
    expect(subNames).toContain("export");
    expect(subNames).toContain("delete");
  });

  it("config command has beta subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const config = program.commands.find((c) => c.name() === "config");
    expect(config).toBeDefined();
    const beta = config.commands.find((c) => c.name() === "beta");
    expect(beta).toBeDefined();
    const subNames = beta.commands.map((c) => c.name());
    expect(subNames).toContain("list");
    expect(subNames).toContain("enable");
    expect(subNames).toContain("disable");
  });
  // Phase 2 command tests
  it("import command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const imp = program.commands.find((c) => c.name() === "import");
    expect(imp).toBeDefined();
    const subNames = imp.commands.map((c) => c.name());
    expect(subNames).toContain("markdown");
    expect(subNames).toContain("evernote");
    expect(subNames).toContain("notion");
    expect(subNames).toContain("pdf");
  });

  it("export command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const exp = program.commands.find((c) => c.name() === "export");
    expect(exp).toBeDefined();
    const subNames = exp.commands.map((c) => c.name());
    expect(subNames).toContain("markdown");
    expect(subNames).toContain("site");
  });

  it("git command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const git = program.commands.find((c) => c.name() === "git");
    expect(git).toBeDefined();
    const subNames = git.commands.map((c) => c.name());
    expect(subNames).toContain("status");
    expect(subNames).toContain("init");
    expect(subNames).toContain("auto-commit");
    expect(subNames).toContain("hooks");
    expect(subNames).toContain("history-analyze");
  });

  // Phase 3 command tests
  it("mcp command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const mcp = program.commands.find((c) => c.name() === "mcp");
    expect(mcp).toBeDefined();
    const subNames = mcp.commands.map((c) => c.name());
    expect(subNames).toContain("servers");
    expect(subNames).toContain("add");
    expect(subNames).toContain("remove");
    expect(subNames).toContain("connect");
    expect(subNames).toContain("disconnect");
    expect(subNames).toContain("tools");
    expect(subNames).toContain("call");
  });

  it("browse command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const browse = program.commands.find((c) => c.name() === "browse");
    expect(browse).toBeDefined();
    const subNames = browse.commands.map((c) => c.name());
    expect(subNames).toContain("fetch");
    expect(subNames).toContain("scrape");
    expect(subNames).toContain("screenshot");
  });

  it("instinct command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const instinct = program.commands.find((c) => c.name() === "instinct");
    expect(instinct).toBeDefined();
    const subNames = instinct.commands.map((c) => c.name());
    expect(subNames).toContain("show");
    expect(subNames).toContain("categories");
    expect(subNames).toContain("prompt");
    expect(subNames).toContain("delete");
    expect(subNames).toContain("reset");
    expect(subNames).toContain("decay");
  });

  it("llm command has Phase 3 subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const llm = program.commands.find((c) => c.name() === "llm");
    expect(llm).toBeDefined();
    const subNames = llm.commands.map((c) => c.name());
    expect(subNames).toContain("providers");
    expect(subNames).toContain("add-provider");
    expect(subNames).toContain("switch");
  });

  // Phase 4 command tests
  it("did command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const did = program.commands.find((c) => c.name() === "did");
    expect(did).toBeDefined();
    const subNames = did.commands.map((c) => c.name());
    expect(subNames).toContain("create");
    expect(subNames).toContain("show");
    expect(subNames).toContain("list");
    expect(subNames).toContain("resolve");
    expect(subNames).toContain("sign");
    expect(subNames).toContain("verify");
    expect(subNames).toContain("export");
    expect(subNames).toContain("set-default");
    expect(subNames).toContain("delete");
  });

  it("encrypt command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const encrypt = program.commands.find((c) => c.name() === "encrypt");
    expect(encrypt).toBeDefined();
    const subNames = encrypt.commands.map((c) => c.name());
    expect(subNames).toContain("file");
    expect(subNames).toContain("db");
    expect(subNames).toContain("info");
    expect(subNames).toContain("status");
  });

  it("auth command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const auth = program.commands.find((c) => c.name() === "auth");
    expect(auth).toBeDefined();
    const subNames = auth.commands.map((c) => c.name());
    expect(subNames).toContain("roles");
    expect(subNames).toContain("create-role");
    expect(subNames).toContain("delete-role");
    expect(subNames).toContain("grant");
    expect(subNames).toContain("revoke");
    expect(subNames).toContain("check");
    expect(subNames).toContain("permissions");
    expect(subNames).toContain("users");
    expect(subNames).toContain("scopes");
  });

  it("audit command has correct subcommands", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const audit = program.commands.find((c) => c.name() === "audit");
    expect(audit).toBeDefined();
    const subNames = audit.commands.map((c) => c.name());
    expect(subNames).toContain("log");
    expect(subNames).toContain("search");
    expect(subNames).toContain("stats");
    expect(subNames).toContain("export");
    expect(subNames).toContain("purge");
    expect(subNames).toContain("types");
  });

  it("program has --verbose and --quiet global options", async () => {
    const { createProgram } = await import("../../src/index.js");
    const program = createProgram();
    const optionNames = program.options.map((o) => o.long);
    expect(optionNames).toContain("--verbose");
    expect(optionNames).toContain("--quiet");
  });
});
