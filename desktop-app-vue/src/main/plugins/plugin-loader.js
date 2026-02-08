/**
 * PluginLoader - 插件加载器
 *
 * 职责：
 * - 支持多种插件来源（本地文件夹、NPM包、ZIP压缩包）
 * - 验证插件manifest
 * - 插件代码加载和安装
 */

const { logger } = require("../utils/logger.js");
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { spawn } = require("child_process");

class PluginLoader {
  constructor() {
    // 插件安装目录
    this.pluginsDir = path.join(app.getPath("userData"), "plugins");
    // 临时目录
    this.tempDir = path.join(app.getPath("temp"), "chainlesschain-plugins");

    // 确保目录存在
    this.ensureDirectories();
  }

  /**
   * 确保必要的目录存在
   */
  ensureDirectories() {
    const dirs = [
      this.pluginsDir,
      path.join(this.pluginsDir, "official"),
      path.join(this.pluginsDir, "community"),
      path.join(this.pluginsDir, "custom"),
      this.tempDir,
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * 解析插件来源
   * @param {string} source - 插件来源
   * @param {Object} options - 选项
   * @returns {Promise<string>} 插件路径
   */
  async resolve(source, options = {}) {
    logger.info(`[PluginLoader] 解析插件来源: ${source}`);

    // 1. 检查是否为本地路径
    if (fs.existsSync(source)) {
      const stat = fs.statSync(source);

      if (stat.isDirectory()) {
        logger.info(`[PluginLoader] 识别为本地目录: ${source}`);
        return source; // 开发模式：直接使用本地目录
      }

      if (stat.isFile() && source.endsWith(".zip")) {
        logger.info(`[PluginLoader] 识别为ZIP文件: ${source}`);
        // 解压ZIP到临时目录
        const extractPath = path.join(this.tempDir, `extract_${Date.now()}`);
        await this.extractZip(source, extractPath);
        return extractPath;
      }
    }

    // 2. 尝试作为NPM包处理
    if (this.isNpmPackage(source)) {
      logger.info(`[PluginLoader] 识别为NPM包: ${source}`);
      return await this.installFromNpm(source, options);
    }

    throw new Error(`无法解析插件来源: ${source}`);
  }

  /**
   * 判断是否为NPM包名
   * @param {string} source - 来源字符串
   * @returns {boolean}
   */
  isNpmPackage(source) {
    // NPM包名格式: package-name 或 @scope/package-name
    return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(
      source,
    );
  }

  /**
   * 加载插件manifest
   * @param {string} pluginPath - 插件路径
   * @returns {Promise<Object>} manifest对象
   */
  async loadManifest(pluginPath) {
    const manifestPath = path.join(pluginPath, "plugin.json");

    if (!fs.existsSync(manifestPath)) {
      // 回退到 package.json
      const packagePath = path.join(pluginPath, "package.json");
      if (fs.existsSync(packagePath)) {
        return this.parsePackageJson(packagePath);
      }

      throw new Error("找不到 plugin.json 或 package.json");
    }

    const content = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(content);

    // 验证必需字段
    this.validateManifest(manifest);

    return manifest;
  }

  /**
   * 从package.json解析插件manifest
   * @param {string} packagePath - package.json路径
   * @returns {Object} manifest对象
   */
  parsePackageJson(packagePath) {
    const content = fs.readFileSync(packagePath, "utf-8");
    const pkg = JSON.parse(content);

    // 检查是否有chainlesschain配置节
    if (!pkg.chainlesschain) {
      throw new Error("package.json中缺少chainlesschain配置节");
    }

    // 合并package.json和chainlesschain配置
    const manifest = {
      id: pkg.chainlesschain.id || pkg.name,
      name: pkg.name,
      version: pkg.version,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      license: pkg.license,
      main: pkg.main || "index.js",
      dependencies: pkg.dependencies || {},
      ...pkg.chainlesschain,
    };

    return manifest;
  }

  /**
   * 验证manifest
   * @param {Object} manifest - manifest对象
   * @throws {Error} 验证失败时抛出错误
   */
  validateManifest(manifest) {
    const required = ["id", "name", "version"];

    for (const field of required) {
      if (!manifest[field]) {
        throw new Error(`插件manifest缺少必需字段: ${field}`);
      }
    }

    // 验证版本号格式（简单的semver检查）
    if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
      throw new Error(`无效的版本号格式: ${manifest.version}，应为 x.y.z`);
    }

    // 验证插件ID格式
    if (!/^[a-z0-9.-]+$/.test(manifest.id)) {
      throw new Error(
        `无效的插件ID格式: ${manifest.id}，只能包含小写字母、数字、点和短横线`,
      );
    }

    logger.info(`[PluginLoader] Manifest验证通过: ${manifest.id}`);
  }

  /**
   * 安装插件到插件目录
   * @param {string} sourcePath - 源路径
   * @param {Object} manifest - manifest对象
   * @returns {Promise<string>} 安装后的路径
   */
  async install(sourcePath, manifest) {
    const category = manifest.category || "custom";
    const targetPath = path.join(this.pluginsDir, category, manifest.id);

    logger.info(`[PluginLoader] 安装插件: ${manifest.id} -> ${targetPath}`);

    // 如果目标已存在，先删除
    if (fs.existsSync(targetPath)) {
      logger.warn(`[PluginLoader] 目标路径已存在，将被覆盖: ${targetPath}`);
      await fs.promises.rm(targetPath, { recursive: true, force: true });
    }

    // 创建目标目录
    fs.mkdirSync(targetPath, { recursive: true });

    // 复制文件
    await this.copyDirectory(sourcePath, targetPath);

    // 安装NPM依赖（如果有）
    if (
      manifest.dependencies &&
      Object.keys(manifest.dependencies).length > 0
    ) {
      logger.info(`[PluginLoader] 安装NPM依赖...`);
      await this.installNpmDependencies(targetPath);
    }

    logger.info(`[PluginLoader] 插件安装成功: ${targetPath}`);

    return targetPath;
  }

  /**
   * 从NPM安装插件
   * @param {string} packageName - NPM包名
   * @param {Object} options - 选项
   * @returns {Promise<string>} 安装路径
   */
  async installFromNpm(packageName, options = {}) {
    const { version } = options;
    const versionSuffix = version ? `@${version}` : "";
    const fullPackage = `${packageName}${versionSuffix}`;

    const installPath = path.join(this.tempDir, `npm_${Date.now()}`);
    fs.mkdirSync(installPath, { recursive: true });

    logger.info(`[PluginLoader] 从NPM安装: ${fullPackage}`);

    // 执行 npm install
    await this.execCommand("npm", [
      "install",
      fullPackage,
      "--prefix",
      installPath,
    ]);

    // 返回安装后的路径
    const packagePath = path.join(installPath, "node_modules", packageName);

    if (!fs.existsSync(packagePath)) {
      throw new Error(`NPM安装失败，包不存在: ${packagePath}`);
    }

    return packagePath;
  }

  /**
   * 加载插件代码
   * @param {string} pluginPath - 插件路径
   * @returns {Promise<Object>} 插件代码信息
   */
  async loadCode(pluginPath) {
    const manifest = await this.loadManifest(pluginPath);
    const entryFile = manifest.main || "index.js";
    const entryPath = path.join(pluginPath, entryFile);

    if (!fs.existsSync(entryPath)) {
      throw new Error(`插件入口文件不存在: ${entryPath}`);
    }

    // 读取代码
    const code = fs.readFileSync(entryPath, "utf-8");

    return {
      code,
      entryPath,
      manifest,
    };
  }

  /**
   * 卸载插件
   * @param {string} pluginPath - 插件路径
   */
  async uninstall(pluginPath) {
    if (fs.existsSync(pluginPath)) {
      logger.info(`[PluginLoader] 卸载插件: ${pluginPath}`);
      await fs.promises.rm(pluginPath, { recursive: true, force: true });
      logger.info(`[PluginLoader] 插件已删除`);
    }
  }

  /**
   * 解压ZIP文件
   * @param {string} zipPath - ZIP文件路径
   * @param {string} extractPath - 解压目标路径
   */
  async extractZip(zipPath, extractPath) {
    // 使用 adm-zip 库（需要安装）
    try {
      const AdmZip = require("adm-zip");
      const zip = new AdmZip(zipPath);

      fs.mkdirSync(extractPath, { recursive: true });
      zip.extractAllTo(extractPath, true);

      logger.info(`[PluginLoader] ZIP解压成功: ${extractPath}`);
    } catch (error) {
      // 如果没有 adm-zip，使用系统命令
      if (process.platform === "win32") {
        await this.execCommand("powershell", [
          "-Command",
          `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractPath}" -Force`,
        ]);
      } else {
        await this.execCommand("unzip", ["-q", zipPath, "-d", extractPath]);
      }
    }
  }

  /**
   * 复制目录
   * @param {string} src - 源目录
   * @param {string} dest - 目标目录
   */
  async copyDirectory(src, dest) {
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      // 跳过 node_modules（会重新安装）
      if (entry.name === "node_modules") {
        continue;
      }

      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        await this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * 安装NPM依赖
   * @param {string} pluginPath - 插件路径
   */
  async installNpmDependencies(pluginPath) {
    return new Promise((resolve, reject) => {
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";

      const child = spawn(npm, ["install", "--production"], {
        cwd: pluginPath,
        stdio: "pipe",
      });

      let output = "";

      child.stdout.on("data", (data) => {
        output += data.toString();
      });

      child.stderr.on("data", (data) => {
        output += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          logger.info("[PluginLoader] NPM依赖安装成功");
          resolve();
        } else {
          logger.error("[PluginLoader] NPM依赖安装失败:", output);
          reject(new Error(`NPM依赖安装失败，退出代码: ${code}`));
        }
      });
    });
  }

  /**
   * 执行命令
   * @param {string} command - 命令
   * @param {Array} args - 参数
   * @returns {Promise<string>} 命令输出
   */
  async execCommand(command, args = []) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: "pipe",
        shell: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`命令执行失败 (${code}): ${stderr || stdout}`));
        }
      });

      child.on("error", (error) => {
        reject(error);
      });
    });
  }
}

module.exports = PluginLoader;
