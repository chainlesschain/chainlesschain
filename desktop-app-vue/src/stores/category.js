/**
 * Category Store shim for @/stores/category imports
 *
 * This file exists to support imports from '@/stores/category' in renderer code.
 * It re-exports from the renderer-specific store.
 */

export { useCategoryStore } from '../renderer/stores/category.js';
