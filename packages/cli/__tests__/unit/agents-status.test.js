/**
 * `/agents` REPL command — arg parsing + rendering for the agent-definition
 * manager. Pure + deterministic.
 */
import { describe, it, expect } from "vitest";
import {
  parseAgentsCommand,
  formatAgentsList,
  formatAgentDetail,
} from "../../src/repl/agents-status.js";

describe("parseAgentsCommand", () => {
  it("defaults to list", () => {
    expect(parseAgentsCommand("/agents")).toEqual({ action: "list" });
    expect(parseAgentsCommand("/agents list")).toEqual({ action: "list" });
    expect(parseAgentsCommand("/agents ls")).toEqual({ action: "list" });
  });

  it("parses help", () => {
    expect(parseAgentsCommand("/agents help")).toEqual({ action: "help" });
  });

  it("parses explicit and bare show", () => {
    expect(parseAgentsCommand("/agents show review:security")).toEqual({
      action: "show",
      name: "review:security",
    });
    // a bare token is a name to show
    expect(parseAgentsCommand("/agents review:security")).toEqual({
      action: "show",
      name: "review:security",
    });
  });

  it("parses new with defaults (project location)", () => {
    expect(parseAgentsCommand("/agents new mybot")).toEqual({
      action: "new",
      name: "mybot",
      description: null,
      tools: null,
      location: "project",
    });
  });

  it("parses new with --tools and --description (description takes the rest)", () => {
    const r = parseAgentsCommand(
      "/agents new mybot --tools read_file,search_files --description Reviews code carefully",
    );
    expect(r.action).toBe("new");
    expect(r.name).toBe("mybot");
    expect(r.tools).toBe("read_file,search_files");
    expect(r.description).toBe("Reviews code carefully");
    expect(r.location).toBe("project");
  });

  it("parses --claude and --personal locations", () => {
    expect(parseAgentsCommand("/agents new b --claude").location).toBe(
      "claude",
    );
    expect(parseAgentsCommand("/agents new b --personal").location).toBe(
      "personal",
    );
  });

  it("strips quotes around a description", () => {
    expect(
      parseAgentsCommand('/agents new b --description "hi there"').description,
    ).toBe("hi there");
  });
});

describe("formatAgentsList", () => {
  it("explains the empty case", () => {
    const out = formatAgentsList([], []);
    expect(out).toMatch(/Agent definitions \(0\)/);
    expect(out).toMatch(/\/agents new <name>/);
  });

  it("renders definitions and built-in profiles", () => {
    const out = formatAgentsList(
      [
        {
          name: "review:security",
          scope: "project",
          description: "Security audit",
          tools: ["read_file", "search_files"],
          model: "claude-opus-4-8",
        },
      ],
      [
        { name: "explorer", shortDescription: "read-only research" },
        { name: "executor", shortDescription: "full-permission execution" },
      ],
    );
    expect(out).toMatch(/Agent definitions \(1\)/);
    expect(out).toMatch(/review:security {2}\[project\] {2}Security audit/);
    expect(out).toMatch(
      /tools: read_file,search_files · model: claude-opus-4-8/,
    );
    expect(out).toMatch(/Built-in profiles/);
    expect(out).toMatch(/explorer — read-only research/);
  });
});

describe("formatAgentDetail", () => {
  it("returns null for a missing agent", () => {
    expect(formatAgentDetail(null)).toBeNull();
  });

  it("renders metadata + system prompt", () => {
    const out = formatAgentDetail({
      name: "review:security",
      scope: "personal",
      description: "Security audit",
      tools: null,
      model: null,
      file: "/home/u/.claude/agents/review/security.md",
      systemPrompt: "You are a security auditor.",
    });
    expect(out).toMatch(/review:security {2}\[personal\]/);
    expect(out).toMatch(/tools: \(all\)/);
    expect(out).toMatch(/file: .*review\/security\.md/);
    expect(out).toMatch(/You are a security auditor\./);
  });
});
