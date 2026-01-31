/**
 * 项目创建事务处理
 *
 * 使用事务管理器确保项目创建的原子性
 *
 * @version 0.27.0
 */

const { createTransaction } = require('../utils/transaction-manager.js');
const { logger } = require('../utils/logger.js');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

/**
 * 事务性项目创建
 *
 * @param {Object} params - 创建参数
 * @param {Object} params.createData - 项目数据
 * @param {Object} params.httpClient - HTTP 客户端
 * @param {Object} params.database - 数据库实例
 * @param {Object} params.projectConfig - 项目配置
 * @param {Function} params.replaceUndefinedWithNull - 清理函数
 * @returns {Promise<Object>} 创建结果
 */
async function createProjectWithTransaction({
  createData,
  httpClient,
  database,
  projectConfig,
  replaceUndefinedWithNull,
}) {
  const transaction = createTransaction('create-project');
  let projectId = null;
  let projectRootPath = null;
  let backendProject = null;

  try {
    // ========================================
    // 步骤1: 清理输入数据
    // ========================================
    const cleanedCreateData = await transaction.step(
      'clean-input',
      () => replaceUndefinedWithNull(createData),
      null // 无需回滚
    );

    logger.info('[Transaction] 清理后的创建数据:', JSON.stringify(cleanedCreateData, null, 2));

    // ========================================
    // 步骤2: 调用后端 API 创建项目
    // ========================================
    backendProject = await transaction.step(
      'backend-create',
      async () => {
        logger.info('[Transaction] 调用后端 API 创建项目...');
        const project = await httpClient.createProject(cleanedCreateData);
        projectId = project.id;
        logger.info('[Transaction] 后端项目创建成功, ID:', projectId);
        return project;
      },
      // 回滚: 删除后端项目
      async () => {
        if (projectId) {
          logger.warn('[Transaction] 回滚: 删除后端项目', projectId);
          try {
            await httpClient.deleteProject(projectId);
          } catch (error) {
            // 如果项目不存在，视为成功
            if (error.message && error.message.includes('不存在')) {
              logger.info('[Transaction] 后端项目不存在，回滚成功');
            } else {
              throw error;
            }
          }
        }
      }
    );

    // ========================================
    // 步骤3: 保存到本地数据库
    // ========================================
    await transaction.step(
      'database-save',
      async () => {
        const cleanedProject = replaceUndefinedWithNull(backendProject);

        const localProject = {
          ...cleanedProject,
          user_id: cleanedCreateData.userId || 'default-user',
          sync_status: 'synced',
          synced_at: Date.now(),
          file_count: cleanedProject.files ? cleanedProject.files.length : 0,
        };

        logger.info('[Transaction] 保存项目到本地数据库...');
        await database.saveProject(localProject);
        logger.info('[Transaction] 项目已保存到本地数据库');

        return localProject;
      },
      // 回滚: 删除本地数据库记录
      async () => {
        if (projectId && database) {
          logger.warn('[Transaction] 回滚: 删除本地数据库记录', projectId);
          try {
            await database.deleteProject(projectId);
          } catch (error) {
            logger.error('[Transaction] 删除本地记录失败:', error);
            // 不抛出错误，因为主要依赖后端删除
          }
        }
      }
    );

    // ========================================
    // 步骤4: 创建项目目录
    // ========================================
    projectRootPath = await transaction.step(
      'create-directory',
      async () => {
        const projectType = backendProject.project_type || backendProject.projectType;
        const rootPath = path.join(
          projectConfig.getProjectsRootPath(),
          projectId
        );

        logger.info('[Transaction] 创建项目目录:', rootPath, '项目类型:', projectType);
        await fs.mkdir(rootPath, { recursive: true });

        // 立即更新 root_path
        database.updateProject(projectId, { root_path: rootPath });
        logger.info('[Transaction] 项目 root_path 已设置:', rootPath);

        return rootPath;
      },
      // 回滚: 删除项目目录
      async () => {
        if (projectRootPath) {
          logger.warn('[Transaction] 回滚: 删除项目目录', projectRootPath);
          try {
            await fs.rm(projectRootPath, { recursive: true, force: true });
            logger.info('[Transaction] 项目目录已删除');
          } catch (error) {
            logger.error('[Transaction] 删除项目目录失败:', error);
            // 不抛出错误，允许手动清理
          }
        }
      }
    );

    // ========================================
    // 步骤5: 保存项目文件
    // ========================================
    if (backendProject.files && backendProject.files.length > 0) {
      await transaction.step(
        'save-files',
        async () => {
          logger.info('[Transaction] 开始保存文件，数量:', backendProject.files.length);

          const cleanedFiles = replaceUndefinedWithNull(backendProject.files);
          await database.saveProjectFiles(projectId, cleanedFiles);

          logger.info('[Transaction] 项目文件已保存到数据库');
          return cleanedFiles;
        },
        // 回滚: 删除文件记录（目录删除已经包含文件清理）
        async () => {
          if (projectId && database) {
            logger.warn('[Transaction] 回滚: 清理文件记录');
            try {
              // 删除文件记录
              database.db.run('DELETE FROM project_files WHERE project_id = ?', [projectId]);
            } catch (error) {
              logger.error('[Transaction] 清理文件记录失败:', error);
            }
          }
        }
      );
    }

    // ========================================
    // 提交事务
    // ========================================
    await transaction.commit();

    logger.info('[Transaction] ===== 项目创建成功 =====');
    logger.info('[Transaction] 项目 ID:', projectId);
    logger.info('[Transaction] 项目路径:', projectRootPath);
    logger.info('[Transaction] 文件数量:', backendProject.files?.length || 0);

    // 返回清理后的项目数据
    const safeProject = replaceUndefinedWithNull(backendProject);
    return {
      success: true,
      project: safeProject,
      transactionInfo: transaction.getInfo(),
    };

  } catch (error) {
    logger.error('[Transaction] ===== 项目创建失败 =====');
    logger.error('[Transaction] 错误:', error.message);
    logger.error('[Transaction] 堆栈:', error.stack);

    // 自动回滚
    logger.warn('[Transaction] 开始自动回滚...');
    try {
      await transaction.rollback();
      logger.info('[Transaction] 回滚成功，所有资源已清理');
    } catch (rollbackError) {
      logger.error('[Transaction] 回滚失败:', rollbackError);
      // 记录需要手动清理的资源
      logger.error('[Transaction] 需要手动清理的资源:', {
        projectId,
        projectRootPath,
        backendProject: !!backendProject,
      });
    }

    throw error;
  }
}

/**
 * 事务性快速创建项目
 *
 * @param {Object} params - 创建参数
 * @returns {Promise<Object>} 创建结果
 */
async function createQuickProjectWithTransaction({
  createData,
  database,
  projectConfig,
  replaceUndefinedWithNull,
}) {
  const transaction = createTransaction('create-quick-project');
  let projectId = null;
  let projectRootPath = null;

  try {
    // 步骤1: 生成项目 ID
    projectId = await transaction.step(
      'generate-id',
      () => crypto.randomUUID(),
      null
    );

    const timestamp = Date.now();

    // 步骤2: 创建项目目录
    projectRootPath = await transaction.step(
      'create-directory',
      async () => {
        const rootPath = path.join(projectConfig.getProjectsRootPath(), projectId);
        logger.info('[Transaction] 创建项目目录:', rootPath);
        await fs.mkdir(rootPath, { recursive: true });
        return rootPath;
      },
      // 回滚: 删除目录
      async () => {
        if (projectRootPath) {
          await fs.rm(projectRootPath, { recursive: true, force: true });
        }
      }
    );

    // 步骤3: 创建 README.md
    await transaction.step(
      'create-readme',
      async () => {
        const readmePath = path.join(projectRootPath, 'README.md');
        const readmeContent = `# ${createData.name}\n\n${createData.description || '这是一个新建的项目。'}\n\n创建时间：${new Date().toLocaleString('zh-CN')}\n`;
        await fs.writeFile(readmePath, readmeContent, 'utf-8');
        return readmeContent;
      },
      null // 目录删除会一起清理
    );

    // 步骤4: 保存到数据库
    const readmeContent = transaction.getStepResult('create-readme');
    await transaction.step(
      'database-save',
      async () => {
        const project = {
          id: projectId,
          name: createData.name,
          description: createData.description || '',
          project_type: createData.projectType || 'document',
          user_id: createData.userId || 'default-user',
          root_path: projectRootPath,
          created_at: timestamp,
          updated_at: timestamp,
          sync_status: 'pending',
          file_count: 1,
          metadata: JSON.stringify({
            created_by: 'quick-create',
            created_at: new Date().toISOString(),
          }),
        };

        await database.saveProject(project);

        // 保存文件记录
        const file = {
          project_id: projectId,
          file_name: 'README.md',
          file_path: 'README.md',
          file_type: 'markdown',
          content: readmeContent,
          created_at: timestamp,
          updated_at: timestamp,
        };

        await database.saveProjectFiles(projectId, [file]);

        return project;
      },
      // 回滚: 删除数据库记录
      async () => {
        if (projectId && database) {
          await database.deleteProject(projectId);
        }
      }
    );

    // 提交事务
    await transaction.commit();

    const project = transaction.getStepResult('database-save');
    return {
      success: true,
      project: replaceUndefinedWithNull(project),
      transactionInfo: transaction.getInfo(),
    };

  } catch (error) {
    logger.error('[Transaction] 快速创建失败:', error);

    try {
      await transaction.rollback();
    } catch (rollbackError) {
      logger.error('[Transaction] 回滚失败:', rollbackError);
    }

    throw error;
  }
}

module.exports = {
  createProjectWithTransaction,
  createQuickProjectWithTransaction,
};
