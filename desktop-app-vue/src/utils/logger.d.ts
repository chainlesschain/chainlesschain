/**
 * Logger 模块类型声明
 * 统一导出渲染进程和主进程的 logger 类型
 */

import { LoggerConfig } from '../shared/logger-config';

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

export class Logger {
  constructor(module?: string);

  module: string;
  config: LoggerConfig;
  logDir: string;
  currentLogFile: string | null;
  performanceMarks: Map<string, number>;

  ensureLogDirectory(): void;
  getCurrentLogFile(): string;
  rotateLogsIfNeeded(): void;

  log(level: number, message: string, data?: any): void;
  debug(message: string, data?: any): void;
  info(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, data?: any): void;
  fatal(message: string, data?: any): void;

  perfStart(label: string): void;
  perfEnd(label: string, data?: any): number | undefined;

  child(subModule: string): Logger;
  setConfig(config: Partial<LoggerConfig>): void;
  cleanup(daysToKeep?: number): number;
}

export const logger: RendererLogger | Logger;
export function createLogger(module: string): RendererLogger | Logger;
