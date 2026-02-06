/**
 * 项目导出分享 IPC
 * 处理项目导出、分享、文件导入导出等操作
 *
 * @module project-export-ipc
 * @description 项目导出分享模块，包括文档导出、PPT生成、分享功能、文件操作等
 */

const { logger, createLogger } = require("../utils/logger.js");
const path = require("path");
const PathSecurity = require("./path-security.js");

/**
 * 注册项目导出分享相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库实例
 * @param {Object} dependencies.llmManager - LLM 管理器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Function} dependencies.getDatabaseConnection - 获取数据库连接
 * @param {Function} dependencies.saveDatabase - 保存数据库
 * @param {Function} dependencies.getProjectConfig - 获取项目配置
 * @param {Function} dependencies.copyDirectory - 复制目录函数
 * @param {Function} dependencies.convertSlidesToOutline - 转换幻灯片为大纲
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 * @param {Object} dependencies.dialog - Dialog对象（可选，用于测试注入）
 */
function registerProjectExportIPC({
  database,
  llmManager,
  mainWindow,
  getDatabaseConnection,
  saveDatabase,
  getProjectConfig,
  copyDirectory,
  convertSlidesToOutline,
  ipcMain: injectedIpcMain,
  dialog: injectedDialog,
}) {
  // 支持依赖注入，用于测试
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;
  const dialog = injectedDialog || electron.dialog;

  logger.info(
    "[Project Export IPC] Registering Project Export/Share IPC handlers...",
  );

  // ============================================================
  // 文档导出相关 (4 handlers)
  // ============================================================

  /**
   * 导出文档为不同格式
   * 支持导出为 PDF, Word, HTML 等格式
   */
  ipcMain.handle("project:exportDocument", async (_event, params) => {
    try {
      const { projectId, sourcePath, format, outputPath } = params;

      // 解析路径（将 /data/projects/xxx 转换为绝对路径）
      const projectConfig = getProjectConfig();
      const resolvedSourcePath = projectConfig.resolveProjectPath(sourcePath);
      const resolvedOutputPath = outputPath
        ? projectConfig.resolveProjectPath(outputPath)
        : null;

      logger.info(`[Main] 导出文档: ${resolvedSourcePath} -> ${format}`);

      const DocumentEngine = require("../engines/document-engine");
      const documentEngine = new DocumentEngine();
      const result = await documentEngine.exportTo(
        resolvedSourcePath,
        format,
        resolvedOutputPath,
      );

      return {
        success: true,
        fileName: path.basename(result.path),
        path: result.path,
      };
    } catch (error) {
      logger.error("[Main] 文档导出失败:", error);
      throw error;
    }
  });

  /**
   * 生成 PPT 演示文稿
   * 从 Markdown 内容生成 PowerPoint 文件
   */
  ipcMain.handle("project:generatePPT", async (_event, params) => {
    try {
      const { projectId, sourcePath } = params;

      // 解析路径（将 /data/projects/xxx 转换为绝对路径）
      const projectConfig = getProjectConfig();
      const resolvedSourcePath = projectConfig.resolveProjectPath(sourcePath);

      logger.info(`[Main] 生成PPT: ${resolvedSourcePath}`);

      const fs = require("fs").promises;
      const PPTEngine = require("../engines/ppt-engine");

      // 读取Markdown内容
      const markdownContent = await fs.readFile(resolvedSourcePath, "utf-8");

      // 生成PPT
      const pptEngine = new PPTEngine();
      const result = await pptEngine.generateFromMarkdown(markdownContent, {
        outputPath: resolvedSourcePath.replace(/\.md$/, ".pptx"),
        llmManager: llmManager,
      });

      return {
        success: true,
        fileName: result.fileName,
        path: result.path,
        slideCount: result.slideCount,
      };
    } catch (error) {
      logger.error("[Main] PPT生成失败:", error);
      throw error;
    }
  });

  /**
   * 生成播客脚本
   * 将文章内容转换为适合播客朗读的口语化脚本
   */
  ipcMain.handle("project:generatePodcastScript", async (_event, params) => {
    try {
      const { projectId, sourcePath } = params;

      // 解析路径（将 /data/projects/xxx 转换为绝对路径）
      const projectConfig = getProjectConfig();
      const resolvedSourcePath = projectConfig.resolveProjectPath(sourcePath);

      logger.info(`[Main] 生成播客脚本: ${resolvedSourcePath}`);

      const fs = require("fs").promises;

      // 读取文档内容
      const content = await fs.readFile(resolvedSourcePath, "utf-8");

      // 使用LLM转换为播客脚本
      const prompt = `请将以下文章内容转换为适合播客朗读的口语化脚本：

${content}

要求：
1. 使用第一人称，自然流畅
2. 增加过渡语和互动语言
3. 适合音频传播
4. 保持原文核心内容`;

      const response = await llmManager.query(prompt, {
        temperature: 0.7,
        maxTokens: 3000,
      });

      // 保存脚本
      const outputPath = resolvedSourcePath.replace(/\.[^.]+$/, "_podcast.txt");
      await fs.writeFile(outputPath, response.text, "utf-8");

      return {
        success: true,
        fileName: path.basename(outputPath),
        path: outputPath,
        content: response.text,
      };
    } catch (error) {
      logger.error("[Main] 播客脚本生成失败:", error);
      throw error;
    }
  });

  /**
   * 生成文章配图
   * 分析文章内容，提取适合配图的关键主题
   */
  ipcMain.handle("project:generateArticleImages", async (_event, params) => {
    try {
      const { projectId, sourcePath } = params;

      // 解析路径（将 /data/projects/xxx 转换为绝对路径）
      const projectConfig = getProjectConfig();
      const resolvedSourcePath = projectConfig.resolveProjectPath(sourcePath);

      logger.info(`[Main] 生成文章配图: ${resolvedSourcePath}`);

      const fs = require("fs").promises;

      // 读取文档内容
      const content = await fs.readFile(resolvedSourcePath, "utf-8");

      // 使用LLM提取关键主题
      const prompt = `请分析以下文章，提取3-5个适合配图的关键主题：

${content.substring(0, 2000)}

请以JSON数组格式返回主题列表，每个主题包含：
- title: 主题标题
- description: 图片描述（用于AI绘图）

格式示例：
[
  {"title": "主题1", "description": "详细的图片描述"},
  {"title": "主题2", "description": "详细的图片描述"}
]`;

      const response = await llmManager.query(prompt, {
        temperature: 0.7,
        maxTokens: 1000,
      });

      // 解析主题
      let themes = [];
      try {
        const jsonMatch = response.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          themes = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        logger.warn("[Main] 解析主题失败，使用默认主题");
        themes = [
          { title: "文章插图1", description: "根据文章内容创作的插图" },
        ];
      }

      // 创建图片目录
      const imageDir = resolvedSourcePath.replace(/\.[^.]+$/, "_images");
      await fs.mkdir(imageDir, { recursive: true });

      // 保存主题列表
      const themesPath = path.join(imageDir, "themes.json");
      await fs.writeFile(themesPath, JSON.stringify(themes, null, 2), "utf-8");

      return {
        success: true,
        path: imageDir,
        themes,
        message: "主题已生成，请使用AI绘图工具生成实际图片",
      };
    } catch (error) {
      logger.error("[Main] 文章配图生成失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 分享功能相关 (5 handlers)
  // ============================================================

  /**
   * 创建或更新项目分享
   * 生成分享链接和 token
   */
  ipcMain.handle("project:shareProject", async (_event, params) => {
    try {
      const { projectId, shareMode, expiresInDays, regenerateToken } = params;
      logger.info(`[Main] 分享项目: ${projectId}, 模式: ${shareMode}`);

      if (!database) {
        throw new Error("数据库未初始化");
      }

      // 获取分享管理器
      let shareManager;
      if (!shareManager) {
        const { getShareManager } = require("./share-manager");
        shareManager = getShareManager(database);
      }

      // 创建或更新分享
      const result = await shareManager.createOrUpdateShare(
        projectId,
        shareMode,
        {
          expiresInDays,
          regenerateToken,
        },
      );

      // 如果是公开模式，发布到社交模块
      if (shareMode === "public") {
        logger.info("[Main] 项目设置为公开访问");
        try {
          // 尝试发布到社交模块
          const postId = `project-share-${projectId}`;
          const shareContent = {
            type: "project_share",
            project_id: projectId,
            share_link: result.share.share_link,
            shared_at: Date.now(),
          };

          // 检查是否存在社交帖子表
          const tableExists = await database.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='social_posts'",
          );

          if (tableExists) {
            // 插入或更新分享帖子
            await database.run(
              `INSERT OR REPLACE INTO social_posts (id, type, content, created_at, updated_at)
               VALUES (?, 'project_share', ?, ?, ?)`,
              [postId, JSON.stringify(shareContent), Date.now(), Date.now()],
            );
            logger.info("[Main] 项目已发布到社交模块");
          }
        } catch (socialError) {
          // 社交模块失败不影响分享功能
          logger.warn("[Main] 发布到社交模块失败:", socialError.message);
        }
      }

      return {
        success: true,
        shareLink: result.share.share_link,
        shareToken: result.share.share_token,
        shareMode: result.share.share_mode,
        share: result.share,
      };
    } catch (error) {
      logger.error("[Main] 项目分享失败:", error);
      throw error;
    }
  });

  /**
   * 获取项目分享信息
   */
  ipcMain.handle("project:getShare", async (_event, projectId) => {
    try {
      logger.info(`[Main] 获取项目分享信息: ${projectId}`);

      if (!database) {
        throw new Error("数据库未初始化");
      }

      const { getShareManager } = require("./share-manager");
      const shareManager = getShareManager(database);

      const share = shareManager.getShareByProjectId(projectId);

      return {
        success: true,
        share,
      };
    } catch (error) {
      logger.error("[Main] 获取分享信息失败:", error);
      throw error;
    }
  });

  /**
   * 删除项目分享
   */
  ipcMain.handle("project:deleteShare", async (_event, projectId) => {
    try {
      logger.info(`[Main] 删除项目分享: ${projectId}`);

      if (!database) {
        throw new Error("数据库未初始化");
      }

      const { getShareManager } = require("./share-manager");
      const shareManager = getShareManager(database);

      const success = shareManager.deleteShare(projectId);

      return {
        success,
      };
    } catch (error) {
      logger.error("[Main] 删除分享失败:", error);
      throw error;
    }
  });

  /**
   * 根据 token 访问分享项目
   */
  ipcMain.handle("project:accessShare", async (_event, token) => {
    try {
      logger.info(`[Main] 访问分享项目: ${token}`);

      if (!database) {
        throw new Error("数据库未初始化");
      }

      const { getShareManager } = require("./share-manager");
      const shareManager = getShareManager(database);

      const share = shareManager.getShareByToken(token);

      if (!share) {
        throw new Error("分享不存在");
      }

      if (share.is_expired) {
        throw new Error("分享已过期");
      }

      if (!share.accessible) {
        throw new Error("分享已设置为私密");
      }

      // 增加访问计数
      shareManager.incrementAccessCount(token);

      return {
        success: true,
        share,
      };
    } catch (error) {
      logger.error("[Main] 访问分享失败:", error);
      throw error;
    }
  });

  /**
   * 微信分享（生成二维码）
   */
  ipcMain.handle("project:shareToWechat", async (_event, params) => {
    try {
      const { projectId, shareLink } = params;
      logger.info(`[Main] 微信分享: ${shareLink}`);

      // 使用 qrcode 库生成二维码
      const QRCode = require("qrcode");

      // 生成二维码数据URL
      const qrCodeDataURL = await QRCode.toDataURL(shareLink, {
        width: 256,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
        errorCorrectionLevel: "M",
      });

      // 同时生成 SVG 格式以支持高清显示
      const qrCodeSVG = await QRCode.toString(shareLink, {
        type: "svg",
        width: 256,
        margin: 2,
        errorCorrectionLevel: "M",
      });

      return {
        success: true,
        projectId,
        shareLink,
        qrCode: {
          dataURL: qrCodeDataURL,
          svg: qrCodeSVG,
          format: "png",
        },
        message: "二维码生成成功，扫码即可访问",
      };
    } catch (error) {
      logger.error("[Main] 微信分享失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 文件操作相关 (8 handlers)
  // ============================================================

  /**
   * 复制文件（项目内）
   */
  ipcMain.handle("project:copyFile", async (_event, params) => {
    try {
      const { sourcePath, targetPath } = params;

      // 解析路径（将 /data/projects/xxx 转换为绝对路径）
      const projectConfig = getProjectConfig();
      const resolvedSourcePath = projectConfig.resolveProjectPath(sourcePath);
      const resolvedTargetPath = projectConfig.resolveProjectPath(targetPath);

      logger.info(
        `[Main] 复制文件: ${resolvedSourcePath} -> ${resolvedTargetPath}`,
      );

      const fs = require("fs").promises;
      await fs.copyFile(resolvedSourcePath, resolvedTargetPath);

      return {
        success: true,
        fileName: path.basename(resolvedTargetPath),
        path: resolvedTargetPath,
      };
    } catch (error) {
      logger.error("[Main] 文件复制失败:", error);
      throw error;
    }
  });

  /**
   * 移动文件（项目内拖拽）
   */
  ipcMain.handle("project:move-file", async (_event, params) => {
    try {
      const { projectId, fileId, sourcePath, targetPath } = params;
      logger.info(`[Main] 移动文件: ${sourcePath} -> ${targetPath}`);

      const fs = require("fs").promises;
      const projectConfig = getProjectConfig();

      // 解析路径
      const resolvedSourcePath = projectConfig.resolveProjectPath(sourcePath);
      const resolvedTargetPath = projectConfig.resolveProjectPath(targetPath);

      // 确保目标目录存在
      const targetDir = path.dirname(resolvedTargetPath);
      await fs.mkdir(targetDir, { recursive: true });

      // 移动文件
      await fs.rename(resolvedSourcePath, resolvedTargetPath);

      // 更新数据库中的文件记录
      if (projectId && fileId) {
        const db = getDatabaseConnection();
        const newFileName = path.basename(resolvedTargetPath);
        const newFilePath = targetPath;

        const updateSQL = `
          UPDATE project_files
          SET file_name = ?, file_path = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND project_id = ?
        `;
        await db.run(updateSQL, [newFileName, newFilePath, fileId, projectId]);
        await saveDatabase();
        logger.info(`[Main] 文件记录已更新: ${fileId}`);
      }

      return {
        success: true,
        fileName: path.basename(resolvedTargetPath),
        path: resolvedTargetPath,
      };
    } catch (error) {
      logger.error("[Main] 文件移动失败:", error);
      throw error;
    }
  });

  /**
   * 从外部导入文件到项目
   */
  ipcMain.handle("project:import-file", async (_event, params) => {
    try {
      const { projectId, externalPath, targetPath } = params;
      logger.info(`[Main] 导入文件: ${externalPath} -> ${targetPath}`);

      const fs = require("fs").promises;
      const projectConfig = getProjectConfig();

      // 1. 获取项目信息
      const db = getDatabaseConnection();
      const project = await db.get("SELECT * FROM projects WHERE id = ?", [
        projectId,
      ]);
      if (!project) {
        throw new Error("项目不存在");
      }

      // 2. 验证目标路径安全性（确保在项目目录内）
      const projectRoot = projectConfig.resolveProjectPath(
        project.root_path || project.folder_path,
      );
      const safeTargetPath = PathSecurity.validateFilePath(
        targetPath,
        projectRoot,
      );

      // 3. 验证外部源文件路径（防止读取敏感系统文件）
      // 检查是否包含危险字符或路径遍历
      if (PathSecurity.containsDangerousChars(externalPath)) {
        throw new Error("外部文件路径包含非法字符");
      }

      // 验证外部文件是否存在且可读
      try {
        await fs.access(externalPath, fs.constants.R_OK);
      } catch (error) {
        throw new Error("外部文件不存在或无法访问");
      }

      // 4. 验证文件扩展名（可选，根据配置）
      const allowedExtensions =
        projectConfig.getAllConfig().allowedFileTypes || [];
      if (allowedExtensions.length > 0) {
        if (
          !PathSecurity.validateFileExtension(externalPath, allowedExtensions)
        ) {
          throw new Error(`不支持的文件类型: ${path.extname(externalPath)}`);
        }
      }

      // 5. 确保目标目录存在
      const targetDir = path.dirname(safeTargetPath);
      await fs.mkdir(targetDir, { recursive: true });

      // 6. 复制文件（保留外部源文件）
      await fs.copyFile(externalPath, safeTargetPath);

      // 7. 获取文件信息
      const stats = await fs.stat(safeTargetPath);
      const content = await fs.readFile(safeTargetPath, "utf-8");

      // 8. 添加到数据库
      const fileId = require("crypto").randomUUID();
      const fileName = PathSecurity.sanitizeFilename(
        path.basename(safeTargetPath),
      );
      const fileExt = path.extname(fileName).substring(1);

      const insertSQL = `
        INSERT INTO project_files (
          id, project_id, file_name, file_path, file_type, file_size, content,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;

      await db.run(insertSQL, [
        fileId,
        projectId,
        fileName,
        targetPath,
        fileExt || "unknown",
        stats.size,
        content,
      ]);
      await saveDatabase();

      logger.info(`[Main] 文件导入成功: ${fileId}`);

      return {
        success: true,
        fileId: fileId,
        fileName: fileName,
        path: safeTargetPath,
        size: stats.size,
      };
    } catch (error) {
      logger.error("[Main] 文件导入失败:", error);
      throw error;
    }
  });

  /**
   * 导出文件到外部
   */
  ipcMain.handle("project:export-file", async (_event, params) => {
    try {
      const { projectId, projectPath, targetPath, isDirectory } = params;
      logger.info(`[Main] 导出文件参数:`, params);

      const fs = require("fs").promises;
      const projectConfig = getProjectConfig();

      // 1. 获取项目信息
      const db = getDatabaseConnection();
      const project = await db.get("SELECT * FROM projects WHERE id = ?", [
        projectId,
      ]);
      if (!project) {
        throw new Error("项目不存在");
      }

      // 2. 验证源路径安全性（确保在项目目录内）
      const projectRoot = projectConfig.resolveProjectPath(
        project.root_path || project.folder_path,
      );
      const safeSourcePath = PathSecurity.validateFilePath(
        projectPath,
        projectRoot,
      );
      logger.info(`[Main] 验证后的源路径: ${safeSourcePath}`);
      logger.info(`[Main] 目标路径: ${targetPath}`);

      // 3. 检查源文件/文件夹是否存在
      try {
        await fs.access(safeSourcePath);
      } catch (err) {
        logger.error(`[Main] 源文件不存在: ${safeSourcePath}`);
        throw new Error(`源文件不存在: ${projectPath}`);
      }

      const stats = await fs.stat(safeSourcePath);

      if (stats.isDirectory()) {
        // 递归复制目录
        logger.info(`[Main] 复制目录: ${safeSourcePath} -> ${targetPath}`);
        await copyDirectory(safeSourcePath, targetPath);
      } else {
        // 确保目标目录存在
        const targetDir = path.dirname(targetPath);
        await fs.mkdir(targetDir, { recursive: true });

        // 复制单个文件
        logger.info(`[Main] 复制文件: ${safeSourcePath} -> ${targetPath}`);
        await fs.copyFile(safeSourcePath, targetPath);
      }

      logger.info(`[Main] 文件导出成功: ${targetPath}`);

      return {
        success: true,
        path: targetPath,
        isDirectory: stats.isDirectory(),
      };
    } catch (error) {
      logger.error("[Main] 文件导出失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 批量导出文件到外部
   */
  ipcMain.handle("project:export-files", async (_event, params) => {
    try {
      const { files, targetDirectory } = params;
      logger.info(
        `[Main] 批量导出 ${files.length} 个文件到: ${targetDirectory}`,
      );

      const fs = require("fs").promises;
      const projectConfig = getProjectConfig();
      const results = [];

      // 确保目标目录存在
      await fs.mkdir(targetDirectory, { recursive: true });

      for (const file of files) {
        try {
          const resolvedSourcePath = projectConfig.resolveProjectPath(
            file.path,
          );
          const targetPath = path.join(targetDirectory, file.name);

          const stats = await fs.stat(resolvedSourcePath);

          if (stats.isDirectory()) {
            await copyDirectory(resolvedSourcePath, targetPath);
          } else {
            await fs.copyFile(resolvedSourcePath, targetPath);
          }

          results.push({
            success: true,
            name: file.name,
            path: targetPath,
          });
        } catch (error) {
          logger.error(`[Main] 导出文件失败: ${file.name}`, error);
          results.push({
            success: false,
            name: file.name,
            error: error.message,
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      logger.info(`[Main] 批量导出完成: ${successCount}/${files.length} 成功`);

      return {
        success: true,
        results,
        successCount,
        totalCount: files.length,
      };
    } catch (error) {
      logger.error("[Main] 批量导出失败:", error);
      throw error;
    }
  });

  /**
   * 选择导出目录对话框
   */
  ipcMain.handle("project:select-export-directory", async (_event) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory", "createDirectory"],
        title: "选择导出目录",
      });

      if (
        result.canceled ||
        !result.filePaths ||
        result.filePaths.length === 0
      ) {
        return {
          success: false,
          canceled: true,
        };
      }

      return {
        success: true,
        path: result.filePaths[0],
      };
    } catch (error) {
      logger.error("[Main] 选择导出目录失败:", error);
      throw error;
    }
  });

  /**
   * 选择导入文件对话框
   */
  ipcMain.handle(
    "project:select-import-files",
    async (_event, options = {}) => {
      try {
        const dialogOptions = {
          properties: ["openFile", "multiSelections"],
          title: "选择要导入的文件",
        };

        // 如果允许选择文件夹
        if (options.allowDirectory) {
          dialogOptions.properties.push("openDirectory");
        }

        // 文件过滤器
        if (options.filters) {
          dialogOptions.filters = options.filters;
        }

        const result = await dialog.showOpenDialog(mainWindow, dialogOptions);

        if (
          result.canceled ||
          !result.filePaths ||
          result.filePaths.length === 0
        ) {
          return {
            success: false,
            canceled: true,
          };
        }

        return {
          success: true,
          filePaths: result.filePaths,
        };
      } catch (error) {
        logger.error("[Main] 选择导入文件失败:", error);
        throw error;
      }
    },
  );

  /**
   * 批量导入文件到项目
   */
  ipcMain.handle("project:import-files", async (_event, params) => {
    try {
      const { projectId, externalPaths, targetDirectory } = params;
      logger.info(
        `[Main] 批量导入 ${externalPaths.length} 个文件到: ${targetDirectory}`,
      );

      const fs = require("fs").promises;
      const projectConfig = getProjectConfig();
      const results = [];

      for (const externalPath of externalPaths) {
        try {
          const fileName = path.basename(externalPath);
          const targetPath = path.join(targetDirectory, fileName);
          const resolvedTargetPath =
            projectConfig.resolveProjectPath(targetPath);

          // 确保目标目录存在
          const targetDir = path.dirname(resolvedTargetPath);
          await fs.mkdir(targetDir, { recursive: true });

          // 检查源是文件还是目录
          const stats = await fs.stat(externalPath);

          if (stats.isDirectory()) {
            await copyDirectory(externalPath, resolvedTargetPath);
          } else {
            await fs.copyFile(externalPath, resolvedTargetPath);
          }

          // 读取文件内容（仅对文件，不对目录）
          let content = "";
          let fileSize = 0;

          if (stats.isFile()) {
            try {
              content = await fs.readFile(resolvedTargetPath, "utf-8");
              fileSize = stats.size;
            } catch (err) {
              // 如果是二进制文件，忽略内容读取错误
              logger.info(
                `[Main] 无法读取文件内容（可能是二进制文件）: ${fileName}`,
              );
              fileSize = stats.size;
            }
          }

          // 添加到数据库
          const db = getDatabaseConnection();
          const fileId = require("crypto").randomUUID();
          const fileExt = path.extname(fileName).substring(1);

          const insertSQL = `
            INSERT INTO project_files (
              id, project_id, file_name, file_path, file_type, file_size, content,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `;

          await db.run(insertSQL, [
            fileId,
            projectId,
            fileName,
            targetPath,
            fileExt || "unknown",
            fileSize,
            content,
          ]);

          results.push({
            success: true,
            fileId,
            name: fileName,
            path: resolvedTargetPath,
          });

          logger.info(`[Main] 文件导入成功: ${fileName}`);
        } catch (error) {
          logger.error(
            `[Main] 导入文件失败: ${path.basename(externalPath)}`,
            error,
          );
          results.push({
            success: false,
            name: path.basename(externalPath),
            error: error.message,
          });
        }
      }

      await saveDatabase();

      const successCount = results.filter((r) => r.success).length;
      logger.info(
        `[Main] 批量导入完成: ${successCount}/${externalPaths.length} 成功`,
      );

      return {
        success: true,
        results,
        successCount,
        totalCount: externalPaths.length,
      };
    } catch (error) {
      logger.error("[Main] 批量导入失败:", error);
      throw error;
    }
  });

  logger.info("[Project Export IPC] ✓ 17 handlers registered");
  logger.info("[Project Export IPC] - 4 document export handlers");
  logger.info("[Project Export IPC] - 5 sharing handlers");
  logger.info("[Project Export IPC] - 8 file operation handlers");
}

module.exports = {
  registerProjectExportIPC,
};
