import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export const sha256 = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
export const integrity = (bytes) => "sha512-" + createHash("sha512").update(bytes).digest("base64");
export function tarBytes(entries, { trailer = Buffer.alloc(1024) } = {}) {
  const parts = [];
  for (const { name, bytes = Buffer.alloc(0), type = "0", mutateHeader } of entries) {
    const body = Buffer.from(bytes), header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    header.write("0000644\0", 100, 8);
    header.write("0000000\0", 108, 8);
    header.write("0000000\0", 116, 8);
    header.write(body.length.toString(8).padStart(11, "0") + "\0", 124, 12);
    header.write("00000000000\0", 136, 12);
    header.fill(32, 148, 156);
    header.write(type, 156, 1);
    header.write("ustar\0", 257, 6);
    header.write("00", 263, 2);
    mutateHeader?.(header);
    const sum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    parts.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  return Buffer.concat([...parts, trailer]);
}
export function paxRecord(key, value) {
  const suffix = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(suffix) + 1;
  for (;;) {
    const record = `${length}${suffix}`;
    const actual = Buffer.byteLength(record);
    if (actual === length) return Buffer.from(record);
    length = actual;
  }
}
export function fixture(entries = [], options) {
  const metadata = Buffer.from(JSON.stringify({ name: "sample", version: "1.0.0" }));
  const all = [{ name: "package/package.json", bytes: metadata }, ...entries];
  const tarball = gzipSync(tarBytes(all, options));
  return {
    tarball, integrity: integrity(tarball), packageName: "sample", packageVersion: "1.0.0",
    installedFiles: all.filter((entry) => entry.type === undefined || entry.type === "0").map((entry) => {
      const bytes = Buffer.from(entry.bytes);
      return { path: entry.name.slice(8), bytes: bytes.length, digest: sha256(bytes) };
    }),
  };
}
