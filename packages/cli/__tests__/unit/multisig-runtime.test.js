import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, dirname, isAbsolute } from "node:path";
import {
  readSecretKey,
  readJsonArg,
  defaultMultisigDbPath,
  defaultMultisigLogPath,
} from "../../src/lib/multisig-runtime.js";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-multisig-rt-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("multisig-runtime — readSecretKey", () => {
  it("throws when no arg is given", () => {
    expect(() => readSecretKey()).toThrow(/--key required/);
    expect(() => readSecretKey("")).toThrow(/--key required/);
  });

  it("parses a hex string directly into a Buffer", () => {
    const buf = readSecretKey("deadbeef");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf).toEqual(Buffer.from("deadbeef", "hex"));
    expect([...buf]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("accepts upper-case hex", () => {
    expect(readSecretKey("DEADBEEF")).toEqual(Buffer.from("deadbeef", "hex"));
  });

  it("treats a bare hex token as hex even if no such file exists", () => {
    // The hex-regex branch runs before any filesystem lookup.
    const buf = readSecretKey("0011223344");
    expect(buf).toEqual(Buffer.from("0011223344", "hex"));
  });

  it("reads hex from a file path and trims surrounding whitespace", () => {
    const f = join(dir, "key.hex");
    writeFileSync(f, "  cafebabe\n", "utf-8");
    expect(readSecretKey(f)).toEqual(Buffer.from("cafebabe", "hex"));
  });

  it("throws when arg is neither hex nor an existing file", () => {
    expect(() => readSecretKey("not-hex-and-no-file.xyz")).toThrow(
      /not hex and not an existing file path/,
    );
  });
});

describe("multisig-runtime — readJsonArg", () => {
  it("parses an inline JSON object string", () => {
    expect(readJsonArg('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
  });

  it("parses an inline JSON array string", () => {
    expect(readJsonArg("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("parses JSON from a file path", () => {
    const f = join(dir, "payload.json");
    writeFileSync(f, JSON.stringify({ hello: "world", n: 42 }), "utf-8");
    expect(readJsonArg(f)).toEqual({ hello: "world", n: 42 });
  });

  it("prefers the file when the arg is an existing path", () => {
    const f = join(dir, "data.json");
    writeFileSync(f, '{"fromFile":true}', "utf-8");
    expect(readJsonArg(f)).toEqual({ fromFile: true });
  });

  it("throws on invalid inline JSON", () => {
    expect(() => readJsonArg("{not json")).toThrow();
  });
});

describe("multisig-runtime — default paths", () => {
  it("names the db file multisig.db", () => {
    expect(basename(defaultMultisigDbPath())).toBe("multisig.db");
  });

  it("names the governance log multisig.governance.log", () => {
    expect(basename(defaultMultisigLogPath())).toBe("multisig.governance.log");
  });

  it("places the db and log in the same directory", () => {
    expect(dirname(defaultMultisigDbPath())).toBe(
      dirname(defaultMultisigLogPath()),
    );
  });

  it("returns absolute paths", () => {
    expect(isAbsolute(defaultMultisigDbPath())).toBe(true);
    expect(isAbsolute(defaultMultisigLogPath())).toBe(true);
  });
});
