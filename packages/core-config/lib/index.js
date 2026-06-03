/**
 * @chainlesschain/core-config
 * Configuration management for ChainlessChain
 */

const {
  AppConfigManager,
  getAppConfig,
  DEFAULT_CONFIG,
  setPathResolvers,
} = require("./database-config.js");
const { getLogger, setLogger } = require("./logger-adapter.js");

module.exports = {
  AppConfigManager,
  getAppConfig,
  DEFAULT_CONFIG,
  setPathResolvers,
  getLogger,
  setLogger,
};
