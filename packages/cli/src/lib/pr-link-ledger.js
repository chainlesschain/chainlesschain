/**
 * PR / session linking (gap-2026-07-11 P1#9) — Claude-Code agent-view parity:
 * remember which pull requests a session created, viewed, commented on,
 * merged, or pushed to, so `cc session show` and the background-agent
 * dashboard can display `#123 open` next to the session.
 *
 * Sources:
 * - successful `gh pr create/view/merge/comment/checkout/…` tool commands —
 *   their stdout carries the canonical https://github.com/o/r/pull/N URL;
 * - `git push` — best-effort `gh pr list --head <branch>` lookup (async,
 *   3s timeout, silently skipped when gh is unavailable).
 *
 * Ledger: ~/.chainlesschain/pr-links.json
 *   { "<sessionId>": [{ number, repo, url, state, action, updatedAt }] }
 * Everything here is best-effort — a ledger failure must never break a tool
 * result or a session listing.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHomeDir } from "./paths.js";
import { executionBroker } from "./process-execution-broker/index.js";

export const _deps = {
  execFile: (...args) => executionBroker.execFile(...args),
  now: () => Date.now(),
};

const MAX_LINKS_PER_SESSION = 20;
const MAX_SESSIONS = 500;

export function prLinkLedgerPath() {
  return join(getHomeDir(), "pr-links.json");
}

export function readPrLinkLedger() {
  try {
    const p = prLinkLedgerPath();
    if (!existsSync(p)) return {};
    const parsed = JSON.parse(readFileSync(p, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // corrupt ledger degrades to empty, never throws
  }
}

function writeLedger(ledger) {
  const ids = Object.keys(ledger);
  if (ids.length > MAX_SESSIONS) {
    // Evict the oldest sessions by their newest link's updatedAt.
    const newest = (id) =>
      Math.max(0, ...(ledger[id] || []).map((l) => l.updatedAt || 0));
    for (const id of ids
      .sort((a, b) => newest(a) - newest(b))
      .slice(0, ids.length - MAX_SESSIONS)) {
      delete ledger[id];
    }
  }
  writeFileSync(prLinkLedgerPath(), JSON.stringify(ledger, null, 2), "utf-8");
}

const PR_URL_RE = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;
const GH_PR_CMD_RE =
  /^\s*gh\s+pr\s+(create|view|merge|comment|checkout|edit|ready|close|reopen|review)\b/;
const GH_PR_NUMBER_RE =
  /^\s*gh\s+pr\s+(?:view|merge|comment|checkout|edit|ready|close|reopen|review)\s+(?:--\S+\s+)*#?(\d+)\b/;

/** True when the shell command is a `gh pr …` subcommand we track. */
export function isGhPrCommand(command) {
  return GH_PR_CMD_RE.test(String(command || ""));
}

/**
 * Extract PR refs from a tracked `gh pr` command + its output. Pure.
 * @returns {Array<{number:number, repo:string|null, url:string|null, action:string}>}
 */
export function parsePrRefs(command, output) {
  const cmd = String(command || "");
  const match = cmd.match(GH_PR_CMD_RE);
  if (!match) return [];
  const action = match[1];
  const refs = new Map(); // repo#number → ref

  for (const m of String(output || "").matchAll(PR_URL_RE)) {
    const repo = `${m[1]}/${m[2]}`;
    const number = Number(m[3]);
    refs.set(`${repo}#${number}`, {
      number,
      repo,
      url: m[0],
      action,
    });
  }
  // `gh pr merge 123` style — explicit number, repo unknown from text alone.
  if (refs.size === 0) {
    const numbered = cmd.match(GH_PR_NUMBER_RE);
    if (numbered) {
      const number = Number(numbered[1]);
      refs.set(`?#${number}`, { number, repo: null, url: null, action });
    }
  }
  return [...refs.values()];
}

const TERMINAL_ACTIONS = { merge: "merged", close: "closed", reopen: "open" };

/** Merge one PR ref into a session's link list (dedupe by repo#number). */
export function recordPrLink(sessionId, ref, options = {}) {
  if (!sessionId || !ref || !Number.isFinite(Number(ref.number))) return null;
  const now = typeof options.now === "number" ? options.now : _deps.now();
  const ledger = readPrLinkLedger();
  const links = Array.isArray(ledger[sessionId]) ? ledger[sessionId] : [];
  const key = (l) => `${l.repo || "?"}#${l.number}`;
  const incoming = {
    number: Number(ref.number),
    repo: ref.repo || null,
    url: ref.url || null,
    state: ref.state || TERMINAL_ACTIONS[ref.action] || "open",
    action: ref.action || null,
    updatedAt: now,
  };
  const existing = links.find((l) => key(l) === key(incoming));
  if (existing) {
    Object.assign(existing, {
      ...incoming,
      url: incoming.url || existing.url,
      repo: incoming.repo || existing.repo,
    });
  } else {
    links.push(incoming);
    if (links.length > MAX_LINKS_PER_SESSION) {
      links.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      links.length = MAX_LINKS_PER_SESSION;
    }
  }
  ledger[sessionId] = links;
  writeLedger(ledger);
  return incoming;
}

/** Links for a session, newest first. */
export function getPrLinks(sessionId) {
  if (!sessionId) return [];
  const links = readPrLinkLedger()[sessionId];
  return Array.isArray(links)
    ? [...links].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    : [];
}

function ghPrForBranch(cwd, timeoutMs = 3000) {
  const run = (file, fileArgs) =>
    new Promise((resolve) => {
      _deps.execFile(
        file,
        fileArgs,
        {
          cwd,
          encoding: "utf8",
          timeout: timeoutMs,
          windowsHide: true,
          origin: "pr:link-query",
          policy: "allow",
          scope: "pr",
          shell: false,
        },
        (err, stdout) => resolve(err ? null : String(stdout || "").trim()),
      );
    });
  return (async () => {
    const branch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (!branch || branch === "HEAD") return [];
    const out = await run("gh", [
      "pr",
      "list",
      "--head",
      branch,
      "--json",
      "number,url,state",
    ]);
    if (!out) return [];
    try {
      const rows = JSON.parse(out);
      return (Array.isArray(rows) ? rows : []).map((r) => {
        const urlMatch = String(r.url || "").match(
          /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\//,
        );
        return {
          number: Number(r.number),
          url: r.url || null,
          repo: urlMatch ? `${urlMatch[1]}/${urlMatch[2]}` : null,
          state: String(r.state || "open").toLowerCase(),
          action: "push",
        };
      });
    } catch {
      return [];
    }
  })();
}

/**
 * Best-effort hook for the run_shell tool: record PR links produced by this
 * command. Fire-and-forget — resolves quietly on every failure path.
 */
export async function recordFromShellCommand({
  sessionId,
  command,
  output,
  cwd,
}) {
  try {
    if (!sessionId || !command) return;
    if (isGhPrCommand(command)) {
      for (const ref of parsePrRefs(command, output)) {
        recordPrLink(sessionId, ref);
      }
      return;
    }
    if (/^\s*git\s+push\b/.test(String(command))) {
      const refs = await ghPrForBranch(cwd || process.cwd());
      for (const ref of refs) recordPrLink(sessionId, ref);
    }
  } catch {
    /* never surface ledger failures into tool results */
  }
}

/** One-line render for panels: "#123 open · #98 merged". */
export function formatPrLinks(links) {
  return (links || [])
    .map((l) => `#${l.number}${l.state ? ` ${l.state}` : ""}`)
    .join(" · ");
}
