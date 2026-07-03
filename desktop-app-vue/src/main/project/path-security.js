const path = require("path");
const os = require("os");
const fs = require("fs").promises;
const { logger } = require("../utils/logger.js");

/**
 * 路径安全验证工具
 * 防止路径遍历攻击和未授权文件访问
 */
class PathSecurity {
  /**
   * 验证路径是否在允许的根目录内
   * @param {string} targetPath - 要验证的路径
   * @param {string} allowedRoot - 允许的根目录
   * @returns {boolean} 是否安全
   */
  static isPathSafe(targetPath, allowedRoot) {
    if (!targetPath || !allowedRoot) {
      return false;
    }

    try {
      // 规范化路径
      const normalizedTarget = path.resolve(targetPath);
      const normalizedRoot = path.resolve(allowedRoot);

      // 检查目标路径是否以根目录开头
      // 使用 path.relative 更可靠地检查路径关系
      const relative = path.relative(normalizedRoot, normalizedTarget);

      // 如果相对路径以 '..' 开头，说明目标在根目录外
      return !relative.startsWith("..") && !path.isAbsolute(relative);
    } catch (error) {
      logger.error("[PathSecurity] 路径验证失败:", error);
      return false;
    }
  }

  /**
   * 安全地解析路径
   * @param {string} userPath - 用户提供的路径
   * @param {string} allowedRoot - 允许的根目录
   * @returns {string} 安全的绝对路径
   * @throws {Error} 如果路径不安全
   */
  static resolveSafePath(userPath, allowedRoot) {
    if (!userPath || !allowedRoot) {
      throw new Error("路径和根目录不能为空");
    }

    // 规范化根目录
    const normalizedRoot = path.resolve(allowedRoot);

    // 解析用户路径（相对于根目录）
    const resolvedPath = path.resolve(normalizedRoot, userPath);

    // 验证安全性
    if (!this.isPathSafe(resolvedPath, normalizedRoot)) {
      logger.error("[PathSecurity] 检测到路径遍历攻击:", {
        userPath,
        allowedRoot,
        resolvedPath,
      });
      throw new Error(`无权访问此路径: ${userPath}`);
    }

    return resolvedPath;
  }

  /**
   * 验证文件是否存在且可访问
   * @param {string} filePath - 文件路径
   * @param {string} allowedRoot - 允许的根目录
   * @returns {Promise<boolean>} 是否存在且可访问
   */
  static async validateFileAccess(filePath, allowedRoot) {
    try {
      // 先验证路径安全性
      const safePath = this.resolveSafePath(filePath, allowedRoot);

      // 检查文件是否存在
      await fs.access(safePath, fs.constants.R_OK);

      return true;
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error("文件不存在");
      } else if (error.code === "EACCES") {
        throw new Error("无权访问此文件");
      }
      throw error;
    }
  }

  /**
   * 验证项目路径
   * @param {string} projectPath - 项目路径
   * @param {string} projectsRoot - 项目根目录
   * @returns {string} 安全的项目路径
   */
  static validateProjectPath(projectPath, projectsRoot) {
    return this.resolveSafePath(projectPath, projectsRoot);
  }

  /**
   * 验证文件路径（项目内）
   * @param {string} filePath - 文件路径
   * @param {string} projectRoot - 项目根目录
   * @returns {string} 安全的文件路径
   */
  static validateFilePath(filePath, projectRoot) {
    return this.resolveSafePath(filePath, projectRoot);
  }

  /**
   * 检查路径是否包含危险字符
   * @param {string} filePath - 文件路径
   * @returns {boolean} 是否包含危险字符
   */
  static containsDangerousChars(filePath) {
    // 危险的路径模式
    const dangerousPatterns = [
      /\.\./, // 父目录遍历
      /~\//, // 用户目录
      /\0/, // null字节
      /[<>:"|?*]/, // Windows 非法字符
      /^\/etc\//, // Linux 系统目录
      /^\/proc\//, // Linux proc目录
      /^\/sys\//, // Linux sys目录
      /^C:\\Windows/i, // Windows 系统目录
      /^C:\\Program Files/i, // Windows 程序目录
    ];

    return dangerousPatterns.some((pattern) => pattern.test(filePath));
  }

  /**
   * 判断一个绝对路径是否指向受保护的系统目录或用户凭据目录。
   *
   * `containsDangerousChars` 是「allow-by-default」黑名单：只拦 `..`/`~/`/少数
   * 系统目录，Linux/mac 上展开后的 `/home/用户/.ssh/id_rsa`、`~/.aws/credentials`
   * 等敏感绝对路径会漏过 —— 被 project:import-file 当外部源读入项目(内容落库
   * = 可外泄)，被 project:export-file 当目标写出(可覆盖 authorized_keys 等)。
   *
   * 本方法把路径解析为绝对路径(展开开头的 `~`)后，与一份**跨平台敏感前缀清单**
   * 做边界匹配(resolve + startsWith(prefix + sep)，Windows 大小写不敏感)，覆盖
   * 凭据/密钥目录与系统目录。这是对既有黑名单的加固(仍是 denylist —— 因为合法
   * 的「拖入任意用户文件导入项目」不能用 allowlist-root 限死)，而非放开。
   *
   * @param {string} filePath - 待检查路径
   * @returns {boolean} true = 指向受保护路径，应拒绝
   */
  static isSensitiveSystemPath(filePath) {
    if (!filePath || typeof filePath !== "string") {
      return false;
    }

    let candidate = filePath;
    // 展开开头的 ~，使 `~/.ssh` 与展开后的 `/home/user/.ssh` 都能命中
    if (
      candidate === "~" ||
      candidate.startsWith("~/") ||
      candidate.startsWith("~\\")
    ) {
      candidate = path.join(os.homedir(), candidate.slice(1) || "");
    }

    let resolved;
    try {
      resolved = path.resolve(candidate);
    } catch (error) {
      logger.warn("[PathSecurity] 无法解析路径，按敏感处理:", error.message);
      return true;
    }

    const isWin = process.platform === "win32";
    const norm = (p) =>
      isWin ? path.resolve(p).toLowerCase() : path.resolve(p);
    const target = isWin ? resolved.toLowerCase() : resolved;
    const within = (dir) => {
      const d = norm(dir);
      return target === d || target.startsWith(d + path.sep);
    };

    const home = os.homedir();
    // 凭据/密钥/配置目录(相对 home)
    const sensitiveHomeSubdirs = [
      ".ssh",
      ".aws",
      ".gnupg",
      ".gpg",
      ".kube",
      ".docker",
      ".azure",
      path.join(".config", "gcloud"),
      ".password-store",
      ".mozilla",
    ];
    for (const sub of sensitiveHomeSubdirs) {
      if (within(path.join(home, sub))) {
        return true;
      }
    }
    // home 下的敏感单文件
    const sensitiveHomeFiles = [
      ".netrc",
      ".npmrc",
      ".git-credentials",
      ".pgpass",
    ];
    for (const f of sensitiveHomeFiles) {
      if (target === norm(path.join(home, f))) {
        return true;
      }
    }

    // 系统目录前缀
    const sensitivePrefixes = isWin
      ? [
          "C:\\Windows",
          "C:\\Program Files",
          "C:\\Program Files (x86)",
          "C:\\ProgramData",
        ]
      : [
          "/etc",
          "/proc",
          "/sys",
          "/root",
          "/boot",
          "/dev",
          "/var/lib",
          "/run/secrets",
        ];
    for (const prefix of sensitivePrefixes) {
      if (within(prefix)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 验证文件扩展名
   * @param {string} filePath - 文件路径
   * @param {string[]} allowedExtensions - 允许的扩展名列表
   * @returns {boolean} 是否为允许的扩展名
   */
  static validateFileExtension(filePath, allowedExtensions) {
    if (!allowedExtensions || allowedExtensions.length === 0) {
      return true; // 没有限制
    }

    const ext = path.extname(filePath).toLowerCase().substring(1);
    return allowedExtensions.includes(ext);
  }

  /**
   * 获取安全的文件名（移除危险字符）
   * @param {string} filename - 原始文件名
   * @returns {string} 安全的文件名
   */
  static sanitizeFilename(filename) {
    // 移除路径分隔符和危险字符
    return filename
      .replace(/[/\\]/g, "_") // 路径分隔符
      .replace(/[<>:"|?*\0]/g, "") // 危险字符
      .replace(/^\.+/, "") // 移除开头的点
      .substring(0, 255); // 限制长度
  }
}

module.exports = PathSecurity;
