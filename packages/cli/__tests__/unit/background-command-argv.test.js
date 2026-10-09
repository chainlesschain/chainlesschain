import { describe, expect, it } from "vitest";

import {
  agentPrintArgument,
  assertBackgroundArgvDurable,
  canonicalizeBackgroundSessionArgv,
  captureCommandArgvGrammar,
  captureCommandOptionSpecs,
  stripFirstTurnPromptArgv,
  transformBackgroundLaunchArgv,
} from "../../src/lib/background-command-argv.js";

const OPTION_SPECS = [
  { long: "--model", required: true },
  { long: "--title", required: true },
  { short: "-p", long: "--print", optional: true },
  { short: "-c", long: "--continue" },
  { long: "--session", required: true },
  { long: "--resume", optional: true },
  { long: "--fork-session" },
  { long: "--fork-request-id", required: true },
  { short: "-y", long: "--yolo" },
  { long: "--verbose" },
  { long: "--profile", required: true },
];

describe("background command argv", () => {
  // These are already parsed argv tokens: shell quoting has been removed,
  // while spaces, empty arguments, Unicode and literal quotes remain data.
  describe.each([
    ["quoted space", "two words"],
    ["empty string", ""],
    ["Unicode and literal quotes", '写入 "引号" 和 C:\\notes\\draft.txt'],
  ])("preserves %s argument boundaries", (_label, value) => {
    it("keeps required option values when removing the first prompt", () => {
      const argv = [
        "agent",
        "--title",
        value,
        "first prompt",
        "--session",
        "s",
      ];
      expect(
        stripFirstTurnPromptArgv(argv, { optionSpecs: OPTION_SPECS }),
      ).toEqual(["agent", "--title", value, "--session", "s"]);
      expect(argv).toEqual([
        "agent",
        "--title",
        value,
        "first prompt",
        "--session",
        "s",
      ]);
    });

    it("keeps inline values and literal operands when replacing the session", () => {
      expect(
        canonicalizeBackgroundSessionArgv(
          ["agent", `--title=${value}`, "--resume", "old", "--", value],
          { sessionId: "resolved", optionSpecs: OPTION_SPECS },
        ),
      ).toEqual([
        "agent",
        `--title=${value}`,
        "--session",
        "resolved",
        "--",
        value,
      ]);
    });

    it("keeps option values and operands when removing background options", () => {
      expect(
        transformBackgroundLaunchArgv(
          ["agent", "--background", "--title", value, "--", value],
          {
            directories: ["canonical root"],
            optionSpecs: [...OPTION_SPECS, { long: "--background" }],
          },
        ),
      ).toEqual([
        "agent",
        "--title",
        value,
        "--add-dir",
        "canonical root",
        "--",
        value,
      ]);
    });
  });

  it("rejects ephemeral background authority but preserves literal prompt data", () => {
    expect(() =>
      assertBackgroundArgvDurable(["agent", "--ephemeral", "-p", "work"]),
    ).toThrowError(
      expect.objectContaining({ code: "BACKGROUND_EPHEMERAL_UNSUPPORTED" }),
    );
    expect(() =>
      assertBackgroundArgvDurable([
        "agent",
        "--session",
        "durable",
        "--",
        "--ephemeral",
      ]),
    ).not.toThrow();
  });

  it.each(["--help", "--no-worktree", "--dangerously-skip-permissions"])(
    "keeps option-shaped prompt data inside one print token: %s",
    (prompt) => {
      expect(agentPrintArgument(prompt)).toBe(`--print=${prompt}`);
    },
  );

  it("captures Commander option aliases and arity", () => {
    expect(
      captureCommandOptionSpecs({
        options: [
          {
            short: "-p",
            long: "--print",
            required: false,
            optional: true,
            variadic: false,
          },
        ],
      }),
    ).toEqual([
      {
        short: "-p",
        long: "--print",
        required: false,
        optional: true,
        variadic: false,
      },
    ]);
  });

  it("captures root options and command aliases as one argv grammar", () => {
    const root = {
      options: [{ long: "--profile", required: true }],
      parent: null,
    };
    const command = {
      options: [{ long: "--session", required: true }],
      parent: root,
      name: () => "agent",
      aliases: () => ["a"],
    };
    expect(captureCommandArgvGrammar(command)).toEqual({
      optionSpecs: [
        {
          short: null,
          long: "--profile",
          required: true,
          optional: false,
          variadic: false,
        },
        {
          short: null,
          long: "--session",
          required: true,
          optional: false,
          variadic: false,
        },
      ],
      commandNames: ["agent", "a"],
    });
  });

  it("canonicalizes resume/fork options to one resolved session", () => {
    expect(
      canonicalizeBackgroundSessionArgv(
        [
          "agent",
          "--resume",
          "old",
          "--fork-session",
          "--fork-request-id",
          "request-1",
          "task",
        ],
        { sessionId: "resolved", optionSpecs: OPTION_SPECS },
      ),
    ).toEqual(["agent", "task", "--session", "resolved"]);

    expect(
      canonicalizeBackgroundSessionArgv(
        ["agent", "--session=old", "task", "--session", "literal"],
        { sessionId: "resolved", optionSpecs: OPTION_SPECS },
      ),
    ).toEqual(["agent", "task", "--session", "resolved"]);
  });

  it("preserves other option values and the literal tail", () => {
    expect(
      canonicalizeBackgroundSessionArgv(
        [
          "agent",
          "--model=--session",
          "-cy",
          "task",
          "--",
          "--session",
          "literal",
        ],
        { sessionId: "resolved", optionSpecs: OPTION_SPECS },
      ),
    ).toEqual([
      "agent",
      "--model=--session",
      "-y",
      "task",
      "--session",
      "resolved",
      "--",
      "--session",
      "literal",
    ]);

    expect(
      canonicalizeBackgroundSessionArgv(
        ["agent", "--model", "--session", "task"],
        { sessionId: "resolved", optionSpecs: OPTION_SPECS },
      ),
    ).toEqual([
      "agent",
      "--model",
      "--session",
      "task",
      "--session",
      "resolved",
    ]);
  });

  it("removes true operands without deleting equal option values", () => {
    expect(
      stripFirstTurnPromptArgv(
        ["agent", "--model", "same", "same", "--session", "s"],
        { optionSpecs: OPTION_SPECS },
      ),
    ).toEqual(["agent", "--model", "same", "--session", "s"]);

    expect(
      stripFirstTurnPromptArgv(
        ["agent", "task1", "--model", "m", "task2", "--session", "s"],
        { optionSpecs: OPTION_SPECS },
      ),
    ).toEqual(["agent", "--model", "m", "--session", "s"]);
  });

  it("preserves global options before the real command token", () => {
    expect(
      stripFirstTurnPromptArgv(
        ["--verbose", "--profile", "agent", "agent", "task", "--session", "s"],
        { optionSpecs: OPTION_SPECS, commandNames: ["agent", "a"] },
      ),
    ).toEqual(["--verbose", "--profile", "agent", "agent", "--session", "s"]);
  });

  it("drops print payloads and every post-terminator first-turn token", () => {
    expect(
      stripFirstTurnPromptArgv(
        [
          "agent",
          "-pfirst",
          "--title",
          "kept",
          "--",
          "model-like",
          "--session",
          "literal",
        ],
        { optionSpecs: OPTION_SPECS },
      ),
    ).toEqual(["agent", "--title", "kept"]);

    expect(
      stripFirstTurnPromptArgv(["agent", "--print=first", "--session", "s"], {
        optionSpecs: OPTION_SPECS,
      }),
    ).toEqual(["agent", "--session", "s"]);
  });
});
