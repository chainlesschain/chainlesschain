/**
 * Chrome connector IDE entry (P1 #8) — pure logic for the
 * `chainlesschain.chrome.connector` command. Wraps the CLI's
 * `cc browse chrome status/launch/state --json` (CDP attach to the user's
 * real/dedicated-profile Chrome) and renders the captured page state
 * (URL/title/console/network/DOM size/screenshot) as a markdown report the
 * agent-assisted debugging flow starts from.
 */

function buildChromeStatusArgs(port) {
  return [
    "browse",
    "chrome",
    "status",
    "--port",
    String(port || 9222),
    "--json",
  ];
}

function buildChromeLaunchArgs({ port, url, defaultProfile } = {}) {
  const args = ["browse", "chrome", "launch", "--port", String(port || 9222)];
  if (url) args.push("--url", String(url));
  if (defaultProfile) args.push("--default-profile");
  args.push("--json");
  return args;
}

function buildChromeStateArgs({
  port,
  tab,
  watchMs,
  reload,
  screenshotPath,
} = {}) {
  const args = [
    "browse",
    "chrome",
    "state",
    "--port",
    String(port || 9222),
    "--tab",
    String(tab || 0),
    "--watch-ms",
    String(watchMs ?? 3000),
  ];
  if (reload) args.push("--reload");
  if (screenshotPath) args.push("--screenshot", String(screenshotPath));
  args.push("--json");
  return args;
}

/** Tolerant parse of any of the three --json replies. */
function parseChromeJson(text) {
  try {
    const parsed = JSON.parse(String(text || "").trim());
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Render a captured state as the markdown report. Null when not ok. */
function stateToMarkdown(state) {
  if (!state || state.ok !== true) return null;
  const lines = [
    "# Chrome page state",
    "",
    `**${escapeMd(state.title || "(untitled)")}**`,
    "",
    `URL: \`${state.url || "?"}\`  ·  tab ${state.tab} of ${state.tabs?.length ?? "?"}` +
      (state.html
        ? `  ·  DOM ${state.html.length}${state.htmlTruncated ? "+ (truncated)" : ""} chars`
        : ""),
    "",
  ];
  if (state.screenshotPath) {
    lines.push(`Screenshot: \`${state.screenshotPath}\``, "");
  }
  lines.push("## Console", "");
  if (!state.console?.length) {
    lines.push(
      "_Nothing captured — console/network are observed from attach time; use Reload capture to catch load-time output._",
    );
  } else {
    for (const c of state.console.slice(0, 50)) {
      lines.push(`- \`${c.type}\` ${escapeMd(c.text)}`);
    }
  }
  lines.push("", "## Network issues", "");
  if (!state.network?.length) {
    lines.push("_No failed or 4xx/5xx requests observed._");
  } else {
    for (const nw of state.network.slice(0, 50)) {
      lines.push(
        `- \`${nw.kind}\` ${escapeMd(nw.url)}${nw.status ? ` → ${nw.status}` : ""}${nw.error ? ` (${escapeMd(nw.error)})` : ""}`,
      );
    }
  }
  if (state.tabs?.length > 1) {
    lines.push("", "## Tabs", "");
    for (const t of state.tabs) {
      lines.push(`- [${t.index}] ${escapeMd(t.url)}`);
    }
  }
  lines.push(
    "",
    "_Captured with `cc browse chrome state` — the agent can run the same command (add `--reload`) to see this context._",
    "",
  );
  return lines.join("\n");
}

function escapeMd(s) {
  return String(s || "")
    .replace(/([\\`*_[\]])/g, "\\$1")
    .slice(0, 400);
}

module.exports = {
  buildChromeLaunchArgs,
  buildChromeStateArgs,
  buildChromeStatusArgs,
  parseChromeJson,
  stateToMarkdown,
};
