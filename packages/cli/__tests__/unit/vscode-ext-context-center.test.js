import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  CONTEXT_CENTER_SCHEMA,
  buildContextCenter,
  normalizeContextCenterPreferences,
  stableChipId,
  updateContextCenterPreferences,
} from "../../../vscode-extension/src/context-center.js";
import {
  createMcpResourceCandidateProvider,
  parseMcpResourceCandidates,
} from "../../../vscode-extension/src/context-external-sources.js";
import { buildIdeTools } from "../../../vscode-extension/src/ide-tools.js";
import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";
import { contextCenterItems } from "../../../vscode-extension/src/ui/context-center-view.js";

const fixturePath = fileURLToPath(
  new URL(
    "../../../vscode-extension/src/__fixtures__/context-center/cases.json",
    import.meta.url,
  ),
);
const cases = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const externalSourcesFixture = JSON.parse(
  fs.readFileSync(
    fileURLToPath(
      new URL(
        "../../../vscode-extension/src/__fixtures__/context-center/external-sources.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);

describe("Context Center external source catalog", () => {
  it("normalizes MCP resource metadata through the shared fixture", () => {
    expect(
      parseMcpResourceCandidates(
        externalSourcesFixture.input,
        externalSourcesFixture.capturedAt,
      ),
    ).toEqual(externalSourcesFixture.expected);
  });

  it("uses the canonical read-only CLI catalog with bounded caching", async () => {
    let clock = Date.parse(externalSourcesFixture.capturedAt);
    const runCliText = vi.fn(async () =>
      JSON.stringify(externalSourcesFixture.input),
    );
    const provider = createMcpResourceCandidateProvider({
      runCliText,
      getCommand: () => "cc-test",
      getCwd: () => "/workspace",
      now: () => clock,
    });
    const [first, concurrent] = await Promise.all([provider(), provider()]);
    expect(first).toEqual(externalSourcesFixture.expected);
    expect(concurrent).toEqual(first);
    expect(runCliText).toHaveBeenCalledTimes(1);
    expect(runCliText).toHaveBeenCalledWith({
      command: "cc-test",
      args: ["mcp", "resources", "--json"],
      cwd: "/workspace",
      timeoutMs: 5000,
    });

    await provider();
    expect(runCliText).toHaveBeenCalledTimes(1);
    clock += 30_000;
    await provider();
    expect(runCliText).toHaveBeenCalledTimes(2);
  });
});

describe("cc-context-center/v1 shared twin fixture", () => {
  for (const item of cases) {
    it(item.name, () => {
      expect(buildContextCenter(item.input)).toEqual(item.expected);
    });
  }

  it("assigns stable content-free ids", () => {
    const id = stableChipId({
      kind: "selection",
      source: "ide.selection",
      identity: "/private/repo/a.js:1-2",
    });
    expect(id).toMatch(/^ctx_[a-f0-9]{16}$/);
    expect(id).not.toContain("private");
  });

  it("normalizes and updates persistent user intent", () => {
    const removed = "ctx_aaaaaaaaaaaaaaaa";
    const pinned = "ctx_bbbbbbbbbbbbbbbb";
    expect(
      normalizeContextCenterPreferences({
        tokenBudget: 999999,
        pinnedIds: [removed, pinned, "bad"],
        removedIds: [removed],
      }),
    ).toEqual({
      tokenBudget: 4096,
      pinnedIds: [pinned],
      removedIds: [removed],
    });
    const restored = updateContextCenterPreferences(
      { pinnedIds: [pinned], removedIds: [removed], tokenBudget: 12 },
      "restore",
      removed,
    );
    expect(restored).toEqual({
      tokenBudget: 12,
      pinnedIds: [pinned],
      removedIds: [],
    });
    expect(updateContextCenterPreferences(restored, "remove", pinned)).toEqual({
      tokenBudget: 12,
      pinnedIds: [],
      removedIds: [pinned],
    });
  });

  it("renders chip actions and explanatory metadata", () => {
    const vscode = {
      ThemeIcon: class ThemeIcon {
        constructor(id) {
          this.id = id;
        }
      },
    };
    const projection = buildContextCenter(cases[0].input);
    const items = contextCenterItems(vscode, projection);
    expect(items[0].detail).toContain("source=ide.active-file");
    expect(items[0].detail).toContain("scope=a.js");
    expect(items[0].detail).toContain("tokens=3/3");
    expect(items[0].buttons.map((button) => button.action)).toEqual([
      "unpin",
      "remove",
      "refresh",
    ]);
    expect(items.at(-1).buttons[0].action).toBe("restore");
  });
});

describe("getContextCenter IDE tool", () => {
  it("projects live host candidates through the deterministic budget", async () => {
    const editor = {
      getSelection: async () => null,
      getDiagnostics: async () => [],
      getOpenEditors: async () => [],
      openDiff: async () => ({ outcome: "rejected" }),
      getContextMetadata: vi.fn(async () => ({
        schema: "cc-ide-context/v2",
        workspaceId: "ws-c52ddf65534b7b46",
      })),
      getContextCandidates: vi.fn(async () => cases[0].input.candidates),
    };
    const tool = buildIdeTools(editor).find(
      (candidate) => candidate.name === "getContextCenter",
    );
    expect(tool).toBeTruthy();
    const result = await tool.handler({
      budgetTokens: 6,
      pinnedIds: ["ctx_bbbbbbbbbbbbbbbb"],
      removedIds: ["ctx_dddddddddddddddd"],
    });
    expect(result.schema).toBe(CONTEXT_CENTER_SCHEMA);
    expect(result.budget).toEqual({
      limitTokens: 6,
      allocatedTokens: 6,
      remainingTokens: 0,
    });
    expect(result.chips[0]).toMatchObject({
      id: "ctx_bbbbbbbbbbbbbbbb",
      pinned: true,
      status: "included",
    });
  });

  it("uses workspace preferences unless a request overrides them", async () => {
    const editor = {
      getSelection: async () => null,
      getDiagnostics: async () => [],
      getOpenEditors: async () => [],
      openDiff: async () => ({ outcome: "rejected" }),
      getContextMetadata: async () => ({ workspaceId: "ws" }),
      getContextCandidates: async () => cases[0].input.candidates,
      getContextCenterPreferences: async () => ({
        tokenBudget: 3,
        pinnedIds: ["ctx_bbbbbbbbbbbbbbbb"],
        removedIds: ["ctx_aaaaaaaaaaaaaaaa"],
      }),
    };
    const tool = buildIdeTools(editor).find(
      (candidate) => candidate.name === "getContextCenter",
    );
    const preferred = await tool.handler({});
    expect(preferred.budget.limitTokens).toBe(3);
    expect(preferred.chips[0]).toMatchObject({
      id: "ctx_bbbbbbbbbbbbbbbb",
      pinned: true,
    });
    expect(
      preferred.chips.find((chip) => chip.id === "ctx_aaaaaaaaaaaaaaaa").status,
    ).toBe("removed");

    const overridden = await tool.handler({
      budgetTokens: 1,
      pinnedIds: [],
      removedIds: [],
    });
    expect(overridden.budget.limitTokens).toBe(1);
    expect(overridden.chips[0].pinned).toBe(false);
  });

  it("gathers live VS Code sources without one failed source blanking the rest", async () => {
    const uri = {
      fsPath: "/workspace/a.js",
      scheme: "file",
      toString: () => "file:///workspace/a.js",
    };
    const range = {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 4 },
      active: { line: 1, character: 4 },
    };
    const document = {
      uri,
      languageId: "javascript",
      version: 3,
      isDirty: true,
      getText: vi.fn(() => "pick"),
    };
    const vscode = {
      commands: { executeCommand: vi.fn() },
      languages: {
        getDiagnostics: () => [
          [
            uri,
            [
              {
                severity: 0,
                message: "boom",
                range: { start: { line: 2, character: 1 } },
              },
            ],
          ],
        ],
      },
      window: {
        activeTextEditor: { document, selection: range },
        visibleTextEditors: [{ document }],
        tabGroups: {
          all: [{ tabs: [{ input: { uri } }] }],
        },
      },
      workspace: {
        isTrusted: true,
        workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
        textDocuments: [document],
      },
    };
    const facade = createVscodeEditorFacade(vscode, {
      now: () => 1000,
      getPreview: () => ({
        state: () => ({ running: true, url: "http://127.0.0.1:3000" }),
      }),
      getContextCenterPreferences: () => ({ tokenBudget: 2048 }),
    });
    const candidates = await facade.getContextCandidates();
    expect(await facade.getContextCenterPreferences()).toEqual({
      tokenBudget: 2048,
    });
    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      "selection",
      "active-file",
      "open-tabs",
      "diagnostics",
      "preview-evidence",
    ]);
    expect(candidates[0]).toMatchObject({
      content: "pick",
      range,
      freshness: {
        state: "live-buffer",
        capturedAt: "1970-01-01T00:00:01.000Z",
      },
    });
  });

  it("gathers bounded Git diff and project-memory sources", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-context-sources-"));
    try {
      fs.writeFileSync(path.join(root, "cc.md"), "# Project memory\n", "utf8");
      const repository = {
        rootUri: { fsPath: root },
        diffWithHEAD: vi.fn(async () => "@@ -1 +1 @@\n-old\n+new\n"),
        state: {
          untrackedChanges: [
            { uri: { fsPath: path.join(root, "new-file.js") } },
          ],
        },
      };
      const vscode = {
        commands: { executeCommand: vi.fn() },
        extensions: {
          getExtension: () => ({
            isActive: true,
            exports: { getAPI: () => ({ repositories: [repository] }) },
          }),
        },
        languages: { getDiagnostics: () => [] },
        window: {
          activeTextEditor: null,
          visibleTextEditors: [],
          tabGroups: { all: [] },
        },
        workspace: {
          isTrusted: true,
          workspaceFolders: [{ uri: { fsPath: root } }],
          textDocuments: [],
        },
      };
      const facade = createVscodeEditorFacade(vscode, {
        now: () => 1000,
        getExternalContextCandidates: async () =>
          externalSourcesFixture.expected,
      });
      const candidates = await facade.getContextCandidates();
      const git = candidates.find((candidate) => candidate.kind === "git-diff");
      const memory = candidates.find(
        (candidate) => candidate.kind === "memory",
      );
      const mcpResource = candidates.find(
        (candidate) => candidate.kind === "mcp-resource",
      );
      expect(git).toMatchObject({
        source: "vscode.git",
        identity: root,
        freshness: { state: "live-vcs" },
      });
      expect(git.content).toContain("+new");
      expect(git.content).toContain("new-file.js");
      expect(memory).toMatchObject({
        label: "Project memory: cc.md",
        source: "project-memory",
        freshness: { state: "disk" },
      });
      expect(memory.content).toContain("# Project memory");
      expect(mcpResource).toEqual(externalSourcesFixture.expected[0]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
