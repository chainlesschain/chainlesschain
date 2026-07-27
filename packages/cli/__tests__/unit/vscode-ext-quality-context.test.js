import { describe, expect, it, vi } from "vitest";

import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";
import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";

function baseFacade(extra = {}) {
  return {
    getSelection: async () => null,
    getDiagnostics: async () => [],
    getOpenEditors: async () => [],
    openDiff: async ({ path }) => ({ outcome: "rejected", path }),
    ...extra,
  };
}

function byName(tools) {
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

describe("IDE quality context tool registration and metadata", () => {
  it("keeps quality tools optional and derives them from facade support", () => {
    const core = byName(buildIdeTools(baseFacade()));
    expect(core).not.toHaveProperty("getTestResults");
    expect(core).not.toHaveProperty("getCoverage");
    expect(core).not.toHaveProperty("getDebugState");

    const quality = byName(
      buildIdeTools(
        baseFacade({
          getTestResults: async () => ({}),
          getCoverage: async () => ({}),
          getDebugState: async () => ({}),
        }),
      ),
    );
    expect(quality).toHaveProperty("getTestResults");
    expect(quality).toHaveProperty("getCoverage");
    expect(quality).toHaveProperty("getDebugState");
  });

  it("bounds args, protects coverage paths, and attaches Context v2", async () => {
    const getTestResults = vi.fn(async ({ limit }) => ({
      schema: "cc-ide-quality/v1",
      kind: "test-results",
      available: true,
      limit,
      runs: [],
    }));
    const getCoverage = vi.fn(async ({ path }) => ({
      schema: "cc-ide-quality/v1",
      kind: "coverage",
      available: true,
      path,
      files: [],
    }));
    const editor = baseFacade({
      getTestResults,
      getCoverage,
      getDebugState: async () => ({
        schema: "cc-ide-quality/v1",
        kind: "debug-state",
        available: true,
        session: null,
        breakpoints: [],
      }),
      getContextMetadata: async ({ file }) => ({
        schema: "cc-ide-context/v2",
        workspaceId: "ws-test",
        documentUri: file ? `file://${file}` : null,
      }),
    });
    const tools = byName(
      buildIdeTools(editor, {
        getWorkspaceFolders: () => ["/workspace"],
      }),
    );

    const tests = await tools.getTestResults.handler({ limit: 999 });
    expect(getTestResults).toHaveBeenCalledWith({ limit: 20 });
    expect(tests).toMatchObject({
      schema: "cc-ide-quality/v1",
      kind: "test-results",
      context: { schema: "cc-ide-context/v2", documentUri: null },
    });

    const coverage = await tools.getCoverage.handler({
      path: "/workspace/src/a.js",
    });
    expect(getCoverage).toHaveBeenCalledWith({
      path: expect.stringMatching(/[\\/]workspace[\\/]src[\\/]a\.js$/),
    });
    expect(coverage.context.documentUri).toMatch(/a\.js$/);
    await expect(
      tools.getCoverage.handler({ path: "/outside/secrets.txt" }),
    ).rejects.toThrow(/unsafe read path rejected/);

    const debug = await tools.getDebugState.handler({});
    expect(debug.context.documentUri).toBeNull();
  });
});

function fakeVscode() {
  const uri = {
    fsPath: "/workspace/src/a.test.js",
    toString: () => "file:///workspace/src/a.test.js",
  };
  const coverage = [
    {
      uri,
      statementCoverage: { covered: 8, total: 10 },
      branchCoverage: { covered: 2, total: 4 },
      declarationCoverage: { covered: 3, total: 3 },
    },
  ];
  const child = {
    id: "suite/test",
    label: "works",
    uri,
    range: {
      start: { line: 4, character: 2 },
      end: { line: 4, character: 12 },
    },
    taskStates: [
      {
        state: 4,
        duration: 17,
        messages: [{ message: "expected 1 to equal 2" }],
      },
    ],
    children: [],
  };
  return {
    Uri: {
      file: (file) => ({
        fsPath: file,
        toString: () => `file://${file}`,
      }),
    },
    commands: { executeCommand: vi.fn() },
    extensions: { getExtension: vi.fn() },
    tests: {
      testResults: [
        {
          id: "run-1",
          name: "Unit tests",
          completedAt: 1000,
          results: [
            {
              id: "suite",
              label: "suite",
              taskStates: [{ state: 3, duration: 20, messages: [] }],
              children: [child],
            },
          ],
          coverage,
        },
      ],
    },
    debug: {
      activeDebugSession: {
        id: "debug-1",
        name: "Launch tests",
        type: "node",
        configuration: {
          type: "node",
          request: "launch",
          name: "Launch tests",
          env: { API_TOKEN: "must-not-leak" },
          args: ["--password", "must-not-leak"],
        },
        workspaceFolder: {
          uri: {
            toString: () => "file:///workspace",
          },
        },
      },
      breakpoints: [
        {
          enabled: true,
          condition: "secret === 'must-not-leak'",
          location: {
            uri,
            range: {
              start: { line: 7, character: 0 },
              end: { line: 7, character: 1 },
            },
          },
        },
      ],
    },
    window: {
      activeTextEditor: null,
      visibleTextEditors: [],
      activeNotebookEditor: null,
    },
    workspace: {
      isTrusted: true,
      workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
      textDocuments: [],
      notebookDocuments: [],
    },
  };
}

describe("real VS Code facade quality snapshots", () => {
  it("does not touch the proposed test observer on stable Marketplace hosts", () => {
    const vscode = fakeVscode();
    Object.defineProperty(vscode.tests, "testResults", {
      configurable: true,
      get() {
        throw new Error("Extension CANNOT use API proposal: testObserver");
      },
    });

    const facade = createVscodeEditorFacade(vscode);
    expect(facade).not.toHaveProperty("getTestResults");
    expect(facade).not.toHaveProperty("getCoverage");
    expect(facade).toHaveProperty("getDebugState");
  });

  it("normalizes recent test results with bounded messages and locations", async () => {
    const facade = createVscodeEditorFacade(fakeVscode(), { now: () => 2000 });
    const result = await facade.getTestResults({ limit: 5 });
    expect(result).toMatchObject({
      schema: "cc-ide-quality/v1",
      kind: "test-results",
      available: true,
      source: "vscode-test-api",
      summary: { passed: 1, failed: 1 },
    });
    expect(result.runs[0]).toMatchObject({
      id: "run-1",
      name: "Unit tests",
      completedAt: "1970-01-01T00:00:01.000Z",
    });
    expect(result.runs[0].items[1]).toMatchObject({
      id: "suite/test",
      parentId: "suite",
      state: "failed",
      durationMs: 17,
      uri: "file:///workspace/src/a.test.js",
      messages: ["expected 1 to equal 2"],
    });
  });

  it("normalizes coverage counts and supports a file scope", async () => {
    const facade = createVscodeEditorFacade(fakeVscode());
    const result = await facade.getCoverage({
      path: "/workspace/src/a.test.js",
    });
    expect(result).toMatchObject({
      schema: "cc-ide-quality/v1",
      kind: "coverage",
      available: true,
      files: [
        {
          uri: "file:///workspace/src/a.test.js",
          statements: { covered: 8, total: 10, percent: 80 },
          branches: { covered: 2, total: 4, percent: 50 },
          functions: { covered: 3, total: 3, percent: 100 },
        },
      ],
    });
  });

  it("returns debugger state without env, args, conditions, or expressions", async () => {
    const facade = createVscodeEditorFacade(fakeVscode());
    const result = await facade.getDebugState();
    expect(result).toMatchObject({
      schema: "cc-ide-quality/v1",
      kind: "debug-state",
      available: true,
      session: {
        id: "debug-1",
        type: "node",
        configuration: {
          type: "node",
          request: "launch",
          name: "Launch tests",
        },
      },
      breakpoints: [
        {
          kind: "source",
          enabled: true,
          uri: "file:///workspace/src/a.test.js",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
    expect(result.session.configuration).not.toHaveProperty("env");
    expect(result.session.configuration).not.toHaveProperty("args");
  });
});
