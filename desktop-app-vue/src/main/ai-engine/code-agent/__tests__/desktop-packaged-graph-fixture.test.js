import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FIXTURE_ROOT = path.resolve(
  __dirname,
  "fixtures/packaged-electron-graph",
);

function readFixture(fileName) {
  return fs.readFileSync(path.join(FIXTURE_ROOT, fileName), "utf8");
}

describe("Desktop packaged Graph fixture contract", () => {
  it("keeps the Node and Electron CommonJS entry points explicit", () => {
    const writer = readFixture("../desktop-graph-kill-writer.cjs");
    const main = readFixture("main.cjs");
    const preload = readFixture("preload.cjs");

    expect(writer).toContain("/* global require, __dirname, process */");
    expect(writer).toContain("DesktopGraphRunRegistry");
    expect(writer).toContain("fs.writeFileSync");
    expect(writer).toContain("setInterval(() => {}, 1_000)");
    expect(main).toContain("/* global require, __dirname, process */");
    expect(preload).toContain("/* global require */");
    for (const source of [writer, main, preload]) {
      expect(source).toContain(
        "/* eslint-disable @typescript-eslint/no-require-imports */",
      );
      expect(source).toContain('"use strict";');
    }
  });

  it("keeps the packaged launcher, main entry, preload, and renderer aligned", () => {
    const packageJson = JSON.parse(readFixture("package.json"));
    const main = readFixture("main.cjs");
    const preload = readFixture("preload.cjs");
    const renderer = readFixture("renderer.html");
    const launcher = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../../scripts/graph-packaged-electron-journey.mjs",
      ),
      "utf8",
    );

    expect(packageJson.main).toBe("main.cjs");
    expect(main).toContain('preload: path.join(__dirname, "preload.cjs")');
    expect(main).toContain(
      'await window.loadFile(path.join(__dirname, "renderer.html"))',
    );
    for (const channel of [
      "p1-3:packaged-graph:start",
      "p1-3:packaged-graph:acknowledge",
    ]) {
      expect(main).toContain(channel);
      expect(preload).toContain(channel);
    }
    expect(renderer).toContain("window.packagedGraphJourney.start()");
    for (const asset of ["main.cjs", "preload.cjs", "renderer.html"]) {
      expect(launcher).toContain(`"${asset}"`);
    }
  });
});
