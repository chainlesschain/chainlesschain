/**
 * Markdown导出器
 *
 * 将SQLite数据库中的知识库项导出为Markdown文件
 */

const { logger, createLogger } = require('../utils/logger.js');
const fs = require('fs');
const path = require('path');

/**
 * Markdown导出器类
 */
class MarkdownExporter {
  constructor(database, exportPath) {
    this.database = database;
    this.exportPath = exportPath;
  }

  /**
   * 导出所有知识库项
   */
  async exportAll() {
    try {
      logger.info('[MarkdownExporter] 开始导出所有知识库项...');

      // 确保导出目录存在
      if (!fs.existsSync(this.exportPath)) {
        fs.mkdirSync(this.exportPath, { recursive: true });
      }

      // 获取所有知识库项
      const items = this.database.getKnowledgeItems(9999, 0);

      const exportedFiles = [];

      for (const item of items) {
        const filename = await this.exportItem(item);
        exportedFiles.push(filename);
      }

      logger.info(`[MarkdownExporter] 导出完成: ${exportedFiles.length} 个文件`);

      return exportedFiles;
    } catch (error) {
      logger.error('[MarkdownExporter] 导出失败:', error);
      throw error;
    }
  }

  /**
   * 导出单个知识库项
   * @param {Object} item - 知识库项
   */
  async exportItem(item) {
    try {
      // 生成文件名（使用ID和标题）
      const filename = this.generateFilename(item);
      const filepath = path.join(this.exportPath, filename);

      // 生成Markdown内容
      const markdown = this.generateMarkdown(item);

      // 写入文件
      fs.writeFileSync(filepath, markdown, 'utf8');

      logger.info('[MarkdownExporter] 导出文件:', filename);

      return filename;
    } catch (error) {
      logger.error('[MarkdownExporter] 导出项失败:', error);
      throw error;
    }
  }

  /**
   * 生成文件名
   * @param {Object} item - 知识库项
   */
  generateFilename(item) {
    // 清理标题，移除特殊字符
    const cleanTitle = item.title
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, '-')
      .substring(0, 50);

    return `${item.id}-${cleanTitle}.md`;
  }

  /**
   * 生成Markdown内容
   * @param {Object} item - 知识库项
   */
  generateMarkdown(item) {
    const lines = [];

    // 前置元数据（YAML front matter）
    lines.push('---');
    lines.push(`id: ${item.id}`);
    lines.push(`title: ${item.title}`);
    lines.push(`type: ${item.type}`);

    // 标签
    if (item.tags && item.tags.length > 0) {
      lines.push(`tags: [${item.tags.join(', ')}]`);
    }

    lines.push(`created_at: ${item.created_at}`);
    lines.push(`updated_at: ${item.updated_at}`);

    if (item.source_url) {
      lines.push(`source_url: ${item.source_url}`);
    }

    lines.push('---');
    lines.push('');

    // 标题
    lines.push(`# ${item.title}`);
    lines.push('');

    // 内容
    if (item.content) {
      lines.push(item.content);
      lines.push('');
    }

    // 元数据部分
    lines.push('---');
    lines.push('');
    lines.push('## 元数据');
    lines.push('');
    lines.push(`- **类型**: ${item.type}`);
    lines.push(`- **创建时间**: ${item.created_at}`);
    lines.push(`- **更新时间**: ${item.updated_at}`);

    if (item.tags && item.tags.length > 0) {
      lines.push(`- **标签**: ${item.tags.join(', ')}`);
    }

    if (item.source_url) {
      lines.push(`- **来源**: [${item.source_url}](${item.source_url})`);
    }

    return lines.join('\n');
  }

  /**
   * 导出单个项（通过ID）
   * @param {string} id - 项ID
   */
  async exportById(id) {
    try {
      const item = this.database.getKnowledgeItemById(id);

      if (!item) {
        throw new Error(`未找到ID为 ${id} 的项`);
      }

      return await this.exportItem(item);
    } catch (error) {
      logger.error('[MarkdownExporter] 导出项失败:', error);
      throw error;
    }
  }

  /**
   * 删除导出的文件
   * @param {string} filename - 文件名
   */
  deleteExportedFile(filename) {
    try {
      const filepath = path.join(this.exportPath, filename);

      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        logger.info('[MarkdownExporter] 删除文件:', filename);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('[MarkdownExporter] 删除文件失败:', error);
      throw error;
    }
  }

  /**
   * 清理所有导出的文件
   */
  cleanAll() {
    try {
      if (!fs.existsSync(this.exportPath)) {
        return 0;
      }

      const files = fs.readdirSync(this.exportPath);
      let count = 0;

      for (const file of files) {
        if (file.endsWith('.md')) {
          const filepath = path.join(this.exportPath, file);
          fs.unlinkSync(filepath);
          count++;
        }
      }

      logger.info(`[MarkdownExporter] 清理完成: ${count} 个文件`);

      return count;
    } catch (error) {
      logger.error('[MarkdownExporter] 清理失败:', error);
      throw error;
    }
  }

  /**
   * 同步数据库到文件
   * - 导出所有项
   * - 删除不存在的项对应的文件
   */
  async sync() {
    try {
      logger.info('[MarkdownExporter] 开始同步...');

      // 获取数据库中的所有项
      const items = this.database.getKnowledgeItems(9999, 0);
      const itemIds = new Set(items.map((item) => item.id));

      // 导出所有项
      const exportedFiles = await this.exportAll();
      const exportedIds = new Set(
        exportedFiles.map((filename) => filename.split('-')[0])
      );

      // 查找需要删除的文件（数据库中不存在的项）
      const files = fs.existsSync(this.exportPath)
        ? fs.readdirSync(this.exportPath)
        : [];

      let deletedCount = 0;

      for (const file of files) {
        if (file.endsWith('.md')) {
          const fileId = file.split('-')[0];

          if (!itemIds.has(fileId)) {
            this.deleteExportedFile(file);
            deletedCount++;
          }
        }
      }

      logger.info('[MarkdownExporter] 同步完成');
      logger.info(`  导出: ${exportedFiles.length} 个文件`);
      logger.info(`  删除: ${deletedCount} 个文件`);

      return {
        exported: exportedFiles.length,
        deleted: deletedCount,
      };
    } catch (error) {
      logger.error('[MarkdownExporter] 同步失败:', error);
      throw error;
    }
  }
}

module.exports = MarkdownExporter;
