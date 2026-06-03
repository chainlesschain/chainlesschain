/**
 * Tool Store shim for @/stores/tool imports
 *
 * This file exists to support imports from '@/stores/tool' in renderer code.
 * It re-exports from the renderer-specific store.
 */

export { useToolStore } from '../renderer/stores/tool.js';
