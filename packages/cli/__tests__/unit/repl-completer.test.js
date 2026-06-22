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

describe("lazy cwd (follows /cd)", () => {
  it("resolves process.cwd() per keystroke when cwd is not pinned", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "cc-lazy-a-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "cc-lazy-b-"));
    fs.writeFileSync(path.join(a, "alpha.txt"), "", "utf-8");
    fs.writeFileSync(path.join(b, "bravo.txt"), "", "utf-8");
    const prev = process.cwd();
    try {
      const c = makeAtCompleter({}); // no cwd pinned
      process.chdir(a);
      expect(c("@al")[0]).toEqual(["@alpha.txt"]);
      process.chdir(b); // simulates /cd mid-session
      expect(c("@br")[0]).toEqual(["@bravo.txt"]);
      expect(c("@al")[0]).toEqual([]);
    } finally {
      process.chdir(prev);
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });
});

describe("slash-command completion", () => {
  const CMDS = ["/help", "/health", "/exit", "/model"];

  it("completes /prefix against the provided command list", () => {
    const c = makeAtCompleter({ slashCommands: CMDS });
    const [hits, replaced] = c("/he");
    expect(hits).toEqual(["/health", "/help"]); // sorted
    expect(replaced).toBe("/he");
  });

  it("bare / lists every command", () => {
    const c = makeAtCompleter({ slashCommands: CMDS });
    const [hits] = c("/");
    expect(hits).toHaveLength(CMDS.length);
  });

  it("stops completing once args begin, and ignores mid-line slashes", () => {
    const c = makeAtCompleter({ slashCommands: CMDS });
    expect(c("/model qwen")[0]).toEqual([]); // space → args territory
    expect(c("see /he")[0]).toEqual([]); // not at line start
  });

  it("is case-insensitive on the typed prefix", () => {
    const c = makeAtCompleter({ slashCommands: CMDS });
    expect(c("/HE")[0]).toEqual(["/health", "/help"]);
  });

  it("no slashCommands option → / lines complete to nothing (legacy)", () => {
    const c = makeAtCompleter({});
    expect(c("/he")[0]).toEqual([]);
  });

  it("de-duplicates a drifted/aliased command list (no double entries)", () => {
    const c = makeAtCompleter({
      slashCommands: ["/help", "/help", "/exit", "/model", "/exit"],
    });
    expect(c("/")[0]).toEqual(["/exit", "/help", "/model"]); // sorted + unique
    expect(c("/he")[0]).toEqual(["/help"]); // single, not doubled
  });
});

describe("dynamic (custom) slash-command completion", () => {
  const CMDS = ["/help", "/exit", "/model"];

  it("merges custom commands and completes namespaced `:` names", () => {
    const c = makeAtCompleter({
      slashCommands: CMDS,
      getDynamicSlashCommands: () => ["/git:commit", "/git:push", "/deploy"],
    });
    expect(c("/git:")[0]).toEqual(["/git:commit", "/git:push"]); // sorted
    const [bare] = c("/");
    expect(bare).toContain("/git:commit"); // custom present
    expect(bare).toContain("/help"); // built-ins still present
  });

  it("completes a custom name typed with digits / dots", () => {
    const c = makeAtCompleter({
      getDynamicSlashCommands: () => ["/v2:plan", "/my.cmd"],
    });
    expect(c("/v2:")[0]).toEqual(["/v2:plan"]);
    expect(c("/my.")[0]).toEqual(["/my.cmd"]);
  });

  it("de-duplicates a custom command that shadows a built-in name", () => {
    const c = makeAtCompleter({
      slashCommands: ["/deploy", "/help"],
      getDynamicSlashCommands: () => ["/deploy", "/release"],
    });
    expect(c("/de")[0]).toEqual(["/deploy"]); // single, not doubled
    expect(c("/")[0]).toEqual(["/deploy", "/help", "/release"]);
  });

  it("TTL-caches the dynamic source (no FS walk per keystroke)", () => {
    let calls = 0;
    let t = 1000;
    const c = makeAtCompleter({
      getDynamicSlashCommands: () => {
        calls += 1;
        return ["/foo"];
      },
      deps: { now: () => t },
    });
    c("/f");
    c("/fo");
    c("/foo");
    expect(calls).toBe(1); // one fetch for the burst
    t += 6000; // past TTL
    c("/f");
    expect(calls).toBe(2);
  });

  it("a throwing dynamic source never breaks completion", () => {
    const c = makeAtCompleter({
      slashCommands: CMDS,
      getDynamicSlashCommands: () => {
        throw new Error("commands dir unreadable");
      },
    });
    expect(c("/he")[0]).toEqual(["/help"]); // built-ins still work
  });

  it("works with no built-ins (custom-only) and stays empty when none match", () => {
    const c = makeAtCompleter({
      getDynamicSlashCommands: () => ["/deploy"],
    });
    expect(c("/de")[0]).toEqual(["/deploy"]);
    expect(c("/zzz")[0]).toEqual([]); // no match → no hits, not a crash
  });
});
