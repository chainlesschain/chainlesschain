import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { createStreamingTranscript } from "../../../vscode-extension/src/chat/streaming-transcript.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";

describe("streaming transcript", () => {
  it("drives bounded recovery actions through generated Webview controls and waits for the draft ACK", async () => {
    const window = new Window({
      settings: { enableJavaScriptEvaluation: true },
    });
    const messages = [];
    const token = "ab".repeat(32);
    window.acquireVsCodeApi = () => ({
      postMessage: (m) => messages.push(m),
      getState: () => ({}),
      setState: vi.fn(),
    });
    try {
      window.document.write(
        buildChatHtml({
          nonce: "n",
          cspSource: "vscode-resource:",
          hostDomToken: token,
        }),
      );
      const receive = (data) =>
        window.dispatchEvent(new window.MessageEvent("message", { data }));
      const command = (action, extra = {}, suppliedToken = token) =>
        receive({
          kind: "hostDomCommand",
          token: suppliedToken,
          requestId: "cd".repeat(16),
          command: { action, ...extra },
        });
      receive({
        kind: "tabs",
        activeId: "conv-1",
        tabs: [
          { id: "conv-1", title: "A", draftKey: "draft-a", draftStorage: true },
          { id: "conv-2", title: "B" },
        ],
      });
      command("editDraft", { text: "ignored" }, "ef".repeat(32));
      expect(window.document.getElementById("input").value).toBe("");
      command("editDraft", { text: "中文😀" });
      command("snapshot");
      const snapshot = () =>
        messages
          .filter((m) => m.type === "hostDomResult" && m.result?.tabs)
          .at(-1)?.result;
      await vi.waitFor(() => expect(snapshot()?.inputText).toBe("中文😀"));
      expect(snapshot().draftStatus).toContain("Saving draft");
      await new Promise((done) => setTimeout(done, 300));
      const draft = messages.find(
        (m) => m.type === "draftUpdate" && m.text === "中文😀",
      );
      expect(draft.convId).toBe("conv-1");
      receive({ ...draft, kind: "draftSaved" });
      command("snapshot");
      await vi.waitFor(() =>
        expect(snapshot()?.draftStatus).toContain("Draft saved on this device"),
      );
      command("switchTab", { id: "conv-2" });
      expect(messages).toContainEqual({ type: "switchTab", id: "conv-2" });
      command("click", { target: "newTab" });
      expect(messages).toContainEqual({ type: "newTab" });
      expect(
        messages.some((m) => m.type === "send" || m.type === "draftSend"),
      ).toBe(false);
    } finally {
      await window.happyDOM.abort();
    }
  });

  it.each([10000, 100000, 200000])(
    "parses %i characters once and preserves the live text node",
    (size) => {
      const window = new Window();
      const document = window.document;
      const element = document.createElement("div");
      document.body.appendChild(element);
      const parse = vi.fn((text) => text);
      const decorate = vi.fn();
      const renderer = createStreamingTranscript({
        document,
        renderMarkdown: parse,
        decorate,
        follow: vi.fn(),
      });
      const text = "a".repeat(size);
      renderer.update(element, text.slice(0, 100));
      const first = element.firstChild;
      for (let length = 200; length <= size; length += 100)
        renderer.update(element, text.slice(0, length));
      expect(parse).not.toHaveBeenCalled();
      expect(element.firstChild).toBe(first);
      expect(element.textContent).toBe(text);
      expect(element.childNodes.length).toBe(Math.ceil(size / 4096));
      expect([...element.childNodes].every((node) => node.length <= 4096)).toBe(
        true,
      );
      renderer.finish(element, text);
      renderer.update(element, text);
      renderer.finish(element, text);
      expect(parse).toHaveBeenCalledExactlyOnceWith(text);
      expect(decorate).toHaveBeenCalledTimes(1);
      renderer.dispose();
      window.happyDOM.abort();
    },
  );

  it("keeps selected text stable through completion and formats after deselection", () => {
    const window = new Window();
    const document = window.document;
    const element = document.createElement("div");
    document.body.appendChild(element);
    const parse = vi.fn((text) => text);
    const renderer = createStreamingTranscript({
      document,
      renderMarkdown: parse,
      decorate: vi.fn(),
      follow: vi.fn(),
    });
    renderer.update(element, "selected text");
    const original = element.firstChild;
    const range = document.createRange();
    range.setStart(original, 0);
    range.setEnd(original, 8);
    document.getSelection().addRange(range);
    renderer.update(element, "selected text continues");
    renderer.finish(element, "selected text continues");
    expect(element.firstChild).toBe(original);
    expect(document.getSelection().toString()).toBe("selected");
    expect(parse).not.toHaveBeenCalled();
    document.getSelection().removeAllRanges();
    document.dispatchEvent(new window.Event("selectionchange"));
    expect(parse).toHaveBeenCalledTimes(1);
    renderer.dispose();
    window.happyDOM.abort();
  });

  it("keeps adjacent Unicode text exact across bounded nodes and subsequent truncation", () => {
    const window = new Window();
    const document = window.document;
    const element = document.createElement("div");
    document.body.appendChild(element);
    const renderer = createStreamingTranscript({
      document,
      renderMarkdown: (t) => t,
      decorate: vi.fn(),
      follow: vi.fn(),
    });
    const text = "a".repeat(4095) + "😀中文".repeat(3000);
    renderer.update(element, text);
    expect(element.textContent).toBe(text);
    for (const node of element.childNodes) {
      expect(node.length).toBeLessThanOrEqual(4096);
      expect(node.data).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    }
    const first = element.firstChild;
    renderer.update(element, "bounded replacement", true);
    expect(element.firstChild).toBe(first);
    expect(element.childNodes.length).toBe(1);
    expect(element.textContent).toBe("bounded replacement");
    renderer.update(element, "a".repeat(4095) + "\uD83D");
    renderer.update(element, "a".repeat(4095) + "😀");
    expect(element.textContent).toBe("a".repeat(4095) + "😀");
    expect(element.lastChild.data).toBe("😀");
    renderer.dispose();
    window.happyDOM.abort();
  });

  it("runs the generated webview without scrolling away from an older message", () => {
    const window = new Window({
      settings: { enableJavaScriptEvaluation: true },
    });
    window.acquireVsCodeApi = () => ({
      postMessage: vi.fn(),
      getState: () => ({}),
      setState: vi.fn(),
    });
    window.document.write(
      buildChatHtml({ nonce: "n", cspSource: "vscode-resource:" }),
    );
    const log = window.document.getElementById("log");
    Object.defineProperties(log, {
      scrollHeight: { get: () => 3000 },
      clientHeight: { get: () => 300 },
    });
    log.scrollTop = 200;
    log.dispatchEvent(new window.Event("scroll"));
    const receive = (data) =>
      window.dispatchEvent(new window.MessageEvent("message", { data }));
    receive({ kind: "delta", text: "streaming" });
    receive({ kind: "turn_end" });
    expect(log.textContent).toContain("streaming");
    expect(log.scrollTop).toBe(200);
    window.happyDOM.abort();
  });
});
