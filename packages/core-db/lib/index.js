/**
 * @chainlesschain/core-db
 * Database layer for ChainlessChain
 */

const { DatabaseManager, getDatabaseManager } = require("./database-manager.js");
const { QueryBuilder } = require("./database/query-builder.js");
const SqlSecurity = require("./database/sql-security.js");
const { IndexOptimizer, getIndexOptimizer } = require("./database/index-optimizer.js");
const { getLogger, setLogger } = require("./logger-adapter.js");

module.exports = {
  DatabaseManager,
  getDatabaseManager,
  QueryBuilder,
  SqlSecurity,
  IndexOptimizer,
  getIndexOptimizer,
  getLogger,
  setLogger,
};
