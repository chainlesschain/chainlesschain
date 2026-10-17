import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const utf8 = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const cp437 = (bytes) =>
  [...bytes]
    .map((b) => (b < 128 ? String.fromCharCode(b) : HIGH[b - 128]))
    .join("");
const field = (header, start, length) => {
  const value = header.subarray(start, start + length);
  const end = value.indexOf(0);
  return end < 0 ? value : value.subarray(0, end);
};
function safe(name) {
  name = name.replace(/\/$/, "");
  assert.ok(
    name && !name.includes("\\") && !name.includes(":"),
    "unsafe archive path",
  );
  assert.ok(
    name.split("/").every((p) => p && p !== "." && p !== ".."),
    "unsafe archive path",
  );
  return name;
}
function octal(bytes) {
  const value = bytes.toString("ascii").replace(/\0/g, "").trim();
  assert.match(value, /^[0-7]+$/);
  const result = parseInt(value, 8);
  assert.ok(Number.isSafeInteger(result));
  return result;
}
function pax(bytes) {
  const result = {};
  for (let offset = 0; offset < bytes.length; ) {
    const space = bytes.indexOf(32, offset);
    assert.ok(space > offset, "invalid PAX length");
    const lengthText = bytes.subarray(offset, space).toString("ascii");
    assert.match(lengthText, /^[1-9][0-9]*$/);
    const length = Number(lengthText),
      end = offset + length;
    assert.ok(
      Number.isSafeInteger(length) &&
        end <= bytes.length &&
        end > space + 2 &&
        bytes[end - 1] === 10,
      "invalid PAX record",
    );
    const record = utf8(bytes.subarray(space + 1, end - 1)),
      equals = record.indexOf("=");
    assert.ok(equals > 0);
    const key = record.slice(0, equals);
    assert.ok(!Object.hasOwn(result, key), "duplicate PAX key");
    assert.ok(
      ["path", "comment", "mtime", "atime", "ctime"].includes(key),
      `unsupported PAX key ${key}`,
    );
    result[key] = record.slice(equals + 1);
    offset = end;
  }
  return result;
}

/** Diagnostic reconstruction only. canonicalSnapshot must describe the pristine
 * UTF-8 archive tree, before task placeholders; file modes remain informational.
 * Never upgrades generation identity or accepts a caller-provided observed tree.
 */
export function deriveLegacyWindowsTarTree(
  archiveBytes,
  canonicalSnapshot,
  expectedFiles = [],
) {
  assert.ok(Buffer.isBuffer(archiveBytes) && archiveBytes.length % 512 === 0);
  const snapshot = Object.create(null),
    canonical = Object.create(null),
    mapping = [];
  const explicit = new Set(),
    seen = new Set(),
    windowsNames = new Map();
  let pending = null,
    ended = false;
  function add(name, value, isExplicit = false) {
    name = safe(name);
    if (!isExplicit && snapshot[name]?.type === "directory") return;
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++)
      add(parts.slice(0, i).join("/"), { type: "directory" });
    const folded = name.toLowerCase();
    assert.ok(
      !windowsNames.has(folded) || windowsNames.get(folded) === name,
      "Windows path collision",
    );
    windowsNames.set(folded, name);
    if (snapshot[name])
      assert.ok(
        snapshot[name].type === "directory" &&
          value.type === "directory" &&
          !(isExplicit && explicit.has(name)),
        "archive path collision",
      );
    snapshot[name] = value;
    if (isExplicit) explicit.add(name);
  }
  for (let offset = 0; offset < archiveBytes.length; ) {
    const h = archiveBytes.subarray(offset, offset + 512);
    if (h.every((b) => b === 0)) {
      assert.ok(
        archiveBytes.subarray(offset).every((b) => b === 0),
        "nonzero archive trailer",
      );
      ended = true;
      break;
    }
    assert.equal(
      field(h, 257, 6).toString("ascii"),
      "ustar",
      "unsupported tar format",
    );
    const checksum = [...h].reduce(
      (sum, b, i) => sum + (i >= 148 && i < 156 ? 32 : b),
      0,
    );
    assert.equal(
      octal(h.subarray(148, 156)),
      checksum,
      "tar checksum mismatch",
    );
    const size = octal(h.subarray(124, 136)),
      end = offset + 512 + size;
    assert.ok(end <= archiveBytes.length, "truncated archive");
    const data = archiveBytes.subarray(offset + 512, end),
      type = String.fromCharCode(h[156]);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x" || type === "g") {
      const metadata = pax(data);
      if (type === "g")
        assert.ok(!metadata.path && !pending, "unsupported global PAX path");
      else {
        assert.equal(pending, null, "stacked PAX headers");
        pending = metadata;
      }
      continue;
    }
    assert.ok(
      type === "0" || type === "\0" || type === "5",
      `unsupported tar entry ${type}`,
    );
    const prefix = field(h, 345, 155),
      name = field(h, 0, 100);
    const raw = prefix.length
      ? Buffer.concat([prefix, Buffer.from("/"), name])
      : name;
    const canonicalPath = safe(pending?.path ?? utf8(raw));
    const observedPath = safe(pending?.path ?? cp437(raw));
    const encoding = pending?.path ? "pax-utf8" : "header-cp437";
    pending = null;
    assert.ok(!seen.has(canonicalPath), "duplicate canonical archive entry");
    seen.add(canonicalPath);
    const value =
      type === "5"
        ? { type: "directory" }
        : {
            type: "file",
            bytes: data.length,
            digest: digest(data),
            mode: octal(h.subarray(100, 108)) & 0o777,
          };
    if (type === "5") assert.equal(size, 0);
    canonical[canonicalPath] = value;
    add(observedPath, value, true);
    mapping.push({ canonicalPath, observedPath, encoding });
  }
  assert.ok(ended && !pending, "incomplete archive");
  assert.deepEqual(
    Object.keys(canonical).sort(),
    Object.keys(canonicalSnapshot).sort(),
    "canonical archive tree mismatch",
  );
  for (const [name, value] of Object.entries(canonical)) {
    const expected = canonicalSnapshot[name];
    assert.equal(value.type, expected.type, `canonical type mismatch: ${name}`);
    if (value.type === "file") {
      assert.equal(
        value.bytes,
        expected.bytes,
        `canonical size mismatch: ${name}`,
      );
      assert.equal(
        value.digest,
        expected.digest,
        `canonical digest mismatch: ${name}`,
      );
    }
  }
  assert.equal(
    new Set(expectedFiles).size,
    expectedFiles.length,
    "duplicate placeholder path",
  );
  for (const name of expectedFiles) {
    assert.equal(safe(name), name);
    assert.ok(
      !snapshot[name] || snapshot[name].type === "file",
      "placeholder type conflict",
    );
    const bytes = Buffer.from(
      name.endsWith(".md")
        ? "<!-- Non-answer placeholder. -->\n"
        : "// Non-answer placeholder.\n",
    );
    if (snapshot[name]) {
      delete snapshot[name];
      explicit.delete(name);
    }
    add(
      name,
      { type: "file", bytes: bytes.length, digest: digest(bytes), mode: 0o666 },
      true,
    );
  }
  return {
    snapshot,
    receipt: {
      schema: "chainlesschain.legacy-windows-tar/v1",
      archiveDigest: digest(archiveBytes),
      encoding: "header-cp437/pax-utf8",
      mapping,
      expectedFiles: [...expectedFiles],
      generationPassed: false,
      candidateOnly: true,
    },
  };
}
