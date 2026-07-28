import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../../../src/main/terminal/database-project-binding-resolver.js";

const { createDatabaseProjectBindingResolver } = pkg;

describe("Desktop terminal database project binding resolver", () => {
  let tmpRoot;
  let projectRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pty-binding-"));
    projectRoot = path.join(tmpRoot, "project");
    fs.mkdirSync(projectRoot);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("uses projectId only as a selector and returns the database record", () => {
    const project = {
      id: "project-1",
      root_path: projectRoot,
      root_path_local_attested: 1,
      deleted: 0,
    };
    const getProjectById = vi.fn(() => project);
    const resolver = createDatabaseProjectBindingResolver({
      getDatabase: () => ({ getProjectById }),
    });

    expect(
      resolver({ projectId: " project-1 ", legacyCwd: "C:\\spoofed" }),
    ).toBe(project);
    expect(getProjectById).toHaveBeenCalledWith("project-1");
  });

  it("maps a legacy Android cwd only through a unique canonical DB root", () => {
    const pcRoot = path.join(tmpRoot, "pc-root");
    fs.mkdirSync(pcRoot);
    const rows = [
      {
        id: "project-1",
        root_path: path.join(tmpRoot, "other"),
        root_path_local_attested: 0,
        pc_root_path: pcRoot,
        source_peer_id: "desktop-peer",
        deleted: 0,
      },
    ];
    const all = vi.fn(() => rows);
    const prepare = vi.fn(() => ({ all }));
    const resolver = createDatabaseProjectBindingResolver({
      getDatabase: () => ({
        db: { prepare },
      }),
    });

    expect(
      resolver({
        legacyCwd: path.join(pcRoot, "."),
      }),
    ).toBe(rows[0]);
    expect(all).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining("root_path_local_attested"),
    );
  });

  it("rejects a legacy cwd that is absent or ambiguously bound", () => {
    const rows = [
      { id: "one", root_path: projectRoot, deleted: 0 },
      { id: "two", pc_root_path: projectRoot, deleted: 0 },
    ];
    const resolver = createDatabaseProjectBindingResolver({
      getDatabase: () => ({
        db: {
          prepare: () => ({ all: () => rows }),
        },
      }),
    });

    expect(resolver({ legacyCwd: projectRoot })).toBeNull();
    expect(resolver({ legacyCwd: path.join(tmpRoot, "missing") })).toBeNull();
  });

  it("fails closed when the main-process database is unavailable", () => {
    const resolver = createDatabaseProjectBindingResolver({
      getDatabase: () => null,
    });

    expect(() => resolver({ projectId: "project-1" })).toThrowError(
      expect.objectContaining({
        code: "ERR_PTY_PROJECT_AUTHORITY_UNAVAILABLE",
        projectBindingFailClosed: true,
      }),
    );
  });
});
