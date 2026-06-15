/**
 * Terminal-context capture in the REAL facade — drives createVscodeEditorFacade
 * with a fake `vscode` that fires shell-integration execution events, then reads
 * them back via getTerminalOutput. Also checks the conditional tool exposure and
 * graceful degradation on hosts without shell integration. Runs in the CLI suite.
 */
import { describe, it, expect } from "vitest";
import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";

function fakeVscode({ shellIntegration = true } = {}) {
  const startCbs = [];
  const endCbs = [];
  const disposed = { count: 0 };
  const window = {};
  if (shellIntegration) {
    window.onDidStartTerminalShellExecution = (cb) => {
      startCbs.push(cb);
      return { dispose: () => disposed.count++ };
    };
    window.onDidEndTerminalShellExecution = (cb) => {
      endCbs.push(cb);
      return { dispose: () => disposed.count++ };
    };
  }
  const vscode = { window };
  return {
    vscode,
    disposed,
    async runCommand({ command, terminal = "bash", chunks = [], exitCode }) {
      const exec = {
        commandLine: { value: command },
        read: async function* () {
          for (const c of chunks) yield c;
        },
      };
      // start handler reads the whole stream — await it before firing end.
      await Promise.all(
        startCbs.map((cb) =>
          cb({ execution: exec, terminal: { name: terminal } }),
        ),
      );
      endCbs.forEach((cb) => cb({ execution: exec, exitCode }));
    },
  };
}

describe("facade getTerminalOutput", () => {
  it("captures a finished command's text, exit code, and terminal name", async () => {
    const fx = fakeVscode();
    const facade = createVscodeEditorFacade(fx.vscode);
    await fx.runCommand({
      command: "npm test",
      chunks: ["12 ", "passed\n"],
      exitCode: 0,
    });
    const res = await facade.getTerminalOutput();
    expect(res.terminals).toHaveLength(1);
    expect(res.terminals[0]).toMatchObject({
      command: "npm test",
      exitCode: 0,
      output: "12 passed\n",
      terminal: "bash",
    });
  });

  it("returns the most recent commands, capped by limit", async () => {
    const fx = fakeVscode();
    const facade = createVscodeEditorFacade(fx.vscode);
    for (const c of ["c1", "c2", "c3", "c4"]) {
      await fx.runCommand({ command: c, exitCode: 0 });
    }
    expect(
      (await facade.getTerminalOutput()).terminals.map((e) => e.command),
    ).toEqual(["c2", "c3", "c4"]); // default limit 3
    expect(
      (await facade.getTerminalOutput({ limit: 1 })).terminals.map(
        (e) => e.command,
      ),
    ).toEqual(["c4"]);
  });

  it("is empty before any command runs", async () => {
    const fx = fakeVscode();
    const facade = createVscodeEditorFacade(fx.vscode);
    expect((await facade.getTerminalOutput()).terminals).toEqual([]);
  });

  it("degrades gracefully on a host WITHOUT shell integration", async () => {
    const fx = fakeVscode({ shellIntegration: false });
    const facade = createVscodeEditorFacade(fx.vscode);
    expect(typeof facade.getTerminalOutput).toBe("function");
    expect((await facade.getTerminalOutput()).terminals).toEqual([]);
  });

  it("disposeTerminalCapture disposes the subscriptions", () => {
    const fx = fakeVscode();
    const facade = createVscodeEditorFacade(fx.vscode);
    facade.disposeTerminalCapture();
    expect(fx.disposed.count).toBe(2); // start + end subscriptions
  });
});

describe("buildIdeTools exposes getTerminalOutput conditionally", () => {
  const base = {
    getSelection: () => null,
    getDiagnostics: () => [],
    getOpenEditors: () => [],
    openDiff: () => ({}),
  };
  it("present when the facade supports it; absent otherwise", () => {
    const withIt = buildIdeTools({
      ...base,
      getTerminalOutput: () => ({ terminals: [] }),
    });
    expect(withIt.map((t) => t.name)).toContain("getTerminalOutput");
    expect(buildIdeTools(base).map((t) => t.name)).not.toContain(
      "getTerminalOutput",
    );
  });
});
