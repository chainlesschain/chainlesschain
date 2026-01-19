/**
 * 渲染进程日志管理器类型声明
 */

import { LoggerConfig } from '../../shared/logger-config';

export class RendererLogger {
  constructor(module?: string);

  module: string;
  config: LoggerConfig;
  performanceMarks: Map<string, number>;
  ipcAvailable: boolean;

  log(level: number, message: string, data?: any): void;
  debug(message: string, data?: any): void;
  info(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, data?: any): void;
  fatal(message: string, data?: any): void;

  perfStart(label: string): void;
  perfEnd(label: string, data?: any): number | undefined;

  child(subModule: string): RendererLogger;
  setConfig(config: Partial<LoggerConfig>): void;
  captureErrors(): void;
}

export const logger: RendererLogger;
export function createLogger(module: string): RendererLogger;
