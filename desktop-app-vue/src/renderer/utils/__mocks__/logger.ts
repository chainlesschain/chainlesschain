/**
 * Mock for logger.ts
 * Used by vitest to mock logger imports in tests
 */

import { vi } from 'vitest';

export class RendererLogger {
  module: string;

  constructor(module = 'test') {
    this.module = module;
  }

  log = vi.fn();
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
  fatal = vi.fn();
  perfStart = vi.fn();
  perfEnd = vi.fn();
  child = vi.fn((subModule: string) => new RendererLogger(`${this.module}:${subModule}`));
  setConfig = vi.fn();
  captureErrors = vi.fn();
}

export const logger = new RendererLogger('renderer');
export const createLogger = vi.fn((module: string) => new RendererLogger(module));

export default logger;
