"use strict";

const {
  ClaudeCodeAdapter,
  CLAUDE_CODE_NAME,
  CLAUDE_CODE_VERSION,
} = require("./adapter");
const {
  defaultClaudeCodeHome,
  inspectClaudeCodeLocalData,
  discoverTranscriptFiles,
  readClaudeCodeTranscripts,
  readClaudeCodeStats,
} = require("./claude-code-reader");

module.exports = {
  ClaudeCodeAdapter,
  CLAUDE_CODE_NAME,
  CLAUDE_CODE_VERSION,
  defaultClaudeCodeHome,
  inspectClaudeCodeLocalData,
  discoverTranscriptFiles,
  readClaudeCodeTranscripts,
  readClaudeCodeStats,
};
