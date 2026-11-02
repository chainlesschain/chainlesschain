import { beforeEach, afterEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { patchMacSqlite } from "../../../scripts/patch-macos-sqlite.js";
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sqlite-v8-test-"));
  fs.mkdirSync(path.join(root, "src"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
function fixture(
  name = "better-sqlite3",
  version = "11.10.0",
  source = "v8::Isolate* isolate = context->GetIsolate();\ninfo.GetIsolate();",
) {
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name, version }),
  );
  fs.writeFileSync(path.join(root, "src/better_sqlite3.cpp"), source);
}
describe("SQLite11 Electron V8 initializer compatibility", () => {
  it.each(["better-sqlite3", "better-sqlite3-multiple-ciphers"])(
    "patches only the removed context method in %s",
    (name) => {
      fixture(name);
      expect(patchMacSqlite(root)).toBe(1);
      const result = fs.readFileSync(
        path.join(root, "src/better_sqlite3.cpp"),
        "utf8",
      );
      expect(result).toContain("v8::Isolate::GetCurrent()");
      expect(result).toContain("info.GetIsolate()");
    },
  );
  it("is idempotent", () => {
    fixture();
    patchMacSqlite(root);
    expect(patchMacSqlite(root)).toBe(0);
  });
  it("preserves newer dependency sources", () => {
    fixture("better-sqlite3", "12.9.0");
    expect(patchMacSqlite(root)).toBe(0);
    expect(
      fs.readFileSync(path.join(root, "src/better_sqlite3.cpp"), "utf8"),
    ).toContain("context->GetIsolate()");
  });
  it("refuses an unexpected initializer instead of hiding an unsupported source", () => {
    fixture("better-sqlite3", "11.10.0", "unknown initializer");
    expect(() => patchMacSqlite(root)).toThrow("Unexpected");
  });
});
