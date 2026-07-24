"use strict";

const {
  LocalFilesAdapter,
  LOCAL_FILES_NAME,
  LOCAL_FILES_VERSION,
  scopeForRoots,
} = require("./adapter");
const walker = require("./file-walker");

module.exports = {
  LocalFilesAdapter,
  LOCAL_FILES_NAME,
  LOCAL_FILES_VERSION,
  scopeForRoots,
  canonicalizeRoots: walker.canonicalizeRoots,
  defaultRoots: walker.defaultRoots,
  inspectRoots: walker.inspectRoots,
  scanRoot: walker.scanRoot,
  scanRoots: walker.scanRoots,
  walkRoot: walker.walkRoot,
  walkRoots: walker.walkRoots,
  DEFAULT_EXCLUDES: walker.DEFAULT_EXCLUDES,
};
