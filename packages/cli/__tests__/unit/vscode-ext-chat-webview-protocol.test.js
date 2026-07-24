import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";

import {
  buildChatHtml,
  CHAT_UI_PROTOCOL_VERSION,
} from "../../../vscode-extension/src/chat/chat-html.js";
import { renderElicitationForm } from "../../../vscode-extension/src/chat/elicitation-form.js";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";

function makeHarness() {
  const htmlWrites = [];
  const posted = [];
  let html = "";
  let receiveMessage = null;
  let disposeView = null;
  const webview = {
    cspSource: "vscode-webview:",
    options: {},
    get html() {
      return html;
    },
    set html(value) {
      html = value;
      htmlWrites.push(value);
    },
    postMessage: vi.fn((message) => {
      posted.push(message);
      return Promise.resolve(true);
    }),
    onDidReceiveMessage: vi.fn((listener) => {
      receiveMessage = listener;
      return { dispose: vi.fn() };
    }),
  };
  const view = {
    webview,
    onDidDispose: vi.fn((listener) => {
      disposeView = listener;
      return { dispose: vi.fn() };
    }),
  };
  const vscode = {
    l10n: { t: (text) => text },
    commands: { executeCommand: vi.fn(() => Promise.resolve()) },
    window: {},
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "C:\\workspace" } }],
      getConfiguration: () => ({
        get: (key) => (key === "path" ? "mock-cc" : undefined),
      }),
    },
  };
  const provider = new ChatViewProvider(vscode, {
    deps: { getConfiguredProvider: async () => "configured" },
  });

  return {
    provider,
    view,
    htmlWrites,
    posted,
    receive(message) {
      if (!receiveMessage) throw new Error("message listener not registered");
      receiveMessage(message);
    },
    disposeView() {
      disposeView?.();
    },
  };
}

describe("chat Webview UI protocol self-heal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("rebuilds a retained legacy DOM whose ready message has no version", () => {
    const harness = makeHarness();
    harness.provider.resolveWebviewView(harness.view);

    expect(harness.htmlWrites).toHaveLength(1);
    expect(harness.posted[0]).toEqual({
      kind: "protocolProbe",
      uiProtocolVersion: CHAT_UI_PROTOCOL_VERSION,
    });

    harness.receive({ type: "ready" });

    expect(harness.htmlWrites).toHaveLength(2);
    expect(harness.htmlWrites[1]).not.toBe(harness.htmlWrites[0]);
    expect(harness.provider._webviewReady).toBe(false);

    harness.receive({
      type: "ready",
      uiProtocolVersion: CHAT_UI_PROTOCOL_VERSION,
    });

    expect(harness.provider._webviewProtocolConfirmed).toBe(true);
    expect(harness.provider._webviewReady).toBe(true);
    expect(harness.htmlWrites).toHaveLength(2);
    harness.disposeView();
  });

  it("rebuilds an unresponsive retained DOM once without entering a loop", () => {
    const harness = makeHarness();
    harness.provider.resolveWebviewView(harness.view);

    vi.advanceTimersByTime(750);
    expect(harness.htmlWrites).toHaveLength(2);

    vi.advanceTimersByTime(750);
    expect(harness.htmlWrites).toHaveLength(2);
    harness.disposeView();
  });

  it("rebuilds a retained DOM that reports an older protocol", () => {
    const harness = makeHarness();
    harness.provider.resolveWebviewView(harness.view);

    harness.receive({
      type: "ready",
      uiProtocolVersion: CHAT_UI_PROTOCOL_VERSION - 1,
    });

    expect(harness.htmlWrites).toHaveLength(2);
    expect(harness.provider._webviewProtocolConfirmed).toBe(false);
    harness.disposeView();
  });

  it("treats a matching probe response as ready after an EH restart", () => {
    const harness = makeHarness();
    harness.provider.resolveWebviewView(harness.view);

    harness.receive({
      type: "protocol",
      uiProtocolVersion: CHAT_UI_PROTOCOL_VERSION,
    });

    expect(harness.provider._webviewProtocolConfirmed).toBe(true);
    expect(harness.provider._webviewReady).toBe(true);
    expect(harness.htmlWrites).toHaveLength(1);
    expect(harness.posted.some((message) => message.kind === "tabs")).toBe(
      true,
    );

    const tabPosts = harness.posted.filter(
      (message) => message.kind === "tabs",
    ).length;
    harness.receive({
      type: "protocol",
      uiProtocolVersion: CHAT_UI_PROTOCOL_VERSION,
    });
    expect(
      harness.posted.filter((message) => message.kind === "tabs"),
    ).toHaveLength(tabPosts);
    harness.disposeView();
  });

  it("embeds the protocol in ready and answers Host probes", () => {
    const html = buildChatHtml({
      cspSource: "vscode-webview:",
      nonce: "test-nonce",
    });

    expect(html).toContain(
      `const CC_CHAT_UI_PROTOCOL_VERSION = ${CHAT_UI_PROTOCOL_VERSION};`,
    );
    expect(html).toContain('if (m.kind === "protocolProbe")');
    expect(html).toContain('type: "protocol"');
    expect(html).toContain("uiProtocolVersion: CC_CHAT_UI_PROTOCOL_VERSION");
    expect(html).toContain("CcElicitationSchema");
    expect(html).toContain("CcElicitationForm");
  });
});

describe("VS Code MCP elicitation form", () => {
  it("renders and validates the shared restricted schema before replying", () => {
    const window = new Window();
    const document = window.document;
    const card = document.createElement("section");
    const actions = document.createElement("div");
    const onSubmit = vi.fn();

    const rendered = renderElicitationForm({
      document,
      container: card,
      actions,
      schema: {
        type: "object",
        properties: {
          email: {
            type: "string",
            title: "Contact email",
            description: "Used for release notices",
            format: "email",
          },
          channel: {
            type: "string",
            title: "Release channel",
            oneOf: [
              { const: "stable", title: "Stable" },
              { const: "preview", title: "Preview" },
            ],
          },
          rating: {
            type: "integer",
            title: "Rating",
            minimum: 1,
            maximum: 5,
          },
          scopes: {
            type: "array",
            title: "Scopes",
            items: {
              anyOf: [
                { const: "read", title: "Read only" },
                { const: "write", title: "Read and write" },
              ],
            },
            minItems: 1,
            maxItems: 1,
          },
        },
        required: ["email", "channel", "rating", "scopes"],
      },
      onSubmit,
    });

    expect(rendered.rendered).toBe(true);
    expect(card.textContent).toContain("Contact email *");
    expect(card.textContent).toContain("Used for release notices");
    expect(card.textContent).toContain("Preview");
    expect(card.textContent).toContain("Read and write");

    const rows = [...card.querySelectorAll(".elicitation-field")];
    const row = (title) =>
      rows.find((candidate) =>
        candidate.querySelector("label")?.textContent?.startsWith(title),
      );
    row("Contact email").querySelector("input").value = "invalid";
    row("Release channel").querySelector("select").value = "preview";
    row("Rating").querySelector("input").value = "8";
    row("Scopes").querySelector('input[value="read"]').checked = true;
    rendered.submit.click();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(card.textContent).toContain("must be a valid email");
    expect(card.textContent).toContain("must be at most 5");

    row("Contact email").querySelector("input").value = "dev@example.com";
    row("Rating").querySelector("input").value = "5";
    rendered.submit.click();

    expect(onSubmit).toHaveBeenCalledWith({
      email: "dev@example.com",
      channel: "preview",
      rating: 5,
      scopes: ["read"],
    });
  });
});
