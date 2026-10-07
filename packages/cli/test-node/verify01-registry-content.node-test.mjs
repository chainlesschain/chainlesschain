import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { verifyRegistryPackageContent as verify } from "../scripts/verify01-registry-content.mjs";
import { fixture, integrity, sha256, tarBytes, paxRecord } from "./helpers/verify01-registry-tar.mjs";

test("verified tarball matches every installed file without extraction", () => {
  const result = verify(fixture([{ name: "package/main.js", bytes: "throw Error('never execute')" }]));
  assert.equal(result.registryContentVerified, true);
  assert.equal(result.fileCount, 2);
});
test("rejects changed compressed bytes before decompression", () => {
  const options = fixture();
  options.tarball[9] ^= 1;
  assert.throws(() => verify(options), /integrity differs/);
});
test("requires canonical frozen-lock sha512 integrity", () => {
  for (const value of ["sha256:" + "a".repeat(64), "sha512-AA==", "", undefined])
    assert.throws(() => verify({ ...fixture(), integrity: value }), /canonical locked sha512/);
});
test("matching compressed integrity cannot conceal modified installed files", () => {
  const options = fixture();
  options.installedFiles[0].digest = sha256(Buffer.from("modified"));
  assert.throws(() => verify(options), /installed file.*differs/);
});
test("missing and extra installed files are both rejected", () => {
  const options = fixture([{ name: "package/main.js", bytes: "x" }]);
  assert.throws(() => verify({ ...options, installedFiles: options.installedFiles.slice(0, 1) }), /installed file is missing/);
  options.installedFiles.push({ path: "injected.js", bytes: 1, digest: sha256(Buffer.from("x")) });
  assert.throws(() => verify(options), /additional files/);
});
test("package metadata must match locked name and version", () => {
  assert.throws(() => verify({ ...fixture(), packageName: "other" }), /identity differs/);
  assert.throws(() => verify({ ...fixture(), packageVersion: "9.0.0" }), /identity differs/);
});
for (const type of ["1", "2", "3", "4", "6", "g", "L"]) {
  test(`rejects link, special file, or extension ${type}`, () => {
    assert.throws(() => verify(fixture([{ name: "package/unsafe", type }])), /links, special files/);
  });
}
for (const name of ["package/../escape", "package/./alias", "package/a\\b", "package/NUL.txt", "package/trailing.", "outside/file"]) {
  test(`rejects unsafe path ${name}`, () => {
    const options = fixture([{ name, bytes: "x" }]);
    options.installedFiles = options.installedFiles.slice(0, 1);
    assert.throws(() => verify(options), /unsafe package path|outside package root/);
  });
}
test("rejects duplicate and case-alias archive paths", () => {
  const options = fixture([{ name: "package/a.js", bytes: "x" }, { name: "package/A.js", bytes: "x" }]);
  options.installedFiles.pop();
  assert.throws(() => verify(options), /duplicate or case-alias archive/);
});
test("installed snapshot independently rejects duplicate paths", () => {
  const options = fixture();
  options.installedFiles.push({ ...options.installedFiles[0] });
  assert.throws(() => verify(options), /snapshot duplicates/);
});
test("PAX long UTF-8 paths are compared without extracting them", () => {
  const long = "package/" + "a".repeat(140) + "-中文.js";
  const options = fixture([{ name: "PaxHeader", type: "x", bytes: paxRecord("path", long) }, { name: "package/placeholder.js", bytes: "x" }]);
  options.installedFiles[1].path = long.slice(8);
  assert.equal(verify(options).fileCount, 2);
});
test("PAX cannot introduce path traversal", () => {
  const options = fixture([{ name: "PaxHeader", type: "x", bytes: paxRecord("path", "package/../outside") }, { name: "package/placeholder.js", bytes: "x" }]);
  assert.throws(() => verify(options), /unsafe package path/);
});
test("malformed PAX lengths and unsupported fields fail", () => {
  for (const bytes of [Buffer.from("999 path=package/a\n"), paxRecord("linkpath", "target")])
    assert.throws(() => verify(fixture([{ name: "PaxHeader", type: "x", bytes }, { name: "package/x", bytes: "x" }])), /PAX/);
});
test("checks tar header checksum even after compressed integrity matches", () => {
  const raw = tarBytes([{ name: "package/package.json", bytes: "{}" }]);
  raw[99] ^= 1;
  const tarball = gzipSync(raw);
  assert.throws(() => verify({ ...fixture(), tarball, integrity: integrity(tarball) }), /header checksum/);
});
test("requires complete end markers and rejects trailing nonzero data", () => {
  for (const trailer of [Buffer.alloc(512), Buffer.from("trailing")])
    assert.throws(() => verify(fixture([], { trailer })), /end markers|incomplete/);
});
test("matching integrity does not permit invalid gzip", () => {
  const tarball = Buffer.from("not-gzip");
  assert.throws(() => verify({ ...fixture(), tarball, integrity: integrity(tarball) }), /invalid or oversized gzip/);
});
test("rejects oversized compressed input before hashing", () => {
  assert.throws(() => verify({ ...fixture(), tarball: Buffer.alloc(32 * 1024 * 1024 + 1) }), /compressed artifact exceeds bound/);
});
