/**
 * 参数验证工具
 *
 * 使用 Ajv 进行 JSON Schema 验证
 */

import AjvModule from "ajv";
import type { ValidateFunction, ErrorObject } from "ajv";
import { logger } from "./logger.js";

// Ajv default export handling for ESM
const Ajv = AjvModule.default || AjvModule;

// 创建 Ajv 实例
const ajv = new Ajv({
  allErrors: true, // 返回所有错误，而非在第一个错误处停止
  verbose: true, // 在错误中包含更多信息
  coerceTypes: true, // 尝试类型强制转换
});

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  details?: ErrorObject[];
}

/**
 * 验证参数是否符合 JSON Schema
 *
 * @param args - 要验证的参数对象
 * @param schema - JSON Schema
 * @returns 验证结果
 */
export function validateArguments(
  args: unknown,
  schema: object,
): ValidationResult {
  try {
    const validate = ajv.compile(schema);
    const valid = validate(args);

    if (!valid) {
      const errors = validate.errors?.map((err: ErrorObject) => {
        const path = err.instancePath || "root";
        return `${path}: ${err.message}`;
      });

      logger.warn("Argument validation failed", { errors });

      return {
        valid: false,
        errors: errors || ["Unknown validation error"],
        details: validate.errors || undefined,
      };
    }

    return { valid: true };
  } catch (error) {
    logger.error("Schema compilation failed", error);
    return {
      valid: false,
      errors: [`Schema compilation error: ${error}`],
    };
  }
}

/**
 * 创建可重用的验证器
 *
 * @param schema - JSON Schema
 * @returns 编译后的验证函数
 */
export function createValidator(schema: object): ValidateFunction {
  return ajv.compile(schema);
}

/**
 * 自定义工具错误类
 */
export class ToolError extends Error {
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: string,
    details?: unknown,
    isOperational: boolean = true,
  ) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;

    // 保持原型链
    Object.setPrototypeOf(this, ToolError.prototype);
  }

  /**
   * 转换为 MCP 格式的错误响应
   */
  toMCPError() {
    return {
      content: [
        {
          type: "text",
          text: `Error [${this.code}]: ${this.message}`,
          isError: true,
        },
      ],
    };
  }
}

/**
 * 预定义的错误代码
 */
export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT_ERROR: "TIMEOUT_ERROR",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMIT: "RATE_LIMIT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
