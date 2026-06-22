"use strict";

/**
 * cowork-observe-html buildHtml tests (previously untested).
 *
 * buildHtml renders a static dashboard from an aggregate snapshot and embeds
 * user-controlled data (template names, failure summaries, schedule fields) into
 * HTML and into an inline <script> JSON blob. The escaping is the security
 * boundary — these tests pin XSS safety (HTML entity escaping + JSON
 * script-breakout escaping) plus the structural rendering / empty states.
 */

import { describe, it, expect } from "vitest";
import { buildHtml } from "../cowork-observe-html.js";

describe("buildHtml — document shape", () => {
  it("emits a full HTML document with UTF-8 charset", () => {
    const html = buildHtml({});
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain("Cowork Observe");
  });

  it("does not throw on null/undefined data", () => {
    expect(() => buildHtml(null)).not.toThrow();
    expect(() => buildHtml(undefined)).not.toThrow();
  });

  it("renders empty-state messages when there is no data", () => {
    const html = buildHtml({});
    expect(html).toContain("No template runs in window.");
    expect(html).toContain("No failures in window");
    expect(html).toContain("No upcoming triggers.");
  });

  it("renders summary stat cards", () => {
    const html = buildHtml({
      tasks: { total: 42, successRate: 0.876, failed: 5, avgTokens: 1200 },
      schedules: { active: 3 },
    });
    expect(html).toContain(">42<"); // total
    expect(html).toContain(">88%<"); // successRate rounded
    expect(html).toContain(">3<"); // active schedules
  });
});

describe("buildHtml — table rendering", () => {
  it("renders template rows with success-rate percentage", () => {
    const html = buildHtml({
      templates: [
        { templateName: "build", runs: 9, successRate: 0.5, avgTokens: 100 },
      ],
    });
    expect(html).toContain("<td>build</td>");
    expect(html).toContain("<td>50%</td>");
  });

  it("caps template rows at 10", () => {
    const templates = Array.from({ length: 15 }, (_, i) => ({
      templateName: `t${i}`,
      runs: i,
      successRate: 1,
      avgTokens: 0,
    }));
    const html = buildHtml({ templates });
    expect(html).toContain("<td>t9</td>");
    expect(html).not.toContain("<td>t10</td>"); // 11th dropped
  });

  it("truncates failure summary to 80 chars", () => {
    const long = "x".repeat(200);
    const html = buildHtml({
      failures: [
        {
          templateId: "f",
          failureCount: 2,
          commonSummaries: [{ summary: long }],
        },
      ],
    });
    // the visible table cell is truncated to 80 (the raw 200-char string still
    // lives untruncated inside the embedded JSON blob, so scope to the <td>).
    expect(html).toContain("<td>" + "x".repeat(80) + "</td>");
    expect(html).not.toContain("<td>" + "x".repeat(81));
  });
});

describe("buildHtml — XSS safety", () => {
  it("HTML-escapes user-controlled template names", () => {
    const html = buildHtml({
      templates: [
        {
          templateName: "<script>alert(1)</script>",
          runs: 1,
          successRate: 1,
          avgTokens: 0,
        },
      ],
    });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // the raw payload must not appear inside a table cell
    expect(html).not.toContain("<td><script>alert(1)</script></td>");
  });

  it("HTML-escapes failure summaries and schedule fields", () => {
    const html = buildHtml({
      failures: [
        {
          templateName: "<b>x</b>",
          failureCount: 1,
          commonSummaries: [{ summary: "a&b\"c'" }],
        },
      ],
      schedules: {
        nextTriggers: [
          { at: "<i>t</i>", cron: "* * * * *", scheduleId: "s<1>" },
        ],
      },
    });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("a&amp;b&quot;c&#39;");
    expect(html).toContain("&lt;i&gt;t&lt;/i&gt;");
    expect(html).toContain("s&lt;1&gt;");
  });

  it("escapes a </script> breakout in the embedded JSON blob", () => {
    const html = buildHtml({
      tasks: { note: "</script><img src=x onerror=alert(1)>" },
    });
    // the inline JSON must not contain a raw closing script tag
    expect(html).toContain("\\u003c/script");
    expect(html).not.toContain("</script><img");
  });

  it("escapes <, > and & in the embedded JSON blob", () => {
    const html = buildHtml({ x: "<a> & <b>" });
    expect(html).toContain("\\u003ca\\u003e \\u0026 \\u003cb\\u003e");
    // the script assignment line itself carries the escaped form
    expect(html).toContain("window.__COWORK_OBSERVE__ =");
  });
});
