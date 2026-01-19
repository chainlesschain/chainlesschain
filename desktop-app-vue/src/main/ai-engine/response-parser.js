const { logger, createLogger } = require('../utils/logger.js');

/**
 * AI响应解析器
 * 从AI的响应中提取文件操作指令
 */

/**
 * 解析AI响应，提取文件操作
 *
 * @param {string} responseText - AI的响应文本
 * @param {Array} operations - 后端已解析的操作列表（如果有）
 * @returns {Object} 解析结果
 */
function parseAIResponse(responseText, operations = []) {
  const result = {
    textResponse: responseText,
    operations: operations || [],
    hasFileOperations: false
  };

  // 如果后端已经解析了操作，直接使用
  if (operations && operations.length > 0) {
    result.hasFileOperations = true;
    result.operations = normalizeOperations(operations);
    return result;
  }

  // 否则尝试从响应文本中解析
  // 方法1: 解析JSON代码块
  const jsonOps = extractJSONOperations(responseText);
  if (jsonOps.length > 0) {
    result.operations = normalizeOperations(jsonOps);
    result.hasFileOperations = true;
    return result;
  }

  // 方法2: 解析文件代码块（Markdown格式）
  const fileOps = extractFileBlocks(responseText);
  if (fileOps.length > 0) {
    result.operations = normalizeOperations(fileOps);
    result.hasFileOperations = true;
    return result;
  }

  return result;
}

/**
 * 从响应中提取JSON格式的操作指令
 *
 * @param {string} text - 响应文本
 * @returns {Array} 操作列表
 */
function extractJSONOperations(text) {
  const operations = [];

  try {
    // 查找 ```json ... ``` 代码块
    const jsonBlockRegex = /```json\s*([\s\S]*?)```/gi;
    const matches = text.matchAll(jsonBlockRegex);

    for (const match of matches) {
      try {
        const jsonStr = match[1].trim();
        const parsed = JSON.parse(jsonStr);

        // 处理两种格式：
        // 1. { "operations": [...] }
        // 2. 直接是数组 [...]
        if (Array.isArray(parsed)) {
          operations.push(...parsed);
        } else if (parsed.operations && Array.isArray(parsed.operations)) {
          operations.push(...parsed.operations);
        }
      } catch (e) {
        logger.error('Failed to parse JSON block:', e);
      }
    }
  } catch (e) {
    logger.error('Failed to extract JSON operations:', e);
  }

  return operations;
}

/**
 * 从响应中提取文件代码块
 *
 * 支持格式：
 * ```file:path/to/file.js
 * [content]
 * ```
 *
 * 或：
 * ```javascript:src/app.js
 * [content]
 * ```
 *
 * @param {string} text - 响应文本
 * @returns {Array} 操作列表
 */
function extractFileBlocks(text) {
  const operations = [];

  try {
    // 匹配带文件路径的代码块
    // 格式1: ```file:path/to/file.ext
    // 格式2: ```language:path/to/file.ext
    const fileBlockRegex = /```(?:file|([a-z]+)):([^\s\n]+)\s*([\s\S]*?)```/gi;
    const matches = text.matchAll(fileBlockRegex);

    for (const match of matches) {
      const language = match[1] || detectLanguage(match[2]);
      const path = match[2];
      const content = match[3].trim();

      if (path && content) {
        operations.push({
          type: 'CREATE',  // 默认为创建操作
          path: path,
          content: content,
          language: language
        });
      }
    }
  } catch (e) {
    logger.error('Failed to extract file blocks:', e);
  }

  return operations;
}

/**
 * 根据文件扩展名检测语言类型
 *
 * @param {string} filePath - 文件路径
 * @returns {string} 语言类型
 */
function detectLanguage(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const languageMap = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'vue': 'vue',
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'json': 'json',
    'md': 'markdown',
    'py': 'python',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'go': 'go',
    'rs': 'rust',
    'sh': 'bash',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'sql': 'sql'
  };

  return languageMap[ext] || ext;
}

/**
 * 标准化操作格式
 *
 * @param {Array} operations - 原始操作列表
 * @returns {Array} 标准化后的操作列表
 */
function normalizeOperations(operations) {
  return operations.map(op => {
    // 确保必需字段存在
    const normalized = {
      type: (op.type || 'CREATE').toUpperCase(),
      path: op.path || '',
      content: op.content || '',
      language: op.language || detectLanguage(op.path || ''),
      reason: op.reason || ''
    };

    // 验证操作类型
    const validTypes = ['CREATE', 'UPDATE', 'DELETE', 'READ'];
    if (!validTypes.includes(normalized.type)) {
      logger.warn(`Invalid operation type: ${normalized.type}, defaulting to CREATE`);
      normalized.type = 'CREATE';
    }

    // 验证路径
    if (!normalized.path) {
      logger.error('Operation missing path:', op);
    }

    // 对于CREATE和UPDATE操作，验证内容
    if (['CREATE', 'UPDATE'].includes(normalized.type) && !normalized.content) {
      logger.warn(`${normalized.type} operation missing content for path: ${normalized.path}`);
    }

    return normalized;
  });
}

/**
 * 验证操作的安全性
 *
 * @param {Object} operation - 文件操作
 * @param {string} projectPath - 项目根目录路径
 * @returns {Object} 验证结果 { valid: boolean, error: string }
 */
function validateOperation(operation, projectPath) {
  const path = require('path');

  // 1. 检查必需字段
  if (!operation.path) {
    return { valid: false, error: '操作缺少文件路径' };
  }

  // 2. 检查路径安全性
  const absolutePath = path.resolve(projectPath, operation.path);
  const normalizedProjectPath = path.normalize(projectPath);

  // 确保文件在项目目录内
  if (!absolutePath.startsWith(normalizedProjectPath)) {
    return { valid: false, error: '文件路径超出项目目录范围' };
  }

  // 3. 禁止访问敏感目录
  const forbiddenPaths = [
    'node_modules',
    '.git',
    '.env',
    '.env.local',
    'package-lock.json'
  ];

  const relativePath = path.relative(projectPath, absolutePath);
  for (const forbidden of forbiddenPaths) {
    if (relativePath.startsWith(forbidden) || relativePath.includes(`/${forbidden}`) || relativePath.includes(`\\${forbidden}`)) {
      return { valid: false, error: `禁止操作敏感文件/目录: ${forbidden}` };
    }
  }

  // 4. 检查文件名合法性
  const fileName = path.basename(operation.path);
  const invalidChars = /[<>:"|?*\x00-\x1F]/;
  if (invalidChars.test(fileName)) {
    return { valid: false, error: '文件名包含非法字符' };
  }

  // 5. 对于CREATE和UPDATE操作，检查内容
  if (['CREATE', 'UPDATE'].includes(operation.type) && !operation.content) {
    return { valid: false, error: `${operation.type}操作缺少文件内容` };
  }

  return { valid: true };
}

/**
 * 批量验证操作
 *
 * @param {Array} operations - 操作列表
 * @param {string} projectPath - 项目路径
 * @returns {Object} { valid: boolean, errors: Array }
 */
function validateOperations(operations, projectPath) {
  const errors = [];

  for (let i = 0; i < operations.length; i++) {
    const result = validateOperation(operations[i], projectPath);
    if (!result.valid) {
      errors.push(`操作 ${i + 1} (${operations[i].path}): ${result.error}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

module.exports = {
  parseAIResponse,
  extractJSONOperations,
  extractFileBlocks,
  detectLanguage,
  normalizeOperations,
  validateOperation,
  validateOperations
};
