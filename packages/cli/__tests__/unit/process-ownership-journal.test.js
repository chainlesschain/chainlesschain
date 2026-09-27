import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProcessOwnershipJournal,
  PROCESS_OWNERSHIP_PENDING,
  PROCESS_OWNERSHIP_JOURNAL_UNAVAILABLE,
} from "../../src/lib/process-execution-broker/process-ownership-journal.js";

describe.skipIf(process.platform !== "linux")(
  "durable process ownership journal",
  () => {
    let root;
    let directory;
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ownership-journal-"));
      directory = path.join(root, "authority");
    });
    afterEach(() => {
      vi.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("admits local parallel launches but fences a fresh runtime until every real settlement", () => {
      const owner = new ProcessOwnershipJournal(directory);
      owner.assertAvailable();
      expect(fs.existsSync(directory)).toBe(false);
      const firstId = randomUUID();
      const first = owner.prepare(firstId);
      const second = owner.prepare(randomUUID());
      owner.assertAvailable();
      const peer = new ProcessOwnershipJournal(directory);
      expect(() => peer.assertAvailable()).toThrow(
        expect.objectContaining({ code: PROCESS_OWNERSHIP_PENDING }),
      );
      expect(() => peer.prepare(randomUUID())).toThrow(
        expect.objectContaining({ code: PROCESS_OWNERSHIP_PENDING }),
      );
      first.settle();
      first.settle();
      expect(() => peer.assertAvailable()).toThrow();
      second.settle();
      peer.assertAvailable();
      expect(owner.inspect().pendingExecutionIds).toEqual([]);
    });

    it("retains a lost lease across fresh instances regardless of PID reuse or age", () => {
      const owner = new ProcessOwnershipJournal(directory);
      const id = randomUUID();
      const lease = owner.prepare(id);
      lease.retain();
      expect(() => owner.assertAvailable()).toThrow(
        expect.objectContaining({ code: PROCESS_OWNERSHIP_PENDING }),
      );
      expect(() => lease.settle()).toThrow();
      const file = path.join(directory, "journal.json");
      const saved = JSON.parse(fs.readFileSync(file));
      saved.pending[0].ownerPid = 2147483647;
      fs.writeFileSync(file, JSON.stringify(saved));
      fs.utimesSync(file, new Date(0), new Date(0));
      expect(() =>
        new ProcessOwnershipJournal(directory).assertAvailable(),
      ).toThrow(expect.objectContaining({ code: PROCESS_OWNERSHIP_PENDING }));
      expect(JSON.parse(fs.readFileSync(file)).pending).toHaveLength(1);
    });

    it.each([
      "json",
      "schema",
      "extra-field",
      "oversize",
      "symlink",
      "hardlink",
      "permissions",
    ])("rejects %s state without overwriting it", (kind) => {
      const owner = new ProcessOwnershipJournal(directory);
      owner.prepare(randomUUID()).settle();
      const file = path.join(directory, "journal.json");
      if (kind === "json") fs.writeFileSync(file, "{");
      if (kind === "schema")
        fs.writeFileSync(file, '{"schema":"old","pending":[]}');
      if (kind === "extra-field")
        fs.writeFileSync(
          file,
          '{"schema":"chainlesschain.process-ownership-journal/v1","pending":[],"reset":true}',
        );
      if (kind === "oversize")
        fs.writeFileSync(file, " ".repeat(1024 * 1024 + 1));
      if (kind === "permissions") fs.chmodSync(file, 0o644);
      if (kind === "hardlink") fs.linkSync(file, path.join(root, "copy"));
      if (kind === "symlink") {
        fs.renameSync(file, path.join(root, "copy"));
        fs.symlinkSync(path.join(root, "copy"), file);
      }
      const bytes = fs.readFileSync(file);
      const peer = new ProcessOwnershipJournal(directory);
      expect(() => peer.prepare(randomUUID())).toThrow(
        expect.objectContaining({
          code: PROCESS_OWNERSHIP_JOURNAL_UNAVAILABLE,
        }),
      );
      expect(fs.readFileSync(file)).toEqual(bytes);
    });

    it("refuses state deletion and failed durable settlement without forgetting the launch", () => {
      const owner = new ProcessOwnershipJournal(directory);
      const id = randomUUID();
      const lease = owner.prepare(id);
      const file = path.join(directory, "journal.json");
      const original = fs.readFileSync(file);
      const fsync = vi.spyOn(fs, "fsyncSync").mockImplementation(() => {
        throw new Error("fixture fsync failure");
      });
      expect(() => lease.settle()).toThrow(
        expect.objectContaining({
          code: PROCESS_OWNERSHIP_JOURNAL_UNAVAILABLE,
        }),
      );
      fsync.mockRestore();
      expect(fs.readFileSync(file)).toEqual(original);
      expect(() => owner.assertAvailable()).toThrow();
      expect(() =>
        new ProcessOwnershipJournal(directory).assertAvailable(),
      ).toThrow(expect.objectContaining({ code: PROCESS_OWNERSHIP_PENDING }));
      const reader = new ProcessOwnershipJournal(directory);
      reader.inspect();
      fs.unlinkSync(file);
      expect(() => reader.assertAvailable()).toThrow(
        expect.objectContaining({
          code: PROCESS_OWNERSHIP_JOURNAL_UNAVAILABLE,
        }),
      );
    });

    it("rejects linked or replaced authority directories", () => {
      const owner = new ProcessOwnershipJournal(directory);
      const lease = owner.prepare(randomUUID());
      const renamed = path.join(root, "old");
      fs.renameSync(directory, renamed);
      fs.symlinkSync(renamed, directory);
      expect(() => lease.settle()).toThrow(
        expect.objectContaining({
          code: PROCESS_OWNERSHIP_JOURNAL_UNAVAILABLE,
        }),
      );
      expect(
        JSON.parse(fs.readFileSync(path.join(renamed, "journal.json"))).pending,
      ).toHaveLength(1);
    });
  },
);
