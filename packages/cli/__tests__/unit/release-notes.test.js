/**
 * `/release-notes` renderer — version + changelog pointers. Pure.
 */
import { describe, it, expect } from "vitest";
import {
  formatReleaseNotes,
  CHANGELOG_URL,
  RELEASES_URL,
} from "../../src/repl/release-notes.js";

describe("formatReleaseNotes", () => {
  it("shows the version and links to the canonical changelog sources", () => {
    const out = formatReleaseNotes({ version: "0.162.130" });
    expect(out).toMatch(/cc 0\.162\.130/);
    expect(out).toContain(CHANGELOG_URL);
    expect(out).toContain(RELEASES_URL);
    expect(out).toMatch(/cc update/);
    expect(out).toMatch(/npm i -g chainlesschain/);
  });

  it("notes a disk-newer install (restart to apply)", () => {
    const out = formatReleaseNotes({
      version: "0.162.130",
      installedVersion: "0.162.131",
    });
    expect(out).toMatch(/disk 0\.162\.131 — restart to apply/);
  });

  it("does not show the disk line when versions match", () => {
    const out = formatReleaseNotes({
      version: "0.162.130",
      installedVersion: "0.162.130",
    });
    expect(out).not.toMatch(/restart to apply/);
  });

  it("degrades gracefully with no info", () => {
    expect(formatReleaseNotes()).toMatch(/cc \?/);
  });
});
