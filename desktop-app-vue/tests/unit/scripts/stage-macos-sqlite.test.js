import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stageMacSqlite } from "../../../scripts/stage-macos-sqlite.js";

let root;
let stage;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sqlite-stage-test-"));
  stage = path.join(root, "staged");
  fs.mkdirSync(stage);
  fs.mkdirSync(path.join(root, "packages"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
function moduleAt(prefix, version) {
  const dir = path.join(
    root,
    prefix,
    "node_modules/better-sqlite3-multiple-ciphers",
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "better-sqlite3-multiple-ciphers", version }),
  );
  return path.join(dir, "build/Release/better_sqlite3.node");
}
function payload(version) {
  fs.writeFileSync(
    path.join(
      stage,
      `better-sqlite3-multiple-ciphers-${version}-universal.node`,
    ),
    version,
  );
}

describe("version-aligned Mac SQLite staging", () => {
  it("updates hoisted, standalone and nested CLI copies with their own versions", () => {
    const hoisted = moduleAt(".", "12.11.1");
    const standalone = moduleAt("desktop-app-vue", "12.9.0");
    const cli = moduleAt(
      "packages/cli/node_modules/@chainlesschain/personal-data-hub",
      "12.11.1",
    );
    payload("12.11.1");
    payload("12.9.0");
    const checked = [];
    expect(
      stageMacSqlite(root, stage, (file) => checked.push(file)),
    ).toHaveLength(3);
    expect(checked).toHaveLength(3);
    expect(fs.readFileSync(hoisted, "utf8")).toBe("12.11.1");
    expect(fs.readFileSync(standalone, "utf8")).toBe("12.9.0");
    expect(fs.readFileSync(cli, "utf8")).toBe("12.11.1");
  });

  it("rejects an unknown native version before overwriting a valid dependency", () => {
    const known = moduleAt(".", "12.11.1");
    moduleAt("desktop-app-vue", "12.8.0");
    payload("12.11.1");
    expect(() => stageMacSqlite(root, stage, () => {})).toThrow(
      "No Electron rebuild",
    );
    expect(fs.existsSync(known)).toBe(false);
  });

  it("propagates a native architecture verification failure", () => {
    moduleAt(".", "12.11.1");
    payload("12.11.1");
    expect(() =>
      stageMacSqlite(root, stage, () => {
        throw new Error("missing arm64");
      }),
    ).toThrow("missing arm64");
  });
});
