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
const { packet } = realRequire(
  "../../../cli/__tests__/fixtures/goal-history.cjs",
);
function harness({ mode = "new", file = true, deferred = false } = {}) {
  let receive, dispose, workspaceChanged, resolveFile;
  const posts = [],
    runs = [];
  const history = realRequire("../goal-history");
  const startGoalReplay = vi.fn((options) => {
    const run = { options, stop: vi.fn(async () => {}) };
    runs.push(run);
    return run;
  });
  const panel = {
    reveal() {},
    webview: {
      html: "",
      postMessage: (message) => posts.push(message),
      onDidReceiveMessage: (fn) => {
        receive = fn;
      },
    },
    onDidDispose: (fn) => {
      dispose = fn;
    },
  };
  const vscode = {
    ViewColumn: { Active: 1 },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "C:/workspace" } }],
      onDidChangeWorkspaceFolders: (fn) => {
        workspaceChanged = fn;
        return { dispose() {} };
      },
    },
    window: {
      createWebviewPanel: () => panel,
      showOpenDialog: vi.fn((options) =>
        deferred
          ? new Promise((resolve) => {
              resolveFile = resolve;
            })
          : Promise.resolve(
              file
                ? [
                    {
                      fsPath: options.openLabel.includes("checkpoint")
                        ? "C:/resume.json"
                        : "C:/connection.json",
                    },
                  ]
                : undefined,
            ),
      ),
      showSaveDialog: vi.fn(async () => ({ fsPath: "C:/new.json" })),
      showInputBox: vi.fn(async () => "goal-1"),
      showQuickPick: vi.fn(async (items) =>
        items.find((item) => item.mode === mode),
      ),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    require(name) {
      if (name === "../goal-history") return { ...history, startGoalReplay };
      if (name === "../chat/introspect-commands.js")
        return { runCliText: async () => "[]" };
      if (name === "../cli-binary")
        return { getResolvedCli: () => "chosen-cc" };
      return realRequire(name);
    },
  });
  module.exports.openPluginManager(vscode);
  return {
    posts,
    runs,
    panel,
    vscode,
    startGoalReplay,
    receive: (msg) => receive(msg),
    dispose: () => dispose(),
    workspace: () => workspaceChanged(),
    resolveFile: (value) => resolveFile(value),
    saved(index = 0) {
      const run = runs[index];
      run.options.onEnd({
        state: "saved",
        page: history.parseGoalHistory(
          JSON.stringify(packet()),
          run.options.input,
        ),
      });
    },
  };
}
const begin = (h) =>
  h.receive({
    command: "pluginGoalHistory",
    name: "observer",
    scope: "project",
    id: "forged",
    connection: "forged",
    checkpoint: "forged",
    checkpointMode: "forged",
  });
const ready = (h) =>
  vi.waitFor(() => expect(h.posts.some((x) => x.type === "update")).toBe(true));
describe("VS Code retained history UI", () => {
  it.each(["new", "resume"])(
    "uses native selections for %s and requires an explicit next click",
    async (mode) => {
      const h = harness({ mode });
      await ready(h);
      begin(h);
      await vi.waitFor(() => expect(h.runs).toHaveLength(1));
      expect(h.runs[0].options).toMatchObject({
        command: "chosen-cc",
        cwd: "C:/workspace",
        input: {
          id: "goal-1",
          name: "observer",
          scope: "project",
          connection: "C:/connection.json",
          checkpoint: mode === "new" ? "C:/new.json" : "C:/resume.json",
          checkpointMode: mode,
        },
      });
      expect(JSON.stringify(h.runs[0].options.input)).not.toContain("forged");
      expect(h.posts.at(-1).canRead).toBe(false);
      h.saved();
      expect(h.posts.at(-1).canRead).toBe(true);
      await Promise.resolve();
      expect(h.runs).toHaveLength(1);
      h.receive({
        command: "nextGoalHistory",
        id: "forged",
        name: "other",
        checkpoint: "forged",
      });
      await vi.waitFor(() => expect(h.runs).toHaveLength(2));
      expect(h.runs[1].options.input).toEqual({
        ...h.runs[0].options.input,
        checkpointMode: "resume",
      });
      expect(h.runs[1].options.expected).toEqual(
        h.runs[0].options.expected ?? {
          goalRef: packet().goalRef,
          plugin: packet().plugin,
        },
      );
      expect(h.panel.webview.html).toContain(
        "document.getElementById('goalHistory').textContent",
      );
    },
  );
  it.each([
    "refresh",
    "pluginReload",
    "clearGoalPanels",
    "stopGoalHistory",
    "workspace",
    "dispose",
  ])("invalidates pending and saved continuation on %s", async (action) => {
    const h = harness();
    await ready(h);
    begin(h);
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    if (action === "workspace") h.workspace();
    else if (action === "dispose") h.dispose();
    else h.receive({ command: action });
    expect(h.runs[0].stop).toHaveBeenCalledOnce();
    const count = h.posts.length;
    h.saved();
    expect(h.posts.slice(count).some((x) => x.canRead)).toBe(false);
    h.receive({ command: "nextGoalHistory" });
    await Promise.resolve();
    expect(h.runs).toHaveLength(1);
  });
  it("clears continuation on failure and does not forward a forged next selection", async () => {
    const h = harness();
    await ready(h);
    begin(h);
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    h.runs[0].options.onEnd({
      state: "unconfirmed",
      message: "Keep checkpoint; may have advanced",
    });
    h.receive({ command: "nextGoalHistory", checkpoint: "forged" });
    await Promise.resolve();
    expect(h.runs).toHaveLength(1);
  });
  it("cancels native selection and ignores late selections", async () => {
    const empty = harness({ file: false });
    await ready(empty);
    begin(empty);
    await vi.waitFor(() =>
      expect(empty.vscode.window.showOpenDialog).toHaveBeenCalledOnce(),
    );
    expect(empty.runs).toHaveLength(0);
    const h = harness({ deferred: true });
    await ready(h);
    begin(h);
    await vi.waitFor(() =>
      expect(h.vscode.window.showOpenDialog).toHaveBeenCalledOnce(),
    );
    h.receive({ command: "stopGoalHistory" });
    h.resolveFile([{ fsPath: "C:/late.json" }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.runs).toHaveLength(0);
  });
  it("waits for prior process termination before replacement", async () => {
    const h = harness();
    await ready(h);
    begin(h);
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    let finish;
    h.runs[0].stop.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    begin(h);
    await vi.waitFor(() => expect(h.runs[0].stop).toHaveBeenCalledOnce());
    expect(h.runs).toHaveLength(1);
    finish();
    await vi.waitFor(() => expect(h.runs).toHaveLength(2));
  });
});
