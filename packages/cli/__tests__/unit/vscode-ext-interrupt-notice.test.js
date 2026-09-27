import { expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";
import {
  createTurnState,
  mapAgentEvent,
} from "../../../vscode-extension/src/chat/chat-events.js";

it.each([true, false])(
  "keeps interruption visible independently of announcements (streamed=%s)",
  (streamed) => {
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
    const receive = (data) =>
      window.dispatchEvent(new window.MessageEvent("message", { data }));
    const provider = new ChatViewProvider(
      {
        workspace: {
          workspaceFolders: [],
          getConfiguration: () => ({ get: () => "mock-cc" }),
        },
        commands: {},
        window: {},
      },
      {},
    );
    provider.view = {
      webview: {
        postMessage(message) {
          receive(message);
          return Promise.resolve(true);
        },
      },
    };
    const conv = provider._activeConv();
    conv._sessionToken = {};
    const state = createTurnState();
    receive({
      kind: "tabs",
      tabs: [{ id: conv.id, title: "A" }],
      activeId: conv.id,
    });
    if (streamed)
      provider._postFrom(
        conv.id,
        mapAgentEvent(
          {
            type: "stream_event",
            event: { delta: { type: "text_delta", text: "partial answer" } },
          },
          state,
        ),
      );
    provider._postFrom(
      conv.id,
      mapAgentEvent(
        {
          type: "result",
          subtype: "interrupted",
          interrupted: true,
          is_error: false,
        },
        state,
      ),
    );
    const log = window.document.getElementById("log");
    expect(log.textContent).toContain("interrupted");
    expect(
      [...log.querySelectorAll(".info")].filter((el) =>
        el.textContent.includes("interrupted"),
      ),
    ).toHaveLength(1);
    expect(
      conv.transcript.filter(
        (row) => row.role === "info" && row.text.includes("interrupted"),
      ),
    ).toHaveLength(1);
    expect(
      conv.transcript
        .filter((row) => row.role === "assistant")
        .map((row) => row.text),
    ).toEqual(streamed ? ["partial answer"] : []);
    receive({
      kind: "transcript",
      messages: conv.transcript,
      replaceView: true,
      live: true,
    });
    expect(
      [...log.querySelectorAll(".info")].filter((el) =>
        el.textContent.includes("interrupted"),
      ),
    ).toHaveLength(1);
    expect(log.textContent).toContain("interrupted");
    window.happyDOM.abort();
  },
);
