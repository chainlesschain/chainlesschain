/**
 * Logger shim for @/utils/logger imports
 *
 * This file exists to support imports from '@/utils/logger' in renderer code.
 * It re-exports from the renderer-specific logger.
 *
 * For main process code, use '@main/utils/logger' instead.
 * For renderer code, you can use either '@/utils/logger' or '@renderer/utils/logger'.
 */

export { logger, createLogger, RendererLogger } from '../renderer/utils/logger.js';
