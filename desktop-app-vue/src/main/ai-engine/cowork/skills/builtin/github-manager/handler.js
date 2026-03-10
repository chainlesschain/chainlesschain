/**
 * GitHub Manager Skill Handler (v2.0)
 *
 * Manages GitHub issues, pull requests, repositories, and workflows
 * via the GitHub REST API. Requires GITHUB_TOKEN in environment.
 *
 * Enhanced: code search, releases, branches, PR review, issue/PR detail,
 * label management, branch comparison.
 */

const { logger } = require("../../../../../utils/logger.js");
const https = require("https");

const _deps = { https };

const GITHUB_API = "api.github.com";

function getToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

function githubRequest(path, method = "GET", body = null) {
  const token = getToken();
  return new Promise((resolve, reject) => {
    const options = {
      hostname: GITHUB_API,
      path,
      method,
      headers: {
        "User-Agent": "ChainlessChain/1.2.0",
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
    };

    if (token) {
      options.headers.Authorization = `Bearer ${token}`;
    }

    if (body) {
      const payload = JSON.stringify(body);
      options.headers["Content-Length"] = Buffer.byteLength(payload);
    }

    const req = _deps.https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (_e) {
          logger.warn(
            "[GitHubManager] Failed to parse JSON response from %s",
            path,
          );
          resolve({ status: res.statusCode, data: { raw: data } });
        }
      });
    });

    req.on("error", reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ── Input Parser ──────────────────────────────────

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "list-issues", repo: "", params: {} };
  }
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const action = (parts[0] || "").toLowerCase();

  const repoMatch = trimmed.match(/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
  const repo = repoMatch ? repoMatch[1] : "";

  const stateMatch = trimmed.match(/--state\s+(\S+)/);
  const maxMatch = trimmed.match(/--max\s+(\d+)/);
  const labelsMatch = trimmed.match(/--labels\s+(\S+)/);
  const titleMatch = trimmed.match(/title:['"](.*?)['"]/);
  const bodyMatch = trimmed.match(/body:['"](.*?)['"]/);
  const headMatch = trimmed.match(/head:(\S+)/);
  const baseMatch = trimmed.match(/base:(\S+)/);
  const tagMatch = trimmed.match(/tag:(\S+)/);
  const eventMatch = trimmed.match(/--event\s+(\S+)/);

  // Extract query for search-code (everything after action + repo)
  let query = "";
  if (action === "search-code") {
    query = trimmed
      .replace(/^search-code\s+/, "")
      .replace(repoMatch ? repoMatch[0] : "", "")
      .replace(/--\S+\s+\S+/g, "")
      .trim();
  }

  // Extract number for get-issue/get-pr/pr-review
  const numberMatch =
    trimmed.match(/#(\d+)/) || trimmed.match(/\b(\d+)\b(?![\w.])/);
  const number = numberMatch ? parseInt(numberMatch[1], 10) : null;

  // Review action (approve/comment/request_changes)
  const reviewAction = trimmed.match(
    /--review\s+(approve|comment|request_changes)/i,
  );

  return {
    action: action || "list-issues",
    repo,
    number,
    query,
    params: {
      state: stateMatch ? stateMatch[1] : "open",
      max: maxMatch ? parseInt(maxMatch[1], 10) : 30,
      labels: labelsMatch ? labelsMatch[1].split(",") : [],
      title: titleMatch ? titleMatch[1] : "",
      body: bodyMatch ? bodyMatch[1] : "",
      head: headMatch ? headMatch[1] : "",
      base: baseMatch ? baseMatch[1] : "main",
      tag: tagMatch ? tagMatch[1] : "",
      event: eventMatch ? eventMatch[1] : "",
      reviewAction: reviewAction ? reviewAction[1].toUpperCase() : "COMMENT",
    },
  };
}

function parseRepo(repo) {
  const parts = repo.split("/");
  if (parts.length !== 2) {
    return null;
  }
  return { owner: parts[0], repo: parts[1] };
}

// ── Original Handlers ─────────────────────────────

async function handleListIssues(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "list-issues",
      error: "Invalid repository format. Use: owner/repo",
    };
  }

  const { state, max } = parsed.params;
  const res = await githubRequest(
    `/repos/${r.owner}/${r.repo}/issues?state=${state}&per_page=${max}&sort=updated&direction=desc`,
  );

  if (res.status !== 200) {
    return {
      success: false,
      action: "list-issues",
      error: `GitHub API error (${res.status}): ${res.data.message || JSON.stringify(res.data)}`,
    };
  }

  const issues = (Array.isArray(res.data) ? res.data : [])
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      author: i.user?.login || "",
      labels: (i.labels || []).map((l) => l.name),
      created: i.created_at,
      updated: i.updated_at,
      comments: i.comments,
      url: i.html_url,
    }));

  return {
    success: true,
    action: "list-issues",
    repo: parsed.repo,
    results: issues,
    result: issues,
    message: `Found ${issues.length} ${state} issue(s) in ${parsed.repo}.`,
  };
}

async function handleCreateIssue(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "create-issue",
      error: "Invalid repository format.",
    };
  }

  const { title, body, labels } = parsed.params;
  if (!title) {
    return { success: false, action: "create-issue", error: "Title required." };
  }

  const payload = { title, body: body || "" };
  if (labels.length > 0) {
    payload.labels = labels;
  }

  const res = await githubRequest(
    `/repos/${r.owner}/${r.repo}/issues`,
    "POST",
    payload,
  );
  if (res.status !== 201) {
    return {
      success: false,
      action: "create-issue",
      error: `Failed (${res.status}): ${res.data.message}`,
    };
  }

  return {
    success: true,
    action: "create-issue",
    result: {
      number: res.data.number,
      title: res.data.title,
      url: res.data.html_url,
      state: res.data.state,
    },
    message: `Created issue #${res.data.number}: "${res.data.title}" in ${parsed.repo}.`,
  };
}

async function handleListPRs(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "list-prs",
      error: "Invalid repository format.",
    };
  }

  const { state, max } = parsed.params;
  const res = await githubRequest(
    `/repos/${r.owner}/${r.repo}/pulls?state=${state}&per_page=${max}&sort=updated&direction=desc`,
  );

  if (res.status !== 200) {
    return {
      success: false,
      action: "list-prs",
      error: `GitHub API error (${res.status})`,
    };
  }

  const prs = (Array.isArray(res.data) ? res.data : []).map((p) => ({
    number: p.number,
    title: p.title,
    state: p.state,
    author: p.user?.login || "",
    head: p.head?.ref || "",
    base: p.base?.ref || "",
    draft: p.draft || false,
    mergeable: p.mergeable,
    created: p.created_at,
    updated: p.updated_at,
    url: p.html_url,
  }));

  return {
    success: true,
    action: "list-prs",
    repo: parsed.repo,
    results: prs,
    result: prs,
    message: `Found ${prs.length} ${state} PR(s).`,
  };
}

async function handleCreatePR(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "create-pr",
      error: "Invalid repository format.",
    };
  }

  const { title, body, head, base } = parsed.params;
  if (!title) {
    return { success: false, action: "create-pr", error: "Title required." };
  }
  if (!head) {
    return {
      success: false,
      action: "create-pr",
      error: "Head branch required.",
    };
  }

  const payload = { title, body: body || "", head, base: base || "main" };
  const res = await githubRequest(
    `/repos/${r.owner}/${r.repo}/pulls`,
    "POST",
    payload,
  );

  if (res.status !== 201) {
    return {
      success: false,
      action: "create-pr",
      error: `Failed (${res.status}): ${res.data.message}`,
    };
  }

  return {
    success: true,
    action: "create-pr",
    result: {
      number: res.data.number,
      title: res.data.title,
      url: res.data.html_url,
      head,
      base: base || "main",
    },
    message: `Created PR #${res.data.number}: "${res.data.title}" (${head} -> ${base || "main"}).`,
  };
}

async function handleRepoInfo(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "repo-info",
      error: "Invalid repository format.",
    };
  }

  const res = await githubRequest(`/repos/${r.owner}/${r.repo}`);
  if (res.status !== 200) {
    return {
      success: false,
      action: "repo-info",
      error: `GitHub API error (${res.status})`,
    };
  }

  const repo = res.data;
  const info = {
    name: repo.full_name,
    description: repo.description || "",
    language: repo.language || "Unknown",
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.subscribers_count,
    openIssues: repo.open_issues_count,
    defaultBranch: repo.default_branch,
    private: repo.private,
    archived: repo.archived,
    license: repo.license?.spdx_id || "None",
    topics: repo.topics || [],
    created: repo.created_at,
    updated: repo.updated_at,
    pushed: repo.pushed_at,
    size: repo.size,
    url: repo.html_url,
  };

  return {
    success: true,
    action: "repo-info",
    result: info,
    message: `${info.name}: ${info.description || "No description"} | ${info.language} | ${info.stars} stars`,
  };
}

async function handleListWorkflows(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "list-workflows",
      error: "Invalid repository format.",
    };
  }

  const res = await githubRequest(
    `/repos/${r.owner}/${r.repo}/actions/runs?per_page=${parsed.params.max}`,
  );
  if (res.status !== 200) {
    return {
      success: false,
      action: "list-workflows",
      error: `GitHub API error (${res.status})`,
    };
  }

  const runs = (res.data.workflow_runs || []).map((w) => ({
    id: w.id,
    name: w.name,
    status: w.status,
    conclusion: w.conclusion,
    branch: w.head_branch,
    event: w.event,
    actor: w.actor?.login || "",
    created: w.created_at,
    updated: w.updated_at,
    url: w.html_url,
    duration:
      w.updated_at && w.created_at
        ? Math.round((new Date(w.updated_at) - new Date(w.created_at)) / 1000)
        : null,
  }));

  const summary = {
    total: runs.length,
    success: runs.filter((r) => r.conclusion === "success").length,
    failure: runs.filter((r) => r.conclusion === "failure").length,
    inProgress: runs.filter((r) => r.status === "in_progress").length,
  };

  return {
    success: true,
    action: "list-workflows",
    repo: parsed.repo,
    results: runs,
    summary,
    result: { runs, summary },
    message: `${runs.length} workflow run(s): ${summary.success} passed, ${summary.failure} failed.`,
  };
}

// ── New v2.0 Handlers ─────────────────────────────

async function handleSearchCode(parsed) {
  const r = parseRepo(parsed.repo);
  const q = parsed.query;

  if (!q) {
    return {
      success: false,
      action: "search-code",
      error: "Search query required.",
    };
  }

  const searchQuery = r ? `${q}+repo:${r.owner}/${r.repo}` : q;
  const res = await githubRequest(
    `/search/code?q=${encodeURIComponent(searchQuery)}&per_page=${parsed.params.max}`,
  );

  if (res.status !== 200) {
    return {
      success: false,
      action: "search-code",
      error: `GitHub API error (${res.status}): ${res.data.message}`,
    };
  }

  const items = (res.data.items || []).map((item) => ({
    name: item.name,
    path: item.path,
    repository: item.repository?.full_name || "",
    url: item.html_url,
    score: item.score,
  }));

  return {
    success: true,
    action: "search-code",
    result: { query: q, totalCount: res.data.total_count, items },
    message: `Found ${res.data.total_count} result(s) for "${q}".`,
  };
}

async function handleGetIssue(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "get-issue",
      error: "Invalid repository format.",
    };
  }
  if (!parsed.number) {
    return {
      success: false,
      action: "get-issue",
      error: "Issue number required.",
    };
  }

  const res = await githubRequest(
    `/repos/${r.owner}/${r.repo}/issues/${parsed.number}`,
  );
  if (res.status !== 200) {
    return {
      success: false,
      action: "get-issue",
      error: `GitHub API error (${res.status})`,
    };
  }

  const i = res.data;
  const issue = {
    number: i.number,
    title: i.title,
    state: i.state,
    body: i.body || "",
    author: i.user?.login || "",
    labels: (i.labels || []).map((l) => l.name),
    assignees: (i.assignees || []).map((a) => a.login),
    milestone: i.milestone?.title || null,
    comments: i.comments,
    created: i.created_at,
    updated: i.updated_at,
    closed: i.closed_at,
    url: i.html_url,
  };

  return {
    success: true,
    action: "get-issue",
    result: issue,
    message: `#${issue.number}: ${issue.title} [${issue.state}]`,
  };
}

async function handleGetPR(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "get-pr",
      error: "Invalid repository format.",
    };
  }
  if (!parsed.number) {
    return { success: false, action: "get-pr", error: "PR number required." };
  }

  const res = await githubRequest(
    `/repos/${r.owner}/${r.repo}/pulls/${parsed.number}`,
  );
  if (res.status !== 200) {
    return {
      success: false,
      action: "get-pr",
      error: `GitHub API error (${res.status})`,
    };
  }

  const p = res.data;
  const pr = {
    number: p.number,
    title: p.title,
    state: p.state,
    body: p.body || "",
    author: p.user?.login || "",
    head: p.head?.ref || "",
    base: p.base?.ref || "",
    draft: p.draft || false,
    mergeable: p.mergeable,
    merged: p.merged || false,
    additions: p.additions,
    deletions: p.deletions,
    changedFiles: p.changed_files,
    reviewComments: p.review_comments,
    comments: p.comments,
    created: p.created_at,
    updated: p.updated_at,
    merged_at: p.merged_at,
    url: p.html_url,
  };

  return {
    success: true,
    action: "get-pr",
    result: pr,
    message: `PR #${pr.number}: ${pr.title} [${pr.state}] (+${pr.additions}/-${pr.deletions}, ${pr.changedFiles} files)`,
  };
}

async function handlePRReview(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "pr-review",
      error: "Invalid repository format.",
    };
  }
  if (!parsed.number) {
    return {
      success: false,
      action: "pr-review",
      error: "PR number required.",
    };
  }

  const payload = {
    body: parsed.params.body || "Reviewed via ChainlessChain GitHub Manager",
    event: parsed.params.reviewAction || "COMMENT",
  };

  const res = await githubRequest(
    `/repos/${r.owner}/${r.repo}/pulls/${parsed.number}/reviews`,
    "POST",
    payload,
  );

  if (res.status !== 200 && res.status !== 201) {
    return {
      success: false,
      action: "pr-review",
      error: `Failed (${res.status}): ${res.data.message}`,
    };
  }

  return {
    success: true,
    action: "pr-review",
    result: { id: res.data.id, state: res.data.state, prNumber: parsed.number },
    message: `Submitted ${payload.event} review on PR #${parsed.number}.`,
  };
}

async function handleListBranches(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "list-branches",
      error: "Invalid repository format.",
    };
  }

  const res = await githubRequest(
    `/repos/${r.owner}/${r.repo}/branches?per_page=${parsed.params.max}`,
  );
  if (res.status !== 200) {
    return {
      success: false,
      action: "list-branches",
      error: `GitHub API error (${res.status})`,
    };
  }

  const branches = (Array.isArray(res.data) ? res.data : []).map((b) => ({
    name: b.name,
    protected: b.protected || false,
    sha: b.commit?.sha?.substring(0, 7) || "",
  }));

  return {
    success: true,
    action: "list-branches",
    repo: parsed.repo,
    result: branches,
    message: `${branches.length} branch(es) in ${parsed.repo}.`,
  };
}

async function handleListReleases(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "list-releases",
      error: "Invalid repository format.",
    };
  }

  const res = await githubRequest(
    `/repos/${r.owner}/${r.repo}/releases?per_page=${parsed.params.max}`,
  );
  if (res.status !== 200) {
    return {
      success: false,
      action: "list-releases",
      error: `GitHub API error (${res.status})`,
    };
  }

  const releases = (Array.isArray(res.data) ? res.data : []).map((rel) => ({
    id: rel.id,
    tag: rel.tag_name,
    name: rel.name || rel.tag_name,
    draft: rel.draft,
    prerelease: rel.prerelease,
    author: rel.author?.login || "",
    created: rel.created_at,
    published: rel.published_at,
    assets: (rel.assets || []).length,
    url: rel.html_url,
  }));

  return {
    success: true,
    action: "list-releases",
    repo: parsed.repo,
    result: releases,
    message: `${releases.length} release(s) in ${parsed.repo}.`,
  };
}

async function handleCreateRelease(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "create-release",
      error: "Invalid repository format.",
    };
  }

  const { tag, title, body } = parsed.params;
  if (!tag) {
    return {
      success: false,
      action: "create-release",
      error:
        "Tag required. Use: create-release owner/repo tag:<version> title:'<name>'",
    };
  }

  const payload = {
    tag_name: tag,
    name: title || tag,
    body: body || "",
    draft: false,
    prerelease: false,
  };
  const res = await githubRequest(
    `/repos/${r.owner}/${r.repo}/releases`,
    "POST",
    payload,
  );

  if (res.status !== 201) {
    return {
      success: false,
      action: "create-release",
      error: `Failed (${res.status}): ${res.data.message}`,
    };
  }

  return {
    success: true,
    action: "create-release",
    result: {
      id: res.data.id,
      tag: res.data.tag_name,
      name: res.data.name,
      url: res.data.html_url,
    },
    message: `Created release "${res.data.name}" (${res.data.tag_name}) in ${parsed.repo}.`,
  };
}

async function handleCompareBranches(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "compare",
      error: "Invalid repository format.",
    };
  }

  const { base, head } = parsed.params;
  if (!head) {
    return {
      success: false,
      action: "compare",
      error: "Head branch required.",
    };
  }

  const res = await githubRequest(
    `/repos/${r.owner}/${r.repo}/compare/${base || "main"}...${head}`,
  );
  if (res.status !== 200) {
    return {
      success: false,
      action: "compare",
      error: `GitHub API error (${res.status}): ${res.data.message}`,
    };
  }

  const d = res.data;
  const comparison = {
    status: d.status,
    aheadBy: d.ahead_by,
    behindBy: d.behind_by,
    totalCommits: d.total_commits,
    files: (d.files || []).map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
    fileCount: (d.files || []).length,
    url: d.html_url,
  };

  return {
    success: true,
    action: "compare",
    result: comparison,
    message: `${base || "main"}...${head}: ${comparison.status}, ${comparison.totalCommits} commit(s), ${comparison.fileCount} file(s) changed (+${d.files?.reduce((s, f) => s + f.additions, 0) || 0}/-${d.files?.reduce((s, f) => s + f.deletions, 0) || 0})`,
  };
}

async function handleListLabels(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) {
    return {
      success: false,
      action: "list-labels",
      error: "Invalid repository format.",
    };
  }

  const res = await githubRequest(
    `/repos/${r.owner}/${r.repo}/labels?per_page=100`,
  );
  if (res.status !== 200) {
    return {
      success: false,
      action: "list-labels",
      error: `GitHub API error (${res.status})`,
    };
  }

  const labels = (Array.isArray(res.data) ? res.data : []).map((l) => ({
    name: l.name,
    color: l.color,
    description: l.description || "",
  }));

  return {
    success: true,
    action: "list-labels",
    repo: parsed.repo,
    result: labels,
    message: `${labels.length} label(s) in ${parsed.repo}.`,
  };
}

// ── Module Exports ────────────────────────────────

module.exports = {
  _deps,
  async init(skill) {
    logger.info("[GitHubManager] Initialized (v2.0)");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    if (!getToken()) {
      return {
        success: false,
        action: parsed.action,
        error:
          "GITHUB_TOKEN not configured. Set the GITHUB_TOKEN or GH_TOKEN environment variable.",
      };
    }

    try {
      switch (parsed.action) {
        case "list-issues":
          return await handleListIssues(parsed);
        case "create-issue":
          return await handleCreateIssue(parsed);
        case "get-issue":
          return await handleGetIssue(parsed);
        case "list-prs":
          return await handleListPRs(parsed);
        case "create-pr":
          return await handleCreatePR(parsed);
        case "get-pr":
          return await handleGetPR(parsed);
        case "pr-review":
          return await handlePRReview(parsed);
        case "repo-info":
          return await handleRepoInfo(parsed);
        case "list-workflows":
          return await handleListWorkflows(parsed);
        case "search-code":
          return await handleSearchCode(parsed);
        case "list-branches":
          return await handleListBranches(parsed);
        case "list-releases":
          return await handleListReleases(parsed);
        case "create-release":
          return await handleCreateRelease(parsed);
        case "compare":
          return await handleCompareBranches(parsed);
        case "list-labels":
          return await handleListLabels(parsed);
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}.\n\nActions: list-issues, create-issue, get-issue, list-prs, create-pr, get-pr, pr-review, repo-info, list-workflows, search-code, list-branches, list-releases, create-release, compare, list-labels`,
          };
      }
    } catch (error) {
      logger.error("[GitHubManager] Error:", error);
      return { success: false, action: parsed.action, error: error.message };
    }
  },
};
