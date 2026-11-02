import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import asar from "@electron/asar";
import {
  findMacApp,
  verifyMacApp,
} from "../../../scripts/verify-macos-sqlite.js";

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mac-sqlite-test-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
const binding =
  "node_modules/better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node";
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}
function app(name = "ChainlessChain.app") {
  const bundle = path.join(tmp, name);
  fs.mkdirSync(path.join(bundle, "Contents", "Resources"), { recursive: true });
  return bundle;
}
const verifyBinary = (file) => {
  expect(fs.readFileSync(file, "utf8")).toBe("universal");
};
const inspection = { verifyBinary, readArchitectures: () => ["x86_64"] };

describe("packaged Mac SQLite verification", () => {
  it("finds the actual Mac resources instead of a Windows resources directory", () => {
    const bundle = app();
    expect(findMacApp(tmp)).toBe(bundle);
  });

  it("verifies a binding inside ASAR even when there are zero loose native files", async () => {
    const bundle = app();
    const stage = path.join(tmp, "stage");
    write(path.join(stage, binding), "universal");
    await asar.createPackage(
      stage,
      path.join(bundle, "Contents/Resources/app.asar"),
    );
    expect(verifyMacApp(bundle, inspection)).toBe(1);
  });

  it("reads unpacked ASAR bindings and CLI extra resources", async () => {
    const bundle = app();
    const stage = path.join(tmp, "stage");
    write(path.join(stage, binding), "universal");
    const resources = path.join(bundle, "Contents/Resources");
    await asar.createPackageWithOptions(
      stage,
      path.join(resources, "app.asar"),
      { unpack: "*.node" },
    );
    expect(
      asar.statFile(path.join(resources, "app.asar"), path.normalize(binding))
        .unpacked,
    ).toBe(true);
    write(path.join(resources, "packages/cli", binding), "universal");
    expect(verifyMacApp(bundle, inspection)).toBeGreaterThanOrEqual(2);
  });

  it("rejects an app without SQLite independently of another valid app", () => {
    const valid = app();
    const empty = app("Empty.app");
    write(path.join(valid, "Contents/Resources/app", binding), "universal");
    expect(verifyMacApp(valid, inspection)).toBe(1);
    expect(() => verifyMacApp(empty, inspection)).toThrow("No SQLite bindings");
  });

  it("rejects a bad archived binding even when a loose binding is valid", async () => {
    const bundle = app();
    const stage = path.join(tmp, "stage");
    write(path.join(stage, binding), "thin");
    const resources = path.join(bundle, "Contents/Resources");
    await asar.createPackage(stage, path.join(resources, "app.asar"));
    write(path.join(resources, "packages/cli", binding), "universal");
    expect(() => verifyMacApp(bundle, inspection)).toThrow(
      "Invalid packaged SQLite binding",
    );
  });

  it("validates a single-architecture binding against its app's actual CPU", () => {
    const bundle = app();
    write(path.join(bundle, "Contents/Resources/app", binding), "arm64");
    expect(
      verifyMacApp(bundle, {
        readArchitectures: () => ["arm64"],
        verifyBinary(file, expected) {
          expect(expected).toEqual(["arm64"]);
          expect(fs.readFileSync(file, "utf8")).toBe(expected[0]);
        },
      }),
    ).toBe(1);
  });

  it("rejects a binding for the other app architecture", () => {
    const bundle = app();
    write(path.join(bundle, "Contents/Resources/app", binding), "arm64");
    expect(() =>
      verifyMacApp(bundle, {
        readArchitectures: () => ["x86_64"],
        verifyBinary(file, expected) {
          expect(fs.readFileSync(file, "utf8")).toBe(expected[0]);
        },
      }),
    ).toThrow("Invalid packaged SQLite binding");
  });
});
