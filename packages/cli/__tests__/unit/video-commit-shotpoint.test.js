/**
 * video-commit-shotpoint.test.js — the shot-point log is a read-modify-write
 * persistence path; a swallowed read error must NOT silently discard prior
 * committed clips. Uses real temp files (no fs mock) so the on-disk behaviour
 * is exercised end-to-end.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp, mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";

import { execute } from "../../src/skills/video-editing/tools/commit.js";

describe("video_commit_clip — shotPointPath log persistence", () => {
  let dir;
  let shotPointPath;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "cc-vid-commit-"));
    shotPointPath = path.join(dir, "shot-points.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const commitOne = () =>
    execute(
      { section_idx: 0, shot_idx: 0, clips: [{ start: 0, end: 5 }] },
      { committedClips: [], shotPointPath },
    );

  test("first commit creates the log (missing file is the normal case)", async () => {
    const result = await commitOne();
    expect(result.status).toBe("success");
    const log = JSON.parse(await fsp.readFile(shotPointPath, "utf-8"));
    expect(log).toHaveLength(1);
  });

  test("appends to an existing log, preserving prior entries", async () => {
    await fsp.writeFile(
      shotPointPath,
      JSON.stringify([{ section_idx: 9, shot_idx: 9 }], null, 2),
    );
    await commitOne();
    const log = JSON.parse(await fsp.readFile(shotPointPath, "utf-8"));
    expect(log).toHaveLength(2);
    expect(log[0].section_idx).toBe(9); // prior entry survived
  });

  test("refuses to overwrite a corrupt existing log (no silent data loss)", async () => {
    await fsp.writeFile(shotPointPath, "{ this is not valid json");
    await expect(commitOne()).rejects.toThrow(/Refusing to overwrite/);
    // The unreadable file must be left untouched, not clobbered with one entry.
    expect(await fsp.readFile(shotPointPath, "utf-8")).toBe(
      "{ this is not valid json",
    );
  });

  test("refuses to overwrite a log that is valid JSON but not an array", async () => {
    await fsp.writeFile(shotPointPath, JSON.stringify({ not: "an array" }));
    await expect(commitOne()).rejects.toThrow(/Refusing to overwrite/);
  });
});
