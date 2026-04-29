import type { PreviewFileNode } from "../../stores/conversation-preview";

export interface FlatProjectFile {
  id?: unknown;
  file_name?: unknown;
  file_path?: unknown;
  file_type?: unknown;
  [key: string]: unknown;
}

interface FolderAccumulator {
  node: PreviewFileNode;
  children: PreviewFileNode[];
  folderIndex: Map<string, FolderAccumulator>;
}

function makeFolder(id: string, name: string): FolderAccumulator {
  const node: PreviewFileNode = {
    id,
    name,
    kind: "folder",
    children: [],
  };
  return {
    node,
    children: node.children!,
    folderIndex: new Map(),
  };
}

function normalizePath(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function pickFileName(file: FlatProjectFile, segments: string[]): string {
  const last = segments[segments.length - 1];
  if (last) {
    return last;
  }
  if (typeof file.file_name === "string" && file.file_name) {
    return file.file_name;
  }
  if (typeof file.id === "string" && file.id) {
    return file.id;
  }
  return "(未命名)";
}

function pickFileId(file: FlatProjectFile, fallback: string): string {
  if (typeof file.id === "string" && file.id) {
    return file.id;
  }
  return fallback;
}

/**
 * Convert a flat list of project files into a nested PreviewFileNode tree
 * suitable for the V6 preview shell file panel.
 *
 * Path segments are split on `/` (after normalising backslashes); the last
 * segment becomes a `file` node, intermediate segments become `folder`
 * nodes that are reused across files. A `file_type === "folder"` entry is
 * treated as an explicit folder marker.
 */
export function flatFilesToTree(
  files: readonly FlatProjectFile[],
): PreviewFileNode[] {
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  const root = makeFolder("__root__", "__root__");

  for (const file of files) {
    const path = normalizePath(file.file_path);
    if (!path) {
      const fallbackName =
        typeof file.file_name === "string" && file.file_name
          ? file.file_name
          : "(未命名)";
      const id =
        typeof file.id === "string" && file.id
          ? file.id
          : `unnamed-${root.children.length}`;
      root.children.push({
        id,
        name: fallbackName,
        kind: file.file_type === "folder" ? "folder" : "file",
      });
      continue;
    }

    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) {
      continue;
    }

    let cursor = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      let folder = cursor.folderIndex.get(segment);
      if (!folder) {
        folder = makeFolder(
          `folder:${segments.slice(0, i + 1).join("/")}`,
          segment,
        );
        cursor.folderIndex.set(segment, folder);
        cursor.children.push(folder.node);
      }
      cursor = folder;
    }

    const isFolder = file.file_type === "folder";
    if (isFolder) {
      const segment = segments[segments.length - 1];
      if (!cursor.folderIndex.has(segment)) {
        const folder = makeFolder(`folder:${path}`, segment);
        cursor.folderIndex.set(segment, folder);
        cursor.children.push(folder.node);
      }
      continue;
    }

    const name = pickFileName(file, segments);
    const id = pickFileId(file, `file:${path}`);
    cursor.children.push({ id, name, kind: "file" });
  }

  sortNodes(root.children);
  return root.children;
}

function sortNodes(nodes: PreviewFileNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      sortNodes(node.children);
    }
  }
}
