/**
 * App Store shim for @/stores/app imports
 *
 * This file exists to support imports from '@/stores/app' in renderer code.
 * It re-exports from the renderer-specific store.
 */

export { useAppStore } from '../renderer/stores/app.js';
