import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_AGENT_LIST_INDEX_FILE,
  BACKGROUND_AGENT_LIST_INDEX_SCHEMA,
  loadBackgroundAgentListIndex,
} from "../../src/lib/background-agent-list-index.js";

let directory;

function writeState(id, state) {
  writeFileSync(
    join(directory, `${id}.json`),
    JSON.stringify({ id, startedAt: 1, status: "completed", ...state }),
    "utf8",
  );
}

function reader() {
  return vi.fn((id) =>
    JSON.parse(readFileSync(join(directory, `${id}.json`), "utf8")),
  );
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cc-background-list-index-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("background agent read-only list index", () => {
  it("reuses an exact authority-file projection without storing session content", () => {
    writeState("bg-a", { startedAt: 2, secret: "DO_NOT_INDEX_A" });
    writeState("bg-b", { startedAt: 1, status: "running" });
    const firstReader = reader();
    const first = loadBackgroundAgentListIndex({
      directory,
      readState: firstReader,
    });
    expect(first.source).toBe("rebuilt");
    expect(firstReader).toHaveBeenCalledTimes(2);

    const indexPath = join(directory, BACKGROUND_AGENT_LIST_INDEX_FILE);
    expect(existsSync(indexPath)).toBe(true);
    const indexText = readFileSync(indexPath, "utf8");
    expect(indexText).not.toContain("DO_NOT_INDEX_A");
    expect(JSON.parse(indexText).schema).toBe(
      BACKGROUND_AGENT_LIST_INDEX_SCHEMA,
    );

    const secondReader = reader();
    const second = loadBackgroundAgentListIndex({
      directory,
      readState: secondReader,
    });
    expect(second.source).toBe("index");
    expect(secondReader).not.toHaveBeenCalled();
    expect(second.entries).toEqual(first.entries);
  });

  it("invalidates on authority replacement and rebuilds a corrupt cache", () => {
    writeState("bg-a", { status: "running" });
    loadBackgroundAgentListIndex({ directory, readState: reader() });

    writeState("bg-a", {
      status: "completed",
      detail: "force a different file signature",
    });
    const changedReader = reader();
    const changed = loadBackgroundAgentListIndex({
      directory,
      readState: changedReader,
    });
    expect(changed.source).toBe("rebuilt");
    expect(changedReader).toHaveBeenCalledTimes(1);
    expect(changed.entries[0].status).toBe("completed");

    writeFileSync(
      join(directory, BACKGROUND_AGENT_LIST_INDEX_FILE),
      "{corrupt",
      "utf8",
    );
    const corruptReader = reader();
    const recovered = loadBackgroundAgentListIndex({
      directory,
      readState: corruptReader,
    });
    expect(recovered.source).toBe("rebuilt");
    expect(corruptReader).toHaveBeenCalledTimes(1);
  });
});
