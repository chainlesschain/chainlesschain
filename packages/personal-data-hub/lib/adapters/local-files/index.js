"use strict";

const {
  LocalFilesAdapter,
  LOCAL_FILES_NAME,
  LOCAL_FILES_VERSION,
} = require("./adapter");
const walker = require("./file-walker");

module.exports = {
  LocalFilesAdapter,
  LOCAL_FILES_NAME,
  LOCAL_FILES_VERSION,
  defaultRoots: walker.defaultRoots,
  walkRoot: walker.walkRoot,
  walkRoots: walker.walkRoots,
  DEFAULT_EXCLUDES: walker.DEFAULT_EXCLUDES,
};
