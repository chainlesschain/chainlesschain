"use strict";

import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_MAX_SNAPSHOT_BYTES,
  HARD_MAX_SNAPSHOT_BYTES,
  probeJsonSnapshotFile,
  readBoundedSnapshot,
  readBoundedSnapshotBuffer,
  readJsonSnapshot,
  resolveMaxSnapshotBytes,
} = require("../lib/snapshot-file");
const publicApi = require("../lib");

function withSnapshot(content, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-snapshot-file-"));
  const file = path.join(dir, "snapshot.json");
  fs.writeFileSync(file, content, "utf8");
  try {
    return run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("bounded snapshot-file reader", () => {
  it("is exported for adapter packages and host integrations", () => {
    expect(publicApi.readJsonSnapshot).toBe(readJsonSnapshot);
    expect(publicApi.DEFAULT_MAX_SNAPSHOT_BYTES).toBe(
      DEFAULT_MAX_SNAPSHOT_BYTES,
    );
  });

  it("reads a regular, stable JSON snapshot and validates its contract", () =>
    withSnapshot(
      JSON.stringify({ schemaVersion: 1, events: [{ id: "1" }] }),
      (file) => {
        expect(
          readJsonSnapshot(fs, file, {
            expectedSchemaVersion: 1,
            requiredArrayFields: ["events"],
          }),
        ).toEqual({
          schemaVersion: 1,
          events: [{ id: "1" }],
        });
      },
    ));

  it("can preserve arbitrary bytes while the legacy text API remains UTF-8", () =>
    withSnapshot(Buffer.from([0x00, 0xff, 0x41, 0x80]), (file) => {
      expect(readBoundedSnapshotBuffer(fs, file)).toEqual(
        Buffer.from([0x00, 0xff, 0x41, 0x80]),
      );
      expect(readBoundedSnapshot(fs, file)).toBe(
        Buffer.from([0x00, 0xff, 0x41, 0x80]).toString("utf8"),
      );
    }));

  it("rejects oversized files before allocating or parsing their contents", () =>
    withSnapshot(
      JSON.stringify({ schemaVersion: 1, events: [], padding: "x".repeat(64) }),
      (file) => {
        const result = probeJsonSnapshotFile(fs, file, {
          maxBytes: 16,
          expectedSchemaVersion: 1,
          requiredArrayFields: ["events"],
        });
        expect(result).toMatchObject({
          ok: false,
          reason: "SNAPSHOT_TOO_LARGE",
        });
        expect(result.message).not.toContain(file);
      },
    ));

  it("rejects malformed JSON, wrong schemas, and non-array event sets", () => {
    withSnapshot("{not-json", (file) => {
      expect(probeJsonSnapshotFile(fs, file)).toMatchObject({
        ok: false,
        reason: "SNAPSHOT_JSON_INVALID",
      });
    });
    withSnapshot(JSON.stringify({ schemaVersion: 2, events: [] }), (file) => {
      expect(
        probeJsonSnapshotFile(fs, file, {
          expectedSchemaVersion: 1,
          requiredArrayFields: ["events"],
        }),
      ).toMatchObject({
        ok: false,
        reason: "SNAPSHOT_SCHEMA_MISMATCH",
      });
    });
    withSnapshot(JSON.stringify({ schemaVersion: 1, events: {} }), (file) => {
      expect(
        probeJsonSnapshotFile(fs, file, {
          expectedSchemaVersion: 1,
          requiredArrayFields: ["events"],
        }),
      ).toMatchObject({
        ok: false,
        reason: "SNAPSHOT_SHAPE_INVALID",
      });
    });
  });

  it("rejects symbolic links without exposing the selected path", () => {
    const secretPath = "C:\\Users\\private\\snapshot.json";
    const result = probeJsonSnapshotFile(
      {
        lstatSync: () => ({ isSymbolicLink: () => true }),
      },
      secretPath,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "SNAPSHOT_SYMBOLIC_LINK",
    });
    expect(JSON.stringify(result)).not.toContain(secretPath);
  });

  it("fails closed when the opened file changes during the read", () =>
    withSnapshot(JSON.stringify({ schemaVersion: 1, events: [] }), (file) => {
      const changingFs = Object.create(fs);
      let fstatCalls = 0;
      changingFs.fstatSync = (descriptor, options) => {
        const stat = fs.fstatSync(descriptor, options);
        fstatCalls += 1;
        if (fstatCalls === 1) return stat;
        return {
          ...stat,
          size: stat.size + (typeof stat.size === "bigint" ? 1n : 1),
          isFile: () => true,
        };
      };
      expect(() =>
        readJsonSnapshot(changingFs, file, {
          expectedSchemaVersion: 1,
          requiredArrayFields: ["events"],
        }),
      ).toThrow(expect.objectContaining({ code: "SNAPSHOT_CHANGED" }));
    }));

  it("uses exact BigInt identities and rejects a same-size path replacement", () =>
    withSnapshot(
      JSON.stringify({ schemaVersion: 1, events: [{ id: "A" }] }),
      (file) => {
        const replacingFs = Object.create(fs);
        const replacement = JSON.stringify({
          schemaVersion: 1,
          events: [{ id: "B" }],
        });
        const originalStat = fs.statSync(file);
        const displaced = `${file}.original`;
        let replaced = false;
        replacingFs.openSync = (candidate, flags) => {
          if (!replaced) {
            replaced = true;
            fs.renameSync(candidate, displaced);
            fs.writeFileSync(candidate, replacement, "utf8");
            fs.utimesSync(candidate, originalStat.atime, originalStat.mtime);
          }
          return fs.openSync(candidate, flags);
        };

        expect(() =>
          readJsonSnapshot(replacingFs, file, {
            expectedSchemaVersion: 1,
            requiredArrayFields: ["events"],
          }),
        ).toThrow(expect.objectContaining({ code: "SNAPSHOT_CHANGED" }));
      },
    ));

  it("rejects an in-place rewrite even when size and mtime are restored", () =>
    withSnapshot(
      JSON.stringify({ schemaVersion: 1, events: [{ id: "A" }] }),
      (file) => {
        const mutatingFs = Object.create(fs);
        const originalStat = fs.statSync(file);
        let mutated = false;
        mutatingFs.readSync = (...args) => {
          const bytesRead = fs.readSync(...args);
          if (!mutated) {
            mutated = true;
            fs.writeFileSync(
              file,
              JSON.stringify({ schemaVersion: 1, events: [{ id: "B" }] }),
              "utf8",
            );
            fs.utimesSync(file, originalStat.atime, originalStat.mtime);
          }
          return bytesRead;
        };

        expect(() =>
          readJsonSnapshot(mutatingFs, file, {
            expectedSchemaVersion: 1,
            requiredArrayFields: ["events"],
          }),
        ).toThrow(expect.objectContaining({ code: "SNAPSHOT_CHANGED" }));
      },
    ));

  it("keeps configurable byte limits inside a fixed hard ceiling", () => {
    expect(resolveMaxSnapshotBytes()).toBe(DEFAULT_MAX_SNAPSHOT_BYTES);
    expect(resolveMaxSnapshotBytes(HARD_MAX_SNAPSHOT_BYTES)).toBe(
      HARD_MAX_SNAPSHOT_BYTES,
    );
    expect(() => resolveMaxSnapshotBytes(HARD_MAX_SNAPSHOT_BYTES + 1)).toThrow(
      /must not exceed/u,
    );
    expect(() => resolveMaxSnapshotBytes(0)).toThrow(/positive safe integer/u);
  });
});
