import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  CONTEXT_CENTER_SCHEMA,
  buildContextCenter,
  normalizeContextCenterPreferences,
  stableChipId,
  updateContextCenterPreferences,
} from "../../../vscode-extension/src/context-center.js";
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
    });
    const candidates = await facade.getContextCandidates();
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
});
