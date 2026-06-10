/**
 * REPL `@` tab-completion (Claude-Code @-mention parity) — pure module tests:
 * @-token extraction, fs candidates, and the merged completer with the IDE
 * open-editors source (cached, async-refreshed, never blocking a keystroke).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  extractAtPrefix,
  fileCandidates,
  makeAtCompleter,
} from "../../src/lib/repl-completer.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("extractAtPrefix", () => {
  it("matches a trailing @token at line start or after whitespace", () => {
    expect(extractAtPrefix("@src/fo")).toEqual({ prefix: "src/fo" });
    expect(extractAtPrefix("fix @a.js")).toEqual({ prefix: "a.js" });
    expect(extractAtPrefix("review @")).toEqual({ prefix: "" });
  });
  it("ignores non-@ lines, mid-word @, and finished tokens", () => {
    expect(extractAtPrefix("hello")).toBe(null);
    expect(extractAtPrefix("mail a@b.com")).toBe(null); // @ not after whitespace
    expect(extractAtPrefix("@a.js done")).toBe(null); // token not at cursor
    expect(extractAtPrefix("")).toBe(null);
  });
});

describe("fileCandidates", () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-complete-"));
    fs.mkdirSync(path.join(tmp, "src"));
    fs.mkdirSync(path.join(tmp, "node_modules"));
    fs.writeFileSync(path.join(tmp, "src", "alpha.js"), "", "utf-8");
    fs.writeFileSync(path.join(tmp, "src", "Beta.js"), "", "utf-8");
    fs.writeFileSync(path.join(tmp, "readme.md"), "", "utf-8");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("lists the cwd for an empty prefix, dirs with a trailing slash", () => {
    const out = fileCandidates("", { cwd: tmp });
    expect(out).toContain("src/");
    expect(out).toContain("readme.md");
    expect(out).not.toContain("node_modules/"); // noise excluded
  });

  it("descends into dirs and filters case-insensitively", () => {
    expect(fileCandidates("src/al", { cwd: tmp })).toEqual(["src/alpha.js"]);
    expect(fileCandidates("src/be", { cwd: tmp })).toEqual(["src/Beta.js"]);
    expect(fileCandidates("src/", { cwd: tmp }).sort()).toEqual([
      "src/Beta.js",
      "src/alpha.js",
    ]);
  });

  it("returns [] for a missing directory", () => {
    expect(fileCandidates("nope/x", { cwd: tmp })).toEqual([]);
  });
});

describe("makeAtCompleter", () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-complete2-"));
    fs.writeFileSync(path.join(tmp, "app.js"), "", "utf-8");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("completes nothing on non-@ lines", () => {
    const c = makeAtCompleter({ cwd: tmp });
    expect(c("run tests")).toEqual([[], "run tests"]);
  });

  it("completes fs paths with the @ kept", () => {
    const c = makeAtCompleter({ cwd: tmp });
    const [hits, replaced] = c("look at @ap");
    expect(hits).toEqual(["@app.js"]);
    expect(replaced).toBe("@ap");
  });

  it("merges IDE open tabs first (relative inside cwd, absolute outside)", async () => {
    const inWs = path.join(tmp, "deep", "open.ts");
    const c = makeAtCompleter({
      cwd: tmp,
      getIdeOpenFiles: async () => [inWs, "/elsewhere/notes.md"],
    });
    c("@"); // first TAB kicks off the async refresh (cache still empty)
    await tick();
    const [hits] = c("@");
    expect(hits[0]).toBe("@deep/open.ts"); // IDE tab ranks before fs listing
    expect(hits).toContain("@/elsewhere/notes.md");
    expect(hits).toContain("@app.js");
  });

  it("filters IDE tabs by the typed prefix", async () => {
    const c = makeAtCompleter({
      cwd: tmp,
      getIdeOpenFiles: async () => [
        path.join(tmp, "deep", "open.ts"),
        path.join(tmp, "other.md"),
      ],
    });
    c("@");
    await tick();
    const [hits] = c("@deep/");
    expect(hits).toEqual(["@deep/open.ts"]);
  });

  it("respects the TTL: refreshes once, not per keystroke", async () => {
    let calls = 0;
    let t = 1000;
    const c = makeAtCompleter({
      cwd: tmp,
      getIdeOpenFiles: async () => {
        calls += 1;
        return [];
      },
      deps: { now: () => t },
    });
    c("@a");
    c("@ap");
    c("@app");
    await tick();
    expect(calls).toBe(1);
    t += 6000; // past TTL
    c("@a");
    await tick();
    expect(calls).toBe(2);
  });

  it("a rejecting IDE source never breaks completion", async () => {
    const c = makeAtCompleter({
      cwd: tmp,
      getIdeOpenFiles: async () => {
        throw new Error("ide down");
      },
    });
    c("@");
    await tick();
    const [hits] = c("@ap");
    expect(hits).toEqual(["@app.js"]); // fs still works
  });
});
