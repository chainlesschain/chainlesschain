"use strict";

/** Render the CLI PR/CI decision as a safe markdown document for the IDE. */
function parsePrStatusJson(text) {
  try {
    const value = JSON.parse(String(text || ""));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function prStatusToMarkdown(status) {
  if (!status || typeof status !== "object") return "";
  const lines = [
    "# PR / CI Status",
    "",
    `Source: \`${status.source || "unknown"}\``,
    "",
  ];
  if (Array.isArray(status.lines) && status.lines.length > 0) {
    lines.push(...status.lines.map((line) => `- ${String(line)}`));
  } else {
    lines.push("```json", JSON.stringify(status, null, 2), "```");
  }
  return `${lines.join("\n")}\n`;
}

module.exports = { parsePrStatusJson, prStatusToMarkdown };
