import {
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBackgroundAgentListIndex } from "../src/lib/background-agent-list-index.js";

let directory;

function writeState(id, state = {}) {
  writeFileSync(
    join(directory, `${id}.json`),
    JSON.stringify({ id, startedAt: 1, status: "completed", ...state }),
    "utf8",
  );
}

function deleteState(id) {
  unlinkSync(join(directory, `${id}.json`));
}

function reader() {
  return vi.fn((id) =>
    JSON.parse(readFileSync(join(directory, `${id}.json`), "utf8")),
  );
}

/**
 * Split a flat list into fixed-size pages, retaining a final partial page.
 * Returns the list of pages so callers can assert on every page including the
 * last one.
 */
function paginateAll(entries, pageSize) {
  const pages = [];
  for (let offset = 0; offset < entries.length; offset += pageSize) {
    pages.push(entries.slice(offset, offset + pageSize));
  }
  return pages;
}

function flat(pages) {
  return pages.flatMap((page) => page.map((entry) => entry.id));
}

function orderedIds(result) {
  return result.entries.map((entry) => entry.id);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cc-verify10-index-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("background agent list index pagination regression", () => {
  it("after a write, index pagination reproduces the full snapshot including the last page", () => {
    ["bg-a", "bg-b", "bg-c"].forEach((id) => writeState(id));
    loadBackgroundAgentListIndex({ directory, readState: reader() });

    writeState("bg-d", { status: "running" });
    const result = loadBackgroundAgentListIndex({
      directory,
      readState: reader(),
    });

    const pageSize = 3;
    const pages = paginateAll(result.entries, pageSize);
    expect(pages.length).toBeGreaterThan(1);
    // The last page must not be empty and must include the final entry.
    expect(pages[pages.length - 1]).toHaveLength(1);
    expect(pages[pages.length - 1][0].id).toBe("bg-d");
    expect(flat(pages)).toEqual(orderedIds(result));
    expect(flat(pages)).toEqual(["bg-a", "bg-b", "bg-c", "bg-d"]);

    // Keep the full four-ID index, then change only an existing authority file.
    // A names/count-only check cannot detect this same-ID state replacement.
    writeState("bg-b", { startedAt: 2, status: "running" });
    const updated = loadBackgroundAgentListIndex({
      directory,
      readState: reader(),
    });
    const updatedPages = paginateAll(updated.entries, pageSize);
    expect(updated.entries).toHaveLength(4);
    expect(updatedPages).toHaveLength(2);
    expect(updatedPages[updatedPages.length - 1]).toHaveLength(1);
    expect(flat(updatedPages)).toEqual(orderedIds(updated));
    expect(flat(updatedPages)).toEqual(["bg-a", "bg-b", "bg-c", "bg-d"]);
    expect(updated.entries.find((entry) => entry.id === "bg-b")).toEqual({
      id: "bg-b",
      startedAt: 2,
      status: "running",
    });
    expect(updatedPages.flat()).toEqual(updated.entries);
    expect(updatedPages[0][1]).toEqual({
      id: "bg-b",
      startedAt: 2,
      status: "running",
    });
  });

  it("after a delete, index pagination reproduces the full snapshot including the last page", () => {
    ["bg-a", "bg-b", "bg-c", "bg-d"].forEach((id) => writeState(id));
    loadBackgroundAgentListIndex({ directory, readState: reader() });

    deleteState("bg-a");
    const result = loadBackgroundAgentListIndex({
      directory,
      readState: reader(),
    });

    const pageSize = 2;
    const pages = paginateAll(result.entries, pageSize);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[pages.length - 1]).toHaveLength(1);
    expect(pages[pages.length - 1][0].id).toBe("bg-d");
    expect(flat(pages)).toEqual(["bg-b", "bg-c", "bg-d"]);
  });

  it("write plus delete keeps every page (including the last) consistent with the same snapshot", () => {
    ["bg-a", "bg-b", "bg-c"].forEach((id) => writeState(id));
    loadBackgroundAgentListIndex({ directory, readState: reader() });

    writeState("bg-e", { status: "running" });
    deleteState("bg-b");
    const result = loadBackgroundAgentListIndex({
      directory,
      readState: reader(),
    });

    const pageSize = 2;
    const pages = paginateAll(result.entries, pageSize);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[pages.length - 1]).toHaveLength(1);
    expect(pages[pages.length - 1][0].id).toBe("bg-e");
    expect(flat(pages)).toEqual(["bg-a", "bg-c", "bg-e"]);
  });

  it("a deleted id never appears in any page after the authority changed", () => {
    ["bg-x", "bg-y", "bg-z"].forEach((id) => writeState(id));
    loadBackgroundAgentListIndex({ directory, readState: reader() });

    deleteState("bg-y");
    const result = loadBackgroundAgentListIndex({
      directory,
      readState: reader(),
    });

    const pages = paginateAll(result.entries, 1);
    const allIds = flat(pages);
    expect(allIds).not.toContain("bg-y");
    expect(result.entries).toHaveLength(2);
  });

  it("unchanged authority serves the cached snapshot so pagination is stable across loads", () => {
    ["bg-a", "bg-b", "bg-c", "bg-d", "bg-e"].forEach((id) => writeState(id));
    const first = loadBackgroundAgentListIndex({
      directory,
      readState: reader(),
    });

    const secondReader = reader();
    const second = loadBackgroundAgentListIndex({
      directory,
      readState: secondReader,
    });
    expect(second.source).toBe("index");
    expect(secondReader).not.toHaveBeenCalled();

    const pageSize = 2;
    const pages = paginateAll(second.entries, pageSize);
    expect(flat(pages)).toEqual(orderedIds(first));
    expect(flat(pages)).toEqual(["bg-a", "bg-b", "bg-c", "bg-d", "bg-e"]);
    expect(pages[pages.length - 1]).toEqual([{ id: "bg-e", startedAt: 1, status: "completed" }]);
  });

  it("a page that is not the last is never truncated by the final partial page boundary", () => {
    ["bg-a", "bg-b", "bg-c", "bg-d", "bg-e", "bg-f", "bg-g"].forEach((id) =>
      writeState(id),
    );
    const result = loadBackgroundAgentListIndex({
      directory,
      readState: reader(),
    });

    const pageSize = 3;
    const pages = paginateAll(result.entries, pageSize);
    expect(pages).toHaveLength(3);
    expect(pages[0].map((e) => e.id)).toEqual(["bg-a", "bg-b", "bg-c"]);
    expect(pages[1].map((e) => e.id)).toEqual(["bg-d", "bg-e", "bg-f"]);
    // Final partial page keeps the tail entry.
    expect(pages[2].map((e) => e.id)).toEqual(["bg-g"]);
    expect(flat(pages)).toEqual(orderedIds(result));
  });
});
