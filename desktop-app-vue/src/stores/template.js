/**
 * Template Store shim for @/stores/template imports
 *
 * This file exists to support imports from '@/stores/template' in renderer code.
 * It re-exports from the renderer-specific store.
 */

export { useTemplateStore } from '../renderer/stores/template.js';
