/**
 * Auth Store shim for @/stores/auth imports
 *
 * This file exists to support imports from '@/stores/auth' in renderer code.
 * It re-exports from the renderer-specific store.
 */

export { useAuthStore } from '../renderer/stores/auth.js';
