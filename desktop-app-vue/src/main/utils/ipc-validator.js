/**
 * IPC 输入参数验证中间件
 * 使用 Zod 进行类型安全的参数验证
 *
 * 功能：
 * - 基于 schema 的自动验证
 * - 详细的验证错误信息
 * - 与 IPC 错误处理中间件集成
 * - 预定义常用 schema（项目、文件、用户等）
 */

const { z } = require('zod');
const { ValidationError } = require('./ipc-error-handler');
const { logger } = require('./logger');

// ============================================
// 基础 Schema 定义
// ============================================

/**
 * UUID 格式验证
 */
const uuidSchema = z.string().uuid('无效的 UUID 格式');

/**
 * 非空字符串
 */
const nonEmptyString = z.string().min(1, '字符串不能为空');

/**
 * 文件路径验证（防止路径遍历）
 */
const safePathSchema = z
  .string()
  .min(1, '路径不能为空')
  .refine(
    (path) => {
      // 禁止路径遍历
      if (path.includes('..')) return false;
      // 禁止绝对路径（应使用项目相对路径）
      if (path.startsWith('/') || /^[A-Z]:\\/.test(path)) return false;
      return true;
    },
    { message: '路径包含非法字符或格式' }
  );

/**
 * 分页参数
 */
const paginationSchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(1000).default(50),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

/**
 * 时间戳验证
 */
const timestampSchema = z.number().int().positive();

// ============================================
// 项目相关 Schema
// ============================================

/**
 * 项目 ID
 */
const projectIdSchema = uuidSchema;

/**
 * 项目创建参数
 */
const projectCreateSchema = z.object({
  name: z
    .string()
    .min(1, '项目名称不能为空')
    .max(100, '项目名称不能超过 100 个字符'),
  description: z.string().max(1000, '描述不能超过 1000 个字符').optional(),
  projectType: z
    .enum(['web', 'mobile', 'backend', 'ai', 'data', 'other'])
    .default('web'),
  userId: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

/**
 * 项目更新参数
 */
const projectUpdateSchema = z.object({
  name: z
    .string()
    .min(1, '项目名称不能为空')
    .max(100, '项目名称不能超过 100 个字符')
    .optional(),
  description: z.string().max(1000, '描述不能超过 1000 个字符').optional(),
  metadata: z.record(z.unknown()).optional()
});

/**
 * 项目列表查询参数
 */
const projectListSchema = paginationSchema.extend({
  userId: z.string().optional(),
  projectType: z.string().optional(),
  search: z.string().optional()
});

// ============================================
// 文件相关 Schema
// ============================================

/**
 * 文件 ID
 */
const fileIdSchema = uuidSchema;

/**
 * 文件内容更新参数
 */
const fileUpdateSchema = z.object({
  content: z.string(),
  version: z.number().int().min(0).optional(),
  encoding: z.enum(['utf-8', 'base64']).default('utf-8')
});

/**
 * 文件创建参数
 */
const fileCreateSchema = z.object({
  path: safePathSchema,
  content: z.string(),
  encoding: z.enum(['utf-8', 'base64']).default('utf-8')
});

/**
 * 批量文件操作参数
 */
const batchFileSchema = z.object({
  files: z.array(fileCreateSchema).min(1).max(100)
});

// ============================================
// 聊天/会话相关 Schema
// ============================================

/**
 * 会话 ID
 */
const sessionIdSchema = uuidSchema;

/**
 * 消息发送参数
 */
const messageSchema = z.object({
  content: z.string().min(1, '消息内容不能为空').max(100000),
  role: z.enum(['user', 'assistant', 'system']).default('user'),
  metadata: z.record(z.unknown()).optional()
});

/**
 * 会话创建参数
 */
const sessionCreateSchema = z.object({
  title: z.string().max(200).optional(),
  model: z.string().optional(),
  systemPrompt: z.string().max(10000).optional(),
  metadata: z.record(z.unknown()).optional()
});

// ============================================
// Git 相关 Schema
// ============================================

/**
 * Git 仓库路径
 */
const gitRepoPathSchema = safePathSchema;

/**
 * Git 提交参数
 */
const gitCommitSchema = z.object({
  message: z.string().min(1, '提交信息不能为空').max(500),
  files: z.array(safePathSchema).optional(),
  author: z
    .object({
      name: z.string(),
      email: z.string().email()
    })
    .optional()
});

/**
 * Git 分支名称
 */
const gitBranchSchema = z
  .string()
  .min(1)
  .max(250)
  .refine(
    (name) => {
      // Git 分支名规则
      if (name.startsWith('-')) return false;
      if (name.endsWith('.lock')) return false;
      if (/[\s~^:?*\[\]\\]/.test(name)) return false;
      if (/\.\./.test(name)) return false;
      return true;
    },
    { message: '无效的 Git 分支名称' }
  );

// ============================================
// 知识库相关 Schema
// ============================================

/**
 * 笔记 ID
 */
const noteIdSchema = uuidSchema;

/**
 * 笔记创建/更新参数
 */
const noteSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(500000),
  tags: z.array(z.string().max(50)).max(20).optional(),
  categoryId: uuidSchema.optional(),
  metadata: z.record(z.unknown()).optional()
});

/**
 * 笔记搜索参数
 */
const noteSearchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(100).default(20),
  useRAG: z.boolean().default(true),
  filters: z
    .object({
      tags: z.array(z.string()).optional(),
      categoryId: uuidSchema.optional(),
      dateRange: z
        .object({
          start: timestampSchema.optional(),
          end: timestampSchema.optional()
        })
        .optional()
    })
    .optional()
});

// ============================================
// 验证中间件
// ============================================

/**
 * 创建验证中间件
 * @param {z.ZodSchema} schema - Zod schema
 * @param {Object} options - 配置选项
 * @returns {Function} 验证包装器
 */
function withValidation(schema, options = {}) {
  const { argIndex = 0, enableLogging = true } = options;

  return (handler) => {
    return async (event, ...args) => {
      const argToValidate = args[argIndex];

      try {
        // 执行验证
        const validatedArg = schema.parse(argToValidate);

        // 替换验证后的参数（可能有默认值填充）
        const newArgs = [...args];
        newArgs[argIndex] = validatedArg;

        // 调用原始处理器
        return await handler(event, ...newArgs);
      } catch (error) {
        if (error instanceof z.ZodError) {
          const details = formatZodError(error);

          if (enableLogging) {
            logger.warn('[IPC-Validator] 验证失败:', {
              argIndex,
              errors: details.errors
            });
          }

          throw new ValidationError(details.message, {
            errors: details.errors,
            receivedValue:
              typeof argToValidate === 'object'
                ? JSON.stringify(argToValidate).substring(0, 200)
                : String(argToValidate).substring(0, 200)
          });
        }

        throw error;
      }
    };
  };
}

/**
 * 创建多参数验证中间件
 * @param {Object} schemas - 参数索引到 schema 的映射
 * @param {Object} options - 配置选项
 * @returns {Function} 验证包装器
 */
function withMultiValidation(schemas, options = {}) {
  const { enableLogging = true } = options;

  return (handler) => {
    return async (event, ...args) => {
      const validatedArgs = [...args];
      const allErrors = [];

      for (const [indexStr, schema] of Object.entries(schemas)) {
        const index = parseInt(indexStr, 10);
        const argToValidate = args[index];

        try {
          validatedArgs[index] = schema.parse(argToValidate);
        } catch (error) {
          if (error instanceof z.ZodError) {
            const details = formatZodError(error);
            allErrors.push({
              argIndex: index,
              errors: details.errors
            });
          } else {
            throw error;
          }
        }
      }

      if (allErrors.length > 0) {
        if (enableLogging) {
          logger.warn('[IPC-Validator] 多参数验证失败:', allErrors);
        }

        const message = allErrors
          .flatMap((e) => e.errors.map((err) => `参数${e.argIndex}: ${err}`))
          .join('; ');

        throw new ValidationError(message, { validationErrors: allErrors });
      }

      return await handler(event, ...validatedArgs);
    };
  };
}

/**
 * 格式化 Zod 错误
 * @param {z.ZodError} error - Zod 错误对象
 * @returns {Object} 格式化后的错误信息
 */
function formatZodError(error) {
  const errors = error.errors.map((e) => {
    const path = e.path.join('.');
    const message = e.message;
    return path ? `${path}: ${message}` : message;
  });

  return {
    message: errors.join('; '),
    errors
  };
}

// ============================================
// 预定义验证器
// ============================================

/**
 * 项目 ID 验证器
 */
const validateProjectId = withValidation(projectIdSchema);

/**
 * 项目创建验证器
 */
const validateProjectCreate = withValidation(projectCreateSchema);

/**
 * 项目更新验证器（第一个参数是 ID，第二个是更新数据）
 */
const validateProjectUpdate = withMultiValidation({
  0: projectIdSchema,
  1: projectUpdateSchema
});

/**
 * 项目列表验证器
 */
const validateProjectList = withValidation(projectListSchema);

/**
 * 文件更新验证器（第一个参数是项目 ID，第二个是文件路径，第三个是更新数据）
 */
const validateFileUpdate = withMultiValidation({
  0: projectIdSchema,
  1: safePathSchema,
  2: fileUpdateSchema
});

/**
 * 会话创建验证器
 */
const validateSessionCreate = withValidation(sessionCreateSchema);

/**
 * 消息发送验证器
 */
const validateMessage = withValidation(messageSchema);

/**
 * 笔记搜索验证器
 */
const validateNoteSearch = withValidation(noteSearchSchema);

// ============================================
// 导出
// ============================================

module.exports = {
  // Zod 实例（供自定义 schema 使用）
  z,

  // 基础 Schema
  uuidSchema,
  nonEmptyString,
  safePathSchema,
  paginationSchema,
  timestampSchema,

  // 项目相关 Schema
  projectIdSchema,
  projectCreateSchema,
  projectUpdateSchema,
  projectListSchema,

  // 文件相关 Schema
  fileIdSchema,
  fileUpdateSchema,
  fileCreateSchema,
  batchFileSchema,

  // 会话相关 Schema
  sessionIdSchema,
  messageSchema,
  sessionCreateSchema,

  // Git 相关 Schema
  gitRepoPathSchema,
  gitCommitSchema,
  gitBranchSchema,

  // 知识库相关 Schema
  noteIdSchema,
  noteSchema,
  noteSearchSchema,

  // 验证中间件
  withValidation,
  withMultiValidation,
  formatZodError,

  // 预定义验证器
  validateProjectId,
  validateProjectCreate,
  validateProjectUpdate,
  validateProjectList,
  validateFileUpdate,
  validateSessionCreate,
  validateMessage,
  validateNoteSearch
};
