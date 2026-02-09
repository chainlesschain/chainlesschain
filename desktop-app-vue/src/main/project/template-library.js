/**
 * 模板库管理模块
 * 提供模板搜索、推荐、预览、自定义模板CRUD等功能
 *
 * @module template-library
 */

const { logger } = require('../utils/logger.js');
const fs = require('fs').promises;
const path = require('path');
const {
  ProjectTemplates,
  TemplateCategory,
  getProjectTemplates,
  getTemplateById,
  getTemplatesByCategory,
  searchTemplates,
} = require('./project-types.js');

/**
 * 自定义模板存储文件名
 */
const CUSTOM_TEMPLATES_FILE = 'custom_templates.json';

/**
 * 模板库管理器
 */
class TemplateLibraryManager {
  constructor(configDir) {
    // 配置目录路径
    this.configDir = configDir || this._getDefaultConfigDir();
    this.customTemplatesPath = path.join(this.configDir, CUSTOM_TEMPLATES_FILE);
    this.customTemplates = {};
    this.initialized = false;
  }

  /**
   * 获取默认配置目录
   * @private
   */
  _getDefaultConfigDir() {
    const { app } = require('electron');
    const userDataPath = app ? app.getPath('userData') : process.cwd();
    return path.join(userDataPath, '.chainlesschain');
  }

  /**
   * 初始化模板库
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // 确保配置目录存在
      await fs.mkdir(this.configDir, { recursive: true });

      // 加载自定义模板
      await this._loadCustomTemplates();

      this.initialized = true;
      logger.info('[TemplateLibrary] 初始化完成');
    } catch (error) {
      logger.error('[TemplateLibrary] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 加载自定义模板
   * @private
   */
  async _loadCustomTemplates() {
    try {
      const data = await fs.readFile(this.customTemplatesPath, 'utf-8');
      this.customTemplates = JSON.parse(data);
      logger.info(
        `[TemplateLibrary] 加载了 ${Object.keys(this.customTemplates).length} 个自定义模板`
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        // 文件不存在，使用空对象
        this.customTemplates = {};
        logger.info('[TemplateLibrary] 自定义模板文件不存在，使用空模板库');
      } else {
        logger.error('[TemplateLibrary] 加载自定义模板失败:', error);
        this.customTemplates = {};
      }
    }
  }

  /**
   * 保存自定义模板
   * @private
   */
  async _saveCustomTemplates() {
    try {
      await fs.writeFile(
        this.customTemplatesPath,
        JSON.stringify(this.customTemplates, null, 2),
        'utf-8'
      );
      logger.info('[TemplateLibrary] 自定义模板已保存');
    } catch (error) {
      logger.error('[TemplateLibrary] 保存自定义模板失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有模板（预置 + 自定义）
   * @returns {Array} 所有模板列表
   */
  getAllTemplates() {
    const builtinTemplates = getProjectTemplates().map((t) => ({
      ...t,
      isBuiltin: true,
      isCustom: false,
    }));

    const customTemplates = Object.values(this.customTemplates).map((t) => ({
      ...t,
      isBuiltin: false,
      isCustom: true,
    }));

    return [...builtinTemplates, ...customTemplates];
  }

  /**
   * 根据ID获取模板
   * @param {string} templateId - 模板ID
   * @returns {Object|null} 模板对象
   */
  getTemplateById(templateId) {
    // 先查找预置模板
    const builtinTemplate = getTemplateById(templateId);
    if (builtinTemplate) {
      return { ...builtinTemplate, isBuiltin: true, isCustom: false };
    }

    // 再查找自定义模板
    const customTemplate = this.customTemplates[templateId];
    if (customTemplate) {
      return { ...customTemplate, isBuiltin: false, isCustom: true };
    }

    return null;
  }

  /**
   * 根据分类获取模板
   * @param {string} category - 分类
   * @returns {Array} 模板列表
   */
  getTemplatesByCategory(category) {
    const builtinTemplates = getTemplatesByCategory(category).map((t) => ({
      ...t,
      isBuiltin: true,
      isCustom: false,
    }));

    const customTemplates = Object.values(this.customTemplates)
      .filter((t) => t.category === category)
      .map((t) => ({
        ...t,
        isBuiltin: false,
        isCustom: true,
      }));

    return [...builtinTemplates, ...customTemplates];
  }

  /**
   * 搜索模板
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项
   * @param {string} options.category - 限定分类
   * @param {string} options.projectType - 限定项目类型
   * @param {boolean} options.includeCustom - 是否包含自定义模板（默认true）
   * @returns {Array} 匹配的模板列表
   */
  search(query, options = {}) {
    const {
      category = null,
      projectType = null,
      includeCustom = true,
    } = options;

    // 搜索预置模板
    let results = searchTemplates(query).map((t) => ({
      ...t,
      isBuiltin: true,
      isCustom: false,
    }));

    // 搜索自定义模板
    if (includeCustom) {
      const lowerQuery = (query || '').toLowerCase().trim();

      const customResults = Object.values(this.customTemplates)
        .filter((template) => {
          if (!lowerQuery) return true;

          const matchName = template.name.toLowerCase().includes(lowerQuery);
          const matchDescription = template.description
            .toLowerCase()
            .includes(lowerQuery);
          const matchTags = (template.tags || []).some((tag) =>
            tag.toLowerCase().includes(lowerQuery)
          );
          return matchName || matchDescription || matchTags;
        })
        .map((t) => ({
          ...t,
          isBuiltin: false,
          isCustom: true,
        }));

      results = [...results, ...customResults];
    }

    // 按分类筛选
    if (category) {
      results = results.filter((t) => t.category === category);
    }

    // 按项目类型筛选
    if (projectType) {
      results = results.filter((t) => t.projectType === projectType);
    }

    return results;
  }

  /**
   * 推荐模板（基于项目描述）
   * @param {string} description - 项目描述
   * @param {number} limit - 最大返回数量
   * @returns {Array} 推荐的模板列表
   */
  recommend(description, limit = 5) {
    if (!description || description.trim() === '') {
      // 没有描述时返回热门模板
      return this.getAllTemplates().slice(0, limit);
    }

    const lowerDescription = description.toLowerCase();
    const allTemplates = this.getAllTemplates();

    // 关键词权重映射
    const keywordWeights = {
      // 移动端
      android: ['android-app', 'kotlin-multiplatform', 'flutter-app'],
      ios: ['flutter-app', 'kotlin-multiplatform'],
      mobile: ['android-app', 'flutter-app', 'kotlin-multiplatform'],
      app: ['android-app', 'flutter-app'],

      // Web前端
      react: ['react-webapp'],
      vue: ['vue-webapp'],
      web: ['react-webapp', 'vue-webapp', 'django-web'],
      frontend: ['react-webapp', 'vue-webapp'],

      // 后端
      api: ['nodejs-api', 'express-api', 'spring-boot'],
      backend: ['nodejs-api', 'express-api', 'spring-boot'],
      rest: ['nodejs-api', 'express-api', 'spring-boot'],
      server: ['nodejs-api', 'express-api', 'spring-boot'],
      node: ['nodejs-api', 'express-api'],
      express: ['express-api'],
      spring: ['spring-boot'],
      java: ['spring-boot'],
      kotlin: ['kotlin-multiplatform', 'spring-boot', 'android-app'],

      // 数据科学
      data: ['python-datascience'],
      python: ['python-datascience', 'django-web'],
      jupyter: ['python-datascience'],
      analysis: ['python-datascience'],
      ml: ['python-datascience'],
      machine: ['python-datascience'],

      // 全栈
      django: ['django-web'],
      fullstack: ['django-web', 'vue-webapp'],

      // Flutter
      flutter: ['flutter-app'],
      dart: ['flutter-app'],
      cross: ['flutter-app', 'kotlin-multiplatform'],
    };

    // 计算每个模板的得分
    const scores = {};

    allTemplates.forEach((template) => {
      scores[template.id] = 0;

      // 1. 名称匹配
      if (template.name.toLowerCase().includes(lowerDescription)) {
        scores[template.id] += 10;
      }

      // 2. 描述匹配
      if (template.description.toLowerCase().includes(lowerDescription)) {
        scores[template.id] += 5;
      }

      // 3. 标签匹配
      (template.tags || []).forEach((tag) => {
        if (lowerDescription.includes(tag.toLowerCase())) {
          scores[template.id] += 3;
        }
      });

      // 4. 关键词权重
      Object.keys(keywordWeights).forEach((keyword) => {
        if (lowerDescription.includes(keyword)) {
          if (keywordWeights[keyword].includes(template.id)) {
            scores[template.id] += 8;
          }
        }
      });
    });

    // 按得分排序并返回前N个
    return allTemplates
      .sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0))
      .slice(0, limit);
  }

  /**
   * 获取模板预览（树形结构）
   * @param {string} templateId - 模板ID
   * @returns {Object} 预览数据
   */
  getTemplatePreview(templateId) {
    const template = this.getTemplateById(templateId);

    if (!template) {
      return null;
    }

    // 构建文件树
    const fileTree = this._buildFileTree(template);

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      projectType: template.projectType,
      tags: template.tags || [],
      fileTree,
      directoryCount: (template.directories || []).length,
      fileCount: (template.files || []).length,
      isBuiltin: template.isBuiltin,
      isCustom: template.isCustom,
    };
  }

  /**
   * 构建文件树
   * @private
   * @param {Object} template - 模板对象
   * @returns {Array} 文件树数组
   */
  _buildFileTree(template) {
    const tree = [];
    const paths = new Set();

    // 添加目录
    (template.directories || []).forEach((dir) => {
      this._addPathToTree(tree, dir, 'directory', paths);
    });

    // 添加文件
    (template.files || []).forEach((file) => {
      const filePath = typeof file === 'string' ? file : file.path;
      this._addPathToTree(tree, filePath, 'file', paths);
    });

    return tree;
  }

  /**
   * 将路径添加到树中
   * @private
   */
  _addPathToTree(tree, pathStr, type, existingPaths) {
    const parts = pathStr.split('/').filter((p) => p);
    let currentLevel = tree;

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      const currentPath = parts.slice(0, index + 1).join('/');

      // 检查是否已存在
      let existingNode = currentLevel.find((node) => node.name === part);

      if (!existingNode) {
        const newNode = {
          name: part,
          path: currentPath,
          type: isLast ? type : 'directory',
          children: isLast && type === 'file' ? undefined : [],
        };
        currentLevel.push(newNode);
        existingPaths.add(currentPath);
        existingNode = newNode;
      }

      if (!isLast && existingNode.children) {
        currentLevel = existingNode.children;
      }
    });
  }

  // ============================================================
  // 自定义模板 CRUD 操作
  // ============================================================

  /**
   * 保存自定义模板
   * @param {Object} template - 模板数据
   * @returns {Object} 保存后的模板
   */
  async saveCustomTemplate(template) {
    await this.initialize();

    if (!template.id) {
      template.id = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // 确保必要字段存在
    const savedTemplate = {
      id: template.id,
      name: template.name || '未命名模板',
      description: template.description || '',
      category: template.category || TemplateCategory.OTHER,
      projectType: template.projectType || 'other',
      icon: template.icon || 'folder',
      tags: template.tags || [],
      directories: template.directories || [],
      files: template.files || [],
      createdAt: template.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    // 检查是否与预置模板ID冲突
    if (ProjectTemplates[template.id]) {
      throw new Error(`模板ID与预置模板冲突: ${template.id}`);
    }

    this.customTemplates[savedTemplate.id] = savedTemplate;
    await this._saveCustomTemplates();

    logger.info('[TemplateLibrary] 保存自定义模板:', savedTemplate.id);

    return { ...savedTemplate, isBuiltin: false, isCustom: true };
  }

  /**
   * 删除自定义模板
   * @param {string} templateId - 模板ID
   * @returns {boolean} 是否成功删除
   */
  async deleteCustomTemplate(templateId) {
    await this.initialize();

    if (!this.customTemplates[templateId]) {
      throw new Error(`自定义模板不存在: ${templateId}`);
    }

    delete this.customTemplates[templateId];
    await this._saveCustomTemplates();

    logger.info('[TemplateLibrary] 删除自定义模板:', templateId);

    return true;
  }

  /**
   * 获取所有自定义模板
   * @returns {Array} 自定义模板列表
   */
  getCustomTemplates() {
    return Object.values(this.customTemplates).map((t) => ({
      ...t,
      isBuiltin: false,
      isCustom: true,
    }));
  }

  // ============================================================
  // 模板导入/导出
  // ============================================================

  /**
   * 导出模板
   * @param {string} templateId - 模板ID
   * @returns {Object} 导出数据
   */
  async exportTemplate(templateId) {
    const template = this.getTemplateById(templateId);

    if (!template) {
      throw new Error(`模板不存在: ${templateId}`);
    }

    // 移除内部属性
    const exportData = {
      ...template,
      exportedAt: Date.now(),
      version: '1.0.0',
    };

    delete exportData.isBuiltin;
    delete exportData.isCustom;

    return exportData;
  }

  /**
   * 批量导出模板
   * @param {Array<string>} templateIds - 模板ID列表
   * @returns {Object} 导出数据
   */
  async exportTemplates(templateIds) {
    const templates = [];

    for (const id of templateIds) {
      try {
        const exportData = await this.exportTemplate(id);
        templates.push(exportData);
      } catch (error) {
        logger.warn(`[TemplateLibrary] 导出模板失败: ${id}`, error.message);
      }
    }

    return {
      version: '1.0.0',
      exportedAt: Date.now(),
      count: templates.length,
      templates,
    };
  }

  /**
   * 导入模板
   * @param {Object} importData - 导入数据
   * @param {Object} options - 导入选项
   * @param {boolean} options.overwrite - 是否覆盖已存在的模板
   * @returns {Object} 导入结果
   */
  async importTemplate(importData, options = {}) {
    await this.initialize();

    const { overwrite = false } = options;
    const results = {
      success: [],
      failed: [],
      skipped: [],
    };

    // 处理单个模板或模板数组
    const templates = importData.templates || [importData];

    for (const template of templates) {
      try {
        // 检查是否与预置模板冲突
        if (ProjectTemplates[template.id]) {
          results.skipped.push({
            id: template.id,
            name: template.name,
            reason: '与预置模板ID冲突',
          });
          continue;
        }

        // 检查是否已存在
        if (this.customTemplates[template.id] && !overwrite) {
          results.skipped.push({
            id: template.id,
            name: template.name,
            reason: '模板已存在',
          });
          continue;
        }

        // 保存模板
        const savedTemplate = await this.saveCustomTemplate({
          ...template,
          id: overwrite ? template.id : `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          importedAt: Date.now(),
        });

        results.success.push({
          id: savedTemplate.id,
          name: savedTemplate.name,
        });
      } catch (error) {
        results.failed.push({
          id: template.id,
          name: template.name,
          error: error.message,
        });
      }
    }

    logger.info(
      `[TemplateLibrary] 导入完成: 成功 ${results.success.length}, 失败 ${results.failed.length}, 跳过 ${results.skipped.length}`
    );

    return results;
  }

  /**
   * 从项目创建模板
   * @param {string} projectPath - 项目路径
   * @param {Object} templateInfo - 模板信息
   * @returns {Object} 创建的模板
   */
  async createTemplateFromProject(projectPath, templateInfo) {
    await this.initialize();

    const directories = [];
    const files = [];

    // 扫描项目目录结构
    await this._scanDirectory(projectPath, '', directories, files);

    const template = {
      ...templateInfo,
      directories,
      files,
      createdAt: Date.now(),
      createdFrom: projectPath,
    };

    return await this.saveCustomTemplate(template);
  }

  /**
   * 扫描目录
   * @private
   */
  async _scanDirectory(basePath, relativePath, directories, files, maxDepth = 10) {
    if (maxDepth <= 0) return;

    const currentPath = path.join(basePath, relativePath);

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        // 跳过隐藏文件和常见的忽略目录
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === '__pycache__' ||
          entry.name === 'venv' ||
          entry.name === 'dist' ||
          entry.name === 'build'
        ) {
          continue;
        }

        const entryRelativePath = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;

        if (entry.isDirectory()) {
          directories.push(entryRelativePath);
          await this._scanDirectory(
            basePath,
            entryRelativePath,
            directories,
            files,
            maxDepth - 1
          );
        } else if (entry.isFile()) {
          // 读取文件内容（限制大小）
          const filePath = path.join(currentPath, entry.name);
          const stats = await fs.stat(filePath);

          if (stats.size < 100 * 1024) {
            // 小于100KB的文件
            const content = await fs.readFile(filePath, 'utf-8');
            files.push({
              path: entryRelativePath,
              content,
            });
          } else {
            files.push({
              path: entryRelativePath,
              content: '',
              note: '文件过大，未包含内容',
            });
          }
        }
      }
    } catch (error) {
      logger.warn(`[TemplateLibrary] 扫描目录失败: ${currentPath}`, error.message);
    }
  }
}

// 单例实例
let templateLibraryInstance = null;

/**
 * 获取模板库管理器实例
 * @param {string} configDir - 配置目录（可选）
 * @returns {TemplateLibraryManager}
 */
function getTemplateLibrary(configDir) {
  if (!templateLibraryInstance) {
    templateLibraryInstance = new TemplateLibraryManager(configDir);
  }
  return templateLibraryInstance;
}

module.exports = {
  TemplateLibraryManager,
  getTemplateLibrary,
};
