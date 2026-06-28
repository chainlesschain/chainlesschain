/**
 * `/pr-comments` — parse args, format fetched PR comments, and fetch via an
 * injected `gh` runner. Pure + deterministic (runGh stubbed).
 */
import { describe, it, expect } from "vitest";
import {
  parsePrCommentsArg,
  formatPrComments,
  fetchPrComments,
  expandPrComments,
} from "../../src/repl/pr-comments.js";

describe("parsePrCommentsArg", () => {
  it("returns nulls for the bare command", () => {
    expect(parsePrCommentsArg("/pr-comments")).toEqual({
      pr: null,
      repo: null,
    });
  });

  it("parses a PR number", () => {
    expect(parsePrCommentsArg("/pr-comments 123")).toEqual({
      pr: 123,
      repo: null,
    });
  });

  it("parses --repo (and -R) plus number", () => {
    expect(parsePrCommentsArg("/pr-comments 7 --repo owner/name")).toEqual({
      pr: 7,
      repo: "owner/name",
    });
    expect(parsePrCommentsArg("/pr-comments -R a/b 9")).toEqual({
      pr: 9,
      repo: "a/b",
    });
  });

  it("extracts number + repo from a PR URL", () => {
    expect(
      parsePrCommentsArg("/pr-comments https://github.com/o/r/pull/42"),
    ).toEqual({ pr: 42, repo: "o/r" });
  });
});

describe("formatPrComments", () => {
  const data = {
    number: 12,
    title: "Add feature",
    url: "https://github.com/o/r/pull/12",
    reviews: [
      {
        author: { login: "alice" },
        state: "CHANGES_REQUESTED",
        body: "Fix the null check",
      },
      { author: { login: "bot" }, state: "COMMENTED", body: "" }, // filtered out
    ],
    conversation: [{ user: { login: "bob" }, body: "Looks close!" }],
    inline: [
      {
        user: { login: "carol" },
        path: "src/x.js",
        line: 40,
        body: "rename this",
      },
    ],
  };

  it("renders header, reviews, conversation and inline comments with counts", () => {
    const out = formatPrComments(data);
    expect(out).toMatch(/PR #12 — Add feature/);
    expect(out).toMatch(/https:\/\/github\.com\/o\/r\/pull\/12/);
    expect(out).toMatch(/Reviews \(1\):/); // COMMENTED-with-empty-body filtered
    expect(out).toMatch(/@alice CHANGES_REQUESTED/);
    expect(out).toMatch(/Fix the null check/);
    expect(out).toMatch(/Conversation comments \(1\):/);
    expect(out).toMatch(/@bob:/);
    expect(out).toMatch(/Inline code comments \(1\):/);
    expect(out).toMatch(/src\/x\.js:40 @carol:/);
    expect(out).toMatch(/rename this/);
  });

  it("tolerates empty/missing sections", () => {
    const out = formatPrComments({ number: 1, title: "t" });
    expect(out).toMatch(/Reviews \(0\):/);
    expect(out).toMatch(/Conversation comments \(0\):/);
    expect(out).toMatch(/Inline code comments \(0\):/);
  });
});

describe("fetchPrComments", () => {
  it("calls gh pr view then the inline-comments API and merges results", async () => {
    const calls = [];
    const runGh = async (args) => {
      calls.push(args);
      if (args[0] === "pr" && args[1] === "view") {
        return JSON.stringify({
          number: 5,
          title: "T",
          url: "https://github.com/o/r/pull/5",
          comments: [{ user: { login: "u" }, body: "hi" }],
          reviews: [{ author: { login: "a" }, state: "APPROVED", body: "" }],
        });
      }
      if (args[0] === "api") {
        return JSON.stringify([
          { user: { login: "c" }, path: "a.js", line: 3, body: "nit" },
        ]);
      }
      throw new Error("unexpected gh call: " + args.join(" "));
    };
    const data = await fetchPrComments({ pr: 5, deps: { runGh } });
    expect(data.number).toBe(5);
    expect(data.conversation).toHaveLength(1);
    expect(data.inline).toHaveLength(1);
    // derived owner/repo from the PR url for the inline-comments api call
    expect(calls[1][1]).toBe("repos/o/r/pulls/5/comments?per_page=100");
  });

  it("treats inline-comments failure as best-effort (empty)", async () => {
    const runGh = async (args) => {
      if (args[0] === "pr") {
        return JSON.stringify({
          number: 8,
          title: "T",
          url: "https://github.com/o/r/pull/8",
          comments: [],
          reviews: [],
        });
      }
      throw new Error("api 404");
    };
    const data = await fetchPrComments({ pr: 8, deps: { runGh } });
    expect(data.inline).toEqual([]);
  });
});

describe("expandPrComments", () => {
  it("returns null for a non-command line", async () => {
    expect(await expandPrComments("just a prompt")).toBeNull();
  });

  it("wraps the formatted block with an instruction and a total count", async () => {
    const runGh = async (args) =>
      args[0] === "pr"
        ? JSON.stringify({
            number: 3,
            title: "T",
            url: "https://github.com/o/r/pull/3",
            comments: [{ user: { login: "u" }, body: "c1" }],
            reviews: [
              {
                author: { login: "a" },
                state: "CHANGES_REQUESTED",
                body: "r1",
              },
            ],
          })
        : JSON.stringify([
            { user: { login: "c" }, path: "a.js", line: 1, body: "i1" },
          ]);
    const res = await expandPrComments("/pr-comments 3", { deps: { runGh } });
    expect(res.number).toBe(3);
    expect(res.count).toBe(3); // 1 review + 1 conversation + 1 inline
    expect(res.text).toMatch(/请逐条理解并处理/);
    expect(res.text).toMatch(/PR #3 — T/);
  });
});
