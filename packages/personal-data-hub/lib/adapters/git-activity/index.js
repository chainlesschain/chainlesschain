"use strict";

const {
  GitActivityAdapter,
  GIT_ACTIVITY_NAME,
  GIT_ACTIVITY_VERSION,
} = require("./adapter");
const reader = require("./git-reader");

module.exports = {
  GitActivityAdapter,
  GIT_ACTIVITY_NAME,
  GIT_ACTIVITY_VERSION,
  defaultCodeRoots: reader.defaultCodeRoots,
  findGitRepos: reader.findGitRepos,
  listCommits: reader.listCommits,
};
