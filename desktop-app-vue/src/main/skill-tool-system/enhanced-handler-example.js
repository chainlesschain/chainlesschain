/**
 * 增强版Handler使用示例
 * 演示如何使用ToolLogger和ErrorHandler包装工具Handler
 */

const { logger, createLogger } = require('../utils/logger.js');
const AdditionalToolsV3Handler = require('./additional-tools-v3-handler');
const ToolLogger = require('./tool-logger');
const { ErrorHandler, ValidationError, ExecutionError } = require('./tool-errors');

/**
 * 创建增强版Handler
 * 自动添加日志记录和错误处理
 */
function createEnhancedHandler(options = {}) {
  // 创建logger
  const logger = new ToolLogger({
    logLevel: options.logLevel || 'info',
    context: 'AdditionalToolsV3',
    ...options.loggerOptions
  });

  // 创建错误处理器
  const errorHandler = new ErrorHandler(logger);

  // 创建原始Handler实例
  const baseHandler = new AdditionalToolsV3Handler({
    workDir: options.workDir,
    logger: logger
  });

  // 包装所有工具方法
  const enhancedHandler = {};

  // 获取所有工具方法
  const proto = Object.getPrototypeOf(baseHandler);
  const methodNames = Object.getOwnPropertyNames(proto).filter(
    name => name.startsWith('tool_') && typeof proto[name] === 'function'
  );

  // 为每个工具方法添加增强功能
  for (const methodName of methodNames) {
    const originalMethod = baseHandler[methodName].bind(baseHandler);
    const toolName = methodName.replace('tool_', '');

    enhancedHandler[methodName] = errorHandler.wrapHandler(
      originalMethod,
      toolName,
      logger
    );
  }

  // 添加辅助方法
  enhancedHandler.logger = logger;
  enhancedHandler.errorHandler = errorHandler;
  enhancedHandler.getErrorStats = () => errorHandler.getErrorStats();
  enhancedHandler.clearErrorStats = () => errorHandler.clearErrorStats();

  return enhancedHandler;
}

/**
 * 使用示例
 */
async function exampleUsage() {
  // 1. 创建增强版Handler
  const handler = createEnhancedHandler({
    logLevel: 'debug',
    workDir: './workspace'
  });

  // 2. 调用工具（自动记录日志和处理错误）
  const result1 = await handler.tool_contract_analyzer({
    contractCode: 'pragma solidity ^0.8.0; ...',
    analysisDepth: 'comprehensive',
    securityFocus: true
  });

  logger.info('Result 1:', result1);

  // 3. 调用失败会自动处理
  const result2 = await handler.tool_financial_calculator({
    calculationType: 'npv',
    // 缺少必需的cashFlows参数，会被捕获
  });

  logger.info('Result 2:', result2);

  // 4. 查看错误统计
  const errorStats = handler.getErrorStats();
  logger.info('Error Stats:', errorStats);

  // 5. 查看日志（日志已自动写入文件）
  // 日志文件位置: logs/tool-system-YYYY-MM-DD.log
}

// 仅在直接运行时执行示例
if (require.main === module) {
  exampleUsage().catch(console.error);
}

module.exports = {
  createEnhancedHandler
};
