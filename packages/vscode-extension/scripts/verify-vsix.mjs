/**
 * CI parse gate for the packaged .vsix / marketplace metadata.
 *
 * A .vsix is a plain ZIP archive. This script opens it with a minimal,
 * dependency-free central-directory reader (node:zlib inflateRawSync for
 * deflated entries), extracts `extension/package.json` +
 * `extension.vsixmanifest`, and asserts the marketplace-facing metadata is
 * coherent BEFORE the artifact is uploaded or published:
 *
 *   - publisher / name / version match packages/vscode-extension/package.json
 *   - engines.vscode + repository declared
 *   - displayName / description non-empty
 *   - icon referenced by package.json actually exists inside the vsix
 *   - README + LICENSE packed (vsce packs extension/readme.md +
 *     extension/LICENSE.txt), [Content_Types].xml present
 *   - `main` entry file exists inside the vsix
 *   - extension.vsixmanifest Identity Id/Version/Publisher agree with
 *     package.json, DisplayName/Description non-empty
 *
 * Usage:  node scripts/verify-vsix.mjs <path-to.vsix>
 * Prints a PASS checklist; exits 1 with ::error:: lines on any failure.
 *
 * The pure helpers are exported so scripts/verify-vsix.selftest.mjs can
 * exercise them against a synthetic in-memory zip.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** Locate the End-Of-Central-Directory record (scan back past any comment). */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Parse the ZIP central directory.
 * @param {Buffer} buf whole archive
 * @returns {Map<string, {method:number, compressedSize:number, localOffset:number}>}
 */
export function listZipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) {
    throw new Error("not a ZIP archive (end-of-central-directory not found)");
  }
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    throw new Error("ZIP64 archive — not supported by this verifier");
  }
  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new Error(`bad central-directory signature at entry ${i}`);
    }
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Read + decompress one entry (sizes come from the central directory, so
 * streaming local headers with zeroed sizes are handled too).
 * @returns {Buffer}
 */
export function readZipEntry(buf, entry) {
  const p = entry.localOffset;
  if (buf.readUInt32LE(p) !== LOCAL_SIG) {
    throw new Error("bad local-file-header signature");
  }
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`unsupported compression method ${entry.method}`);
}

/**
 * Pull Identity/DisplayName/Description out of extension.vsixmanifest
 * (tiny known-shape XML — regex, no XML dependency).
 */
export function parseVsixManifest(xml) {
  const identityTag = (xml.match(/<Identity\b[^>]*\/?>/) || [""])[0];
  const attr = (name) => {
    const m = identityTag.match(new RegExp(`\\b${name}="([^"]*)"`));
    return m ? m[1] : "";
  };
  const text = (tag) => {
    const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : "";
  };
  return {
    id: attr("Id"),
    version: attr("Version"),
    publisher: attr("Publisher"),
    displayName: text("DisplayName"),
    description: text("Description"),
  };
}

/**
 * Pure assertion core (plain data in, verdict out — unit-testable).
 * @param {object} args
 * @param {string[]} args.entryNames all entry names inside the vsix
 * @param {object} args.packaged parsed extension/package.json from the vsix
 * @param {object} args.manifest parseVsixManifest() result
 * @param {object} args.expected { publisher, name, version, requireLicense }
 * @returns {{passes: string[], failures: string[]}}
 */
export function verifyVsixMetadata({
  entryNames,
  packaged,
  manifest,
  expected,
}) {
  const passes = [];
  const failures = [];
  const names = new Set(entryNames);
  const check = (ok, label, detail) => {
    if (ok) passes.push(label);
    else failures.push(detail ? `${label} — ${detail}` : label);
  };
  const eq = (label, actual, want) =>
    check(
      actual === want,
      `${label} = ${JSON.stringify(want)}`,
      `got ${JSON.stringify(actual)}`,
    );
  const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

  // package.json identity vs the repo source of truth
  eq("package.json publisher", packaged.publisher, expected.publisher);
  eq("package.json name", packaged.name, expected.name);
  eq("package.json version", packaged.version, expected.version);
  check(
    nonEmpty(packaged.engines && packaged.engines.vscode),
    "package.json engines.vscode present",
    `got ${JSON.stringify(packaged.engines)}`,
  );
  check(
    nonEmpty(packaged.repository && packaged.repository.url),
    "package.json repository.url present",
    `got ${JSON.stringify(packaged.repository)}`,
  );
  check(
    nonEmpty(packaged.displayName),
    "package.json displayName non-empty",
    `got ${JSON.stringify(packaged.displayName)}`,
  );
  check(
    nonEmpty(packaged.description),
    "package.json description non-empty",
    `got ${JSON.stringify(packaged.description)}`,
  );

  // Declared assets must actually exist inside the archive
  if (nonEmpty(packaged.icon)) {
    const iconEntry = `extension/${packaged.icon.replace(/^\.\//, "")}`;
    check(
      names.has(iconEntry),
      `icon packed (${iconEntry})`,
      "declared in package.json but missing from vsix",
    );
  } else {
    failures.push("package.json icon declared — marketplace listing needs one");
  }
  if (nonEmpty(packaged.main)) {
    const mainEntry = `extension/${packaged.main.replace(/^\.\//, "")}`;
    check(
      names.has(mainEntry),
      `main entry packed (${mainEntry})`,
      "declared in package.json but missing from vsix",
    );
  } else {
    failures.push("package.json main declared");
  }
  check(
    entryNames.some((n) => /^extension\/readme\.(md|txt)$/i.test(n)),
    "README packed (extension/readme.md)",
    "no extension/readme.* entry — marketplace page would be empty",
  );
  if (expected.requireLicense) {
    check(
      entryNames.some((n) => /^extension\/license(\.[a-z]+)?$/i.test(n)),
      "LICENSE packed (extension/LICENSE.txt)",
      "repo ships a LICENSE but vsce did not pack it",
    );
  }
  check(
    names.has("[Content_Types].xml"),
    "[Content_Types].xml present",
    "vsix is missing the OPC content-types part",
  );

  // extension.vsixmanifest identity must agree with package.json
  eq("vsixmanifest Identity Id", manifest.id, expected.name);
  eq("vsixmanifest Identity Version", manifest.version, expected.version);
  eq("vsixmanifest Identity Publisher", manifest.publisher, expected.publisher);
  check(
    nonEmpty(manifest.displayName),
    "vsixmanifest DisplayName non-empty",
    `got ${JSON.stringify(manifest.displayName)}`,
  );
  check(
    nonEmpty(manifest.description),
    "vsixmanifest Description non-empty",
    `got ${JSON.stringify(manifest.description)}`,
  );

  return { passes, failures };
}

function main() {
  const vsixPath = process.argv[2];
  if (!vsixPath) {
    console.error(
      "::error::usage: node scripts/verify-vsix.mjs <path-to.vsix>",
    );
    process.exit(1);
  }
  const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const source = JSON.parse(
    readFileSync(join(extensionRoot, "package.json"), "utf8"),
  );
  const expected = {
    publisher: source.publisher,
    name: source.name,
    version: source.version,
    requireLicense: true, // repo ships packages/vscode-extension/LICENSE
  };

  let entries;
  let entryNames;
  let packaged;
  let manifest;
  let buf;
  try {
    buf = readFileSync(vsixPath);
    entries = listZipEntries(buf);
    entryNames = [...entries.keys()];
    const readText = (name) => {
      const entry = entries.get(name);
      if (!entry) throw new Error(`${name} missing from archive`);
      return readZipEntry(buf, entry).toString("utf8");
    };
    packaged = JSON.parse(readText("extension/package.json"));
    manifest = parseVsixManifest(readText("extension.vsixmanifest"));
  } catch (err) {
    console.error(
      `::error::verify-vsix: cannot parse ${vsixPath} — ${err.message}`,
    );
    process.exit(1);
  }

  const { passes, failures } = verifyVsixMetadata({
    entryNames,
    packaged,
    manifest,
    expected,
  });

  console.log(`verify-vsix: ${vsixPath} (${entryNames.length} entries)`);
  for (const line of passes) console.log(`  PASS ${line}`);
  if (failures.length > 0) {
    for (const line of failures) console.error(`::error::verify-vsix: ${line}`);
    console.error(
      `verify-vsix: ${failures.length} check(s) FAILED, ${passes.length} passed`,
    );
    process.exit(1);
  }
  console.log(`verify-vsix: all ${passes.length} checks passed`);
}

// Run only when executed directly (the selftest imports the helpers instead).
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
