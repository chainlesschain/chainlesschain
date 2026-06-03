import { describe, it, expect } from "vitest";
import { flatFilesToTree } from "../flatToTree";

describe("flatFilesToTree", () => {
  it("returns an empty list for empty input", () => {
    expect(flatFilesToTree([])).toEqual([]);
  });

  it("returns an empty list for non-array input defensively", () => {
    expect(
      flatFilesToTree(
        undefined as unknown as Parameters<typeof flatFilesToTree>[0],
      ),
    ).toEqual([]);
  });

  it("nests files under intermediate directories", () => {
    const tree = flatFilesToTree([
      { id: "a", file_path: "src/index.ts" },
      { id: "b", file_path: "src/utils/io.ts" },
      { id: "c", file_path: "README.md" },
    ]);

    expect(tree.map((node) => node.name)).toEqual(["src", "README.md"]);
    const src = tree.find((node) => node.name === "src")!;
    expect(src.kind).toBe("folder");
    expect(src.children?.map((node) => node.name)).toEqual([
      "utils",
      "index.ts",
    ]);
    const utils = src.children?.find((node) => node.name === "utils");
    expect(utils?.kind).toBe("folder");
    expect(utils?.children?.map((node) => node.name)).toEqual(["io.ts"]);
  });

  it("normalises Windows-style backslashes and leading dot/slash", () => {
    const tree = flatFilesToTree([
      { id: "a", file_path: ".\\src\\App.vue" },
      { id: "b", file_path: "/src/main.ts" },
    ]);
    const src = tree.find((node) => node.name === "src")!;
    expect(src.kind).toBe("folder");
    expect(src.children?.map((node) => node.name).sort()).toEqual([
      "App.vue",
      "main.ts",
    ]);
  });

  it("treats file_type === 'folder' as an explicit folder", () => {
    const tree = flatFilesToTree([
      { id: "f1", file_path: "docs", file_type: "folder" },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: "docs", kind: "folder" });
  });

  it("falls back to file_name when file_path is missing", () => {
    const tree = flatFilesToTree([{ id: "loose", file_name: "loose-doc.md" }]);
    expect(tree).toEqual([{ id: "loose", name: "loose-doc.md", kind: "file" }]);
  });

  it("sorts folders before files at every depth, alphabetically within each kind", () => {
    const tree = flatFilesToTree([
      { id: "z", file_path: "z-file.md" },
      { id: "a", file_path: "a-folder/x.md" },
      { id: "m", file_path: "m-file.md" },
    ]);
    expect(tree.map((node) => node.name)).toEqual([
      "a-folder",
      "m-file.md",
      "z-file.md",
    ]);
  });

  it("does not duplicate folder nodes when many files share a parent", () => {
    const tree = flatFilesToTree([
      { id: "1", file_path: "src/a.ts" },
      { id: "2", file_path: "src/b.ts" },
      { id: "3", file_path: "src/c.ts" },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(3);
  });
});
