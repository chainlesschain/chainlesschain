/**
 * @file-mention completion in the chat panel — typing "@" suggests workspace
 * files; the accepted "@rel/path " rides the normal user turn and the CLI
 * expands it server-side (headless-stream expandFileRefs), so the panel only
 * helps TYPE the reference.
 *
 * Layers: pure token/filter/splice logic (shared Node↔webview, like md-lite),
 * the provider's cached workspace listing, and the generated-HTML parse gate
 * (the 0.9.0/0.10.0 dead-panel trap: webview script must stay parseable).
 */
import { describe, it, expect, vi } from "vitest";

import {
  detectAtToken,
  filterFiles,
  applyMention,
  ideMentionMatches,
} from "../../../vscode-extension/src/chat/at-mention.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";

describe("detectAtToken", () => {
  it("detects an @token at start, after whitespace, and after brackets", () => {
    expect(detectAtToken("@src")).toEqual({ prefix: "src", start: 0 });
    expect(detectAtToken("read @pack")).toEqual({ prefix: "pack", start: 5 });
    expect(detectAtToken("see (@li")).toEqual({ prefix: "li", start: 5 });
    expect(detectAtToken("fix @")).toEqual({ prefix: "", start: 4 });
  });

  it("supports path characters in the prefix", () => {
    expect(detectAtToken("@src/chat/at-m").prefix).toBe("src/chat/at-m");
    expect(detectAtToken("@src\\chat").prefix).toBe("src\\chat");
    expect(detectAtToken("@my-file.test.js").prefix).toBe("my-file.test.js");
  });

  it("ignores emails and mid-word @", () => {
    expect(detectAtToken("mail me a@b")).toBeNull();
    expect(detectAtToken("user@host")).toBeNull();
  });

  it("returns null when the caret left the token", () => {
    expect(detectAtToken("@src done ")).toBeNull();
    expect(detectAtToken("")).toBeNull();
  });
});

describe("filterFiles", () => {
  const FILES = [
    "README.md",
    "src/app.js",
    "src/chat/app-view.js",
    "src/chat/chat-html.js",
    "docs/apps/guide.md",
  ];

  it("empty prefix lists the head of the corpus", () => {
    expect(filterFiles(FILES, "", 3)).toEqual([
      "README.md",
      "src/app.js",
      "src/chat/app-view.js",
    ]);
  });

  it("ranks basename-prefix over path-prefix over substring", () => {
    expect(filterFiles(FILES, "app", 10)).toEqual([
      "src/app.js", // basename starts with "app"
      "src/chat/app-view.js", // basename starts with "app"
      "docs/apps/guide.md", // substring elsewhere in the path
    ]);
    expect(filterFiles(FILES, "src/ch", 10)).toEqual([
      "src/chat/app-view.js",
      "src/chat/chat-html.js",
    ]);
  });

  it("is case-insensitive and normalizes backslashes in the query", () => {
    expect(filterFiles(FILES, "readme", 10)).toEqual(["README.md"]);
    expect(filterFiles(FILES, "src\\chat", 10)).toEqual([
      "src/chat/app-view.js",
      "src/chat/chat-html.js",
    ]);
  });

  it("caps at the limit", () => {
    expect(filterFiles(FILES, "", 2)).toHaveLength(2);
  });
});

describe("applyMention", () => {
  it("replaces the active token and appends a space", () => {
    const r = applyMention("read @ap please", { start: 5 }, "src/app.js", 8);
    expect(r.text).toBe("read @src/app.js  please");
    expect(r.caret).toBe("read @src/app.js ".length);
  });

  it("works at end of input", () => {
    const r = applyMention("fix @", { start: 4 }, "README.md", 5);
    expect(r.text).toBe("fix @README.md ");
    expect(r.caret).toBe(r.text.length);
  });
});

describe("ideMentionMatches", () => {
  it("offers all IDE pseudo-mentions for an empty prefix", () => {
    expect(ideMentionMatches("")).toEqual(["selection", "diagnostics", "terminal"]);
    expect(ideMentionMatches(null)).toEqual(["selection", "diagnostics", "terminal"]);
  });

  it("filters by prefix, case-insensitively", () => {
    expect(ideMentionMatches("s")).toEqual(["selection"]);
    expect(ideMentionMatches("DIAG")).toEqual(["diagnostics"]);
    expect(ideMentionMatches("sel")).toEqual(["selection"]);
    expect(ideMentionMatches("t")).toEqual(["terminal"]);
  });

  it("returns nothing when the prefix can't start either keyword", () => {
    expect(ideMentionMatches("src")).toEqual([]);
    expect(ideMentionMatches("x")).toEqual([]);
  });
});

describe("ChatViewProvider._listWorkspaceFiles", () => {
  function makeProvider() {
    const findFiles = vi.fn(async () => [
      { fsPath: "C:\\ws\\src\\app.js" },
      { fsPath: "C:\\ws\\src\\chat\\app-view.js" },
      { fsPath: "C:\\ws\\README.md" },
    ]);
    const vscode = {
      workspace: {
        findFiles,
        workspaceFolders: [{ uri: { fsPath: "C:\\ws" } }],
        getConfiguration: () => ({ get: () => undefined }),
      },
    };
    return { provider: new ChatViewProvider(vscode, {}), findFiles };
  }

  it("maps to workspace-relative forward-slash paths and filters", async () => {
    const { provider } = makeProvider();
    expect(await provider._listWorkspaceFiles("app")).toEqual([
      "src/app.js",
      "src/chat/app-view.js",
    ]);
  });

  it("scans once and reuses the cache across keystrokes", async () => {
    const { provider, findFiles } = makeProvider();
    await provider._listWorkspaceFiles("a");
    await provider._listWorkspaceFiles("ap");
    await provider._listWorkspaceFiles("app");
    expect(findFiles).toHaveBeenCalledTimes(1);
    provider._fileCache = null; // what the "new" branch does
    await provider._listWorkspaceFiles("a");
    expect(findFiles).toHaveBeenCalledTimes(2);
  });

  it("survives a findFiles failure with an empty list", async () => {
    const vscode = {
      workspace: {
        findFiles: vi.fn(async () => {
          throw new Error("no workspace");
        }),
        workspaceFolders: [],
        getConfiguration: () => ({ get: () => undefined }),
      },
    };
    const provider = new ChatViewProvider(vscode, {});
    expect(await provider._listWorkspaceFiles("x")).toEqual([]);
  });
});

describe("chat HTML embeds the completion (parse gate)", () => {
  it("ships the suggest UI + ccAtMention and every script still parses", () => {
    const html = buildChatHtml({ nonce: "n".repeat(32), cspSource: "vsc:" });
    expect(html).toContain('id="suggest"');
    expect(html).toContain("ccAtMention");
    const scripts = [
      ...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g),
    ];
    expect(scripts.length).toBeGreaterThanOrEqual(3); // md-lite + at-mention + panel
    for (const [, body] of scripts) {
      // Throws on a syntax error — the 0.10.1 dead-panel regression gate.
      new Function(body);
    }
  });
});
