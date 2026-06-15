/**
 * Panel `/` slash-command autocomplete — the pure slash-commands module
 * (detect/filter + the menu source) plus drift protection that every menu
 * command is actually wired in chat-html's SLASH executor map. Runs headless
 * in the CLI suite (the module is shared verbatim with the webview).
 */
import { describe, it, expect } from "vitest";
import * as slashMod from "../../../vscode-extension/src/chat/slash-commands.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";

const slash = slashMod.default || slashMod;

describe("slash-commands (panel / autocomplete)", () => {
  it("detectSlashToken matches a start-of-line slash token only", () => {
    expect(slash.detectSlashToken("/")).toEqual({ prefix: "" });
    expect(slash.detectSlashToken("/co")).toEqual({ prefix: "co" });
    expect(slash.detectSlashToken("  /re")).toEqual({ prefix: "re" }); // leading ws ok
    expect(slash.detectSlashToken("/cost ")).toBe(null); // trailing space → full cmd
    expect(slash.detectSlashToken("/cost x")).toBe(null); // already has an arg
    expect(slash.detectSlashToken("hi /x")).toBe(null); // not at start of line
    expect(slash.detectSlashToken("")).toBe(null);
    expect(slash.detectSlashToken("hello")).toBe(null);
  });

  it("filterSlashCommands prefix-matches by name, in menu order", () => {
    expect(slash.filterSlashCommands("")).toEqual(slash.SLASH_COMMANDS); // all
    expect(slash.filterSlashCommands("c").map((r) => r[0])).toEqual([
      "/cost",
      "/context",
    ]);
    expect(slash.filterSlashCommands("re").map((r) => r[0])).toEqual([
      "/reject",
      "/rewind",
      "/retry",
    ]);
    expect(slash.filterSlashCommands("rew").map((r) => r[0])).toEqual([
      "/rewind",
    ]);
    expect(slash.filterSlashCommands("ret").map((r) => r[0])).toEqual([
      "/retry",
    ]);
    expect(slash.filterSlashCommands("zzz")).toEqual([]);
  });

  it("every menu row is [/command, non-empty description]", () => {
    for (const row of slash.SLASH_COMMANDS) {
      expect(row[0]).toMatch(/^\/[a-z]+$/);
      expect(typeof row[1]).toBe("string");
      expect(row[1].length).toBeGreaterThan(0);
    }
  });

  it("drift gate: every menu command (except /help) is wired in the SLASH map", () => {
    const html = buildChatHtml({ nonce: "n".repeat(32), cspSource: "vsc:" });
    // The module is inlined so the webview can call ccSlash.* .
    expect(html).toContain("ccSlash");
    expect(html).toContain("showSlashSug");
    expect(html).toContain('mode: "slash"');
    for (const [cmd] of slash.SLASH_COMMANDS) {
      if (cmd === "/help") continue; // /help is handled in send(), not the map
      expect(html).toContain('"' + cmd + '":'); // SLASH map executor key
    }
    // Every inline script must still parse (dead-panel regression gate).
    const scripts = [
      ...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g),
    ];
    for (const [, body] of scripts) new Function(body);
  });
});
