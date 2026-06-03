import { describe, it, expect } from "vitest";
import {
  substituteArguments,
  injectSkillDirectory,
  prepareSkillBody,
} from "../../src/lib/skill-loader.js";

describe("substituteArguments — $ARGUMENTS", () => {
  it("replaces $ARGUMENTS with raw string", () => {
    expect(substituteArguments("Task: $ARGUMENTS", "foo bar")).toBe(
      "Task: foo bar",
    );
  });

  it("replaces $ARGUMENTS with array joined by space", () => {
    expect(substituteArguments("Run $ARGUMENTS", ["a", "b"])).toBe("Run a b");
  });

  it("leaves $ARGUMENTS intact when args is null/undefined", () => {
    expect(substituteArguments("x $ARGUMENTS y", null)).toBe("x  y");
  });

  it("respects word boundaries (does NOT replace $ARGUMENTSX)", () => {
    expect(substituteArguments("$ARGUMENTSX", "v")).toBe("$ARGUMENTSX");
  });
});

describe("substituteArguments — $1, $2, $N", () => {
  it("replaces positional args from string", () => {
    expect(substituteArguments("$1 + $2 = $3", "a b c")).toBe("a + b = c");
  });

  it("replaces positional args from array", () => {
    expect(substituteArguments("$1-$2", ["hello", "world"])).toBe(
      "hello-world",
    );
  });

  it("leaves out-of-range placeholders as-is", () => {
    expect(substituteArguments("$1 $5", "only-one")).toBe("only-one $5");
  });

  it("splits string on whitespace (shell-like)", () => {
    expect(substituteArguments("$1|$2|$3", "  a  b   c  ")).toBe("a|b|c");
  });
});

describe("substituteArguments — escape and edge cases", () => {
  it("escapes $$ to literal $", () => {
    expect(substituteArguments("price: $$5", "ignored")).toBe("price: $5");
  });

  it("preserves $$ARGUMENTS as literal $ARGUMENTS", () => {
    expect(substituteArguments("$$ARGUMENTS", "x")).toBe("$ARGUMENTS");
  });

  it("handles empty body", () => {
    expect(substituteArguments("", "x")).toBe("");
    expect(substituteArguments(null, "x")).toBe("");
  });

  it("handles mixed $ARGUMENTS + positional", () => {
    expect(substituteArguments("all=$ARGUMENTS first=$1", "a b c")).toBe(
      "all=a b c first=a",
    );
  });
});

describe("injectSkillDirectory", () => {
  it("prepends Skill directory header", () => {
    const result = injectSkillDirectory("body text", "/abs/skills/foo");
    expect(result).toBe("Skill directory: /abs/skills/foo\n\nbody text");
  });

  it("returns body unchanged when skillDir is falsy", () => {
    expect(injectSkillDirectory("body", "")).toBe("body");
    expect(injectSkillDirectory("body", null)).toBe("body");
  });

  it("handles empty body", () => {
    expect(injectSkillDirectory("", "/abs")).toBe("Skill directory: /abs\n\n");
    expect(injectSkillDirectory(null, "/abs")).toBe(
      "Skill directory: /abs\n\n",
    );
  });
});

describe("prepareSkillBody", () => {
  it("substitutes args then prepends skill dir", () => {
    const skill = { body: "Do $ARGUMENTS in $1", skillDir: "/s/my-skill" };
    const result = prepareSkillBody(skill, "foo bar");
    expect(result).toBe("Skill directory: /s/my-skill\n\nDo foo bar in foo");
  });

  it("works with empty args", () => {
    const skill = { body: "static content", skillDir: "/abs" };
    expect(prepareSkillBody(skill, "")).toBe(
      "Skill directory: /abs\n\nstatic content",
    );
  });

  it("handles skill without skillDir", () => {
    const skill = { body: "hello $1" };
    expect(prepareSkillBody(skill, "world")).toBe("hello world");
  });
});
