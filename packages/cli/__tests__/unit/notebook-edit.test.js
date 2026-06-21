/**
 * notebook_edit tool — editNotebookCell pure helper.
 * Replace / insert / delete cells in a Jupyter .ipynb, with nbformat-correct
 * source (array of lines keeping trailing \n) and code-cell output clearing.
 */
import { describe, it, expect } from "vitest";
import { editNotebookCell } from "../../src/runtime/agent-core.js";

function nb(cells) {
  return JSON.stringify({
    cells,
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  });
}
const codeCell = (id, src, withOutput = false) => ({
  cell_type: "code",
  id,
  metadata: {},
  source: Array.isArray(src) ? src : [src],
  outputs: withOutput ? [{ output_type: "stream", text: ["old\n"] }] : [],
  execution_count: withOutput ? 7 : null,
});
const mdCell = (id, src) => ({
  cell_type: "markdown",
  id,
  metadata: {},
  source: Array.isArray(src) ? src : [src],
});
const parse = (res) => JSON.parse(res.text);

describe("editNotebookCell — replace", () => {
  it("replaces a code cell's source and clears stale output", () => {
    const res = editNotebookCell(nb([codeCell("a", "x=1\n", true)]), {
      cell_id: "a",
      new_source: "x = 2\nprint(x)\n",
    });
    expect(res.error).toBeUndefined();
    const cell = parse(res).cells[0];
    expect(cell.source).toEqual(["x = 2\n", "print(x)\n"]);
    expect(cell.outputs).toEqual([]);
    expect(cell.execution_count).toBeNull();
    expect(res.summary).toMatch(/replaced code cell at index 0/);
  });

  it("replaces a markdown cell by index without adding outputs", () => {
    const res = editNotebookCell(nb([mdCell("m", "# Old\n")]), {
      cell_index: 0,
      new_source: "# New\n",
      edit_mode: "replace",
    });
    const cell = parse(res).cells[0];
    expect(cell.source).toEqual(["# New\n"]);
    expect(cell.outputs).toBeUndefined();
  });

  it("trailing-newline-less source becomes a single line", () => {
    const res = editNotebookCell(nb([codeCell("a", "x\n")]), {
      cell_id: "a",
      new_source: "y = 9",
    });
    expect(parse(res).cells[0].source).toEqual(["y = 9"]);
  });
});

describe("editNotebookCell — insert", () => {
  it("inserts a new code cell after the target with a fresh id + cleared output", () => {
    const res = editNotebookCell(
      nb([codeCell("a", "x\n"), codeCell("b", "y\n")]),
      {
        edit_mode: "insert",
        cell_id: "a",
        cell_type: "code",
        new_source: "z = 0\n",
      },
    );
    const cells = parse(res).cells;
    expect(cells).toHaveLength(3);
    expect(cells[1].cell_type).toBe("code");
    expect(cells[1].source).toEqual(["z = 0\n"]);
    expect(cells[1].outputs).toEqual([]);
    expect(cells[1].execution_count).toBeNull();
    expect(typeof cells[1].id).toBe("string");
    expect(cells[1].id).not.toBe("a");
    expect(res.cellId).toBe(cells[1].id);
  });

  it("inserts at the top when no target is given", () => {
    const res = editNotebookCell(nb([codeCell("a", "x\n")]), {
      edit_mode: "insert",
      cell_type: "markdown",
      new_source: "# Intro\n",
    });
    const cells = parse(res).cells;
    expect(cells[0].cell_type).toBe("markdown");
    expect(cells[0].source).toEqual(["# Intro\n"]);
  });

  it("requires cell_type for insert", () => {
    const res = editNotebookCell(nb([codeCell("a", "x\n")]), {
      edit_mode: "insert",
      new_source: "z\n",
    });
    expect(res.error).toMatch(/cell_type/);
  });
});

describe("editNotebookCell — delete", () => {
  it("removes the target cell", () => {
    const res = editNotebookCell(
      nb([codeCell("a", "x\n"), codeCell("b", "y\n")]),
      { edit_mode: "delete", cell_id: "b" },
    );
    const cells = parse(res).cells;
    expect(cells).toHaveLength(1);
    expect(cells[0].id).toBe("a");
    expect(res.summary).toMatch(/deleted cell at index 1/);
  });
});

describe("editNotebookCell — errors", () => {
  it("rejects non-JSON", () => {
    expect(editNotebookCell("not json {", {}).error).toMatch(/valid JSON/);
  });
  it("rejects a non-notebook (no cells[])", () => {
    expect(editNotebookCell(JSON.stringify({ foo: 1 }), {}).error).toMatch(
      /missing cells/,
    );
  });
  it("requires a locator for replace/delete", () => {
    expect(
      editNotebookCell(nb([codeCell("a", "x\n")]), { new_source: "y\n" }).error,
    ).toMatch(/cell_id or cell_index/);
  });
  it("reports a missing target", () => {
    expect(
      editNotebookCell(nb([codeCell("a", "x\n")]), {
        cell_id: "zzz",
        new_source: "y\n",
      }).error,
    ).toMatch(/not found/);
  });
  it("requires new_source for replace", () => {
    expect(
      editNotebookCell(nb([codeCell("a", "x\n")]), { cell_id: "a" }).error,
    ).toMatch(/new_source/);
  });
  it("keeps the output as valid round-trippable JSON ending in a newline", () => {
    const res = editNotebookCell(nb([codeCell("a", "x\n")]), {
      cell_id: "a",
      new_source: "y\n",
    });
    expect(res.text.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(res.text)).not.toThrow();
  });
});
