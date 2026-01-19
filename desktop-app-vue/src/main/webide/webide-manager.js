/**
 * Web IDE 管理器
 * 负责项目保存、加载、导出等核心功能
 */

const { logger, createLogger } = require('../utils/logger.js');
const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const archiver = require('archiver');
const crypto = require('crypto');

class WebIDEManager {
  constructor() {
    // Web IDE 项目存储路径
    this.projectsPath = path.join(app.getPath('userData'), 'webide-projects');
    this.tempPath = path.join(app.getPath('temp'), 'webide');

    // 初始化目录
    this.initDirectories();
  }

  /**
   * 初始化目录结构
   */
  async initDirectories() {
    try {
      await fs.mkdir(this.projectsPath, { recursive: true });
      await fs.mkdir(this.tempPath, { recursive: true });
      logger.info('[WebIDE Manager] 目录初始化完成');
    } catch (error) {
      logger.error('[WebIDE Manager] 目录初始化失败:', error);
    }
  }

  /**
   * 保存项目
   * @param {Object} projectData - 项目数据
   * @returns {Promise<Object>} 保存结果
   */
  async saveProject(projectData) {
    try {
      const {
        id = this.generateId(),
        name = 'Untitled',
        html = '',
        css = '',
        js = '',
        description = '',
        tags = [],
      } = projectData;

      logger.info(`[WebIDE Manager] 保存项目: ${name} (ID: ${id})`);

      // 创建项目目录
      const projectDir = path.join(this.projectsPath, id);
      await fs.mkdir(projectDir, { recursive: true });

      // 保存文件
      await Promise.all([
        fs.writeFile(path.join(projectDir, 'index.html'), html, 'utf-8'),
        fs.writeFile(path.join(projectDir, 'style.css'), css, 'utf-8'),
        fs.writeFile(path.join(projectDir, 'script.js'), js, 'utf-8'),
        fs.writeFile(
          path.join(projectDir, 'project.json'),
          JSON.stringify(
            {
              id,
              name,
              description,
              tags,
              createdAt: projectData.createdAt || Date.now(),
              updatedAt: Date.now(),
            },
            null,
            2
          ),
          'utf-8'
        ),
      ]);

      logger.info(`[WebIDE Manager] 项目保存成功: ${projectDir}`);

      return {
        success: true,
        id,
        name,
        path: projectDir,
        message: '项目保存成功',
      };
    } catch (error) {
      logger.error('[WebIDE Manager] 保存项目失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 加载项目
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} 项目数据
   */
  async loadProject(projectId) {
    try {
      logger.info(`[WebIDE Manager] 加载项目: ${projectId}`);

      const projectDir = path.join(this.projectsPath, projectId);

      // 检查项目是否存在
      const exists = await this.checkPathExists(projectDir);
      if (!exists) {
        throw new Error('项目不存在');
      }

      // 读取文件
      const [html, css, js, metaJson] = await Promise.all([
        fs.readFile(path.join(projectDir, 'index.html'), 'utf-8'),
        fs.readFile(path.join(projectDir, 'style.css'), 'utf-8'),
        fs.readFile(path.join(projectDir, 'script.js'), 'utf-8'),
        fs.readFile(path.join(projectDir, 'project.json'), 'utf-8'),
      ]);

      const meta = JSON.parse(metaJson);

      logger.info(`[WebIDE Manager] 项目加载成功: ${meta.name}`);

      return {
        success: true,
        project: {
          ...meta,
          html,
          css,
          js,
        },
      };
    } catch (error) {
      logger.error('[WebIDE Manager] 加载项目失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 获取所有项目列表
   * @returns {Promise<Object>} 项目列表
   */
  async getProjectList() {
    try {
      logger.info('[WebIDE Manager] 获取项目列表');

      const dirs = await fs.readdir(this.projectsPath);
      const projects = [];

      for (const dir of dirs) {
        try {
          const metaPath = path.join(this.projectsPath, dir, 'project.json');
          const exists = await this.checkPathExists(metaPath);

          if (exists) {
            const metaJson = await fs.readFile(metaPath, 'utf-8');
            const meta = JSON.parse(metaJson);
            projects.push(meta);
          }
        } catch (error) {
          logger.warn(`[WebIDE Manager] 读取项目元数据失败: ${dir}`, error);
        }
      }

      // 按更新时间倒序排列
      projects.sort((a, b) => b.updatedAt - a.updatedAt);

      logger.info(`[WebIDE Manager] 找到 ${projects.length} 个项目`);

      return {
        success: true,
        projects,
      };
    } catch (error) {
      logger.error('[WebIDE Manager] 获取项目列表失败:', error);
      return {
        success: false,
        error: error.message,
        projects: [],
      };
    }
  }

  /**
   * 删除项目
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} 删除结果
   */
  async deleteProject(projectId) {
    try {
      logger.info(`[WebIDE Manager] 删除项目: ${projectId}`);

      const projectDir = path.join(this.projectsPath, projectId);

      // 检查项目是否存在
      const exists = await this.checkPathExists(projectDir);
      if (!exists) {
        throw new Error('项目不存在');
      }

      // 递归删除目录
      await fs.rm(projectDir, { recursive: true, force: true });

      logger.info(`[WebIDE Manager] 项目删除成功: ${projectId}`);

      return {
        success: true,
        message: '项目删除成功',
      };
    } catch (error) {
      logger.error('[WebIDE Manager] 删除项目失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 导出项目为 HTML 文件
   * @param {Object} exportData - 导出数据
   * @returns {Promise<Object>} 导出结果
   */
  async exportHTML(exportData) {
    try {
      const { html, css, js, filename = 'index.html' } = exportData;

      logger.info(`[WebIDE Manager] 导出 HTML: ${filename}`);

      // 生成完整的 HTML
      const fullHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Web IDE Export</title>
  <style>
${css}
  </style>
</head>
<body>
${html}
  <script>
${js}
  </script>
</body>
</html>`;

      // 创建临时文件
      const tempFilePath = path.join(this.tempPath, filename);
      await fs.writeFile(tempFilePath, fullHTML, 'utf-8');

      logger.info(`[WebIDE Manager] HTML 导出成功: ${tempFilePath}`);

      return {
        success: true,
        path: tempFilePath,
        content: fullHTML,
      };
    } catch (error) {
      logger.error('[WebIDE Manager] 导出 HTML 失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 导出项目为 ZIP 压缩包
   * @param {Object} exportData - 导出数据
   * @returns {Promise<Object>} 导出结果
   */
  async exportZIP(exportData) {
    try {
      const { html, css, js, filename = 'webide-project.zip' } = exportData;

      logger.info(`[WebIDE Manager] 导出 ZIP: ${filename}`);

      // 创建临时目录
      const tempDir = path.join(this.tempPath, this.generateId());
      await fs.mkdir(tempDir, { recursive: true });

      // 创建项目结构
      await fs.mkdir(path.join(tempDir, 'css'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'js'), { recursive: true });

      // 写入文件
      await Promise.all([
        fs.writeFile(
          path.join(tempDir, 'index.html'),
          `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Web IDE Project</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
${html}
  <script src="js/script.js"></script>
</body>
</html>`,
          'utf-8'
        ),
        fs.writeFile(path.join(tempDir, 'css', 'style.css'), css, 'utf-8'),
        fs.writeFile(path.join(tempDir, 'js', 'script.js'), js, 'utf-8'),
      ]);

      // 创建 ZIP 文件
      const zipPath = path.join(this.tempPath, filename);
      await this.createZipArchive(tempDir, zipPath);

      // 清理临时目录
      await fs.rm(tempDir, { recursive: true, force: true });

      logger.info(`[WebIDE Manager] ZIP 导出成功: ${zipPath}`);

      return {
        success: true,
        path: zipPath,
      };
    } catch (error) {
      logger.error('[WebIDE Manager] 导出 ZIP 失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 创建 ZIP 压缩包
   * @private
   */
  async createZipArchive(sourceDir, outputPath) {
    return new Promise((resolve, reject) => {
      const output = require('fs').createWriteStream(outputPath);
      const archive = archiver('zip', {
        zlib: { level: 9 }, // 压缩级别
      });

      output.on('close', () => {
        logger.info(`[WebIDE Manager] ZIP 创建完成: ${archive.pointer()} bytes`);
        resolve();
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  /**
   * 生成唯一 ID
   * @private
   */
  generateId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * 检查路径是否存在
   * @private
   */
  async checkPathExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取项目存储路径
   */
  getProjectsPath() {
    return this.projectsPath;
  }

  /**
   * 获取临时文件路径
   */
  getTempPath() {
    return this.tempPath;
  }
}

module.exports = WebIDEManager;
