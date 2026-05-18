/**
 * 日志管理器配置类型声明
 */

export const LOG_LEVELS: {
  DEBUG: 0;
  INFO: 1;
  WARN: 2;
  ERROR: 3;
  FATAL: 4;
};

export const LOG_LEVEL_NAMES: {
  0: 'DEBUG';
  1: 'INFO';
  2: 'WARN';
  3: 'ERROR';
  4: 'FATAL';
};

export interface LoggerConfig {
  level: number;
  console: boolean;
  file: boolean;
  fileConfig: {
    maxSize: number;
    maxFiles: number;
    compress: boolean;
  };
  stackTrace: boolean;
  timestamp: boolean;
  module: boolean;
  performance: {
    enabled: boolean;
    slowThreshold: number;
  };
}

export const DEFAULT_CONFIG: LoggerConfig;

export function formatLogMessage(
  level: number,
  module: string,
  message: string,
  data: any,
  timestamp: boolean
): string;

export function getStackTrace(): string;

export function sanitizeData(data: any): any;
