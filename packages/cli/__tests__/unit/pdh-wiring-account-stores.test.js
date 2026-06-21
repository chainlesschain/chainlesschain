import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadEmailAccounts,
  loadAlipayAccounts,
  loadWechatAccounts,
  _atomicWriteJson600,
} from "../../src/lib/personal-data-hub-wiring.js";

// The PDH account stores hold login credentials (cookies/tokens). The loaders
// MUST fail closed to [] (never throw) so a corrupt/partial file can't crash hub
// boot, and a round-trip through the atomic writer must preserve the data.
describe("personal-data-hub-wiring account stores", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-pdhw-acct-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const loaders = [
    ["email", loadEmailAccounts],
    ["alipay", loadAlipayAccounts],
    ["wechat", loadWechatAccounts],
  ];

  for (const [name, load] of loaders) {
    describe(`${name} loader`, () => {
      it("returns [] when the file does not exist", () => {
        expect(load(join(dir, `${name}-missing.json`))).toEqual([]);
      });

      it("returns [] (does not throw) on corrupt JSON", () => {
        const file = join(dir, `${name}-corrupt.json`);
        writeFileSync(file, "{ this is not json", "utf-8");
        expect(() => load(file)).not.toThrow();
        expect(load(file)).toEqual([]);
      });

      it("returns [] when the parsed JSON is not an array", () => {
        const file = join(dir, `${name}-object.json`);
        writeFileSync(file, JSON.stringify({ account: "x" }), "utf-8");
        expect(load(file)).toEqual([]);
      });

      it("round-trips an array written via the atomic writer", () => {
        const file = join(dir, `${name}-accounts.json`);
        const accounts = [
          { account: { id: `${name}-1` }, token: "secret" },
          { account: { id: `${name}-2` } },
        ];
        _atomicWriteJson600(file, accounts);
        expect(load(file)).toEqual(accounts);
        // atomic writer leaves no .tmp sibling behind
        expect(readdirSync(dir).some((n) => n.endsWith(".tmp"))).toBe(false);
        // on-disk content is the canonical JSON we asked for
        expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual(accounts);
      });
    });
  }
});
