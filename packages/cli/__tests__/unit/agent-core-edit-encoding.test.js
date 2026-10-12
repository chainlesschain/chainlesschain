import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeProposedEdit,
  executeTool,
} from "../helpers/test-model-egress.js";
import { hashLine } from "../../src/lib/hashline.js";

const invalidEncodings = [
  ["Windows-1252", Buffer.from([0xe9])],
  ["GBK", Buffer.from([0xd6, 0xd0])],
  ["Shift-JIS", Buffer.from([0x82, 0xa0])],
  ["truncated UTF-8", Buffer.from([0xe2, 0x82])],
];
const textArgs = {
  edit_file: { old_string: "value = 1;", new_string: "value = 2;" },
  edit_file_hashed: {
    anchor_hash: hashLine("value = 1;"),
    expected_line: "value = 1;",
    new_line: "value = 2;",
  },
};
function notebookBytes(markerBytes) {
  const notebook = JSON.stringify({
    cells: [
      { cell_type: "markdown", id: "a", metadata: {}, source: ["old\n"] },
    ],
    metadata: { title: "ENCODING_MARKER" },
    nbformat: 4,
    nbformat_minor: 5,
  });
  const [before, after] = notebook.split("ENCODING_MARKER");
  return Buffer.concat([Buffer.from(before), markerBytes, Buffer.from(after)]);
}

describe("text edits preserve files with invalid UTF-8 bytes", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-edit-encoding-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (root && path.dirname(root) === path.resolve(os.tmpdir())) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  for (const tool of ["edit_file", "edit_file_hashed", "notebook_edit"]) {
    it.each(invalidEncodings)(
      `${tool} refuses %s before writing the file`,
      async (_encoding, markerBytes) => {
        const filePath = path.join(
          root,
          tool === "notebook_edit" ? "a.ipynb" : "a.txt",
        );
        const original =
          tool === "notebook_edit"
            ? notebookBytes(markerBytes)
            : Buffer.concat([Buffer.from("value = 1;\r\n// "), markerBytes]);
        fs.writeFileSync(filePath, original);
        const before = fs.statSync(filePath, { bigint: true });
        const writes = vi.spyOn(fs, "writeFileSync");
        const result = await executeTool(
          tool,
          {
            path: path.basename(filePath),
            ...(tool === "notebook_edit"
              ? { cell_id: "a", new_source: "new\n" }
              : textArgs[tool]),
          },
          { cwd: root },
        );
        expect(result.error).toMatch(/not valid UTF-8/i);
        expect(result.success).not.toBe(true);
        expect(writes.mock.calls.some(([target]) => target === filePath)).toBe(
          false,
        );
        expect(fs.readFileSync(filePath)).toEqual(original);
        expect(fs.statSync(filePath, { bigint: true }).mtimeNs).toBe(
          before.mtimeNs,
        );
      },
    );
  }

  for (const tool of ["edit_file", "edit_file_hashed"]) {
    it.each(invalidEncodings)(
      `${tool} offers no lossy IDE diff for %s`,
      (_encoding, markerBytes) => {
        const filePath = path.join(root, "a.txt");
        const original = Buffer.concat([
          Buffer.from("value = 1;\n// "),
          markerBytes,
        ]);
        fs.writeFileSync(filePath, original);
        expect(
          computeProposedEdit(tool, { path: "a.txt", ...textArgs[tool] }, root),
        ).toBeNull();
        expect(fs.readFileSync(filePath)).toEqual(original);
      },
    );
    it.each([
      ["Unicode", "value = 1;\n// 中文 🌍"],
      ["UTF-8 BOM and CRLF", "\uFEFF// 中文\r\nvalue = 1;\r\n// café"],
      ["literal replacement character", "value = 1;\n// \uFFFD"],
    ])(`${tool} preserves valid %s`, async (_label, original) => {
      const filePath = path.join(root, "a.txt");
      fs.writeFileSync(filePath, original, "utf8");
      const expected = original.replace("value = 1;", "value = 2;");
      const proposal = computeProposedEdit(
        tool,
        { path: "a.txt", ...textArgs[tool] },
        root,
      );
      expect(proposal.originalText).toBe(original);
      expect(proposal.newContent).toBe(expected);
      const result = await executeTool(
        tool,
        { path: "a.txt", ...textArgs[tool] },
        { cwd: root },
      );
      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath)).toEqual(Buffer.from(expected));
    });
  }

  it("notebook_edit preserves valid Unicode in unedited metadata", async () => {
    const filePath = path.join(root, "a.ipynb");
    fs.writeFileSync(filePath, notebookBytes(Buffer.from("中文 🌍 \uFFFD")));
    const result = await executeTool(
      "notebook_edit",
      { path: "a.ipynb", cell_id: "a", new_source: "new\n" },
      { cwd: root },
    );
    expect(result.success).toBe(true);
    const notebook = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(notebook.metadata.title).toBe("中文 🌍 \uFFFD");
    expect(notebook.cells[0].source).toEqual(["new\n"]);
  });
});
