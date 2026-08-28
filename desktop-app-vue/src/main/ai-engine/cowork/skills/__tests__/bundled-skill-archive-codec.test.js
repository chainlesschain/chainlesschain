// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { withTestFilesystemHandler } from "./helpers/bundled-skill-filesystem.js";

const require = createRequire(import.meta.url);
const {
  normalizeArchiveEntryName,
} = require("../bundled-skill-archive-codec.js");
const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-archive-codec-"));
  temporaryRoots.push(root);
  return root;
}

function handlerFor(skillId) {
  return withTestFilesystemHandler(
    require(`../builtin/${skillId}/handler.js`),
    skillId,
  );
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

describe("bundled Skill bounded archive codec", () => {
  it("compresses, inspects, and extracts only through filesystem authority", async () => {
    const root = temporaryRoot();
    fs.writeFileSync(path.join(root, "source.txt"), "bounded archive", "utf8");
    const handler = handlerFor("file-compressor");
    const context = { projectRoot: root };

    const compressed = await handler.execute(
      { input: "--compress source.txt --output bundle.zip" },
      context,
    );
    expect(compressed).toMatchObject({ success: true });
    expect(fs.existsSync(path.join(root, "bundle.zip"))).toBe(true);

    const listed = await handler.execute(
      { input: "--list bundle.zip" },
      context,
    );
    expect(listed.result.entries, JSON.stringify(listed)).toEqual([
      expect.objectContaining({ name: "source.txt" }),
    ]);

    const extracted = await handler.execute(
      { input: "--extract bundle.zip --to restored" },
      context,
    );
    expect(extracted).toMatchObject({
      success: true,
      result: { fileCount: 1 },
    });
    expect(
      fs.readFileSync(path.join(root, "restored", "source.txt"), "utf8"),
    ).toBe("bounded archive");
  });

  it("creates and restores backups without archive-library path I/O", async () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, "data"));
    fs.writeFileSync(path.join(root, "data", "state.json"), '{"ok":true}');
    const handler = handlerFor("backup-manager");
    const context = { projectRoot: root };

    const created = await handler.execute(
      { input: "--create --name bounded --items db" },
      context,
    );
    expect(created).toMatchObject({
      success: true,
      result: { fileCount: 1, items: ["db"] },
    });
    fs.rmSync(path.join(root, "data"), { recursive: true });

    const restored = await handler.execute(
      { input: `--restore ${created.result.file}` },
      context,
    );
    expect(restored, JSON.stringify(restored)).toMatchObject({
      success: true,
      result: { fileCount: 1 },
    });
    expect(fs.readFileSync(path.join(root, "data", "state.json"), "utf8")).toBe(
      '{"ok":true}',
    );
  });

  it("rejects absolute, traversal, empty, and oversized archive entry names", () => {
    expect(() => normalizeArchiveEntryName("../escape.txt")).toThrow(
      /escapes the approved extraction root/i,
    );
    expect(() => normalizeArchiveEntryName("nested/../../escape.txt")).toThrow(
      /escapes the approved extraction root/i,
    );
    expect(() => normalizeArchiveEntryName("/absolute.txt")).toThrow(
      /escapes the approved extraction root/i,
    );
    expect(() => normalizeArchiveEntryName("C:\\absolute.txt")).toThrow(
      /escapes the approved extraction root/i,
    );
    expect(() => normalizeArchiveEntryName("./file.txt")).toThrow(
      /escapes the approved extraction root/i,
    );
    expect(() => normalizeArchiveEntryName("x".repeat(16 * 1024 + 1))).toThrow(
      /entry name is invalid/i,
    );
  });

  it("keeps archive handlers free of implicit filesystem APIs", () => {
    for (const skillId of ["backup-manager", "file-compressor"]) {
      const source = fs.readFileSync(
        path.join(__dirname, "..", "builtin", skillId, "handler.js"),
        "utf8",
      );
      expect(source).not.toMatch(/require\(["'](?:node:)?fs["']\)/);
      expect(source).not.toMatch(
        /createWriteStream|addLocalFile|\.file\(|writeZip|extractAllTo|new AdmZip\([^)]*(?:Path|path)/,
      );
      expect(source).toContain("bundled-skill-archive-codec.js");
      expect(source).toContain("withBundledSkillFilesystem");
    }
  });
});
