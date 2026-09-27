import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { createStreamingTranscript } from "../../../vscode-extension/src/chat/streaming-transcript.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";

describe("streaming transcript", () => {
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
