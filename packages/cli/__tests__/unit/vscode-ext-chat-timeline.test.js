import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import * as rewindModule from "../../../vscode-extension/src/chat/rewind-commands.js";

const rewind = rewindModule.default || rewindModule;
const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../vscode-extension/src/__fixtures__/checkpoint-timeline/cases.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);

function memento(sessionId) {
  const state = new Map([["chainlesschain.chat.sessionId", sessionId]]);
  return {
    get: (key) => state.get(key) ?? null,
    update: (key, value) => state.set(key, value),
  };
}

function providerWith({ responses, confirm = "Confirm action" }) {
  const parsed = rewind.parseTimelineProjection(fixture.projection);
  const entry = parsed.entries[1];
  const turnPick = rewind.toTimelineQuickPickItem(entry);
  const actionPick = rewind
    .timelineActionItems(entry)
    .find((candidate) => candidate.action === "restore-both");
  const picks = [turnPick, actionPick];
  const calls = [];
  const posted = [];
  const shownDocs = [];
  let responseIndex = 0;
  const rewindStub = {
    ...rewind,
    runCliJson(options) {
      calls.push(options.args);
      return Promise.resolve(responses[responseIndex++]);
    },
  };
  const vscode = {
    commands: { executeCommand() {} },
    window: {
      showQuickPick: async () => picks.shift(),
      showWarningMessage: async () => confirm,
      showTextDocument: async (doc) => shownDocs.push(doc),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/ws" } }],
      getConfiguration: () => ({ get: () => undefined }),
      openTextDocument: async (options) => ({ ...options }),
    },
  };
  const provider = new ChatViewProvider(vscode, {
    deps: { createSession: () => ({ running: true }), rewind: rewindStub },
    state: memento("session-fixture"),
  });
  provider.view = {
    webview: {
      postMessage: (message) => (posted.push(message), Promise.resolve()),
    },
  };
  return { provider, calls, posted, shownDocs, actionPick };
}

function executedResult(overrides = {}) {
  return {
    schema: "cc-checkpoint-timeline-result/v1",
    version: 1,
    ok: true,
    mode: "executed",
    action: "restore-both",
    sessionId: "session-fixture",
    turnId: "turn-2",
    revision: "timeline-fixture-r1",
    nextRevision: "timeline-next-r2",
    result: { conversation: { messages: 4 } },
    warnings: fixture.actionPreview.warnings,
    ...overrides,
  };
}

describe("ChatView canonical checkpoint timeline", () => {
  it("shows turn/action UI, previews, confirms, and submits the exact envelope", async () => {
    const { provider, calls, posted, shownDocs, actionPick } = providerWith({
      responses: [
        { ok: true, data: fixture.projection },
        { ok: true, data: fixture.actionPreview },
        { ok: true, data: executedResult() },
      ],
    });

    await provider._rewind();

    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual(rewind.buildTimelineArgs("session-fixture"));
    expect(calls[1]).toContain("--preview");
    expect(calls[2]).toContain("--confirm");
    expect(JSON.parse(calls[1][5])).toEqual(actionPick.submission);
    expect(JSON.parse(calls[2][5])).toEqual(
      fixture.actionPreview.confirmationSubmission,
    );
    expect(shownDocs[0]).toMatchObject({ language: "markdown" });
    expect(shownDocs[0].content).toContain("bundle.zip");
    expect(posted).toContainEqual({ kind: "reset" });
    expect(posted.at(-1)).toMatchObject({
      kind: "info",
      text: expect.stringContaining("completed"),
    });
  });

  it("surfaces a stale CLI commit and never claims success", async () => {
    const stale = executedResult({
      ok: false,
      mode: undefined,
      code: "TIMELINE_STALE",
      error: "refresh",
    });
    const { provider, posted } = providerWith({
      responses: [
        { ok: true, data: fixture.projection },
        { ok: true, data: fixture.actionPreview },
        { ok: true, data: stale },
      ],
    });

    await provider._rewind();

    expect(posted.at(-1)).toMatchObject({
      kind: "error",
      text: expect.stringContaining("TIMELINE_STALE"),
    });
    expect(posted.some((message) => /completed/.test(message.text || ""))).toBe(
      false,
    );
  });

  it("refuses to open a mutable timeline during an active turn", async () => {
    const { provider, calls, posted } = providerWith({ responses: [] });
    provider._activeConv().turnActive = true;

    await provider._rewind();

    expect(calls).toEqual([]);
    expect(posted.at(-1).text).toContain("stop the active turn");
  });
});
