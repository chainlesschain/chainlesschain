"use strict";

/**
 * Runtime capability manifest advertised by the IDE MCP bridge.
 *
 * This is deliberately derived from the tools actually registered with the
 * bridge. VS Code and JetBrains expose different optional host APIs (for
 * example notebook execution and multi-file diff), so clients must inspect
 * this manifest instead of assuming feature parity.
 */
const IDE_CAPABILITY_VERSION = 1;

const TOOL_FEATURES = new Map([
  ["getSelection", "selection"],
  ["getActiveFile", "active_file"],
  ["getDiagnostics", "diagnostics"],
  ["getOpenEditors", "open_editors"],
  ["openDiff", "native_diff"],
  ["openMultiDiff", "multi_file_diff"],
  ["getTerminalOutput", "terminal_output"],
  ["getPreviewState", "preview_state"],
  ["executeCode", "notebook_execute"],
  ["getHover", "semantic_hover"],
  ["goToDefinition", "semantic_definition"],
  ["findReferences", "semantic_references"],
  ["renamePreview", "semantic_rename"],
  ["getCallHierarchy", "semantic_call_hierarchy"],
  ["getSymbolInfo", "semantic_symbols"],
  ["getProjectModel", "project_model"],
]);

function buildIdeCapabilities(tools = []) {
  const names = new Set(
    (Array.isArray(tools) ? tools : [])
      .map((tool) => tool && tool.name)
      .filter((name) => typeof name === "string" && name.length > 0),
  );
  const features = [...new Set(
    [...names]
      .map((name) => TOOL_FEATURES.get(name))
      .filter(Boolean),
  )].sort();
  return {
    schemaVersion: IDE_CAPABILITY_VERSION,
    features,
    tools: [...names].sort(),
  };
}

module.exports = { IDE_CAPABILITY_VERSION, buildIdeCapabilities };
