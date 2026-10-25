import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { evolutionDurableStoreConfiguration } from "../fixtures/evolution-durable-store.js";
import { createJournalBoundaryIo } from "../fixtures/evolution-journal-boundary.js";
import {
  evolutionPrivateStorageOptions,
  isProductionEvolutionFileSystem,
} from "../../src/lib/evolution/evolution-private-storage.js";

describe("real Evolution fixture filesystem boundary", () => {
  it("keeps the unmodified durable fixture on the production ACL path", () => {
    const { fsImpl } = evolutionDurableStoreConfiguration(
      "unused-fixture-root",
    );
    expect(isProductionEvolutionFileSystem(fsImpl)).toBe(true);
    expect(evolutionPrivateStorageOptions(fsImpl)).not.toHaveProperty("deps");
    if (process.platform === "win32") {
      expect(Object.getPrototypeOf(fsImpl)).toBe(fs);
      expect(Object.hasOwn(fsImpl, "syncDirectorySync")).toBe(true);
    } else {
      expect(fsImpl).toBe(fs);
    }
  });

  it("preserves inherited fs and owned flush methods without granting custom-port authority", () => {
    const flush = vi.fn(() => "flushed");
    const base = Object.assign(Object.create(fs), { syncDirectorySync: flush });
    const { fsImpl } = createJournalBoundaryIo(base);
    expect(fsImpl.mkdirSync).toBe(fs.mkdirSync);
    expect(fsImpl.linkSync).toBe(fs.linkSync);
    expect(Object.hasOwn(fsImpl, "syncDirectorySync")).toBe(true);
    expect(fsImpl.syncDirectorySync("fixture-directory")).toBe("flushed");
    expect(flush).toHaveBeenCalledWith("fixture-directory");
    expect(isProductionEvolutionFileSystem(fsImpl)).toBe(false);
    expect(evolutionPrivateStorageOptions(fsImpl).deps.fs).toBe(fsImpl);
  });

  it("keeps mutation of a monitoring facade isolated from Node's global fs", () => {
    const original = fs.openSync;
    const { fsImpl } = createJournalBoundaryIo(fs);
    fsImpl.openSync = () => {
      throw new Error("test-only fault");
    };
    expect(() => fsImpl.openSync("unused")).toThrow("test-only fault");
    expect(fs.openSync).toBe(original);
  });

  it("retains directory fault admission before the native flush and records successful IO", () => {
    const flush = vi.fn(() => "flushed");
    const base = Object.assign(Object.create(fs), { syncDirectorySync: flush });
    const tracking = createJournalBoundaryIo(base);
    tracking.arm("fixture-directory");
    tracking.io.beforeAnyOpen = () => {
      throw new Error("directory open denied");
    };
    expect(() =>
      tracking.fsImpl.syncDirectorySync("fixture-directory"),
    ).toThrow("directory open denied");
    expect(flush).not.toHaveBeenCalled();
    tracking.io.beforeAnyOpen = null;
    expect(tracking.fsImpl.syncDirectorySync("fixture-directory")).toBe(
      "flushed",
    );
    expect(tracking.io.allOpens).toEqual([
      { target: "fixture-directory", flags: "r" },
    ]);
  });
});
