/**
 * File System Adapter
 *
 * Provides abstraction layer for file system operations to enable testing
 * without actual file I/O.
 */

const fs = require('fs');
const path = require('path');

/**
 * Real FileSystem Adapter using Node.js fs module
 */
class FileSystemAdapter {
  /**
   * Create directory
   * @param {string} dirPath - Directory path
   * @param {object} options - Options (recursive, etc.)
   */
  async mkdir(dirPath, options = { recursive: true }) {
    return fs.promises.mkdir(dirPath, options);
  }

  /**
   * Write file
   * @param {string} filePath - File path
   * @param {string|Buffer} data - Data to write
   * @param {object} options - Write options
   */
  async writeFile(filePath, data, options = 'utf8') {
    return fs.promises.writeFile(filePath, data, options);
  }

  /**
   * Read file
   * @param {string} filePath - File path
   * @param {object} options - Read options
   * @returns {Promise<string|Buffer>}
   */
  async readFile(filePath, options = 'utf8') {
    return fs.promises.readFile(filePath, options);
  }

  /**
   * Delete file
   * @param {string} filePath - File path
   */
  async unlink(filePath) {
    return fs.promises.unlink(filePath);
  }

  /**
   * Read directory
   * @param {string} dirPath - Directory path
   * @param {object} options - Read options
   * @returns {Promise<string[]>}
   */
  async readdir(dirPath, options) {
    return fs.promises.readdir(dirPath, options);
  }

  /**
   * Get file stats
   * @param {string} filePath - File path
   * @returns {Promise<fs.Stats>}
   */
  async stat(filePath) {
    return fs.promises.stat(filePath);
  }

  /**
   * Check if file exists
   * @param {string} filePath - File path
   * @returns {Promise<boolean>}
   */
  async exists(filePath) {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rename file
   * @param {string} oldPath - Old path
   * @param {string} newPath - New path
   */
  async rename(oldPath, newPath) {
    return fs.promises.rename(oldPath, newPath);
  }

  /**
   * Copy file
   * @param {string} src - Source path
   * @param {string} dest - Destination path
   */
  async copyFile(src, dest) {
    return fs.promises.copyFile(src, dest);
  }

  /**
   * Remove directory recursively
   * @param {string} dirPath - Directory path
   */
  async rmdir(dirPath) {
    return fs.promises.rm(dirPath, { recursive: true, force: true });
  }
}

/**
 * In-Memory FileSystem Adapter for testing
 *
 * Simulates file system operations in memory without touching disk
 */
class InMemoryFileSystemAdapter {
  constructor() {
    this.files = new Map();
    this.dirs = new Set(['/']);
  }

  /**
   * Create directory (no-op for in-memory)
   */
  async mkdir(dirPath, options = { recursive: true }) {
    this.dirs.add(dirPath);
    if (options.recursive) {
      // Add all parent directories
      const parts = dirPath.split(path.sep).filter(Boolean);
      let current = '';
      for (const part of parts) {
        current = current ? path.join(current, part) : part;
        this.dirs.add(current);
      }
    }
  }

  /**
   * Write file to memory
   */
  async writeFile(filePath, data, options = 'utf8') {
    const content = typeof data === 'string' ? data : data.toString(options);
    this.files.set(filePath, content);

    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    this.dirs.add(dir);
  }

  /**
   * Read file from memory
   */
  async readFile(filePath, options = 'utf8') {
    if (!this.files.has(filePath)) {
      const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      error.code = 'ENOENT';
      throw error;
    }
    return this.files.get(filePath);
  }

  /**
   * Delete file from memory
   */
  async unlink(filePath) {
    if (!this.files.has(filePath)) {
      const error = new Error(`ENOENT: no such file or directory, unlink '${filePath}'`);
      error.code = 'ENOENT';
      throw error;
    }
    this.files.delete(filePath);
  }

  /**
   * Read directory from memory
   */
  async readdir(dirPath, options) {
    const normalizedPath = dirPath.endsWith(path.sep) ? dirPath : dirPath + path.sep;
    const entries = Array.from(this.files.keys())
      .filter(p => p.startsWith(normalizedPath))
      .map(p => {
        const relative = p.slice(normalizedPath.length);
        return relative.split(path.sep)[0];
      })
      .filter(Boolean);

    // Remove duplicates
    return [...new Set(entries)];
  }

  /**
   * Get file stats (simulated)
   */
  async stat(filePath) {
    if (!this.files.has(filePath) && !this.dirs.has(filePath)) {
      const error = new Error(`ENOENT: no such file or directory, stat '${filePath}'`);
      error.code = 'ENOENT';
      throw error;
    }

    const isDirectory = this.dirs.has(filePath);
    const content = this.files.get(filePath) || '';

    return {
      isFile: () => !isDirectory,
      isDirectory: () => isDirectory,
      size: content.length,
      mtime: new Date(),
      ctime: new Date(),
      atime: new Date(),
    };
  }

  /**
   * Check if file exists
   */
  async exists(filePath) {
    return this.files.has(filePath) || this.dirs.has(filePath);
  }

  /**
   * Rename file
   */
  async rename(oldPath, newPath) {
    if (!this.files.has(oldPath)) {
      const error = new Error(`ENOENT: no such file or directory, rename '${oldPath}'`);
      error.code = 'ENOENT';
      throw error;
    }
    const content = this.files.get(oldPath);
    this.files.delete(oldPath);
    this.files.set(newPath, content);
  }

  /**
   * Copy file
   */
  async copyFile(src, dest) {
    if (!this.files.has(src)) {
      const error = new Error(`ENOENT: no such file or directory, copyfile '${src}'`);
      error.code = 'ENOENT';
      throw error;
    }
    const content = this.files.get(src);
    this.files.set(dest, content);
  }

  /**
   * Remove directory recursively
   */
  async rmdir(dirPath) {
    const normalizedPath = dirPath.endsWith(path.sep) ? dirPath : dirPath + path.sep;

    // Remove all files in directory
    for (const [filePath] of this.files) {
      if (filePath.startsWith(normalizedPath)) {
        this.files.delete(filePath);
      }
    }

    // Remove directory itself
    this.dirs.delete(dirPath);
  }

  /**
   * Clear all files (for testing)
   */
  clear() {
    this.files.clear();
    this.dirs.clear();
    this.dirs.add('/');
  }
}

module.exports = {
  FileSystemAdapter,
  InMemoryFileSystemAdapter,
};
