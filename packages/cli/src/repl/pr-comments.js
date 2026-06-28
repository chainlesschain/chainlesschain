/**
 * `/pr-comments` REPL command (Claude-Code parity) — fetch a GitHub pull
 * request's review summaries, conversation comments and inline code comments
 * via the `gh` CLI, format them, and feed the block back as this turn's input
 * so the agent can address the feedback.
 *
 * The pure pieces (parse args + format) are unit-tested; the `gh` calls go
 * through an injected `runGh` so fetchPrComments is testable without a network
 * or a real repo. The REPL (agent-repl.js) wires expandPrComments into the
 * same promptText seam that `/mcp__server__prompt` uses.
 */
import { execFile } from "child_process";

/** Default `gh` runner — resolves stdout, rejects with a friendly message. */
function defaultRunGh(args) {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if (err.code === "ENOENT") {
            return reject(
              new Error(
                "gh CLI not found — install GitHub CLI (https://cli.github.com) and run `gh auth login`.",
              ),
            );
          }
          return reject(
            new Error(String(stderr || err.message || "gh failed").trim()),
          );
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * Parse `/pr-comments [<n>|<url>] [--repo owner/name]`.
 * @returns {{ pr: number|null, repo: string|null }}
 */
export function parsePrCommentsArg(line) {
  const rest = String(line || "")
    .trim()
    .replace(/^\/pr-comments\b/, "")
    .trim();
  let pr = null;
  let repo = null;
  const tokens = rest.length ? rest.split(/\s+/) : [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === "--repo" || t === "-R") {
      repo = tokens[i + 1] || null;
      i += 1;
    } else if (/^\d+$/.test(t)) {
      pr = Number(t);
    } else {
      const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(t);
      if (m) {
        repo = repo || m[1];
        pr = pr ?? Number(m[2]);
      }
    }
  }
  return { pr, repo };
}

/** Indent a (possibly multi-line) comment body under its header. */
function indentBody(body, indent = "    ") {
  const text = String(body || "").trim();
  if (!text) return `${indent}(empty)`;
  return text
    .split(/\r?\n/)
    .map((l) => indent + l)
    .join("\n");
}

/**
 * Format fetched PR comment data into a plain-text block.
 * @param {object} data  { number, title, url, reviews[], conversation[], inline[] }
 */
export function formatPrComments(data) {
  const number = data?.number;
  const reviews = (Array.isArray(data?.reviews) ? data.reviews : []).filter(
    (r) => (r?.body && r.body.trim()) || (r?.state && r.state !== "COMMENTED"),
  );
  const conv = Array.isArray(data?.conversation) ? data.conversation : [];
  const inline = Array.isArray(data?.inline) ? data.inline : [];

  const lines = [`PR #${number ?? "?"} — ${data?.title || "(no title)"}`];
  if (data?.url) lines.push(data.url);

  lines.push("", `Reviews (${reviews.length}):`);
  for (const r of reviews) {
    const who = r?.author?.login || r?.user?.login || "?";
    lines.push(`  @${who} ${r?.state || ""}`.trimEnd());
    if (r?.body && r.body.trim()) lines.push(indentBody(r.body));
  }

  lines.push("", `Conversation comments (${conv.length}):`);
  for (const c of conv) {
    const who = c?.author?.login || c?.user?.login || "?";
    lines.push(`  @${who}:`);
    lines.push(indentBody(c?.body));
  }

  lines.push("", `Inline code comments (${inline.length}):`);
  for (const c of inline) {
    const who = c?.user?.login || c?.author?.login || "?";
    const lineNo = c?.line ?? c?.original_line;
    const loc = c?.path
      ? `${c.path}${lineNo != null ? ":" + lineNo : ""}`
      : "?";
    lines.push(`  ${loc} @${who}:`);
    lines.push(indentBody(c?.body));
  }

  return lines.join("\n");
}

/**
 * Fetch a PR's reviews + conversation + inline comments via `gh`.
 * @param {object} opts  { pr?: number, repo?: string, deps?: { runGh } }
 */
export async function fetchPrComments({ pr = null, repo = null, deps } = {}) {
  const runGh = deps?.runGh || defaultRunGh;
  const viewArgs = ["pr", "view"];
  if (pr) viewArgs.push(String(pr));
  if (repo) viewArgs.push("--repo", repo);
  viewArgs.push("--json", "number,title,url,comments,reviews");
  const meta = JSON.parse(await runGh(viewArgs));
  const number = meta?.number;

  let ownerRepo = repo;
  if (!ownerRepo) {
    const m = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(meta?.url || "");
    ownerRepo = m ? m[1] : null;
  }

  let inline = [];
  if (ownerRepo && number) {
    try {
      const raw = await runGh([
        "api",
        `repos/${ownerRepo}/pulls/${number}/comments?per_page=100`,
      ]);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) inline = parsed;
    } catch {
      // inline review-thread comments are best-effort; the JSON view above is
      // the primary source.
      inline = [];
    }
  }

  return {
    number,
    title: meta?.title,
    url: meta?.url,
    reviews: Array.isArray(meta?.reviews) ? meta.reviews : [],
    conversation: Array.isArray(meta?.comments) ? meta.comments : [],
    inline,
  };
}

const PR_INSTRUCTION =
  "下面是该 PR 的评审意见（reviews / 评论 / 行内代码评论）。请逐条理解并处理：" +
  "能直接改的就改代码，需要讨论或澄清的给出回应。";

/**
 * Expand a `/pr-comments …` line into turn input. Returns
 * `{ number, count, block, text }`, or `null` when the line isn't the command.
 * Throws on fetch failure (the REPL surfaces it and skips the turn).
 */
export async function expandPrComments(line, { deps } = {}) {
  if (!String(line || "").trim().startsWith("/pr-comments")) return null;
  const { pr, repo } = parsePrCommentsArg(line);
  const data = await fetchPrComments({ pr, repo, deps });
  const block = formatPrComments(data);
  const count =
    (data.reviews?.length || 0) +
    (data.conversation?.length || 0) +
    (data.inline?.length || 0);
  return { number: data.number, count, block, text: `${PR_INSTRUCTION}\n\n${block}` };
}
