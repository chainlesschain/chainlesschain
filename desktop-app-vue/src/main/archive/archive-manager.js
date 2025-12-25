/**
 * 压缩包管理器
 * 支持 ZIP, RAR, 7Z 格式的预览和提取
 */

const path = require('path');
const fs = require('fs').promises;
const AdmZip = require('adm-zip');
const Seven = require('node-7z');
const { app } = require('electron');

class ArchiveManager {
  constructor() {
    this.tempDir = path.join(app.getPath('temp'), 'chainlesschain-archive');
    this.ensureTempDir();
  }

  /**
   * 确保临时目录存在
   */
  async ensureTempDir() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      console.error('[Archive Manager] 创建临时目录失败:', error);
    }
  }

  /**
   * 列出压缩包内容
   * @param {string} archivePath - 压缩包路径
   * @returns {Promise<Array>} 文件列表
   */
  async listContents(archivePath) {
    const ext = path.extname(archivePath).toLowerCase();

    switch (ext) {
      case '.zip':
        return await this.listZipContents(archivePath);
      case '.7z':
        return await this.list7zContents(archivePath);
      case '.rar':
        return await this.listRarContents(archivePath);
      default:
        throw new Error(`不支持的压缩格式: ${ext}`);
    }
  }

  /**
   * 列出ZIP内容
   */
  async listZipContents(zipPath) {
    try {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();

      const fileTree = [];

      for (const entry of entries) {
        const isDirectory = entry.isDirectory;
        const name = entry.entryName;
        const size = entry.header.size;
        const compressedSize = entry.header.compressedSize;
        const date = entry.header.time;
        const compressionRatio = size > 0 ? ((1 - compressedSize / size) * 100).toFixed(2) : 0;

        fileTree.push({
          name: name,
          path: name,
          isDirectory: isDirectory,
          size: size,
          compressedSize: compressedSize,
          compressionRatio: parseFloat(compressionRatio),
          date: date,
          type: isDirectory ? 'directory' : this.getFileType(name),
        });
      }

      return this.buildTree(fileTree);
    } catch (error) {
      console.error('[Archive Manager] ZIP解析失败:', error);
      throw error;
    }
  }

  /**
   * 列出7Z内容
   */
  async list7zContents(archivePath) {
    return new Promise((resolve, reject) => {
      const sevenZip = Seven.list(archivePath, {
        $bin: this.get7zBinary(),
      });

      const files = [];

      sevenZip.on('data', (data) => {
        files.push({
          name: data.file,
          path: data.file,
          isDirectory: data.attr && data.attr.includes('D'),
          size: parseInt(data.size) || 0,
          compressedSize: parseInt(data.compressed) || 0,
          compressionRatio: 0,
          date: data.date,
          type: data.attr && data.attr.includes('D') ? 'directory' : this.getFileType(data.file),
        });
      });

      sevenZip.on('end', () => {
        resolve(this.buildTree(files));
      });

      sevenZip.on('error', (err) => {
        reject(new Error(`7Z解析失败: ${err.message}`));
      });
    });
  }

  /**
   * 列出RAR内容（使用7z）
   */
  async listRarContents(rarPath) {
    // RAR也可以用7z来处理
    return await this.list7zContents(rarPath);
  }

  /**
   * 提取单个文件到临时目录
   * @param {string} archivePath - 压缩包路径
   * @param {string} filePath - 文件在压缩包内的路径
   * @returns {Promise<string>} 提取后的文件路径
   */
  async extractFile(archivePath, filePath) {
    const ext = path.extname(archivePath).toLowerCase();
    const outputPath = path.join(this.tempDir, Date.now().toString(), path.basename(filePath));

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    switch (ext) {
      case '.zip':
        return await this.extractZipFile(archivePath, filePath, outputPath);
      case '.7z':
      case '.rar':
        return await this.extract7zFile(archivePath, filePath, outputPath);
      default:
        throw new Error(`不支持的压缩格式: ${ext}`);
    }
  }

  /**
   * 从ZIP提取文件
   */
  async extractZipFile(zipPath, filePath, outputPath) {
    try {
      const zip = new AdmZip(zipPath);
      const entry = zip.getEntry(filePath);

      if (!entry) {
        throw new Error(`文件不存在: ${filePath}`);
      }

      if (entry.isDirectory) {
        throw new Error('无法预览文件夹');
      }

      zip.extractEntryTo(entry, path.dirname(outputPath), false, true);
      return outputPath;
    } catch (error) {
      console.error('[Archive Manager] ZIP文件提取失败:', error);
      throw error;
    }
  }

  /**
   * 从7Z/RAR提取文件
   */
  async extract7zFile(archivePath, filePath, outputPath) {
    return new Promise((resolve, reject) => {
      const sevenZip = Seven.extractFull(archivePath, path.dirname(outputPath), {
        $bin: this.get7zBinary(),
        $cherryPick: [filePath],
      });

      sevenZip.on('end', () => {
        resolve(path.join(path.dirname(outputPath), filePath));
      });

      sevenZip.on('error', (err) => {
        reject(new Error(`7Z文件提取失败: ${err.message}`));
      });
    });
  }

  /**
   * 获取压缩包信息
   * @param {string} archivePath - 压缩包路径
   * @returns {Promise<Object>} 压缩包信息
   */
  async getArchiveInfo(archivePath) {
    try {
      const stats = await fs.stat(archivePath);
      const contents = await this.listContents(archivePath);

      const fileCount = contents.filter(item => !item.isDirectory).length;
      const folderCount = contents.filter(item => item.isDirectory).length;

      return {
        path: archivePath,
        name: path.basename(archivePath),
        size: stats.size,
        type: path.extname(archivePath).toUpperCase().slice(1),
        fileCount: fileCount,
        folderCount: folderCount,
        created: stats.birthtime,
        modified: stats.mtime,
      };
    } catch (error) {
      console.error('[Archive Manager] 获取压缩包信息失败:', error);
      throw error;
    }
  }

  /**
   * 构建文件树结构
   */
  buildTree(flatList) {
    const tree = [];
    const pathMap = new Map();

    // 排序：文件夹在前，文件在后
    flatList.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const item of flatList) {
      const parts = item.path.split(/[/\\]/);
      const fileName = parts[parts.length - 1];

      const treeNode = {
        key: item.path,
        title: fileName,
        isLeaf: !item.isDirectory,
        ...item,
      };

      if (parts.length === 1) {
        // 根级文件/文件夹
        tree.push(treeNode);
        pathMap.set(item.path, treeNode);
      } else {
        // 嵌套文件/文件夹
        const parentPath = parts.slice(0, -1).join('/');
        const parent = pathMap.get(parentPath);

        if (parent) {
          if (!parent.children) {
            parent.children = [];
          }
          parent.children.push(treeNode);
        } else {
          // 父节点不存在，添加到根级
          tree.push(treeNode);
        }

        pathMap.set(item.path, treeNode);
      }
    }

    return tree;
  }

  /**
   * 获取文件类型
   */
  getFileType(fileName) {
    const ext = path.extname(fileName).toLowerCase().slice(1);
    const typeMap = {
      // 文档
      pdf: 'document',
      doc: 'document',
      docx: 'document',
      txt: 'document',
      md: 'document',
      // 表格
      xlsx: 'spreadsheet',
      xls: 'spreadsheet',
      csv: 'spreadsheet',
      // 图片
      png: 'image',
      jpg: 'image',
      jpeg: 'image',
      gif: 'image',
      svg: 'image',
      // 视频
      mp4: 'video',
      avi: 'video',
      mkv: 'video',
      // 音频
      mp3: 'audio',
      wav: 'audio',
      // 代码
      js: 'code',
      ts: 'code',
      vue: 'code',
      html: 'code',
      css: 'code',
      json: 'code',
    };

    return typeMap[ext] || 'file';
  }

  /**
   * 获取7z二进制路径
   */
  get7zBinary() {
    // node-7z会自动查找系统中的7z可执行文件
    // 如果没有安装，可以使用7zip-bin包提供的二进制文件
    return require('7zip-bin').path7za;
  }

  /**
   * 清理临时文件
   */
  async cleanup() {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
      await this.ensureTempDir();
    } catch (error) {
      console.error('[Archive Manager] 清理临时文件失败:', error);
    }
  }
}

module.exports = ArchiveManager;
