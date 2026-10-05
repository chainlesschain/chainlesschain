import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _projectInternals } from "../../src/commands/project.js";

const { readProjectSnapshot, MAX_PROJECT_SNAPSHOT_BYTES } = _projectInternals;
let directory;
beforeEach(() => {
  directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-project-snapshot-unit-"),
  );
});
afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fakeIo(contents, overrides = {}) {
  const bytes = Buffer.from(contents);
  return {
    lstatSync: vi.fn(() => ({ isFile: () => true })),
    openSync: vi.fn(() => 5),
    fstatSync: vi.fn(() => ({
      size: bytes.length,
      mtimeMs: 1,
      ctimeMs: 1,
      isFile: () => true,
    })),
    readSync: vi.fn((_fd, target, offset, length, position) =>
      bytes.copy(target, offset, position, position + length),
    ),
    closeSync: vi.fn(),
    ...overrides,
  };
}

describe("bounded offline project snapshot files", () => {
  it("accepts a regular UTF-8 JSON file at the exact 2 MiB byte limit", () => {
    const file = path.join(directory, "snapshot.json");
    fs.writeFileSync(
      file,
      `{"x":1}${" ".repeat(MAX_PROJECT_SNAPSHOT_BYTES - 7)}`,
    );
    expect(fs.statSync(file).size).toBe(MAX_PROJECT_SNAPSHOT_BYTES);
    expect(readProjectSnapshot(file)).toEqual({ x: 1 });
  });

  it("rejects an oversized file before any allocation/read", () => {
    const io = fakeIo("{}", {
      fstatSync: vi.fn(() => ({
        size: MAX_PROJECT_SNAPSHOT_BYTES + 1,
        isFile: () => true,
      })),
    });
    expect(() => readProjectSnapshot("snapshot.json", io)).toThrow(
      "SNAPSHOT_FILE_TOO_LARGE",
    );
    expect(io.readSync).not.toHaveBeenCalled();
    expect(io.closeSync).toHaveBeenCalledWith(5);
  });

  it("rejects directories, symbolic links and FIFOs before opening them", () => {
    const io = fakeIo("{}", {
      lstatSync: vi.fn(() => ({ isFile: () => false })),
    });
    expect(() => readProjectSnapshot("not-regular", io)).toThrow(
      "SNAPSHOT_REGULAR_FILE_REQUIRED",
    );
    expect(io.openSync).not.toHaveBeenCalled();
  });

  it("uses nonblocking open where available and rejects a replaced nonregular descriptor", () => {
    const io = fakeIo("{}", {
      fstatSync: vi.fn(() => ({ isFile: () => false })),
    });
    expect(() => readProjectSnapshot("snapshot.json", io)).toThrow(
      "SNAPSHOT_REGULAR_FILE_REQUIRED",
    );
    expect(io.openSync).toHaveBeenCalledWith(
      "snapshot.json",
      fs.constants.O_RDONLY |
        (fs.constants.O_NONBLOCK || 0) |
        (fs.constants.O_NOFOLLOW || 0),
    );
    expect(io.closeSync).toHaveBeenCalledWith(5);
  });

  it.each(["size", "mtimeMs", "ctimeMs"])(
    "rejects a file whose %s changes while reading",
    (field) => {
      let calls = 0;
      const io = fakeIo("{}", {
        fstatSync: vi.fn(() => {
          const stat = { size: 2, mtimeMs: 1, ctimeMs: 1, isFile: () => true };
          if (calls++ > 0) stat[field]++;
          return stat;
        }),
      });
      expect(() => readProjectSnapshot("snapshot.json", io)).toThrow(
        "SNAPSHOT_CHANGED_DURING_READ",
      );
      expect(io.closeSync).toHaveBeenCalledWith(5);
    },
  );

  it("caps reads at declared size plus one when a writer grows the file", () => {
    const io = fakeIo("{}growing-file", {
      fstatSync: vi.fn(() => ({
        size: 2,
        mtimeMs: 1,
        ctimeMs: 1,
        isFile: () => true,
      })),
    });
    expect(() => readProjectSnapshot("snapshot.json", io)).toThrow(
      "SNAPSHOT_CHANGED_DURING_READ",
    );
    expect(io.readSync).toHaveBeenCalledOnce();
    expect(io.readSync.mock.calls[0][3]).toBe(3);
  });

  it.each([
    [
      Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]),
      "SNAPSHOT_INVALID_UTF8",
    ],
    [
      Buffer.from('{"secret":"sensitive unfinished content'),
      "SNAPSHOT_INVALID_JSON",
    ],
    [Buffer.alloc(0), "SNAPSHOT_INVALID_JSON"],
  ])(
    "rejects invalid encoding/JSON without exposing contents %#",
    (bytes, code) => {
      const file = path.join(directory, "invalid.json");
      fs.writeFileSync(file, bytes);
      expect(() => readProjectSnapshot(file)).toThrow(code);
    },
  );

  it("normalizes read errors and rejects device namespaces before filesystem access", () => {
    expect(() =>
      readProjectSnapshot(path.join(directory, "missing.json")),
    ).toThrow("SNAPSHOT_READ_FAILED");
    const io = fakeIo("{}");
    for (const device of ["\\\\.\\pipe\\input", "\\\\?\\C:\\input.json"]) {
      expect(() => readProjectSnapshot(device, io)).toThrow(
        "SNAPSHOT_INVALID_PATH",
      );
    }
    expect(io.lstatSync).not.toHaveBeenCalled();
  });
});
