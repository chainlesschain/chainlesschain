/**
 * "✨ Explain / Refactor" CodeLens — the pure symbol flattener and the
 * provider's orchestration (symbol provider → lenses, kill-switch, tolerant
 * of a missing/slow language server). Headless (mock vscode).
 */
import { describe, it, expect, vi } from "vitest";
import {
  flattenLensTargets,
  createCcCodeLensProvider,
  MAX_LENS_TARGETS,
} from "../../../vscode-extension/src/code-lens.js";

const fn = (name, extra = {}) => ({
  name,
  kind: 11, // Function
  range: { start: { line: 1 }, end: { line: 9 } },
  selectionRange: { start: { line: 1 }, end: { line: 1 } },
  children: [],
  ...extra,
});

describe("flattenLensTargets", () => {
  it("keeps classes/methods/constructors/functions, in document order, nested included", () => {
    const cls = fn("C", {
      kind: 4,
      children: [fn("m", { kind: 5 }), fn("prop", { kind: 6 })],
    });
    const out = flattenLensTargets([cls, fn("top")]);
    expect(out.map((s) => s.name)).toEqual(["C", "m", "top"]); // Property (6) dropped
  });

  it("caps the lens count so generated files don't wallpaper the editor", () => {
    const many = Array.from({ length: 100 }, (_, i) => fn("f" + i));
    expect(flattenLensTargets(many).length).toBe(MAX_LENS_TARGETS);
  });

  it("tolerates undefined/ragged symbol trees (server still starting)", () => {
    expect(flattenLensTargets(undefined)).toEqual([]);
    expect(flattenLensTargets([null, { kind: 999 }, fn("ok")]).length).toBe(1);
  });
});

function makeVscode({ symbols, config = {} } = {}) {
  return {
    CodeLens: class {
      constructor(range, command) {
        this.range = range;
        this.command = command;
      }
    },
    workspace: {
      getConfiguration: () => ({ get: (k) => config[k] }),
    },
    commands: {
      executeCommand: vi.fn(async (id) => {
        if (id === "vscode.executeDocumentSymbolProvider") {
          if (symbols instanceof Error) throw symbols;
          return symbols;
        }
        return undefined;
      }),
    },
  };
}

describe("createCcCodeLensProvider", () => {
  const doc = { uri: { fsPath: "/ws/a.js" } };

  it("emits an Explain + Refactor lens per symbol, anchored on the name line", async () => {
    const vscode = makeVscode({ symbols: [fn("top")] });
    const provider = createCcCodeLensProvider(vscode);
    const lenses = await provider.provideCodeLenses(doc);
    expect(lenses.length).toBe(2);
    expect(lenses[0].command.title).toContain("Explain");
    expect(lenses[0].command.command).toBe("chainlesschain.lens.explain");
    expect(lenses[0].range).toEqual({ start: { line: 1 }, end: { line: 1 } }); // selectionRange
    expect(lenses[0].command.arguments[1]).toEqual({
      start: { line: 1 },
      end: { line: 9 },
    }); // full body range rides the command
    expect(lenses[1].command.command).toBe("chainlesschain.lens.refactor");
  });

  it("returns [] when chainlesschain.codeLens.enabled=false (no symbol query at all)", async () => {
    const vscode = makeVscode({
      symbols: [fn("top")],
      config: { enabled: false },
    });
    const provider = createCcCodeLensProvider(vscode);
    expect(await provider.provideCodeLenses(doc)).toEqual([]);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it("returns [] when the symbol provider throws or yields nothing", async () => {
    const boom = makeVscode({ symbols: new Error("no provider") });
    expect(await createCcCodeLensProvider(boom).provideCodeLenses(doc)).toEqual(
      [],
    );
    const empty = makeVscode({ symbols: undefined });
    expect(
      await createCcCodeLensProvider(empty).provideCodeLenses(doc),
    ).toEqual([]);
  });
});
