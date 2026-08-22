/**
 * Local-only GitLab merge-request reference parsing and worktree footer UI.
 *
 * This intentionally performs no network I/O and never accepts a token. A
 * caller may render an MR produced by a later `glab`/GitLab integration while
 * preserving a safe, portable contract for local worktree workflows.
 */

const MAX_REFERENCE_BYTES = 4096;
const MAX_TITLE_BYTES = 512;
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const IID_RE = /^[1-9][0-9]{0,9}$/u;

function safeText(value, label, maximum) {
  if (
    typeof value !== "string" ||
    !value ||
    Buffer.byteLength(value, "utf8") > maximum ||
    /[\r\n\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function safeProjectPath(value) {
  const segments = String(value || "").split("/");
  if (
    segments.length < 2 ||
    segments.some((segment) => !SEGMENT_RE.test(segment))
  ) {
    throw new TypeError("GitLab project path is invalid");
  }
  return segments.join("/");
}

function safeHost(value) {
  const host = safeText(String(value || "").toLowerCase(), "GitLab host", 255);
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(host) &&
    host !== "localhost"
  ) {
    throw new TypeError("GitLab host is invalid");
  }
  return host;
}

function safeIid(value) {
  const iid = String(value || "");
  if (!IID_RE.test(iid)) throw new TypeError("GitLab MR iid is invalid");
  return Number(iid);
}

function buildWebUrl(host, projectPath, iid) {
  return `https://${host}/${projectPath}/-/merge_requests/${iid}`;
}

/**
 * Parse an HTTPS GitLab web URL or `namespace/project!iid` shorthand. Nested
 * subgroup paths are allowed; credentials, query strings and fragments are
 * rejected rather than echoed into terminal output.
 */
export function parseGitLabMergeRequestReference(value, options = {}) {
  const input = safeText(
    String(value || "").trim(),
    "GitLab MR reference",
    MAX_REFERENCE_BYTES,
  );
  if (/(?:^|\/)(?:\.|\.\.)(?:\/|$)/u.test(input)) {
    throw new TypeError("GitLab MR reference is invalid");
  }
  const shorthand = input.match(/^(.+)!([1-9][0-9]{0,9})$/u);
  if (shorthand && !input.includes("://")) {
    const host = safeHost(options.defaultHost || "gitlab.com");
    const projectPath = safeProjectPath(shorthand[1]);
    const iid = safeIid(shorthand[2]);
    return Object.freeze({
      host,
      projectPath,
      iid,
      webUrl: buildWebUrl(host, projectPath, iid),
    });
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new TypeError("GitLab MR reference is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new TypeError("GitLab MR reference is invalid");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const marker = parts.lastIndexOf("-");
  if (
    marker < 2 ||
    parts[marker + 1] !== "merge_requests" ||
    parts.length !== marker + 3
  ) {
    throw new TypeError("GitLab MR reference is invalid");
  }
  const host = safeHost(url.hostname);
  const projectPath = safeProjectPath(parts.slice(0, marker).join("/"));
  const iid = safeIid(parts[marker + 2]);
  return Object.freeze({
    host,
    projectPath,
    iid,
    webUrl: buildWebUrl(host, projectPath, iid),
  });
}

function safeOptionalText(value, label, maximum = 255) {
  if (value == null || value === "") return null;
  return safeText(String(value), label, maximum);
}

/** Normalize a local GitLab MR display model without retaining API extras. */
export function normalizeGitLabMergeRequest(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("GitLab MR is invalid");
  }
  const reference = parseGitLabMergeRequestReference(
    value.webUrl || value.web_url || value.reference,
    options,
  );
  const iid = value.iid == null ? reference.iid : safeIid(value.iid);
  if (iid !== reference.iid)
    throw new TypeError("GitLab MR iid does not match reference");
  const state = safeOptionalText(
    value.state || "opened",
    "GitLab MR state",
    32,
  )?.toLowerCase();
  if (state && !new Set(["opened", "closed", "merged", "locked"]).has(state)) {
    throw new TypeError("GitLab MR state is invalid");
  }
  return Object.freeze({
    ...reference,
    title: safeOptionalText(value.title, "GitLab MR title", MAX_TITLE_BYTES),
    state: state || "opened",
    sourceBranch: safeOptionalText(
      value.sourceBranch || value.source_branch,
      "GitLab MR source branch",
    ),
    targetBranch: safeOptionalText(
      value.targetBranch || value.target_branch,
      "GitLab MR target branch",
    ),
  });
}

/** Render a compact, safe footer suitable for terminal and IDE worktree views. */
export function renderGitLabMergeRequestFooter(value, options = {}) {
  const mr = normalizeGitLabMergeRequest(value, options);
  const lines = [`GitLab MR !${mr.iid} · ${mr.state}`, mr.webUrl];
  if (mr.title) lines.push(mr.title);
  if (mr.sourceBranch || mr.targetBranch) {
    lines.push(`${mr.sourceBranch || "?"} → ${mr.targetBranch || "?"}`);
  }
  const worktreePath = safeOptionalText(
    options.worktreePath,
    "GitLab worktree path",
    4096,
  );
  if (worktreePath) lines.push(`worktree: ${worktreePath}`);
  return lines.join("\n");
}
