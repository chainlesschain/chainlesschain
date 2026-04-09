import { describe, it, expect } from "vitest";

const {
  parseWorkflowCommand,
  DEFAULT_ALLOWED,
} = require("../workflow-command-parser.js");

describe("parseWorkflowCommand", () => {
  it("returns matched=false for non-workflow input", () => {
    expect(parseWorkflowCommand("hello world").matched).toBe(false);
    expect(parseWorkflowCommand("").matched).toBe(false);
    expect(parseWorkflowCommand("$unknown foo").matched).toBe(false);
  });

  it("returns matched=false for non-string input", () => {
    expect(parseWorkflowCommand(null).matched).toBe(false);
    expect(parseWorkflowCommand(undefined).matched).toBe(false);
    expect(parseWorkflowCommand(42).matched).toBe(false);
  });

  it("parses $deep-interview with quoted goal", () => {
    const r = parseWorkflowCommand('$deep-interview "add OAuth to API"');
    expect(r.matched).toBe(true);
    expect(r.skill).toBe("deep-interview");
    expect(r.rest).toBe("add OAuth to API");
    expect(r.params.goal).toBe("add OAuth to API");
  });

  it("parses $deep-interview with unquoted goal", () => {
    const r = parseWorkflowCommand("$deep-interview add OAuth");
    expect(r.matched).toBe(true);
    expect(r.rest).toBe("add OAuth");
    expect(r.params.goal).toBe("add OAuth");
  });

  it("parses $ralplan --approve flag", () => {
    const r = parseWorkflowCommand("$ralplan --approve");
    expect(r.matched).toBe(true);
    expect(r.skill).toBe("ralplan");
    expect(r.flags.approve).toBe(true);
    expect(r.params.approve).toBe(true);
  });

  it("parses $ralplan with both flag and rest", () => {
    const r = parseWorkflowCommand("$ralplan --approve Final plan title");
    expect(r.matched).toBe(true);
    expect(r.flags.approve).toBe(true);
    expect(r.params.title).toBe("Final plan title");
  });

  it("parses --key=value style flags", () => {
    const r = parseWorkflowCommand("$ralph --sessionId=abc start now");
    expect(r.matched).toBe(true);
    expect(r.flags.sessionId).toBe("abc");
    expect(r.params.sessionId).toBe("abc");
    expect(r.params.note).toBe("start now");
  });

  it("parses $team spec", () => {
    const r = parseWorkflowCommand("$team 3:executor run parallel");
    expect(r.matched).toBe(true);
    expect(r.params.spec).toBe("3:executor run parallel");
  });

  it("is case-insensitive on the skill name", () => {
    const r = parseWorkflowCommand("$Deep-Interview foo");
    expect(r.matched).toBe(true);
    expect(r.skill).toBe("deep-interview");
  });

  it("allowSkills option restricts allowed skills", () => {
    const r = parseWorkflowCommand("$ralplan", {
      allowSkills: ["deep-interview"],
    });
    expect(r.matched).toBe(false);
  });

  it("DEFAULT_ALLOWED lists the 4 canonical skills", () => {
    expect([...DEFAULT_ALLOWED].sort()).toEqual([
      "deep-interview",
      "ralph",
      "ralplan",
      "team",
    ]);
  });

  it("handles leading whitespace", () => {
    const r = parseWorkflowCommand("   $ralph keep going");
    expect(r.matched).toBe(true);
    expect(r.params.note).toBe("keep going");
  });

  it("ignores $ without a skill name", () => {
    expect(parseWorkflowCommand("$").matched).toBe(false);
    expect(parseWorkflowCommand("$ ").matched).toBe(false);
  });
});
