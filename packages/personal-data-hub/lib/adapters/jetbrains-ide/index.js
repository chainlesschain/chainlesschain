"use strict";

const {
  JetBrainsIdeAdapter,
  JETBRAINS_IDE_NAME,
  JETBRAINS_IDE_VERSION,
} = require("./adapter");
const reader = require("./jetbrains-reader");

module.exports = {
  JetBrainsIdeAdapter,
  JETBRAINS_IDE_NAME,
  JETBRAINS_IDE_VERSION,
  defaultJetBrainsConfigRoot: reader.defaultJetBrainsConfigRoot,
  discoverJetBrainsProductConfigs: reader.discoverProductConfigs,
  parseJetBrainsRecentProjectsXml: reader.parseRecentProjectsXml,
  readJetBrainsRecentProjects: reader.readRecentProjects,
};
