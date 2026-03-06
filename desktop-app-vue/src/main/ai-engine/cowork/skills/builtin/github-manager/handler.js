/**
 * GitHub Manager Skill Handler
 *
 * Manages GitHub issues, pull requests, repositories, and workflows
 * via the GitHub REST API. Requires GITHUB_TOKEN in environment.
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

    if (token) options.headers.Authorization = `Bearer ${token}`;

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
          logger.warn("[GitHubManager] Failed to parse JSON response from %s", path);
          resolve({ status: res.statusCode, data: { raw: data } });
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

module.exports = {
  _deps,
  async init(skill) {
    logger.info("[GitHubManager] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    if (!getToken()) {
      return {
        success: false,
        action: parsed.action,
        error: "GITHUB_TOKEN not configured. Set the GITHUB_TOKEN or GH_TOKEN environment variable.",
      };
    }

    try {
      switch (parsed.action) {
        case "list-issues": return await handleListIssues(parsed);
        case "create-issue": return await handleCreateIssue(parsed);
        case "list-prs": return await handleListPRs(parsed);
        case "create-pr": return await handleCreatePR(parsed);
        case "repo-info": return await handleRepoInfo(parsed);
        case "list-workflows": return await handleListWorkflows(parsed);
        default: return { success: false, error: `Unknown action: ${parsed.action}. Use: list-issues, create-issue, list-prs, create-pr, repo-info, list-workflows` };
      }
    } catch (error) {
      logger.error("[GitHubManager] Error:", error);
      return { success: false, action: parsed.action, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") return { action: "list-issues", repo: "", params: {} };
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const action = (parts[0] || "").toLowerCase();

  // Find owner/repo pattern
  const repoMatch = trimmed.match(/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
  const repo = repoMatch ? repoMatch[1] : "";

  // Parse flags
  const stateMatch = trimmed.match(/--state\s+(\S+)/);
  const maxMatch = trimmed.match(/--max\s+(\d+)/);
  const labelsMatch = trimmed.match(/--labels\s+(\S+)/);

  // Parse quoted fields: title:'...' body:'...'
  const titleMatch = trimmed.match(/title:['"](.*?)['"]/);
  const bodyMatch = trimmed.match(/body:['"](.*?)['"]/);
  const headMatch = trimmed.match(/head:(\S+)/);
  const baseMatch = trimmed.match(/base:(\S+)/);

  return {
    action: action || "list-issues",
    repo,
    params: {
      state: stateMatch ? stateMatch[1] : "open",
      max: maxMatch ? parseInt(maxMatch[1], 10) : 30,
      labels: labelsMatch ? labelsMatch[1].split(",") : [],
      title: titleMatch ? titleMatch[1] : "",
      body: bodyMatch ? bodyMatch[1] : "",
      head: headMatch ? headMatch[1] : "",
      base: baseMatch ? baseMatch[1] : "main",
    },
  };
}

function parseRepo(repo) {
  const parts = repo.split("/");
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

async function handleListIssues(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) return { success: false, action: "list-issues", error: "Invalid repository format. Use: owner/repo" };

  const state = parsed.params.state;
  const max = parsed.params.max;

  const res = await githubRequest(`/repos/${r.owner}/${r.repo}/issues?state=${state}&per_page=${max}&sort=updated&direction=desc`);

  if (res.status !== 200) {
    return { success: false, action: "list-issues", error: `GitHub API error (${res.status}): ${res.data.message || JSON.stringify(res.data)}` };
  }

  // Filter out pull requests (GitHub returns PRs as issues too)
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
  if (!r) return { success: false, action: "create-issue", error: "Invalid repository format. Use: owner/repo" };

  const { title, body, labels } = parsed.params;
  if (!title) return { success: false, action: "create-issue", error: "Title required. Use: create-issue owner/repo title:'<title>' body:'<body>'" };

  const payload = { title, body: body || "" };
  if (labels.length > 0) payload.labels = labels;

  const res = await githubRequest(`/repos/${r.owner}/${r.repo}/issues`, "POST", payload);

  if (res.status !== 201) {
    return { success: false, action: "create-issue", error: `Failed to create issue (${res.status}): ${res.data.message || JSON.stringify(res.data)}` };
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
  if (!r) return { success: false, action: "list-prs", error: "Invalid repository format. Use: owner/repo" };

  const state = parsed.params.state;
  const max = parsed.params.max;

  const res = await githubRequest(`/repos/${r.owner}/${r.repo}/pulls?state=${state}&per_page=${max}&sort=updated&direction=desc`);

  if (res.status !== 200) {
    return { success: false, action: "list-prs", error: `GitHub API error (${res.status}): ${res.data.message || JSON.stringify(res.data)}` };
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
    message: `Found ${prs.length} ${state} pull request(s) in ${parsed.repo}.`,
  };
}

async function handleCreatePR(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) return { success: false, action: "create-pr", error: "Invalid repository format. Use: owner/repo" };

  const { title, body, head, base } = parsed.params;
  if (!title) return { success: false, action: "create-pr", error: "Title required. Use: create-pr owner/repo title:'<title>' head:<branch> base:<branch>" };
  if (!head) return { success: false, action: "create-pr", error: "Head branch required. Use: head:<branch-name>" };

  const payload = { title, body: body || "", head, base: base || "main" };

  const res = await githubRequest(`/repos/${r.owner}/${r.repo}/pulls`, "POST", payload);

  if (res.status !== 201) {
    return { success: false, action: "create-pr", error: `Failed to create PR (${res.status}): ${res.data.message || JSON.stringify(res.data)}` };
  }

  return {
    success: true,
    action: "create-pr",
    result: {
      number: res.data.number,
      title: res.data.title,
      url: res.data.html_url,
      state: res.data.state,
      head: head,
      base: base || "main",
    },
    message: `Created PR #${res.data.number}: "${res.data.title}" (${head} -> ${base || "main"}) in ${parsed.repo}.`,
  };
}

async function handleRepoInfo(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) return { success: false, action: "repo-info", error: "Invalid repository format. Use: owner/repo" };

  const res = await githubRequest(`/repos/${r.owner}/${r.repo}`);

  if (res.status !== 200) {
    return { success: false, action: "repo-info", error: `GitHub API error (${res.status}): ${res.data.message || JSON.stringify(res.data)}` };
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
    message: `${info.name}: ${info.description || "No description"} | ${info.language} | ${info.stars} stars | ${info.openIssues} open issues`,
  };
}

async function handleListWorkflows(parsed) {
  const r = parseRepo(parsed.repo);
  if (!r) return { success: false, action: "list-workflows", error: "Invalid repository format. Use: owner/repo" };

  const res = await githubRequest(`/repos/${r.owner}/${r.repo}/actions/runs?per_page=${parsed.params.max}`);

  if (res.status !== 200) {
    return { success: false, action: "list-workflows", error: `GitHub API error (${res.status}): ${res.data.message || JSON.stringify(res.data)}` };
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
    duration: w.updated_at && w.created_at ? Math.round((new Date(w.updated_at) - new Date(w.created_at)) / 1000) : null,
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
    message: `${runs.length} workflow run(s) in ${parsed.repo}: ${summary.success} passed, ${summary.failure} failed, ${summary.inProgress} in progress.`,
  };
}
