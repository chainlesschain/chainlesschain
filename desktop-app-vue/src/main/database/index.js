/**
 * 数据库加密模块入口
 *
 * 导出所有数据库加密相关功能
 */

const { KeyManager, KEY_DERIVATION_CONFIG } = require('./key-manager');
const {
  SQLCipherWrapper,
  createEncryptedDatabase,
  createUnencryptedDatabase,
  SQLCIPHER_CONFIG
} = require('./sqlcipher-wrapper');
const {
  DatabaseMigrator,
  MigrationStatus,
  migrateDatabase
} = require('./database-migration');
const {
  DatabaseAdapter,
  DatabaseEngine,
  createDatabaseAdapter
} = require('./database-adapter');

module.exports = {
  // 密钥管理
  KeyManager,
  KEY_DERIVATION_CONFIG,

  // SQLCipher 包装器
  SQLCipherWrapper,
  createEncryptedDatabase,
  createUnencryptedDatabase,
  SQLCIPHER_CONFIG,

  // 数据库迁移
  DatabaseMigrator,
  MigrationStatus,
  migrateDatabase,

  // 数据库适配器
  DatabaseAdapter,
  DatabaseEngine,
  createDatabaseAdapter
};
