import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const url = new URL(
  "../../../vscode-extension/src/ui/plugin-manager-view.js",
  import.meta.url,
);
const source = fs.readFileSync(url, "utf8"),
  realRequire = createRequire(url);
function harness({
  file = "C:/native event.json",
  id = "goal-1",
  deferred = false,
} = {}) {
  let receive, dispose, resolveFile, workspaceChanged;
  const posts = [],
    watches = [];
  const startGoalWatch = vi.fn((options) => {
    const watch = { options, stop: vi.fn(async () => {}) };
    watches.push(watch);
    return watch;
  });
  const events = realRequire("../goal-events");
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
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "C:/selected-workspace" } }],
      onDidChangeWorkspaceFolders: (fn) => {
        workspaceChanged = fn;
        return { dispose() {} };
      },
    },
    ViewColumn: { Active: 1 },
    window: {
      createWebviewPanel: () => panel,
      showOpenDialog: vi.fn(() =>
        deferred
          ? new Promise((resolve) => {
              resolveFile = resolve;
            })
          : Promise.resolve(file ? [{ fsPath: file }] : undefined),
      ),
      showInputBox: vi.fn(async () => id),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    require(name) {
      if (name === "../goal-events") return { ...events, startGoalWatch };
      if (name === "../chat/introspect-commands.js")
        return { runCliText: vi.fn(async () => "[]") };
      if (name === "../cli-binary")
        return { getResolvedCli: () => "chosen-cc" };
      return realRequire(name);
    },
  });
  module.exports.openPluginManager(vscode);
  return {
    posts,
    watches,
    startGoalWatch,
    vscode,
    panel,
    receive: (message) => receive(message),
    dispose: () => dispose(),
    resolveFile: (value) => resolveFile(value),
    workspaceChanged: () => workspaceChanged(),
  };
}
const begin = (h) =>
  h.receive({
    command: "pluginGoalEvents",
    name: "observer",
    scope: "project",
    connection: "webview-forged",
    id: "webview-goal",
  });
const waitReady = (h) =>
  vi.waitFor(() => expect(h.posts.some((x) => x.type === "update")).toBe(true));
describe("VS Code explicit goal event view", () => {
  it("uses only native selections, pins the workspace and renders text with a stop control", async () => {
    const h = harness();
    await waitReady(h);
    expect(h.startGoalWatch).not.toHaveBeenCalled();
    begin(h);
    await vi.waitFor(() => expect(h.startGoalWatch).toHaveBeenCalledOnce());
    const call = h.startGoalWatch.mock.calls[0][0];
    expect(call).toMatchObject({
      cwd: "C:/selected-workspace",
      command: "chosen-cc",
      input: {
        id: "goal-1",
        connection: "C:/native event.json",
        name: "observer",
        scope: "project",
      },
    });
    expect(JSON.stringify(call.input)).not.toContain("webview-");
    call.onRecord({ kind: "event", text: "<script>inert</script>" });
    expect(h.posts.at(-1)).toEqual({
      type: "goalEvents",
      text: "<script>inert</script>",
    });
    expect(h.panel.webview.html).toContain("stopGoalEvents");
    expect(h.panel.webview.html).toContain(
      "document.getElementById('goalEvents').textContent",
    );
    h.receive({ command: "stopGoalEvents" });
    await vi.waitFor(() => expect(h.watches[0].stop).toHaveBeenCalledOnce());
    call.onRecord({ text: "late" });
    expect(h.posts.at(-1).text).not.toBe("late");
  });
  it.each([
    "refresh",
    "clearGoalPanels",
    "pluginReload",
    "dispose",
    "workspace",
  ])("stops and invalidates output on %s", async (mode) => {
    const h = harness();
    await waitReady(h);
    begin(h);
    await vi.waitFor(() => expect(h.watches).toHaveLength(1));
    if (mode === "dispose") h.dispose();
    else if (mode === "workspace") h.workspaceChanged();
    else h.receive({ command: mode });
    expect(h.watches[0].stop).toHaveBeenCalledOnce();
    const count = h.posts.length;
    h.watches[0].options.onRecord({ text: "secret late" });
    h.watches[0].options.onEnd("ended");
    expect(
      h.posts.slice(count).some((x) => x.text?.includes("secret late")),
    ).toBe(false);
  });
  it("cancelling native selection never starts or reads a connection", async () => {
    const h = harness({ file: null });
    await waitReady(h);
    begin(h);
    await vi.waitFor(() =>
      expect(h.vscode.window.showOpenDialog).toHaveBeenCalledOnce(),
    );
    expect(h.startGoalWatch).not.toHaveBeenCalled();
    expect(h.vscode.window.showInputBox).not.toHaveBeenCalled();
  });
  it("drops late native selection after clearing the view", async () => {
    const h = harness({ deferred: true });
    await waitReady(h);
    begin(h);
    await vi.waitFor(() =>
      expect(h.vscode.window.showOpenDialog).toHaveBeenCalledOnce(),
    );
    h.receive({ command: "clearGoalPanels" });
    h.resolveFile([{ fsPath: "C:/late.json" }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.startGoalWatch).not.toHaveBeenCalled();
  });
  it("keeps at most 50 records and clears history on an unavailable stream", async () => {
    const h = harness();
    await waitReady(h);
    begin(h);
    await vi.waitFor(() => expect(h.watches).toHaveLength(1));
    const callback = h.watches[0].options;
    for (let i = 0; i < 80; i++) callback.onRecord({ text: `event-${i}` });
    expect(h.posts.at(-1).text.split("\n")).toHaveLength(50);
    callback.onEnd("unavailable");
    expect(h.posts.at(-1).text).not.toContain("event-");
  });
  it("waits for confirmed stop before starting a replacement observer", async () => {
    const h = harness();
    await waitReady(h);
    begin(h);
    await vi.waitFor(() => expect(h.watches).toHaveLength(1));
    let finish;
    h.watches[0].stop.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    begin(h);
    await vi.waitFor(() => expect(h.watches[0].stop).toHaveBeenCalledOnce());
    expect(h.startGoalWatch).toHaveBeenCalledOnce();
    finish();
    await vi.waitFor(() => expect(h.startGoalWatch).toHaveBeenCalledTimes(2));
  });
});
