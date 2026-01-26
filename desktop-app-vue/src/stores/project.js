/**
 * Project Store shim for @/stores/project imports
 *
 * This file exists to support imports from '@/stores/project' in renderer code.
 * It re-exports from the renderer-specific store.
 */

export { useProjectStore } from '../renderer/stores/project.js';
