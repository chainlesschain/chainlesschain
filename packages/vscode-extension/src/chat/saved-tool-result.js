/** Display saved tool output on demand without changing transcript identity. */
function writeSavedToolResult(document, element, row) {
  const text = row.text;
  let tool = "";
  let failed = false;
  try {
    const result = JSON.parse(text);
    const name =
      result?.toolAttribution?.tool || result?.toolTelemetryRecord?.toolName;
    if (typeof name === "string") tool = name.slice(0, 80);
    failed =
      Boolean(result?.error) ||
      result?.success === false ||
      (Number.isInteger(result?.exitCode) && result.exitCode !== 0);
  } catch {
    // Legacy, plain-text and released results are still available verbatim.
  }
  element.textContent = "";
  const details = document.createElement("details");
  details.className = "saved-tool-result";
  const summary = document.createElement("summary");
  summary.textContent =
    "Saved tool result" +
    (tool ? " · " + tool : "") +
    (failed ? " · failed" : "") +
    (row.truncated ? " · shortened" : "");
  details.appendChild(summary);
  // Keep closed results out of the DOM and copied conversation text. Opening
  // a result reads display data only; it never dispatches the saved tool.
  details.addEventListener("toggle", () => {
    if (!details.open) {
      details.querySelector("pre")?.remove();
      return;
    }
    if (details.childElementCount > 1) return;
    const output = document.createElement("pre");
    output.textContent = text;
    details.appendChild(output);
  });
  element.appendChild(details);
}

module.exports = { writeSavedToolResult };
