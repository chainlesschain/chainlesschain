"use strict";

const { CursorAdapter, CURSOR_NAME, CURSOR_VERSION } = require("./adapter");
const reader = require("./cursor-reader");

module.exports = {
  CursorAdapter,
  CURSOR_NAME,
  CURSOR_VERSION,
  defaultCursorRoot: reader.defaultCursorRoot,
  defaultCursorHome: reader.defaultCursorHome,
  inspectCursorLocalData: reader.inspectCursorLocalData,
  readAgentTranscripts: reader.readAgentTranscripts,
  readAiTracking: reader.readAiTracking,
};
