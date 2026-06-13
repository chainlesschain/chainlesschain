/**
 * "Insert File Reference" command (Cmd/Ctrl+Alt+K — Claude Code parity).
 *
 * Layers: the pure path→`@ref` formatter, the provider's reveal + queue/flush
 * (a reference inserted before the webview is live must be flushed on "ready",
 * not dropped), and the generated-HTML parse gate (the dead-panel trap: every
 * webview script must stay parseable, and the insertText case + ready signal
 * must ship).
 */
import { describe, it, expect, vi } from "vitest";

import { formatInsertReference } from "../../../vscode-extension/src/chat/insert-reference.js";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";

describe("formatInsertReference", () => {
  it("turns a workspace-relative path into an @ref token with trailing space", () => {
    expect(formatInsertReference("src/app.js")).toBe("@src/app.js ");
  });

  it("normalizes Windows backslashes to forward slashes", () => {
    expect(formatInsertReference("src\\chat\\view.js")).toBe(
      "@src/chat/view.js ",
    );
  });

  it("returns empty string for empty/missing input", () => {
    expect(formatInsertReference("")).toBe("");
    expect(formatInsertReference(null)).toBe("");
    expect(formatInsertReference("   ")).toBe("");
  });
});

describe("ChatViewProvider.insertReference", () => {
  function makeProvider() {
    const executeCommand = vi.fn();
    const postMessage = vi.fn(() => Promise.resolve());
    const vscode = { commands: { executeCommand } };
    const provider = new ChatViewProvider(vscode, {});
    return { provider, executeCommand, postMessage };
  }

  it("reveals the panel and queues the ref when the webview is not live yet", () => {
    const { provider, executeCommand, postMessage } = makeProvider();
    provider.insertReference("@src/app.js ");
    expect(executeCommand).toHaveBeenCalledWith("chainlesschainIdeChat.focus");
    // Nothing posted yet (no live webview) — it's queued.
    expect(postMessage).not.toHaveBeenCalled();
    expect(provider._pendingInsert).toBe("@src/app.js ");
  });

  it("flushes the queued ref once the webview signals ready", () => {
    const { provider, postMessage } = makeProvider();
    provider.view = { webview: { postMessage } };
    provider.insertReference("@a.js "); // queued (not ready)
    provider.insertReference("@b.js "); // accumulates
    expect(postMessage).not.toHaveBeenCalled();
    provider._onWebviewReady();
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      kind: "insertText",
      text: "@a.js @b.js ",
    });
    expect(provider._pendingInsert).toBe("");
  });

  it("posts immediately when the webview is already live", () => {
    const { provider, postMessage } = makeProvider();
    provider.view = { webview: { postMessage } };
    provider._webviewReady = true;
    provider.insertReference("@src/app.js ");
    expect(postMessage).toHaveBeenCalledWith({
      kind: "insertText",
      text: "@src/app.js ",
    });
  });

  it("ignores empty references", () => {
    const { provider, executeCommand } = makeProvider();
    provider.insertReference("");
    expect(executeCommand).not.toHaveBeenCalled();
  });
});

describe("chat HTML ships insertText + ready (parse gate)", () => {
  it("handles insertText, signals ready, and every script still parses", () => {
    const html = buildChatHtml({ nonce: "n".repeat(32), cspSource: "vsc:" });
    expect(html).toContain('case "insertText"');
    expect(html).toContain('type: "ready"');
    const scripts = [
      ...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g),
    ];
    expect(scripts.length).toBeGreaterThanOrEqual(3);
    for (const [, body] of scripts) {
      new Function(body); // throws on a syntax error — dead-panel regression gate
    }
  });
});
