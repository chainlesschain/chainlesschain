import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { deriveLegacyWindowsTarTree } from "../scripts/verify01-legacy-windows-tar.mjs";
import { assessFrozenBefore } from "../scripts/verify01-native-task-checker.mjs";
import {
  archiveExtractor,
  snapshotNativeTree,
} from "../scripts/verify01-native-task-campaign.mjs";

function withoutModes(tree) {
  return Object.fromEntries(
    Object.entries(tree).map(([name, value]) => {
      const { mode, ...rest } = value;
      return [name, rest];
    }),
  );
}
test(
  "real Windows bsdtar reproduces header CP437 and UTF-8 PAX with distinct parents",
  { skip: process.platform !== "win32" },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-legacy-tar-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, "source"),
      canonicalDir = path.join(root, "canonical"),
      legacyDir = path.join(root, "legacy"),
      archive = path.join(root, "fixture.tar");
    for (const directory of [source, canonicalDir, legacyDir])
      fs.mkdirSync(directory);
    const names = [
      "plain.txt",
      "后端.txt",
      "文档/café-结果.md",
      `文档/${"长文件名".repeat(10)}.txt`,
    ];
    for (const name of names) {
      fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
      fs.writeFileSync(path.join(source, name), `frozen ${name}\n`);
    }
    const git = (...args) =>
      execFileSync(
        "git",
        ["-C", source, "-c", "core.autocrlf=false", ...args],
        { encoding: "utf8" },
      ).trim();
    git("init", "--quiet");
    git("add", ".");
    git("archive", "--format=tar", "--output", archive, git("write-tree"));
    for (const [charset, destination] of [
      ["UTF-8", canonicalDir],
      ["CP437", legacyDir],
    ]) {
      execFileSync(archiveExtractor(), [
        "--options",
        `hdrcharset=${charset}`,
        "-xf",
        archive,
        "-C",
        destination,
      ]);
    }
    const bytes = fs.readFileSync(archive),
      canonical = snapshotNativeTree(canonicalDir);
    const result = deriveLegacyWindowsTarTree(bytes, canonical);
    assert.deepEqual(
      withoutModes(result.snapshot),
      withoutModes(snapshotNativeTree(legacyDir)),
    );
    assert.ok(result.snapshot["文档"]);
    assert.ok(
      result.receipt.mapping.some(
        (m) =>
          m.encoding === "pax-utf8" &&
          m.canonicalPath === names[3] &&
          m.observedPath === names[3],
      ),
    );
    assert.ok(
      result.receipt.mapping.some(
        (m) => m.canonicalPath === names[1] && m.observedPath !== names[1],
      ),
    );
    assert.equal(result.receipt.generationPassed, false);
    assert.equal(result.receipt.candidateOnly, true);
    const assessment = assessFrozenBefore(
      canonical,
      snapshotNativeTree(legacyDir),
      "win32",
      { archiveBytes: bytes, canonicalSnapshot: canonical, expectedFiles: [] },
    );
    assert.equal(assessment.exact, false);
    assert.equal(assessment.contentVerified, true);
    assert.equal(assessment.nativeGenerationIdentityPassed, false);
    const damaged = snapshotNativeTree(legacyDir);
    damaged["plain.txt"].digest = "sha256:modified";
    assert.throws(
      () =>
        assessFrozenBefore(canonical, damaged, "win32", {
          archiveBytes: bytes,
          canonicalSnapshot: canonical,
          expectedFiles: [],
        }),
      /initial bytes differ/,
    );
    for (const name of ["plain.txt", "new/结果.md"]) {
      fs.mkdirSync(path.dirname(path.join(legacyDir, name)), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(legacyDir, name),
        name.endsWith(".md")
          ? "<!-- Non-answer placeholder. -->\n"
          : "// Non-answer placeholder.\n",
      );
    }
    const placeholders = deriveLegacyWindowsTarTree(bytes, canonical, [
      "plain.txt",
      "new/结果.md",
    ]);
    assert.deepEqual(
      withoutModes(placeholders.snapshot),
      withoutModes(snapshotNativeTree(legacyDir)),
    );
    const altered = structuredClone(canonical);
    altered["plain.txt"].digest = "sha256:tampered";
    assert.throws(
      () => deriveLegacyWindowsTarTree(bytes, altered),
      /digest mismatch/,
    );
    assert.throws(
      () =>
        deriveLegacyWindowsTarTree(bytes, {
          ...canonical,
          extra: { type: "directory" },
        }),
      /tree mismatch/,
    );
    const missing = { ...canonical };
    delete missing["plain.txt"];
    assert.throws(
      () => deriveLegacyWindowsTarTree(bytes, missing),
      /tree mismatch/,
    );
    assert.throws(
      () => deriveLegacyWindowsTarTree(bytes, canonical, ["../escape"]),
      /unsafe/,
    );
    assert.throws(
      () => deriveLegacyWindowsTarTree(bytes, canonical, ["文档"]),
      /type conflict/,
    );
    const corrupted = Buffer.from(bytes);
    corrupted[0] ^= 1;
    assert.throws(
      () => deriveLegacyWindowsTarTree(corrupted, canonical),
      /checksum/,
    );
    // Links are intentionally unsupported even if the canonical tree supplies one.
    const linked = Buffer.from(bytes);
    linked[156] = "2".charCodeAt(0);
    linked.fill(32, 148, 156);
    const sum = [...linked.subarray(0, 512)].reduce((a, b) => a + b, 0);
    linked.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
    assert.throws(
      () => deriveLegacyWindowsTarTree(linked, canonical),
      /unsupported tar entry/,
    );
  },
);
