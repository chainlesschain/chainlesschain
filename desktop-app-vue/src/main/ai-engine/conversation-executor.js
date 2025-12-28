/**
 * 文件操作执行器
 * 执行AI解析出的文件操作
 */

const fs = require('fs').promises;
const path = require('path');
const { validateOperations } = require('./response-parser');

/**
 * 执行文件操作列表
 *
 * @param {Array} operations - 文件操作列表
 * @param {string} projectPath - 项目根目录路径
 * @param {Object} database - 数据库实例（用于记录操作日志）
 * @returns {Promise<Array>} 执行结果列表
 */
async function executeOperations(operations, projectPath, database = null) {
  // 1. 验证所有操作
  const validation = validateOperations(operations, projectPath);
  if (!validation.valid) {
    throw new Error(`操作验证失败:\n${validation.errors.join('\n')}`);
  }

  // 2. 执行操作
  const results = [];

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    console.log(`执行操作 ${i + 1}/${operations.length}: ${operation.type} ${operation.path}`);

    try {
      const result = await executeOperation(operation, projectPath, database);
      results.push(result);
    } catch (error) {
      console.error(`操作失败:`, error);
      results.push({
        operation: operation,
        status: 'error',
        error: error.message
      });

      // 如果是关键操作失败，可以选择中断整个流程
      // 这里选择继续执行其他操作
    }
  }

  return results;
}

/**
 * 执行单个文件操作
 *
 * @param {Object} operation - 文件操作
 * @param {string} projectPath - 项目根目录
 * @param {Object} database - 数据库实例
 * @returns {Promise<Object>} 执行结果
 */
async function executeOperation(operation, projectPath, database) {
  const absolutePath = path.resolve(projectPath, operation.path);

  switch (operation.type) {
    case 'CREATE':
      return await createFile(absolutePath, operation.content, operation, database);

    case 'UPDATE':
      return await updateFile(absolutePath, operation.content, operation, database);

    case 'DELETE':
      return await deleteFile(absolutePath, operation, database);

    case 'READ':
      return await readFile(absolutePath, operation, database);

    default:
      throw new Error(`不支持的操作类型: ${operation.type}`);
  }
}

/**
 * 创建文件
 *
 * @param {string} filePath - 文件绝对路径
 * @param {string} content - 文件内容
 * @param {Object} operation - 操作对象
 * @param {Object} database - 数据库实例
 * @returns {Promise<Object>} 执行结果
 */
async function createFile(filePath, content, operation, database) {
  try {
    // 检查文件是否已存在
    const exists = await fileExists(filePath);
    if (exists) {
      // 文件已存在，改为更新操作
      console.warn(`文件已存在，改为更新: ${filePath}`);
      return await updateFile(filePath, content, operation, database);
    }

    // 确保父目录存在
    const dirPath = path.dirname(filePath);
    await fs.mkdir(dirPath, { recursive: true });

    // 写入文件
    await fs.writeFile(filePath, content, 'utf8');

    // 获取文件信息
    const stats = await fs.stat(filePath);

    const result = {
      operation: operation,
      status: 'success',
      message: '文件创建成功',
      filePath: filePath,
      size: stats.size
    };

    // 记录日志
    if (database) {
      await logOperation(database, {
        type: 'CREATE',
        path: operation.path,
        status: 'success',
        size: stats.size
      });
    }

    return result;
  } catch (error) {
    console.error('创建文件失败:', error);
    throw error;
  }
}

/**
 * 更新文件
 *
 * @param {string} filePath - 文件绝对路径
 * @param {string} content - 新文件内容
 * @param {Object} operation - 操作对象
 * @param {Object} database - 数据库实例
 * @returns {Promise<Object>} 执行结果
 */
async function updateFile(filePath, content, operation, database) {
  try {
    // 检查文件是否存在
    const exists = await fileExists(filePath);
    if (!exists) {
      // 文件不存在，改为创建操作
      console.warn(`文件不存在，改为创建: ${filePath}`);
      return await createFile(filePath, content, operation, database);
    }

    // 备份原文件（可选）
    // await backupFile(filePath);

    // 写入新内容
    await fs.writeFile(filePath, content, 'utf8');

    // 获取文件信息
    const stats = await fs.stat(filePath);

    const result = {
      operation: operation,
      status: 'success',
      message: '文件更新成功',
      filePath: filePath,
      size: stats.size
    };

    // 记录日志
    if (database) {
      await logOperation(database, {
        type: 'UPDATE',
        path: operation.path,
        status: 'success',
        size: stats.size
      });
    }

    return result;
  } catch (error) {
    console.error('更新文件失败:', error);
    throw error;
  }
}

/**
 * 删除文件
 *
 * @param {string} filePath - 文件绝对路径
 * @param {Object} operation - 操作对象
 * @param {Object} database - 数据库实例
 * @returns {Promise<Object>} 执行结果
 */
async function deleteFile(filePath, operation, database) {
  try {
    // 检查文件是否存在
    const exists = await fileExists(filePath);
    if (!exists) {
      return {
        operation: operation,
        status: 'skipped',
        message: '文件不存在，跳过删除',
        filePath: filePath
      };
    }

    // 备份文件到临时目录（安全措施）
    const backupPath = await backupFile(filePath);

    // 删除文件
    await fs.unlink(filePath);

    const result = {
      operation: operation,
      status: 'success',
      message: '文件删除成功',
      filePath: filePath,
      backupPath: backupPath
    };

    // 记录日志
    if (database) {
      await logOperation(database, {
        type: 'DELETE',
        path: operation.path,
        status: 'success',
        backupPath: backupPath
      });
    }

    return result;
  } catch (error) {
    console.error('删除文件失败:', error);
    throw error;
  }
}

/**
 * 读取文件
 *
 * @param {string} filePath - 文件绝对路径
 * @param {Object} operation - 操作对象
 * @param {Object} database - 数据库实例
 * @returns {Promise<Object>} 执行结果
 */
async function readFile(filePath, operation, database) {
  try {
    // 检查文件是否存在
    const exists = await fileExists(filePath);
    if (!exists) {
      throw new Error('文件不存在');
    }

    // 读取文件
    const content = await fs.readFile(filePath, 'utf8');
    const stats = await fs.stat(filePath);

    const result = {
      operation: operation,
      status: 'success',
      message: '文件读取成功',
      filePath: filePath,
      content: content,
      size: stats.size
    };

    // 记录日志
    if (database) {
      await logOperation(database, {
        type: 'READ',
        path: operation.path,
        status: 'success',
        size: stats.size
      });
    }

    return result;
  } catch (error) {
    console.error('读取文件失败:', error);
    throw error;
  }
}

/**
 * 检查文件是否存在
 *
 * @param {string} filePath - 文件路径
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 备份文件
 *
 * @param {string} filePath - 源文件路径
 * @returns {Promise<string>} 备份文件路径
 */
async function backupFile(filePath) {
  const os = require('os');
  const backupDir = path.join(os.tmpdir(), 'chainlesschain-backups');

  // 确保备份目录存在
  await fs.mkdir(backupDir, { recursive: true });

  // 生成备份文件名（带时间戳）
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = path.basename(filePath);
  const backupPath = path.join(backupDir, `${timestamp}_${fileName}`);

  // 复制文件
  await fs.copyFile(filePath, backupPath);

  console.log(`文件已备份: ${backupPath}`);
  return backupPath;
}

/**
 * 记录操作日志到数据库
 *
 * @param {Object} database - 数据库实例
 * @param {Object} logData - 日志数据
 * @returns {Promise<void>}
 */
async function logOperation(database, logData) {
  try {
    if (!database || !database.db) {
      console.warn('数据库实例无效，跳过日志记录');
      return;
    }

    const query = `
      INSERT INTO file_operations_log
      (type, path, status, size, backup_path, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `;

    // 使用 better-sqlite3 的 API
    const stmt = database.db.prepare(query);
    stmt.run(
      logData.type,
      logData.path,
      logData.status,
      logData.size || null,
      logData.backupPath || null
    );
  } catch (error) {
    console.error('记录操作日志失败:', error);
    // 日志记录失败不影响主流程
  }
}

/**
 * 确保日志表存在
 *
 * @param {Object} database - 数据库实例
 * @returns {Promise<void>}
 */
async function ensureLogTable(database) {
  if (!database || !database.db) {
    return;
  }

  try {
    // 使用 better-sqlite3 的 API
    database.db.exec(`
      CREATE TABLE IF NOT EXISTS file_operations_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        status TEXT NOT NULL,
        size INTEGER,
        backup_path TEXT,
        created_at TEXT NOT NULL
      )
    `);
  } catch (error) {
    console.error('创建日志表失败:', error);
  }
}

module.exports = {
  executeOperations,
  executeOperation,
  createFile,
  updateFile,
  deleteFile,
  readFile,
  ensureLogTable
};
