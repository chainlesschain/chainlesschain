/**
 * Git路径转换工具
 *
 * 功能:
 * 1. Windows路径 ↔ POSIX路径转换
 * 2. Windows路径 ↔ Docker容器路径转换
 * 3. 路径规范化和验证
 *
 * 问题背景:
 * Windows路径（C:/code/chainlesschain）在Docker容器中查询失败
 * 需要转换为容器路径（/app, /data/projects）
 */

const path = require('path');
const os = require('os');

class PathConverter {
  constructor(options = {}) {
    this.platform = options.platform || os.platform();
    this.dockerMode = options.dockerMode || false;

    // Docker路径映射配置
    this.dockerMappings = options.dockerMappings || {
      'C:/code/chainlesschain': '/app',
      'C:\\code\\chainlesschain': '/app',
      'C:/data/projects': '/data/projects',
      'C:\\data\\projects': '/data/projects',
      '/c/code/chainlesschain': '/app', // Git Bash格式
      '/c/data/projects': '/data/projects'
    };
  }

  /**
   * 将Windows路径转换为POSIX路径
   * @param {string} windowsPath - Windows格式路径 (C:\path\to\file or C:/path/to/file)
   * @returns {string} POSIX格式路径 (/c/path/to/file or /path/to/file)
   */
  windowsToPosix(windowsPath) {
    if (!windowsPath || typeof windowsPath !== 'string') {
      throw new Error('路径必须是非空字符串');
    }

    let posixPath = windowsPath;

    // 替换反斜杠为正斜杠
    posixPath = posixPath.replace(/\\/g, '/');

    // 处理Windows盘符 (C: -> /c or C:/ -> /c/)
    const driveRegex = /^([A-Za-z]):/;
    if (driveRegex.test(posixPath)) {
      posixPath = posixPath.replace(driveRegex, (match, drive) => {
        return '/' + drive.toLowerCase();
      });
    }

    return posixPath;
  }

  /**
   * 将POSIX路径转换为Windows路径
   * @param {string} posixPath - POSIX格式路径 (/c/path/to/file)
   * @returns {string} Windows格式路径 (C:/path/to/file)
   */
  posixToWindows(posixPath) {
    if (!posixPath || typeof posixPath !== 'string') {
      throw new Error('路径必须是非空字符串');
    }

    let windowsPath = posixPath;

    // 处理盘符 (/c/ -> C:/)
    const posixDriveRegex = /^\/([a-zA-Z])\//;
    if (posixDriveRegex.test(windowsPath)) {
      windowsPath = windowsPath.replace(posixDriveRegex, (match, drive) => {
        return drive.toUpperCase() + ':/';
      });
    }

    // 不转换为反斜杠，保持正斜杠（Windows也支持正斜杠）
    // 如果需要反斜杠，取消下面一行的注释
    // windowsPath = windowsPath.replace(/\//g, '\\');

    return windowsPath;
  }

  /**
   * 将本地路径转换为Docker容器路径
   * @param {string} localPath - 本地文件系统路径
   * @returns {string} Docker容器内路径
   */
  localToDocker(localPath) {
    if (!localPath || typeof localPath !== 'string') {
      throw new Error('路径必须是非空字符串');
    }

    // 规范化路径（统一为正斜杠）
    const normalizedPath = localPath.replace(/\\/g, '/');

    // 检查是否匹配任何已定义的映射
    for (const [localPrefix, dockerPrefix] of Object.entries(this.dockerMappings)) {
      const normalizedPrefix = localPrefix.replace(/\\/g, '/');

      if (normalizedPath.startsWith(normalizedPrefix)) {
        // 替换前缀
        const relativePath = normalizedPath.substring(normalizedPrefix.length);
        return dockerPrefix + relativePath;
      }
    }

    // 如果没有匹配的映射，尝试通用转换
    // Windows绝对路径 -> 容器路径
    if (/^[A-Za-z]:/.test(normalizedPath)) {
      // 移除盘符，将路径放到/data下
      const pathWithoutDrive = normalizedPath.replace(/^[A-Za-z]:/, '');
      return '/data' + pathWithoutDrive;
    }

    // 已经是POSIX路径，直接返回
    return normalizedPath;
  }

  /**
   * 将Docker容器路径转换为本地路径
   * @param {string} dockerPath - Docker容器内路径
   * @returns {string} 本地文件系统路径
   */
  dockerToLocal(dockerPath) {
    if (!dockerPath || typeof dockerPath !== 'string') {
      throw new Error('路径必须是非空字符串');
    }

    // 检查反向映射
    for (const [localPrefix, dockerPrefix] of Object.entries(this.dockerMappings)) {
      if (dockerPath.startsWith(dockerPrefix)) {
        const relativePath = dockerPath.substring(dockerPrefix.length);

        // 在Windows上，返回Windows格式路径
        if (this.platform === 'win32') {
          return localPrefix.replace(/\\/g, '/') + relativePath;
        }

        return localPrefix + relativePath;
      }
    }

    // 如果没有匹配的反向映射，尝试通用转换
    if (this.platform === 'win32' && dockerPath.startsWith('/data/')) {
      // 将 /data/path 转换为 C:/data/path
      return 'C:' + dockerPath.substring(5);
    }

    // 无法转换，返回原路径
    return dockerPath;
  }

  /**
   * 规范化路径
   * @param {string} inputPath - 输入路径
   * @returns {string} 规范化后的路径
   */
  normalize(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
      throw new Error('路径必须是非空字符串');
    }

    // 替换反斜杠为正斜杠
    let normalized = inputPath.replace(/\\/g, '/');

    // 移除末尾的斜杠（根目录除外）
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    // 移除多余的斜杠
    normalized = normalized.replace(/\/+/g, '/');

    return normalized;
  }

  /**
   * 判断路径是否为绝对路径
   * @param {string} inputPath - 输入路径
   * @returns {boolean} 是否为绝对路径
   */
  isAbsolute(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
      return false;
    }

    // Windows绝对路径: C:/ or C:\
    if (/^[A-Za-z]:[/\\]/.test(inputPath)) {
      return true;
    }

    // POSIX绝对路径: /path
    if (inputPath.startsWith('/')) {
      return true;
    }

    // UNC路径: \\server\share
    if (inputPath.startsWith('\\\\')) {
      return true;
    }

    return false;
  }

  /**
   * 获取相对路径
   * @param {string} from - 起始路径
   * @param {string} to - 目标路径
   * @returns {string} 相对路径
   */
  relative(from, to) {
    const normalizedFrom = this.normalize(from);
    const normalizedTo = this.normalize(to);

    // 使用Node.js内置方法
    return path.relative(normalizedFrom, normalizedTo).replace(/\\/g, '/');
  }

  /**
   * 连接路径
   * @param {...string} paths - 要连接的路径片段
   * @returns {string} 连接后的路径
   */
  join(...paths) {
    if (paths.length === 0) {
      return '.';
    }

    // 使用Node.js内置方法连接，然后规范化
    const joined = path.join(...paths);
    return this.normalize(joined);
  }

  /**
   * 获取路径的目录部分
   * @param {string} inputPath - 输入路径
   * @returns {string} 目录路径
   */
  dirname(inputPath) {
    const normalized = this.normalize(inputPath);
    const dir = path.dirname(normalized);
    return this.normalize(dir);
  }

  /**
   * 获取路径的文件名部分
   * @param {string} inputPath - 输入路径
   * @param {string} ext - 可选的扩展名（会从结果中移除）
   * @returns {string} 文件名
   */
  basename(inputPath, ext) {
    const normalized = this.normalize(inputPath);
    return path.basename(normalized, ext);
  }

  /**
   * 获取路径的扩展名
   * @param {string} inputPath - 输入路径
   * @returns {string} 扩展名（包含点）
   */
  extname(inputPath) {
    const normalized = this.normalize(inputPath);
    return path.extname(normalized);
  }

  /**
   * 智能路径转换（根据环境自动选择）
   * @param {string} inputPath - 输入路径
   * @param {Object} options - 转换选项
   * @returns {string} 转换后的路径
   */
  convert(inputPath, options = {}) {
    const { target = 'posix', docker = this.dockerMode } = options;

    let result = inputPath;

    // Docker模式优先
    if (docker) {
      if (target === 'docker') {
        result = this.localToDocker(inputPath);
      } else if (target === 'local') {
        result = this.dockerToLocal(inputPath);
      }
    } else {
      // 非Docker模式
      if (target === 'posix') {
        if (this.platform === 'win32' && /^[A-Za-z]:/.test(inputPath)) {
          result = this.windowsToPosix(inputPath);
        }
      } else if (target === 'windows') {
        if (inputPath.startsWith('/')) {
          result = this.posixToWindows(inputPath);
        }
      }
    }

    return this.normalize(result);
  }

  /**
   * 添加Docker路径映射
   * @param {string} localPath - 本地路径
   * @param {string} dockerPath - Docker路径
   */
  addMapping(localPath, dockerPath) {
    this.dockerMappings[localPath] = dockerPath;
    // 同时添加反斜杠版本（Windows兼容）
    this.dockerMappings[localPath.replace(/\//g, '\\')] = dockerPath;
  }

  /**
   * 移除Docker路径映射
   * @param {string} localPath - 本地路径
   */
  removeMapping(localPath) {
    delete this.dockerMappings[localPath];
    delete this.dockerMappings[localPath.replace(/\//g, '\\')];
  }

  /**
   * 获取所有路径映射
   * @returns {Object} 路径映射对象
   */
  getMappings() {
    return { ...this.dockerMappings };
  }
}

// 默认实例（单例模式）
let defaultInstance = null;

function getDefaultInstance() {
  if (!defaultInstance) {
    defaultInstance = new PathConverter();
  }
  return defaultInstance;
}

// 导出类和便捷方法
module.exports = PathConverter;
module.exports.PathConverter = PathConverter;
module.exports.windowsToPosix = (path) => getDefaultInstance().windowsToPosix(path);
module.exports.posixToWindows = (path) => getDefaultInstance().posixToWindows(path);
module.exports.localToDocker = (path) => getDefaultInstance().localToDocker(path);
module.exports.dockerToLocal = (path) => getDefaultInstance().dockerToLocal(path);
module.exports.normalize = (path) => getDefaultInstance().normalize(path);
module.exports.convert = (path, options) => getDefaultInstance().convert(path, options);
