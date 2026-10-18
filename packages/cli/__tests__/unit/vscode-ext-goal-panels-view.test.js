import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const sourceUrl = new URL(
  "../../../vscode-extension/src/ui/plugin-manager-view.js",
  import.meta.url,
);
const source = fs.readFileSync(sourceUrl, "utf8");
const realRequire = createRequire(sourceUrl);
const storeId = "cli-goals-" + "a".repeat(64);
const catalog = JSON.stringify({
  schema: "chainlesschain.goal-catalog.v1",
  snapshot: true,
  storeId,
  observedAt: "2026-10-18T00:00:00.000Z",
  scannedCount: 1,
  skippedCount: 0,
  invalidNameCount: 0,
  nextCursor: null,
  entries: [
    {
      id: "goal-1",
      title: "Delivery",
      status: "active",
      revision: 1,
      controlGeneration: 0,
    },
  ],
});
const reply = JSON.stringify({
  schema: "chainlesschain.goal-extension-panels.v1",
  snapshot: true,
  observedAt: "2026-10-18T00:00:00.000Z",
  goalRef: {
    id: "goal-1",
    storeId,
    revision: 1,
    controlGeneration: 0,
  },
  panels: [
    {
      plugin: { name: "viewer", scope: "project", version: "0.1.0" },
      id: "progress",
      slot: "goal.summary",
      format: "text",
      text: "objective: <script>inert</script>",
    },
  ],
  dropped: [],
});

function harness({
  catalogOutput = catalog,
  choose,
  deferCatalog = false,
  connectionFile = "C:/private/connection.json",
} = {}) {
  let receive, dispose, finish, finishCatalog;
  const posts = [];
  const runCliText = vi.fn(({ args }) =>
    args[1] === "catalog"
      ? deferCatalog
        ? new Promise((resolve) => {
            finishCatalog = resolve;
          })
        : Promise.resolve(catalogOutput)
      : args[0] === "goal"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve("[]"),
  );
  const panel = {
    reveal() {},
    webview: {
      html: "",
      postMessage: (message) => posts.push(message),
      onDidReceiveMessage: (listener) => {
        receive = listener;
      },
    },
    onDidDispose: (listener) => {
      dispose = listener;
    },
  };
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "C:/selected-workspace" } }],
    },
    ViewColumn: { Active: 1 },
    window: {
      createWebviewPanel: () => panel,
      showInputBox: vi.fn().mockResolvedValue("goal-1"),
      showOpenDialog: vi
        .fn()
        .mockResolvedValue(
          connectionFile ? [{ fsPath: connectionFile }] : undefined,
        ),
      showQuickPick: vi.fn(
        choose ||
          ((items) =>
            Promise.resolve(
              items.find((item) => item.goalId) ||
                items.find((item) => item.manual),
            )),
      ),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    require(name) {
      if (name === "../chat/introspect-commands.js") return { runCliText };
      if (name === "../cli-binary") return { getResolvedCli: () => "test-cc" };
      return realRequire(name);
    },
  });
  module.exports.openPluginManager(vscode);
  return {
    panel,
    vscode,
    posts,
    runCliText,
    receive: (message) => receive(message),
    dispose: () => dispose(),
    finish: (value) => finish(value),
    finishCatalog: (value) => finishCatalog(value),
  };
}

describe("VS Code goal snapshot view lifecycle", () => {
  it("chooses a desktop credential through the native picker and pins its store without passing secrets", async () => {
    const nativeStore = "project-goals-12345678-1234-1234-1234-123456789abc";
    const connectedCatalog = JSON.stringify({
      ...JSON.parse(catalog),
      source: "desktop-project",
      storeId: nativeStore,
    });
    const h = harness({
      catalogOutput: connectedCatalog,
      choose: (items) => Promise.resolve(items.find((row) => row.connection)),
    });
    await vi.waitFor(() =>
      expect(h.posts.some((p) => p.type === "update")).toBe(true),
    );
    h.receive({
      command: "pluginGoalPanels",
      name: "viewer",
      scope: "project",
      connection: "ignored-webview-path",
    });
    await vi.waitFor(() =>
      expect(
        h.runCliText.mock.calls.some(([c]) => c.args[1] === "panels"),
      ).toBe(true),
    );
    const args = h.runCliText.mock.calls.find(
      ([c]) => c.args[1] === "panels",
    )[0].args;
    expect(args).toContain("--connection=C:/private/connection.json");
    expect(args).toContain(`--expected-store=${nativeStore}`);
    expect(JSON.stringify(args)).not.toContain("ignored-webview-path");
    h.finish(
      JSON.stringify({
        ...JSON.parse(reply),
        source: "desktop-project",
        goalRef: { ...JSON.parse(reply).goalRef, storeId: nativeStore },
      }),
    );
    await vi.waitFor(() =>
      expect(
        h.posts.some(
          (p) => p.type === "goalPanels" && p.text.includes("inert"),
        ),
      ).toBe(true),
    );
  });
  it("cancelling the desktop file picker performs no connected read", async () => {
    const h = harness({
      connectionFile: null,
      choose: (items) => Promise.resolve(items.find((row) => row.connection)),
    });
    await vi.waitFor(() =>
      expect(h.posts.some((p) => p.type === "update")).toBe(true),
    );
    h.receive({
      command: "pluginGoalPanels",
      name: "viewer",
      scope: "project",
    });
    await vi.waitFor(() =>
      expect(h.vscode.window.showOpenDialog).toHaveBeenCalled(),
    );
    expect(
      h.runCliText.mock.calls.some(
        ([c]) =>
          c.args[1] === "panels" ||
          c.args.some((a) => a.startsWith("--connection=")),
      ),
    ).toBe(false);
  });
  it("shows only a requested, parsed plaintext snapshot", async () => {
    const h = harness();
    await vi.waitFor(() =>
      expect(h.posts.some((p) => p.type === "update")).toBe(true),
    );
    h.receive({
      command: "pluginGoalPanels",
      name: "viewer",
      scope: "project",
    });
    await vi.waitFor(() =>
      expect(
        h.runCliText.mock.calls.some(([call]) => call.args[1] === "panels"),
      ).toBe(true),
    );
    h.finish(reply);
    await vi.waitFor(() =>
      expect(
        h.posts.some(
          (p) =>
            p.type === "goalPanels" &&
            p.text.includes("<script>inert</script>"),
        ),
      ).toBe(true),
    );
    expect(
      h.runCliText.mock.calls.find(([call]) => call.args[1] === "panels")[0]
        .args,
    ).toContain(`--expected-store=${storeId}`);
    expect(h.vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(h.panel.webview.html).toContain(
      "document.getElementById('goalPanels').textContent",
    );
    expect(
      h.runCliText.mock.calls.every(
        ([call]) => call.cwd === "C:/selected-workspace",
      ),
    ).toBe(true);
  });
  it.each(["clear", "dispose", "refresh"])(
    "discards a late response after %s",
    async (action) => {
      const h = harness();
      await vi.waitFor(() =>
        expect(h.posts.some((p) => p.type === "update")).toBe(true),
      );
      h.receive({
        command: "pluginGoalPanels",
        name: "viewer",
        scope: "project",
      });
      await vi.waitFor(() =>
        expect(
          h.runCliText.mock.calls.some(([call]) => call.args[1] === "panels"),
        ).toBe(true),
      );
      if (action === "dispose") h.dispose();
      else
        h.receive({
          command: action === "clear" ? "clearGoalPanels" : "refresh",
        });
      h.finish(reply);
      await new Promise((resolve) => setImmediate(resolve));
      expect(h.posts.some((p) => p.type === "goalPanels" && p.text)).toBe(
        false,
      );
    },
  );
  it("clears the prior snapshot and reports malformed CLI output", async () => {
    const h = harness();
    await vi.waitFor(() =>
      expect(h.posts.some((p) => p.type === "update")).toBe(true),
    );
    h.receive({
      command: "pluginGoalPanels",
      name: "viewer",
      scope: "project",
    });
    await vi.waitFor(() =>
      expect(
        h.runCliText.mock.calls.some(([call]) => call.args[1] === "panels"),
      ).toBe(true),
    );
    h.finish('{"schema":"unknown"}');
    await vi.waitFor(() =>
      expect(
        h.posts.some(
          (p) => p.type === "note" && p.text.includes("unavailable"),
        ),
      ).toBe(true),
    );
    expect(h.posts.some((p) => p.type === "goalPanels" && p.text)).toBe(false);
  });
});

describe("VS Code bounded goal picker", () => {
  it("falls back to explicit ID entry when the CLI catalog is unavailable", async () => {
    const h = harness({ catalogOutput: "unsupported" });
    await vi.waitFor(() =>
      expect(h.posts.some((p) => p.type === "update")).toBe(true),
    );
    h.receive({
      command: "pluginGoalPanels",
      name: "viewer",
      scope: "project",
    });
    await vi.waitFor(() =>
      expect(
        h.runCliText.mock.calls.some(([c]) => c.args[1] === "panels"),
      ).toBe(true),
    );
    expect(h.vscode.window.showInputBox).toHaveBeenCalledOnce();
    h.finish(reply);
    await vi.waitFor(() =>
      expect(h.posts.some((p) => p.type === "goalPanels" && p.text)).toBe(true),
    );
  });
  it("cancels without reading a goal body", async () => {
    const h = harness({ choose: async () => undefined });
    await vi.waitFor(() =>
      expect(h.posts.some((p) => p.type === "update")).toBe(true),
    );
    h.receive({
      command: "pluginGoalPanels",
      name: "viewer",
      scope: "project",
    });
    await vi.waitFor(() =>
      expect(h.vscode.window.showQuickPick).toHaveBeenCalled(),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.runCliText.mock.calls.some(([c]) => c.args[1] === "panels")).toBe(
      false,
    );
  });
  it("does not open a picker after the manager closes during catalog discovery", async () => {
    const h = harness({ deferCatalog: true });
    await vi.waitFor(() =>
      expect(h.posts.some((p) => p.type === "update")).toBe(true),
    );
    h.receive({
      command: "pluginGoalPanels",
      name: "viewer",
      scope: "project",
    });
    await vi.waitFor(() =>
      expect(
        h.runCliText.mock.calls.some(([c]) => c.args[1] === "catalog"),
      ).toBe(true),
    );
    h.dispose();
    h.finishCatalog(catalog);
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.vscode.window.showQuickPick).not.toHaveBeenCalled();
  });
  it("pages explicitly and retains the selected store", async () => {
    let picks = 0;
    const first = JSON.stringify({
      ...JSON.parse(catalog),
      nextCursor: "Y3Vyc29y",
    });
    const h = harness({
      catalogOutput: first,
      choose: async (items) =>
        ++picks === 1 ? items.find((i) => i.next) : items.find((i) => i.goalId),
    });
    await vi.waitFor(() =>
      expect(h.posts.some((p) => p.type === "update")).toBe(true),
    );
    const original = h.runCliText.getMockImplementation();
    h.runCliText.mockImplementation((call) =>
      call.args.includes("--after=Y3Vyc29y")
        ? Promise.resolve(catalog)
        : original(call),
    );
    h.receive({
      command: "pluginGoalPanels",
      name: "viewer",
      scope: "project",
    });
    await vi.waitFor(() =>
      expect(
        h.runCliText.mock.calls.some(([c]) => c.args[1] === "panels"),
      ).toBe(true),
    );
    expect(h.vscode.window.showQuickPick).toHaveBeenCalledTimes(2);
    expect(
      h.runCliText.mock.calls.find(([c]) => c.args[1] === "panels")[0].args,
    ).toContain(`--expected-store=${storeId}`);
    h.finish(reply);
    await vi.waitFor(() =>
      expect(h.posts.some((p) => p.type === "goalPanels" && p.text)).toBe(true),
    );
  });

  it("retains the first store after a later page fails and manual entry is chosen", async () => {
    let picks = 0;
    const first = JSON.stringify({
      ...JSON.parse(catalog),
      nextCursor: "Y3Vyc29y",
    });
    const h = harness({
      catalogOutput: first,
      choose: async (items) =>
        ++picks === 1 ? items.find((i) => i.next) : items.find((i) => i.manual),
    });
    await vi.waitFor(() =>
      expect(h.posts.some((p) => p.type === "update")).toBe(true),
    );
    const original = h.runCliText.getMockImplementation();
    h.runCliText.mockImplementation((call) =>
      call.args.includes("--after=Y3Vyc29y")
        ? Promise.resolve("unavailable")
        : original(call),
    );
    h.receive({
      command: "pluginGoalPanels",
      name: "viewer",
      scope: "project",
    });
    await vi.waitFor(() =>
      expect(
        h.runCliText.mock.calls.some(([c]) => c.args[1] === "panels"),
      ).toBe(true),
    );
    expect(
      h.runCliText.mock.calls.find(([c]) => c.args[1] === "panels")[0].args,
    ).toContain(`--expected-store=${storeId}`);
    h.finish(reply);
    await vi.waitFor(() =>
      expect(h.posts.some((p) => p.type === "goalPanels" && p.text)).toBe(true),
    );
  });
});
