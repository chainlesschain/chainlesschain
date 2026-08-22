import { describe, expect, it } from "vitest";
import {
  normalizeGitLabMergeRequest,
  parseGitLabMergeRequestReference,
  renderGitLabMergeRequestFooter,
} from "../../src/lib/gitlab-mr-worktree.js";

describe("GitLab MR worktree footer", () => {
  it("parses nested GitLab project URLs and shorthand without network I/O", () => {
    expect(
      parseGitLabMergeRequestReference(
        "https://gitlab.example/group/subgroup/project/-/merge_requests/42",
      ),
    ).toEqual({
      host: "gitlab.example",
      projectPath: "group/subgroup/project",
      iid: 42,
      webUrl:
        "https://gitlab.example/group/subgroup/project/-/merge_requests/42",
    });
    expect(
      parseGitLabMergeRequestReference("group/project!7", {
        defaultHost: "gitlab.internal",
      }),
    ).toEqual({
      host: "gitlab.internal",
      projectPath: "group/project",
      iid: 7,
      webUrl: "https://gitlab.internal/group/project/-/merge_requests/7",
    });
  });

  it("rejects credential-bearing, query-bearing and traversal-shaped references", () => {
    for (const input of [
      "http://gitlab.example/group/project/-/merge_requests/1",
      "https://token@gitlab.example/group/project/-/merge_requests/1",
      "https://gitlab.example/group/project/-/merge_requests/1?private_token=x",
      "https://gitlab.example/group/../project/-/merge_requests/1",
      "group/../project!1",
      "group/project!0",
    ]) {
      expect(() => parseGitLabMergeRequestReference(input), input).toThrow();
    }
  });

  it("renders bounded local worktree UI without API extras or secrets", () => {
    const mr = normalizeGitLabMergeRequest({
      web_url: "https://gitlab.com/group/project/-/merge_requests/12",
      iid: 12,
      title: "Fix cached index",
      state: "opened",
      source_branch: "feature/index",
      target_branch: "main",
      private_token: "must-not-project",
    });
    const footer = renderGitLabMergeRequestFooter(mr, {
      worktreePath: "C:\\worktrees\\index-fix",
    });

    expect(footer).toBe(
      "GitLab MR !12 · opened\n" +
        "https://gitlab.com/group/project/-/merge_requests/12\n" +
        "Fix cached index\n" +
        "feature/index → main\n" +
        "worktree: C:\\worktrees\\index-fix",
    );
    expect(JSON.stringify(mr)).not.toContain("must-not-project");
  });
});
