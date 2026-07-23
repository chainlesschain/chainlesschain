/**
 * Chat-panel slash-command regression coverage.
 *
 * The declarative manifest is the single source of truth for completion,
 * /help and execution routing. These tests intentionally assert the public
 * helpers instead of duplicating a second command list in the test.
 */
import { describe, it, expect } from "vitest";
import * as slashMod from "../../../vscode-extension/src/chat/slash-commands.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";
import { SESSION_SLASH_COMMANDS } from "../../src/runtime/session-slash-commands.js";

const slash = slashMod.default || slashMod;

describe("slash-command manifest", () => {
  it("has unique, well-formed canonical names and aliases", () => {
    const seen = new Set();

    for (const def of slash.COMMAND_DEFS) {
      expect(def.name).toMatch(/^\/[a-z]+(?:-[a-z]+)*$/);
      expect(def.description).toEqual(expect.any(String));
      expect(def.description.length).toBeGreaterThan(0);
      expect(["message", "session", "cli", "local", "help"]).toContain(
        def.route,
      );

      for (const name of [def.name, ...(def.aliases || [])]) {
        expect(name).toBe(name.toLowerCase());
        expect(name).toMatch(/^\/[a-z]+(?:-[a-z]+)*$/);
        expect(seen.has(name)).toBe(false);
        seen.add(name);
      }
    }

    expect(slash.SLASH_COMMANDS).toEqual(
      slash.COMMAND_DEFS.map((def) => [def.name, def.description]),
    );
  });

  it("resolves /resume as the /sessions alias without duplicating completion", () => {
    expect(slash.findSlashCommand("/resume")).toBe(
      slash.findSlashCommand("/sessions"),
    );
    expect(slash.routeSlashCommand("/resume", "")).toEqual({
      kind: "message",
      message: { type: "pickSession" },
    });
    expect(slash.SLASH_COMMANDS.map(([name]) => name)).not.toContain("/resume");
  });

  it("formats /help directly from every manifest entry", () => {
    const lines = slash.formatSlashHelp().split("\n");
    expect(lines[0]).toBe("panel commands:");
    expect(lines).toHaveLength(slash.COMMAND_DEFS.length + 1);

    slash.COMMAND_DEFS.forEach((def, index) => {
      const names = [def.name, ...(def.aliases || [])].join(", ");
      expect(lines[index + 1]).toBe(`  ${names} - ${def.description}`);
    });
  });

  it("keeps extension session routes exactly aligned with CLI capabilities", () => {
    const extensionCommands = slash.COMMAND_DEFS.filter(
      (def) => def.route === "session",
    ).map((def) => def.command);

    expect(extensionCommands).toEqual([...SESSION_SLASH_COMMANDS]);
  });
});

describe("slash-command completion", () => {
  it("detects only a start-of-line token, including hyphenated commands", () => {
    expect(slash.detectSlashToken("/")).toEqual({ prefix: "" });
    expect(slash.detectSlashToken("/co")).toEqual({ prefix: "co" });
    expect(slash.detectSlashToken("  /release-")).toEqual({
      prefix: "release-",
    });
    expect(slash.detectSlashToken("/cost ")).toBe(null);
    expect(slash.detectSlashToken("/cost x")).toBe(null);
    expect(slash.detectSlashToken("hi /x")).toBe(null);
    expect(slash.detectSlashToken("")).toBe(null);
  });

  it("includes /expand and prefix-matches hyphenated names", () => {
    expect(slash.filterSlashCommands("exp").map(([name]) => name)).toEqual([
      "/expand",
    ]);
    expect(slash.filterSlashCommands("release-").map(([name]) => name)).toEqual(
      ["/release-notes"],
    );
    expect(slash.filterSlashCommands("zzz")).toEqual([]);
  });

  it("normalizes untrusted host tokens and resolves only unique prefixes", () => {
    expect(slash.normalizeSlashName("/ＳＴＡ\u200b")).toBe("/sta");
    expect(slash.resolveSlashCommandPrefix("/ＳＴＡ\u200b")).toMatchObject({
      status: "resolved",
      name: "/sta",
      command: "/status",
      matchedName: "/status",
    });
    expect(slash.resolveSlashCommandPrefix("/think")).toMatchObject({
      status: "resolved",
      command: "/think",
    });
    expect(slash.resolveSlashCommandPrefix("/st")).toEqual({
      status: "ambiguous",
      name: "/st",
      matches: ["/stop", "/status"],
    });
    expect(slash.resolveSlashCommandPrefix("/sta;rm")).toEqual({
      status: "unknown",
      name: "/sta;rm",
      matches: [],
    });
  });
});

describe("slash-command execution routing", () => {
  const rawArgs = String.raw`"two words" C:\Users\longfa\project`;

  it("routes session commands and preserves their raw argument text", () => {
    expect(slash.routeSlashCommand("/status", `  ${rawArgs}  `)).toEqual({
      kind: "message",
      message: {
        type: "sessionSlashCommand",
        command: "status",
        args: rawArgs,
      },
    });
  });

  it("routes CLI commands and preserves their raw argument text", () => {
    expect(slash.routeSlashCommand("/init", `  ${rawArgs}  `)).toEqual({
      kind: "message",
      message: {
        type: "cliCommand",
        command: "init",
        args: rawArgs,
      },
    });
  });

  it("routes parameterized host messages with the original argument text", () => {
    expect(slash.routeSlashCommand("/goal", `  ${rawArgs}  `)).toEqual({
      kind: "message",
      message: { type: "goal", spec: rawArgs },
    });
  });

  it("routes local commands and preserves their raw argument text", () => {
    expect(slash.routeSlashCommand("/review", `  ${rawArgs}  `)).toEqual({
      kind: "local",
      command: "/review",
      args: rawArgs,
    });
  });

  it("returns null for an unknown command", () => {
    expect(slash.routeSlashCommand("/does-not-exist", "x")).toBe(null);
  });
});

describe("splitSlashArgs", () => {
  it("tokenizes quoted values and keeps Windows path backslashes literal", () => {
    expect(
      slash.splitSlashArgs(
        String.raw`--label "hello world" 'two words' "C:\Users\long fa\file.txt" C:\Temp\x`,
      ),
    ).toEqual({
      args: [
        "--label",
        "hello world",
        "two words",
        String.raw`C:\Users\long fa\file.txt`,
        String.raw`C:\Temp\x`,
      ],
      error: null,
    });
  });

  it("supports empty quoted argv and escaped quotes", () => {
    expect(slash.splitSlashArgs(String.raw`"" "say \"hello\""`)).toEqual({
      args: ["", 'say "hello"'],
      error: null,
    });
  });

  it("does not collapse UNC path backslashes inside quotes", () => {
    expect(
      slash.splitSlashArgs(String.raw`"\\server\share name\file.txt"`),
    ).toEqual({
      args: [String.raw`\\server\share name\file.txt`],
      error: null,
    });
  });

  it("rejects an unterminated quote without returning partial argv", () => {
    expect(slash.splitSlashArgs('--label "not closed')).toEqual({
      args: [],
      error: "unterminated quoted argument",
    });
  });
});

describe("chat HTML slash-command integration", () => {
  it("uses the shared router/help and every inline script remains parseable", () => {
    const html = buildChatHtml({ nonce: "n".repeat(32), cspSource: "vsc:" });
    expect(html).toContain("ccSlash.routeSlashCommand");
    expect(html).toContain("ccSlash.formatSlashHelp");
    expect(html).toContain("showSlashSug");
    expect(html).toContain('mode: "slash"');
    expect(html).toContain('type: "slashCommandFallback"');
    expect(html).not.toContain(
      'add("info", "unknown command " + cmd + " — try /help")',
    );

    const scripts = [
      ...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g),
    ];
    for (const [, body] of scripts) {
      expect(() => new Function(body)).not.toThrow();
    }
  });
});
