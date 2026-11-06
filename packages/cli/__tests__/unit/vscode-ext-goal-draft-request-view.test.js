import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const url = new URL(
    "../../../vscode-extension/src/ui/plugin-manager-view.js",
    import.meta.url,
  ),
  source = fs.readFileSync(url, "utf8"),
  realRequire = createRequire(url);
const store = "project-goals-12345678-1234-1234-1234-123456789abc",
  connection = "C:/private/connection.json",
  body = "C:/input/body.txt",
  out = "C:/export/request.json";
function harness({
  cancel = false,
  defer = false,
  creation = false,
  cancelType = false,
  wrongType = false,
  nonzero = false,
} = {}) {
  let receive, finish;
  const posts = [];
  const runCliText = vi.fn(({ args }) => {
    if (args[0] === "goal" && args[1] === "catalog")
      return Promise.resolve(
        args.includes(`--connection=${connection}`)
          ? JSON.stringify({
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
              nextCursor: null,
              scannedCount: 1,
              skippedCount: 0,
              invalidNameCount: 0,
            })
          : "[]",
      );
    if (["draft-request", "draft-create-request"].includes(args[1])) {
      const requestId = args
        .find((x) => x.startsWith("--request-id="))
        .slice(13);
      const result = JSON.stringify({
        schema: creation
          ? "chainlesschain.goal-task-create-export/v1"
          : "chainlesschain.goal-draft-export/v1",
        state: "request-exported",
        goalRef: {
          id: "goal-1",
          storeId: store,
          ...(creation ? { revision: 1, controlGeneration: 0 } : {}),
        },
        declaredPlugin: {
          name: "drafter",
          scope: "project",
          ...(creation ? { version: "0.3.0" } : {}),
        },
        requestId,
        file: out,
        contentDigest: `sha256:${"a".repeat(64)}`,
        ...(creation
          ? {
              type: "task.create",
              taskType: wrongType ? "deploy_project" : "analyze_data",
            }
          : {}),
      });
      return defer
        ? new Promise((resolve) => {
            finish = () => resolve(result);
          })
        : Promise.resolve(result);
    }
    return Promise.resolve("[]");
  });
  const panel = {
    reveal() {},
    onDidDispose() {},
    webview: {
      html: "",
      postMessage: (msg) => posts.push(msg),
      onDidReceiveMessage: (fn) => {
        receive = fn;
      },
    },
  };
  const vscode = {
    workspace: { workspaceFolders: [{ uri: { fsPath: "C:/workspace" } }] },
    ViewColumn: { Active: 1 },
    window: {
      createWebviewPanel: () => panel,
      showQuickPick: vi.fn(async (items) =>
        items.some((x) => x.taskType)
          ? cancelType
            ? undefined
            : items.find((x) => x.taskType === "analyze_data")
          : items.find((x) => x.connection),
      ),
      showOpenDialog: vi
        .fn()
        .mockResolvedValueOnce([{ fsPath: connection }])
        .mockResolvedValueOnce([{ fsPath: body }]),
      showSaveDialog: vi.fn(async () => (cancel ? undefined : { fsPath: out })),
      showInputBox: vi
        .fn()
        .mockResolvedValueOnce(`goal-proposal-${"b".repeat(64)}`)
        .mockResolvedValueOnce("User title"),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (name) =>
      name === "../chat/introspect-commands.js"
        ? {
            runCliText,
            runCliResult: async (options) => ({
              ok: !nonzero,
              code: nonzero ? 1 : 0,
              stdout: await runCliText(options),
            }),
          }
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
    finish: () => finish?.(),
  };
}
describe("VS Code native request-file export", () => {
  it("uses only native task type and paths for creation and does not submit a native draft", async () => {
    const h = harness({ creation: true });
    h.send({
      command: "pluginGoalTaskCreateRequest",
      name: "drafter",
      scope: "project",
      taskType: "deploy_project",
      out: "C:/evil.json",
    });
    await vi.waitFor(() =>
      expect(h.posts.some((m) => m.text?.includes("Request exported:"))).toBe(
        true,
      ),
    );
    const call = h.runCliText.mock.calls.find(
      ([c]) => c.args[1] === "draft-create-request",
    )[0];
    expect(call.args).toContain("--task-type=analyze_data");
    expect(call.args).toContain(`--out=${out}`);
    expect(call.args.join(" ")).not.toContain("evil");
    expect(call.maxBufferBytes).toBe(16384);
    expect(
      h.posts.find((m) => m.text?.includes("Request exported:")).text,
    ).toContain("No native draft has been saved");
  });
  it.each([{ cancelType: true }, { wrongType: true }, { nonzero: true }])(
    "does not report creation success after %j",
    async (scenario) => {
      const h = harness({ creation: true, ...scenario });
      h.send({
        command: "pluginGoalTaskCreateRequest",
        name: "drafter",
        scope: "project",
      });
      if (scenario.cancelType)
        await vi.waitFor(() =>
          expect(
            h.runCliText.mock.calls.filter(([c]) => c.args[1] === "catalog"),
          ).toHaveLength(2),
        );
      else
        await vi.waitFor(() =>
          expect(h.posts.some((m) => m.type === "note")).toBe(true),
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(h.posts.some((m) => m.text?.includes("Request exported:"))).toBe(
        false,
      );
    },
  );
  it("discards creation success after refresh while keeping any exported file for explicit inspection", async () => {
    const h = harness({ creation: true, defer: true });
    h.send({
      command: "pluginGoalTaskCreateRequest",
      name: "drafter",
      scope: "project",
    });
    await vi.waitFor(() =>
      expect(
        h.runCliText.mock.calls.some(
          ([c]) => c.args[1] === "draft-create-request",
        ),
      ).toBe(true),
    );
    h.send({ command: "refresh" });
    h.finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.posts.some((m) => m.text?.includes("Request exported:"))).toBe(
      false,
    );
  });
  it("uses paths from native pickers and ignores webview-supplied paths", async () => {
    const h = harness();
    h.send({
      command: "pluginGoalDraftRequest",
      name: "drafter",
      scope: "project",
      connection: "C:/evil.json",
      out: "C:/evil-out.json",
      descriptionFile: "C:/evil-body.txt",
    });
    await vi.waitFor(() =>
      expect(
        h.posts.some(
          (msg) =>
            msg.type === "goalPanels" &&
            msg.text?.includes("Request exported:"),
        ),
      ).toBe(true),
    );
    const args = h.runCliText.mock.calls.find(
      ([call]) => call.args[1] === "draft-request",
    )[0].args;
    expect(args).toContain(`--connection=${connection}`);
    expect(args).toContain(`--description-file=${body}`);
    expect(args).toContain(`--out=${out}`);
    expect(args.join(" ")).not.toContain("evil");
  });
  it("does not run the exporter after cancelling the native save picker", async () => {
    const h = harness({ cancel: true });
    h.send({
      command: "pluginGoalDraftRequest",
      name: "drafter",
      scope: "project",
    });
    await vi.waitFor(() =>
      expect(
        h.runCliText.mock.calls.filter(([call]) => call.args[1] === "catalog"),
      ).toHaveLength(2),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      h.runCliText.mock.calls.some(
        ([call]) => call.args[1] === "draft-request",
      ),
    ).toBe(false);
  });
  it("discards a late export UI result after selection invalidation", async () => {
    const h = harness({ defer: true });
    h.send({
      command: "pluginGoalDraftRequest",
      name: "drafter",
      scope: "project",
    });
    await vi.waitFor(() =>
      expect(
        h.runCliText.mock.calls.some(
          ([call]) => call.args[1] === "draft-request",
        ),
      ).toBe(true),
    );
    h.send({ command: "clearGoalPanels" });
    h.finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.posts.some((msg) => msg.text?.includes("Request exported:"))).toBe(
      false,
    );
  });
});
