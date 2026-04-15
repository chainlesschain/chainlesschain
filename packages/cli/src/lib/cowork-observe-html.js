/**
 * Cowork Observe HTML — builds a static single-page dashboard from an
 * aggregate snapshot. Pure function; no I/O.
 *
 * @module cowork-observe-html
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * Build a self-contained HTML dashboard from aggregate output.
 * @param {object} data - result of `aggregate()`
 * @returns {string} full HTML document
 */
export function buildHtml(data) {
  const safeJson = escapeJsonForScript(data || {});
  const win = data?.window || {};
  const t = data?.tasks || {};
  const templates = data?.templates || [];
  const failures = data?.failures || [];
  const next = data?.schedules?.nextTriggers || [];

  const templateRows = templates
    .slice(0, 10)
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.templateName || row.templateId)}</td>` +
        `<td>${row.runs}</td><td>${Math.round((row.successRate || 0) * 100)}%</td>` +
        `<td>${row.avgTokens || 0}</td></tr>`,
    )
    .join("");

  const failureRows = failures
    .slice(0, 10)
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.templateName || row.templateId)}</td>` +
        `<td>${row.failureCount}</td>` +
        `<td>${escapeHtml((row.commonSummaries?.[0]?.summary || "—").slice(0, 80))}</td></tr>`,
    )
    .join("");

  const nextRows = next
    .map(
      (n) =>
        `<tr><td>${escapeHtml(n.at)}</td><td>${escapeHtml(n.cron)}</td><td>${escapeHtml(n.scheduleId || "—")}</td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cowork Observe — ChainlessChain</title>
  <script>window.__COWORK_OBSERVE__ = ${safeJson};</script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 20px; background: #0e1116; color: #e6edf3; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    h2 { margin: 24px 0 8px; font-size: 16px; color: #9ec5ff; }
    .meta { color: #7d8590; font-size: 13px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 16px 0; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 14px; }
    .card .num { font-size: 24px; font-weight: 600; color: #58a6ff; }
    .card .lbl { color: #7d8590; font-size: 12px; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #30363d; font-size: 13px; }
    th { background: #1f242c; color: #9ec5ff; font-weight: 500; }
    tr:last-child td { border-bottom: none; }
    .empty { color: #7d8590; font-style: italic; padding: 12px 0; }
  </style>
</head>
<body>
  <h1>Cowork Observe</h1>
  <div class="meta">Window: ${escapeHtml(win.days || 7)} days · ${escapeHtml(win.from || "")} → ${escapeHtml(win.to || "")}</div>
  <div class="cards">
    <div class="card"><div class="num">${t.total || 0}</div><div class="lbl">Tasks</div></div>
    <div class="card"><div class="num">${Math.round((t.successRate || 0) * 100)}%</div><div class="lbl">Success rate</div></div>
    <div class="card"><div class="num">${t.failed || 0}</div><div class="lbl">Failed</div></div>
    <div class="card"><div class="num">${t.avgTokens || 0}</div><div class="lbl">Avg tokens</div></div>
    <div class="card"><div class="num">${data?.schedules?.active || 0}</div><div class="lbl">Active schedules</div></div>
  </div>

  <h2>Templates (top 10 by runs)</h2>
  ${templates.length ? `<table><thead><tr><th>Template</th><th>Runs</th><th>Success</th><th>Avg tokens</th></tr></thead><tbody>${templateRows}</tbody></table>` : `<div class="empty">No template runs in window.</div>`}

  <h2>Failures (top 10)</h2>
  ${failures.length ? `<table><thead><tr><th>Template</th><th>Count</th><th>Common summary</th></tr></thead><tbody>${failureRows}</tbody></table>` : `<div class="empty">No failures in window — nice.</div>`}

  <h2>Next scheduled triggers</h2>
  ${next.length ? `<table><thead><tr><th>At</th><th>Cron</th><th>Schedule</th></tr></thead><tbody>${nextRows}</tbody></table>` : `<div class="empty">No upcoming triggers.</div>`}
</body>
</html>`;
}
