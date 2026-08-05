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

function providerWith({ responses, confirm = true }) {
  const parsed = rewind.parseTimelineProjection(fixture.projection);
  const entry = parsed.entries[1];
  const turnPick = rewind.toTimelineQuickPickItem(entry);
  const actionPick = rewind
    .timelineActionItems(entry)
    .find((candidate) => candidate.action === "restore-both");
  const confirmationPick = confirm
    ? { label: "Confirm action", confirmed: true }
    : undefined;
  const picks = [turnPick, actionPick, confirmationPick];
  const calls = [];
  const posted = [];
  const shownDocs = [];
  const quickPicks = [];
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
      showQuickPick: async (...args) => {
        quickPicks.push(args);
        return picks.shift();
      },
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
  return { provider, calls, posted, shownDocs, quickPicks, actionPick };
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
    const { provider, calls, posted, shownDocs, quickPicks, actionPick } =
      providerWith({
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
    const confirmationItems = quickPicks[2][0];
    const confirmationOptions = quickPicks[2][1];
    expect(confirmationItems[0]).toMatchObject({
      label: "Confirm action",
      description: "Restore code + conversation at turn-2",
      confirmed: true,
    });
    expect(confirmationItems[0].detail).toContain(
      "Excluded paths: vendor/cache",
    );
    expect(confirmationItems[0].detail).toContain(
      "Irreversible side effects: publish release, bundle.zip",
    );
    expect(confirmationOptions).toMatchObject({
      title: "Confirm Restore code + conversation at turn-2",
      ignoreFocusOut: true,
    });
    expect(confirmationOptions.placeHolder).toContain("vendor/cache");
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

  it("cancels fail closed when the confirmation picker is dismissed", async () => {
    const { provider, calls, posted } = providerWith({
      confirm: false,
      responses: [
        { ok: true, data: fixture.projection },
        { ok: true, data: fixture.actionPreview },
      ],
    });

    await provider._rewind();

    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("--preview");
    expect(calls.some((args) => args.includes("--confirm"))).toBe(false);
    expect(posted.at(-1)).toMatchObject({
      kind: "info",
      text: expect.stringContaining("cancelled"),
    });
  });

  it("refuses to open a mutable timeline during an active turn", async () => {
    const { provider, calls, posted } = providerWith({ responses: [] });
    provider._activeConv().turnActive = true;

    await provider._rewind();

    expect(calls).toEqual([]);
    expect(posted.at(-1).text).toContain("stop the active turn");
  });
});
