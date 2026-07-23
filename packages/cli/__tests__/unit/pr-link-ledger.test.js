import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testHome = join(tmpdir(), `cc-pr-ledger-${Date.now()}`);

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => testHome,
}));

const {
  _deps,
  parsePrRefs,
  isGhPrCommand,
  recordPrLink,
  getPrLinks,
  readPrLinkLedger,
  recordFromShellCommand,
  formatPrLinks,
  prLinkLedgerPath,
} = await import("../../src/lib/pr-link-ledger.js");

const originalExecFile = _deps.execFile;

beforeEach(() => {
  mkdirSync(testHome, { recursive: true });
});

afterEach(() => {
  _deps.execFile = originalExecFile;
  rmSync(testHome, { recursive: true, force: true });
});

describe("parsePrRefs", () => {
  it("extracts the PR URL from gh pr create output", () => {
    const refs = parsePrRefs(
      "gh pr create --title x --body y",
      "Creating pull request...\nhttps://github.com/acme/widgets/pull/42\n",
    );
    expect(refs).toEqual([
      {
        number: 42,
        repo: "acme/widgets",
        url: "https://github.com/acme/widgets/pull/42",
        action: "create",
      },
    ]);
  });

  it("dedupes repeated URLs and reads view/merge/comment outputs", () => {
    const out =
      "url:\thttps://github.com/a/b/pull/7\nagain https://github.com/a/b/pull/7";
    expect(parsePrRefs("gh pr view 7", out)).toHaveLength(1);
    expect(parsePrRefs("gh pr merge 7", out)[0].action).toBe("merge");
    expect(parsePrRefs("gh pr comment 7 --body hi", out)[0].action).toBe(
      "comment",
    );
  });

  it("falls back to the explicit PR number when the output has no URL", () => {
    const refs = parsePrRefs("gh pr merge 123", "✓ Merged pull request");
    expect(refs).toEqual([
      { number: 123, repo: null, url: null, action: "merge" },
    ]);
  });

  it("ignores non-gh-pr commands entirely", () => {
    expect(parsePrRefs("echo https://github.com/a/b/pull/9", "...")).toEqual(
      [],
    );
    expect(parsePrRefs("gh issue view 3", "...")).toEqual([]);
    expect(isGhPrCommand("gh pr create")).toBe(true);
    expect(isGhPrCommand("git push")).toBe(false);
  });
});

describe("record / get", () => {
  it("round-trips links and dedupes by repo#number, newest state wins", () => {
    recordPrLink(
      "sess-1",
      {
        number: 5,
        repo: "a/b",
        url: "https://github.com/a/b/pull/5",
        action: "create",
      },
      { now: 100 },
    );
    recordPrLink(
      "sess-1",
      { number: 5, repo: "a/b", action: "merge" },
      { now: 200 },
    );
    const links = getPrLinks("sess-1");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      number: 5,
      repo: "a/b",
      state: "merged",
      url: "https://github.com/a/b/pull/5", // earlier URL preserved
    });
  });

  it("keeps sessions separate and sorts newest first", () => {
    recordPrLink(
      "s-a",
      { number: 1, repo: "x/y", action: "create" },
      { now: 10 },
    );
    recordPrLink(
      "s-a",
      { number: 2, repo: "x/y", action: "view" },
      { now: 20 },
    );
    recordPrLink(
      "s-b",
      { number: 9, repo: "x/y", action: "view" },
      { now: 30 },
    );
    expect(getPrLinks("s-a").map((l) => l.number)).toEqual([2, 1]);
    expect(getPrLinks("s-b").map((l) => l.number)).toEqual([9]);
    expect(getPrLinks("s-none")).toEqual([]);
  });

  it("tolerates a corrupt ledger file", () => {
    writeFileSync(prLinkLedgerPath(), "{not json", "utf-8");
    expect(readPrLinkLedger()).toEqual({});
    expect(getPrLinks("any")).toEqual([]);
    // and recording over the corrupt file heals it
    recordPrLink("s-heal", { number: 3, repo: "a/b", action: "view" });
    expect(getPrLinks("s-heal")).toHaveLength(1);
  });
});

describe("recordFromShellCommand", () => {
  it("records refs from a gh pr command", async () => {
    await recordFromShellCommand({
      sessionId: "sess-gh",
      command: "gh pr create -t x",
      output: "https://github.com/o/r/pull/11\n",
    });
    expect(getPrLinks("sess-gh")[0]).toMatchObject({ number: 11, repo: "o/r" });
  });

  it("queries gh for open PRs after a git push (branch → pr list)", async () => {
    _deps.execFile = vi.fn((file, args, opts, cb) => {
      expect(opts).toMatchObject({
        cwd: testHome,
        encoding: "utf8",
        timeout: 3000,
        windowsHide: true,
        origin: "pr:link-query",
        policy: "allow",
        scope: "pr",
        shell: false,
      });
      if (file === "git") return cb(null, "feat/thing\n");
      if (file === "gh") {
        expect(args).toEqual([
          "pr",
          "list",
          "--head",
          "feat/thing",
          "--json",
          "number,url,state",
        ]);
        return cb(
          null,
          JSON.stringify([
            {
              number: 77,
              url: "https://github.com/o/r/pull/77",
              state: "OPEN",
            },
          ]),
        );
      }
      return cb(new Error("unexpected"));
    });
    await recordFromShellCommand({
      sessionId: "sess-push",
      command: "git push origin feat/thing",
      output: "",
      cwd: testHome,
    });
    expect(getPrLinks("sess-push")[0]).toMatchObject({
      number: 77,
      repo: "o/r",
      state: "open",
      action: "push",
    });
    expect(_deps.execFile).toHaveBeenCalledTimes(2);
  });

  it("swallows gh unavailability quietly", async () => {
    _deps.execFile = vi.fn((file, args, opts, cb) =>
      cb(new Error("ENOENT: gh not found")),
    );
    await expect(
      recordFromShellCommand({
        sessionId: "sess-nogh",
        command: "git push",
        output: "",
        cwd: testHome,
      }),
    ).resolves.toBeUndefined();
    expect(getPrLinks("sess-nogh")).toEqual([]);
  });
});

describe("formatPrLinks", () => {
  it("renders a compact panel string", () => {
    expect(
      formatPrLinks([
        { number: 12, state: "open" },
        { number: 9, state: "merged" },
      ]),
    ).toBe("#12 open · #9 merged");
    expect(formatPrLinks([])).toBe("");
  });
});
