import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const url = new URL(
    "../../../vscode-extension/src/ui/plugin-manager-view.js",
    import.meta.url,
  ),
  realRequire = createRequire(url),
  source = fs.readFileSync(url, "utf8");
const draft = requireDraft();
function requireDraft() {
  return realRequire("../goal-drafts.js");
}
const store = "project-goals-12345678-1234-1234-1234-123456789abc",
  connection = "C:/private/online.json",
  record = "C:/records/submission.json",
  out = "C:/records/access.json",
  body = "C:/body.txt";
const goalRef = {
    id: "goal-1",
    storeId: store,
    revision: 1,
    controlGeneration: 0,
  },
  plugin = { name: "drafter", scope: "project", version: "1.0.0" },
  grantRef = { id: `goal-external-grant-${"c".repeat(64)}`, epoch: 1 },
  declarationDigest = `sha256:${"d".repeat(64)}`,
  sourceId = `goal-proposal-${"a".repeat(64)}`;
const input = {
  id: "goal-1",
  expectedStore: store,
  connection,
  name: "drafter",
  scope: "project",
  record,
};
function sourcePage() {
  return {
    schema: "chainlesschain.goal-draft-source-page/v1",
    goalRef,
    plugin,
    grantRef,
    declarationDigest,
    sources: {
      entries: [
        {
          id: sourceId,
          sourceTaskId: "t1",
          reviewId: "r1",
          reviewDigest: declarationDigest,
        },
      ],
      scannedCount: 1,
      unavailableCount: 0,
      nextCursor: null,
    },
  };
}
function submission(state = "saved", requestId = "original-id") {
  return {
    schema: "chainlesschain.goal-draft-submission/v1",
    goalRef,
    plugin,
    grantRef,
    declarationDigest,
    requestId,
    inputDigest: declarationDigest,
    proposalId: state === "saved" ? `goal-extension-${"b".repeat(64)}` : null,
    state,
    record,
  };
}
function harness({ state = "saved", defer = false, cancel = false } = {}) {
  let receive, finish;
  const posts = [];
  const runCliText = vi.fn(({ args }) => {
    if (args[1] === "catalog")
      return Promise.resolve(
        JSON.stringify({
          schema: "chainlesschain.goal-catalog.v1",
          source: "desktop-project",
          snapshot: true,
          storeId: store,
          observedAt: "2026-10-18T00:00:00Z",
          entries: [
            {
              id: "goal-1",
              title: "Delivery",
              status: "active",
              revision: 1,
              controlGeneration: 0,
            },
          ],
          scannedCount: 1,
          skippedCount: 0,
          invalidNameCount: 0,
          nextCursor: null,
        }),
      );
    if (args[1] === "draft-sources")
      return Promise.resolve(JSON.stringify(sourcePage()));
    if (args[1] === "draft-access")
      return Promise.resolve(
        JSON.stringify({
          schema: "chainlesschain.goal-draft-access-export/v1",
          state: "access-exported",
          plugin,
          declarationDigest,
          file: out,
        }),
      );
    if (["draft-send", "draft-receipt"].includes(args[1])) {
      const id =
        args.find((x) => x.startsWith("--request-id="))?.slice(13) ||
        "original-id";
      const value = JSON.stringify(submission(state, id));
      return defer
        ? new Promise((resolve) => (finish = () => resolve(value)))
        : Promise.resolve(value);
    }
    return Promise.resolve("[]");
  });
  const panel = {
    reveal() {},
    onDidDispose() {},
    webview: {
      html: "",
      postMessage: (msg) => posts.push(msg),
      onDidReceiveMessage: (fn) => (receive = fn),
    },
  };
  const vscode = {
    workspace: { workspaceFolders: [{ uri: { fsPath: "C:/workspace" } }] },
    ViewColumn: { Active: 1 },
    window: {
      createWebviewPanel: () => panel,
      showQuickPick: vi.fn(async (rows) => rows[0]),
      showOpenDialog: vi
        .fn()
        .mockResolvedValueOnce([{ fsPath: connection }])
        .mockResolvedValueOnce([{ fsPath: body }]),
      showSaveDialog: vi.fn(async () =>
        cancel ? undefined : { fsPath: record },
      ),
      showInputBox: vi.fn(async () => "User title"),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (name) =>
      name === "../chat/introspect-commands.js"
        ? { runCliText }
        : name === "../cli-binary"
          ? { getResolvedCli: () => "cc" }
          : realRequire(name),
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
  });
  module.exports.openPluginManager(vscode);
  return {
    send: (msg) => receive(msg),
    posts,
    runCliText,
    vscode,
    finish: () => finish?.(),
  };
}
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 25));
};
describe("VS Code online draft native flows", () => {
  it("takes source and all filesystem paths from native pickers, ignoring webview path injection", async () => {
    const h = harness();
    h.send({
      command: "pluginGoalDraftSend",
      name: "drafter",
      scope: "project",
      connection: "C:/evil",
      source: "evil",
      record: "C:/evil",
      descriptionFile: "C:/evil",
    });
    await flush();
    const args = h.runCliText.mock.calls.find(
      ([arg]) => arg.args[1] === "draft-send",
    )[0].args;
    expect(args).toEqual(
      expect.arrayContaining([
        `--connection=${connection}`,
        `--source=${sourceId}`,
        `--record=${record}`,
        `--description-file=${body}`,
      ]),
    );
    expect(args.join(" ")).not.toContain("evil");
    expect(h.vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
    expect(
      h.posts.some((msg) => msg.text?.includes("Saved pending draft")),
    ).toBe(true);
  });
  it("exports an access request without opening a connection or submitting", async () => {
    const h = harness();
    h.vscode.window.showSaveDialog.mockResolvedValue({ fsPath: out });
    h.send({
      command: "pluginGoalDraftAccess",
      name: "drafter",
      scope: "project",
      out: "evil",
    });
    await flush();
    expect(
      h.runCliText.mock.calls.some(
        ([arg]) =>
          arg.args[1] === "draft-access" && arg.args.includes(`--out=${out}`),
      ),
    ).toBe(true);
    expect(
      h.runCliText.mock.calls.some(([arg]) => arg.args[1] === "draft-send"),
    ).toBe(false);
  });
  it("looks up a prior record independently of a previous send UI", async () => {
    const h = harness({ state: "not-found" });
    h.vscode.window.showOpenDialog
      .mockReset()
      .mockResolvedValueOnce([{ fsPath: connection }])
      .mockResolvedValueOnce([{ fsPath: record }]);
    h.send({
      command: "pluginGoalDraftReceipt",
      name: "drafter",
      scope: "project",
    });
    await flush();
    expect(
      h.runCliText.mock.calls.find(
        ([arg]) => arg.args[1] === "draft-receipt",
      )[0].args,
    ).toEqual(expect.arrayContaining([`--record=${record}`]));
    expect(h.posts.some((msg) => msg.text?.includes("at lookup time"))).toBe(
      true,
    );
    expect(
      h.runCliText.mock.calls.some(([arg]) => arg.args[1] === "draft-send"),
    ).toBe(false);
  });
  it("reports an unknown outcome with the durable record and never auto-resends", async () => {
    const h = harness({ state: "unknown" });
    h.send({
      command: "pluginGoalDraftSend",
      name: "drafter",
      scope: "project",
    });
    await flush();
    expect(
      h.posts.some(
        (msg) =>
          msg.text?.includes("Submission outcome unknown") &&
          msg.text.includes(record),
      ),
    ).toBe(true);
    expect(
      h.runCliText.mock.calls.filter(([arg]) => arg.args[1] === "draft-send"),
    ).toHaveLength(1);
  });
  it("discards late presentation after a clear while leaving the native operation and durable record alone", async () => {
    const h = harness({ defer: true });
    h.send({
      command: "pluginGoalDraftSend",
      name: "drafter",
      scope: "project",
    });
    await flush();
    h.send({ command: "clearGoalPanels" });
    h.finish();
    await flush();
    expect(
      h.posts.some((msg) => msg.text?.includes("Saved pending draft")),
    ).toBe(false);
  });
  it("cancels before submission if the record save picker is cancelled", async () => {
    const h = harness({ cancel: true });
    h.send({
      command: "pluginGoalDraftSend",
      name: "drafter",
      scope: "project",
    });
    await flush();
    expect(
      h.runCliText.mock.calls.some(([arg]) => arg.args[1] === "draft-send"),
    ).toBe(false);
  });
});
describe("bounded online draft response projections", () => {
  it("pins full goal/plugin/declaration/grant identity across source pages and submission results", () => {
    const raw = sourcePage();
    const binding = draft.parseGoalDraftSources(
      JSON.stringify(raw),
      input,
    ).binding;
    for (const mutate of [
      (r) => r.grantRef.epoch++,
      (r) => (r.plugin.version = "2.0"),
      (r) => (r.declarationDigest = `sha256:${"e".repeat(64)}`),
      (r) => r.goalRef.revision++,
    ]) {
      const next = structuredClone(raw);
      mutate(next);
      expect(
        draft.parseGoalDraftSources(JSON.stringify(next), {
          ...input,
          binding,
        }),
      ).toBeNull();
      const submitted = {
        ...submission(),
        goalRef: next.goalRef,
        plugin: next.plugin,
        declarationDigest: next.declarationDigest,
        grantRef: next.grantRef,
      };
      expect(
        draft.parseGoalDraftSubmission(JSON.stringify(submitted), {
          ...input,
          binding,
        }),
      ).toBeNull();
    }
    expect(
      draft.parseGoalDraftSubmission(JSON.stringify(submission()), {
        ...input,
        binding,
      }).inputDigest,
    ).toBe(declarationDigest);
  });
  it("rejects wrong plugin, inconsistent source counts, unknown source IDs and unbounded output", () => {
    const raw = sourcePage();
    expect(
      draft.parseGoalDraftSources(JSON.stringify(raw), input).entries[0].id,
    ).toBe(sourceId);
    for (const mutate of [
      (r) => (r.plugin.scope = "user"),
      (r) => (r.sources.scannedCount = 2),
      (r) => (r.sources.entries[0].id = "manual-id"),
    ]) {
      const bad = structuredClone(raw);
      mutate(bad);
      expect(
        draft.parseGoalDraftSources(JSON.stringify(bad), input),
      ).toBeNull();
    }
    expect(draft.parseGoalDraftSources(" ".repeat(16385), input)).toBeNull();
  });
  it("rejects a false saved receipt and wrong reference file", () => {
    const raw = submission();
    expect(
      draft.parseGoalDraftSubmission(JSON.stringify(raw), input).state,
    ).toBe("saved");
    expect(
      draft.parseGoalDraftSubmission(
        JSON.stringify({ ...raw, proposalId: null }),
        input,
      ),
    ).toBeNull();
    expect(
      draft.parseGoalDraftSubmission(
        JSON.stringify({ ...raw, record: "evil" }),
        input,
      ),
    ).toBeNull();
  });
  it("builds fixed argv with leading-dash data in equals arguments", () => {
    const args = draft.buildGoalDraftSendArgs({
      ...input,
      title: "--help",
      source: sourceId,
      descriptionFile: body,
      requestId: "stable",
    });
    expect(args).toContain("--title=--help");
    expect(() => draft.buildGoalDraftSourcesArgs(input, "manual")).toThrow();
  });
});
