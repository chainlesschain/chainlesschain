/**
 * Adapters Index
 *
 * Export all adapters for easy importing
 */

const {
  FileSystemAdapter,
  InMemoryFileSystemAdapter,
} = require('./file-system-adapter');

const {
  DatabaseAdapter,
  InMemoryDatabaseAdapter,
} = require('./database-adapter');

module.exports = {
  // File System Adapters
  FileSystemAdapter,
  InMemoryFileSystemAdapter,

  // Database Adapters
  DatabaseAdapter,
  InMemoryDatabaseAdapter,
};
