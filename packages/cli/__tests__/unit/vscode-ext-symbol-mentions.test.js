/**
 * Workspace symbol @-mentions in the chat panel (Claude Code parity — find a
 * file by a function/class name, not just by path). Layers: the pure
 * SymbolInformation→item mapper + dedup, the at-mention label/value split that
 * lets a row display a symbol while inserting its file's `@path`, the provider
 * query (gated ≥2 chars, never-throw), and the webview parse gate.
 */
import { describe, it, expect, vi } from "vitest";

import {
  symbolKindLabel,
  formatSymbolItems,
  dedupeMentionItems,
} from "../../../vscode-extension/src/chat/symbol-mentions.js";
import {
  mentionLabel,
  mentionValue,
  applyMention,
} from "../../../vscode-extension/src/chat/at-mention.js";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";

const sym = (name, kind, fsPath) => ({
  name,
  kind,
  location: { uri: { fsPath } },
});

describe("formatSymbolItems", () => {
  it("maps symbols to {label,value} with kind + root-relative path", () => {
    const items = formatSymbolItems(
      [
        sym("buildFixPrompt", 11, "/ws/src/chat/fix-with-cc.js"),
        sym("ChatViewProvider", 4, "/ws/src/chat/chat-view.js"),
      ],
      "/ws",
      8,
    );
    expect(items).toEqual([
      { label: "function buildFixPrompt · src/chat/fix-with-cc.js", value: "src/chat/fix-with-cc.js" },
      { label: "class ChatViewProvider · src/chat/chat-view.js", value: "src/chat/chat-view.js" },
    ]);
  });

  it("normalizes Windows separators and unknown kinds, caps the list", () => {
    const items = formatSymbolItems(
      [
        sym("a", 99, "C:\\ws\\src\\a.ts"),
        sym("b", 12, "C:\\ws\\src\\b.ts"),
        sym("c", 12, "C:\\ws\\src\\c.ts"),
      ],
      "C:\\ws",
      2,
    );
    expect(items).toHaveLength(2); // capped
    expect(items[0]).toEqual({ label: "symbol a · src/a.ts", value: "src/a.ts" });
    expect(items[1].label).toBe("var b · src/b.ts");
  });

  it("skips nameless / pathless entries and tolerates junk input", () => {
    expect(
      formatSymbolItems(
        [sym("", 11, "/ws/x.ts"), { kind: 11 }, sym("ok", 11, "/ws/ok.ts")],
        "/ws",
        8,
      ),
    ).toEqual([{ label: "function ok · ok.ts", value: "ok.ts" }]);
    expect(formatSymbolItems(null, "/ws", 8)).toEqual([]);
  });

  it("symbolKindLabel falls back to 'symbol'", () => {
    expect(symbolKindLabel(11)).toBe("function");
    expect(symbolKindLabel(4)).toBe("class");
    expect(symbolKindLabel(999)).toBe("symbol");
  });
});

describe("dedupeMentionItems", () => {
  it("keeps the first item per inserted value (strings + objects)", () => {
    const out = dedupeMentionItems([
      "selection",
      "src/a.ts",
      { label: "function foo · src/a.ts", value: "src/a.ts" }, // dup of file → dropped
      { label: "class Bar · src/b.ts", value: "src/b.ts" },
      "src/a.ts", // dup string → dropped
    ]);
    expect(out).toEqual([
      "selection",
      "src/a.ts",
      { label: "class Bar · src/b.ts", value: "src/b.ts" },
    ]);
  });

  it("drops empties and tolerates junk", () => {
    expect(dedupeMentionItems(["", { value: "" }, null, "x"])).toEqual(["x"]);
    expect(dedupeMentionItems(undefined)).toEqual([]);
  });
});

describe("at-mention label/value split", () => {
  it("reads plain strings and {label,value} objects uniformly", () => {
    expect(mentionLabel("src/a.ts")).toBe("src/a.ts");
    expect(mentionValue("src/a.ts")).toBe("src/a.ts");
    const obj = { label: "function foo · src/a.ts", value: "src/a.ts" };
    expect(mentionLabel(obj)).toBe("function foo · src/a.ts");
    expect(mentionValue(obj)).toBe("src/a.ts");
    expect(mentionLabel(null)).toBe("");
    expect(mentionValue(null)).toBe("");
  });

  it("applyMention inserts the symbol's file value (not its label)", () => {
    const obj = { label: "function foo · src/a.ts", value: "src/a.ts" };
    const at = { prefix: "foo", start: 0 };
    const r = applyMention("@foo", at, mentionValue(obj), 4);
    expect(r.text).toBe("@src/a.ts ");
  });
});

describe("ChatViewProvider._listWorkspaceSymbols", () => {
  function makeProvider(executeCommand) {
    const vscode = {
      commands: { executeCommand },
      workspace: { workspaceFolders: [{ uri: { fsPath: "/ws" } }] },
    };
    return new ChatViewProvider(vscode, {});
  }

  it("returns [] for short prefixes without querying", async () => {
    const execute = vi.fn();
    const provider = makeProvider(execute);
    expect(await provider._listWorkspaceSymbols("a")).toEqual([]);
    expect(await provider._listWorkspaceSymbols(" ")).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("queries the symbol provider and formats results for a real prefix", async () => {
    const execute = vi.fn(async (cmd, q) => {
      expect(cmd).toBe("vscode.executeWorkspaceSymbolProvider");
      expect(q).toBe("build");
      return [sym("buildFixPrompt", 11, "/ws/src/chat/fix-with-cc.js")];
    });
    const provider = makeProvider(execute);
    expect(await provider._listWorkspaceSymbols("build")).toEqual([
      { label: "function buildFixPrompt · src/chat/fix-with-cc.js", value: "src/chat/fix-with-cc.js" },
    ]);
  });

  it("never throws when the provider rejects", async () => {
    const provider = makeProvider(() => Promise.reject(new Error("no provider")));
    expect(await provider._listWorkspaceSymbols("build")).toEqual([]);
  });
});

describe("chat HTML uses the label/value split (parse gate)", () => {
  it("renders mentionLabel, inserts mentionValue, and stays parseable", () => {
    const html = buildChatHtml({ nonce: "n".repeat(32), cspSource: "vsc:" });
    expect(html).toContain("ccAtMention.mentionLabel(f)");
    expect(html).toContain("ccAtMention.mentionValue(item)");
    const scripts = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)];
    for (const [, body] of scripts) new Function(body); // syntax-error gate
  });
});
