/**
 * Code Tools IPC Handlers
 * 代码工具相关的 IPC 处理函数
 *
 * 包含10个代码处理handlers:
 * - code:generate - 生成代码
 * - code:generateTests - 生成单元测试
 * - code:review - 代码审查
 * - code:refactor - 代码重构
 * - code:explain - 解释代码
 * - code:fixBug - 修复bug
 * - code:generateScaffold - 生成项目脚手架
 * - code:executePython - 执行Python代码
 * - code:executeFile - 执行代码文件
 * - code:checkSafety - 检查代码安全性
 */

const { ipcMain } = require('electron');

/**
 * 注册所有代码工具相关的 IPC handlers
 * @param {Object} context - 上下文对象，包含 llmManager 等
 */
function registerCodeIPC(context) {
  const { llmManager } = context;

  // 生成代码
  ipcMain.handle('code:generate', async (_event, description, options = {}) => {
    try {
      console.log('[Main] 生成代码:', description);

      const { getCodeEngine } = require('../engines/code-engine');
      const codeEngine = getCodeEngine(llmManager);

      const result = await codeEngine.handleProjectTask({
        taskType: 'generateCode',
        description: description,
        language: options.language || 'javascript',
        options: options
      });

      console.log('[Main] 代码生成完成');
      return result;
    } catch (error) {
      console.error('[Main] 代码生成失败:', error);
      throw error;
    }
  });

  // 生成单元测试
  ipcMain.handle('code:generateTests', async (_event, code, language) => {
    try {
      console.log('[Main] 生成单元测试:', language);

      const { getCodeEngine } = require('../engines/code-engine');
      const codeEngine = getCodeEngine(llmManager);

      const result = await codeEngine.handleProjectTask({
        taskType: 'generateTests',
        sourceCode: code,
        language: language
      });

      console.log('[Main] 单元测试生成完成');
      return result;
    } catch (error) {
      console.error('[Main] 单元测试生成失败:', error);
      throw error;
    }
  });

  // 代码审查
  ipcMain.handle('code:review', async (_event, code, language) => {
    try {
      console.log('[Main] 代码审查:', language);

      const { getCodeEngine } = require('../engines/code-engine');
      const codeEngine = getCodeEngine(llmManager);

      const result = await codeEngine.handleProjectTask({
        taskType: 'reviewCode',
        sourceCode: code,
        language: language
      });

      console.log('[Main] 代码审查完成，评分:', result.score);
      return result;
    } catch (error) {
      console.error('[Main] 代码审查失败:', error);
      throw error;
    }
  });

  // 代码重构
  ipcMain.handle('code:refactor', async (_event, code, language, refactoringType) => {
    try {
      console.log('[Main] 代码重构:', refactoringType);

      const { getCodeEngine } = require('../engines/code-engine');
      const codeEngine = getCodeEngine(llmManager);

      const result = await codeEngine.handleProjectTask({
        taskType: 'refactorCode',
        sourceCode: code,
        language: language,
        options: { goal: refactoringType }
      });

      console.log('[Main] 代码重构完成');
      return result;
    } catch (error) {
      console.error('[Main] 代码重构失败:', error);
      throw error;
    }
  });

  // 解释代码
  ipcMain.handle('code:explain', async (_event, code, language) => {
    try {
      console.log('[Main] 解释代码:', language);

      const { getCodeEngine } = require('../engines/code-engine');
      const codeEngine = getCodeEngine(llmManager);

      const result = await codeEngine.handleProjectTask({
        taskType: 'explainCode',
        sourceCode: code,
        language: language
      });

      console.log('[Main] 代码解释完成');
      return result;
    } catch (error) {
      console.error('[Main] 代码解释失败:', error);
      throw error;
    }
  });

  // 修复bug
  ipcMain.handle('code:fixBug', async (_event, code, language, errorMessage) => {
    try {
      console.log('[Main] 修复bug:', language);

      const { getCodeEngine } = require('../engines/code-engine');
      const codeEngine = getCodeEngine(llmManager);

      const result = await codeEngine.handleProjectTask({
        taskType: 'fixBugs',
        sourceCode: code,
        errorMessage: errorMessage,
        language: language
      });

      console.log('[Main] bug修复完成');
      return result;
    } catch (error) {
      console.error('[Main] bug修复失败:', error);
      throw error;
    }
  });

  // 生成项目脚手架
  ipcMain.handle('code:generateScaffold', async (_event, projectType, options = {}) => {
    try {
      console.log('[Main] 生成项目脚手架:', projectType);

      const { getCodeEngine } = require('../engines/code-engine');
      const codeEngine = getCodeEngine(llmManager);

      const result = await codeEngine.handleProjectTask({
        taskType: 'createScaffold',
        projectName: options.projectName || projectType,
        template: projectType,
        outputDir: options.outputDir || process.cwd(),
        options: options
      });

      console.log('[Main] 项目脚手架生成完成');
      return result;
    } catch (error) {
      console.error('[Main] 项目脚手架生成失败:', error);
      throw error;
    }
  });

  // 执行Python代码
  ipcMain.handle('code:executePython', async (_event, code, options = {}) => {
    try {
      console.log('[Main] 执行Python代码...');

      const { getCodeExecutor } = require('../engines/code-executor');
      const codeExecutor = getCodeExecutor();

      await codeExecutor.initialize();

      // 基础安全检查
      const safetyCheck = codeExecutor.checkSafety(code);
      if (!safetyCheck.safe && !options.ignoreWarnings) {
        return {
          success: false,
          error: 'code_unsafe',
          warnings: safetyCheck.warnings,
          message: '代码包含潜在危险操作,执行已阻止'
        };
      }

      const result = await codeExecutor.executePython(code, options);

      console.log('[Main] Python代码执行完成');
      return result;
    } catch (error) {
      console.error('[Main] Python代码执行失败:', error);
      return {
        success: false,
        error: 'execution_failed',
        message: error.message,
        stdout: '',
        stderr: error.message
      };
    }
  });

  // 执行代码文件
  ipcMain.handle('code:executeFile', async (_event, filepath, options = {}) => {
    try {
      console.log('[Main] 执行代码文件:', filepath);

      const { getCodeExecutor } = require('../engines/code-executor');
      const codeExecutor = getCodeExecutor();

      await codeExecutor.initialize();

      const result = await codeExecutor.executeFile(filepath, options);

      console.log('[Main] 代码文件执行完成');
      return result;
    } catch (error) {
      console.error('[Main] 代码文件执行失败:', error);
      return {
        success: false,
        error: 'execution_failed',
        message: error.message,
        stdout: '',
        stderr: error.message
      };
    }
  });

  // 检查代码安全性
  ipcMain.handle('code:checkSafety', async (_event, code) => {
    try {
      const { getCodeExecutor } = require('../engines/code-executor');
      const codeExecutor = getCodeExecutor();

      return codeExecutor.checkSafety(code);
    } catch (error) {
      console.error('[Main] 安全检查失败:', error);
      return {
        safe: false,
        warnings: [error.message]
      };
    }
  });

  console.log('[IPC] 代码工具IPC handlers已注册 (10个)');
}

module.exports = {
  registerCodeIPC
};
