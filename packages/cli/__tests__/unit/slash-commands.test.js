import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverCommands,
  getCommand,
  parseCommandFile,
  substituteArgs,
  expandCommand,
} from "../../src/lib/slash-commands.js";

describe("slash-commands", () => {
  let base; // mkdtemp root holding both fake roots
  let cwd; // fake project root
  let home; // fake personal root
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "slashcmd-"));
    cwd = join(base, "proj");
    home = join(base, "home");
    mkdirSync(join(cwd, ".claude", "commands", "git"), { recursive: true });
    mkdirSync(join(home, ".claude", "commands"), { recursive: true });
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const writeCmd = (root, rel, content) =>
    writeFileSync(join(root, ".claude", "commands", rel), content, "utf-8");
  const opts = () => ({ home });

  it("discovers commands from project + personal, names from path", () => {
    writeCmd(cwd, "review.md", "---\ndescription: Review code\n---\nReview $1");
    writeCmd(cwd, "git/commit.md", "Commit with message $ARGUMENTS");
    writeCmd(home, "note.md", "Personal note");
    const all = discoverCommands(cwd, opts());
    const names = all.map((c) => c.name).sort();
    expect(names).toEqual(["git:commit", "note", "review"]);
    expect(all.find((c) => c.name === "review").description).toBe(
      "Review code",
    );
    expect(all.find((c) => c.name === "git:commit").scope).toBe("project");
    expect(all.find((c) => c.name === "note").scope).toBe("personal");
  });

  it("project scope shadows personal on a name clash", () => {
    writeCmd(cwd, "dup.md", "PROJECT version");
    writeCmd(home, "dup.md", "PERSONAL version");
    const c = getCommand("dup", cwd, opts());
    expect(c.scope).toBe("project");
    expect(c.body).toBe("PROJECT version");
  });

  it("getCommand accepts slash and colon namespacing", () => {
    writeCmd(cwd, "git/commit.md", "body");
    expect(getCommand("git:commit", cwd, opts()).body).toBe("body");
    expect(getCommand("git/commit", cwd, opts()).body).toBe("body");
    expect(getCommand("/git:commit", cwd, opts()).body).toBe("body");
    expect(getCommand("nope", cwd, opts())).toBeNull();
  });

  it("parses frontmatter (kebab → camel)", () => {
    writeCmd(
      cwd,
      "x.md",
      "---\ndescription: D\nargument-hint: <pr>\nallowed-tools: read_file,git\nmodel: claude-opus-4-8\n---\nbody",
    );
    const c = getCommand("x", cwd, opts());
    expect(c.argumentHint).toBe("<pr>");
    expect(c.allowedTools).toBe("read_file,git");
    expect(c.model).toBe("claude-opus-4-8");
  });

  describe("substituteArgs", () => {
    it("replaces $ARGUMENTS and $1..$9", () => {
      expect(substituteArgs("a $1 b $2 all=$ARGUMENTS", ["x", "y"])).toBe(
        "a x b y all=x y",
      );
    });
    it("missing positionals become empty", () => {
      expect(substituteArgs("[$1][$3]", ["only"])).toBe("[only][]");
    });
  });

  describe("expandCommand", () => {
    const mk = (body) => ({ name: "t", body });

    it("substitutes args then resolves @file refs", () => {
      writeFileSync(join(cwd, "data.txt"), "FILE-CONTENT", "utf-8");
      const { prompt } = expandCommand(mk("task $1 @data.txt"), ["go"], {
        cwd,
        allowBang: false,
      });
      expect(prompt).toContain("task go");
      expect(prompt).toContain("FILE-CONTENT");
    });

    it("runs !`cmd` bang segments via injected execSync", () => {
      const calls = [];
      const { prompt } = expandCommand(mk("status: !`git status`"), [], {
        cwd,
        deps: {
          execSync: (cmd) => {
            calls.push(cmd);
            return "BRANCH-CLEAN\n";
          },
        },
      });
      expect(calls).toEqual(["git status"]);
      expect(prompt).toContain("status: BRANCH-CLEAN");
    });

    it("--no-bang leaves bang segments untouched", () => {
      const { prompt } = expandCommand(mk("x !`rm -rf /` y"), [], {
        cwd,
        allowBang: false,
      });
      expect(prompt).toContain("!`rm -rf /`");
    });

    it("a failing bang is spliced as an error marker, not fatal", () => {
      const { prompt } = expandCommand(mk("out: !`boom`"), [], {
        cwd,
        deps: {
          execSync: () => {
            throw new Error("nonzero exit");
          },
        },
      });
      expect(prompt).toContain("[command failed: boom");
    });
  });

  it("parseCommandFile returns null for a missing file", () => {
    expect(parseCommandFile(join(cwd, "nope.md"), "project")).toBeNull();
  });
});
