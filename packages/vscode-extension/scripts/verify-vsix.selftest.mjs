/**
 * Hermetic selftest for scripts/verify-vsix.mjs.
 *
 * Builds a synthetic .vsix (ZIP) fully in memory with a ~40-line zip writer
 * (stored + deflated entries, real CRC-32), round-trips it through the
 * verifier's central-directory reader, then exercises the pure assertion
 * core on both a passing package and a battery of corrupted ones.
 *
 * Run:  node scripts/verify-vsix.selftest.mjs   (exits 1 on any failure)
 *
 * Note: vscode-extension pure-core tests normally live in
 * packages/cli/__tests__/unit/vscode-ext-*.test.js (vitest); this selftest is
 * self-contained inside the package so the CI "Verify .vsix metadata" step
 * can run it with zero install.
 */
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import {
  listZipEntries,
  parseVsixManifest,
  readZipEntry,
  verifyVsixMetadata,
} from "./verify-vsix.mjs";

// ---------------------------------------------------------------------------
// Minimal ZIP writer (test fixture builder)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {Array<{name: string, data: Buffer|string, deflate?: boolean}>} files
 * @returns {Buffer} a valid single-disk ZIP archive
 */
function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const data = Buffer.isBuffer(file.data)
      ? file.data
      : Buffer.from(file.data, "utf8");
    const method = file.deflate ? 8 : 0;
    const payload = file.deflate ? deflateRawSync(data) : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    localParts.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += 30 + nameBuf.length + payload.length;
  }
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBuf, eocd]);
}

// ---------------------------------------------------------------------------
// Fixtures mirroring what vsce actually packs (entry names verified against a
// real chainlesschain-ide .vsix)
// ---------------------------------------------------------------------------

const EXPECTED = {
  publisher: "chainlesschain",
  name: "chainlesschain-ide",
  version: "9.9.9",
  requireLicense: true,
};

const GOOD_PACKAGE = {
  name: "chainlesschain-ide",
  displayName: "ChainlessChain IDE Bridge",
  description: "Bridges the cc agent CLI to VS Code.",
  version: "9.9.9",
  publisher: "chainlesschain",
  icon: "media/logo.png",
  main: "./src/extension.js",
  engines: { vscode: "^1.85.0" },
  repository: {
    type: "git",
    url: "https://github.com/chainlesschain/chainlesschain.git",
  },
};

const GOOD_MANIFEST_XML = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="chainlesschain-ide" Version="9.9.9" Publisher="chainlesschain" />
    <DisplayName>ChainlessChain IDE Bridge</DisplayName>
    <Description xml:space="preserve">Bridges the cc agent CLI to VS Code.</Description>
  </Metadata>
</PackageManifest>`;

function goodFiles({
  packageJson = GOOD_PACKAGE,
  manifestXml = GOOD_MANIFEST_XML,
} = {}) {
  return [
    { name: "extension.vsixmanifest", data: manifestXml, deflate: true },
    { name: "[Content_Types].xml", data: "<Types/>" },
    {
      name: "extension/package.json",
      data: JSON.stringify(packageJson),
      deflate: true,
    },
    { name: "extension/readme.md", data: "# readme 中文内容", deflate: true },
    { name: "extension/LICENSE.txt", data: "MIT" },
    { name: "extension/changelog.md", data: "# changelog" },
    {
      name: "extension/media/logo.png",
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    },
    {
      name: "extension/src/extension.js",
      data: "module.exports = {};",
      deflate: true,
    },
  ];
}

function runVerifier(zipBuf, expected = EXPECTED) {
  const entries = listZipEntries(zipBuf);
  const read = (name) =>
    readZipEntry(zipBuf, entries.get(name)).toString("utf8");
  return verifyVsixMetadata({
    entryNames: [...entries.keys()],
    packaged: JSON.parse(read("extension/package.json")),
    manifest: parseVsixManifest(read("extension.vsixmanifest")),
    expected,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let testCount = 0;
function test(label, fn) {
  testCount++;
  fn();
  console.log(`  PASS ${label}`);
}

test("zip round-trip: names, stored + deflated bytes, utf-8 content", () => {
  const zip = buildZip(goodFiles());
  const entries = listZipEntries(zip);
  assert.equal(entries.size, 8);
  assert.ok(entries.has("extension/package.json"));
  const readme = readZipEntry(zip, entries.get("extension/readme.md"));
  assert.equal(readme.toString("utf8"), "# readme 中文内容");
  const png = readZipEntry(zip, entries.get("extension/media/logo.png"));
  assert.deepEqual([...png], [0x89, 0x50, 0x4e, 0x47]);
});

test("non-zip buffer rejected", () => {
  assert.throws(
    () => listZipEntries(Buffer.from("definitely not a zip archive at all")),
    /not a ZIP archive/,
  );
});

test("parseVsixManifest extracts identity + display fields", () => {
  const m = parseVsixManifest(GOOD_MANIFEST_XML);
  assert.deepEqual(m, {
    id: "chainlesschain-ide",
    version: "9.9.9",
    publisher: "chainlesschain",
    displayName: "ChainlessChain IDE Bridge",
    description: "Bridges the cc agent CLI to VS Code.",
  });
});

test("well-formed vsix passes every check", () => {
  const { passes, failures } = runVerifier(buildZip(goodFiles()));
  assert.deepEqual(failures, []);
  assert.ok(
    passes.length >= 15,
    `expected >=15 pass lines, got ${passes.length}`,
  );
});

test("version drift between vsix and repo package.json fails", () => {
  const pkg = { ...GOOD_PACKAGE, version: "9.9.8" };
  const xml = GOOD_MANIFEST_XML.replaceAll(
    'Version="9.9.9"',
    'Version="9.9.8"',
  );
  const { failures } = runVerifier(
    buildZip(goodFiles({ packageJson: pkg, manifestXml: xml })),
  );
  assert.equal(failures.length, 2); // package.json version + Identity Version
  assert.match(failures[0], /version/);
});

test("wrong publisher fails both package.json and Identity checks", () => {
  const pkg = { ...GOOD_PACKAGE, publisher: "evil-corp" };
  const { failures } = runVerifier(buildZip(goodFiles({ packageJson: pkg })));
  assert.ok(failures.some((f) => f.startsWith("package.json publisher")));
});

test("declared icon missing from archive fails", () => {
  const files = goodFiles().filter(
    (f) => f.name !== "extension/media/logo.png",
  );
  const { failures } = runVerifier(buildZip(files));
  assert.ok(failures.some((f) => f.includes("icon packed")));
});

test("missing README / LICENSE / main entry each fail", () => {
  const files = goodFiles().filter(
    (f) =>
      ![
        "extension/readme.md",
        "extension/LICENSE.txt",
        "extension/src/extension.js",
      ].includes(f.name),
  );
  const { failures } = runVerifier(buildZip(files));
  assert.ok(failures.some((f) => f.includes("README packed")));
  assert.ok(failures.some((f) => f.includes("LICENSE packed")));
  assert.ok(failures.some((f) => f.includes("main entry packed")));
});

test("empty description + missing engines.vscode fail", () => {
  const pkg = { ...GOOD_PACKAGE, description: "  ", engines: {} };
  const { failures } = runVerifier(buildZip(goodFiles({ packageJson: pkg })));
  assert.ok(failures.some((f) => f.includes("description non-empty")));
  assert.ok(failures.some((f) => f.includes("engines.vscode")));
});

test("vsixmanifest identity drift from package.json fails", () => {
  const xml = GOOD_MANIFEST_XML.replace(
    'Id="chainlesschain-ide"',
    'Id="other-ext"',
  );
  const { failures } = runVerifier(buildZip(goodFiles({ manifestXml: xml })));
  assert.ok(failures.some((f) => f.startsWith("vsixmanifest Identity Id")));
});

console.log(`verify-vsix selftest: all ${testCount} tests passed`);
