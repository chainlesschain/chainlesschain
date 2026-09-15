import { describe, it, expect } from "vitest";
import { gitToolInputError } from "../../src/lib/git-tool-input.js";

describe("Git argv diagnostics", () => {
  it.each([
    'merge-base --is-ancestor main HEAD && echo "FF-SAFE"',
    "tag --sort=-v:refname | head -8",
    "log --oneline|head -5",
    "status > out.txt",
    "status; echo done",
    "status\nlog",
    "show $(whoami)",
  ])(
    "rejects shell syntax without running a partial command: %s",
    (command) => {
      expect(gitToolInputError(command)).toMatchObject({
        code: "CC_GIT_SHELL_SYNTAX",
      });
    },
  );
  it.each([
    'commit -m "fix: preserve a | b && c"',
    "log --grep='a;b' -n 5",
    "merge-base --is-ancestor main HEAD",
    "tag --list v-npm-* --sort=-v:refname",
    'log --format="%h %s" -n 5',
  ])("preserves valid Git arguments: %s", (command) => {
    expect(gitToolInputError(command)).toBeNull();
  });
  it("diagnoses unmatched quotes", () => {
    expect(gitToolInputError('log --grep="oops')).toMatchObject({
      code: "CC_GIT_UNCLOSED_QUOTE",
    });
  });
});
